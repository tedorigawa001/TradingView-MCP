#include <node_api.h>
#include <sys/acl.h>
#include <sys/attr.h>
#include <sys/mount.h>
#include <sys/stat.h>
#include <sys/stdio.h>
#include <CommonCrypto/CommonDigest.h>
#include <CoreFoundation/CoreFoundation.h>
#include <dirent.h>
#include <uuid/uuid.h>
#include <fcntl.h>
#include <unistd.h>
#include <atomic>
#include <chrono>
#include <climits>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <regex>
#include <stdexcept>
#include <string>
#include <vector>
#include <algorithm>
#include <map>
#include <optional>
#include <set>

#if !defined(__APPLE__) || !defined(NATIVE_BAR_SYNTHETIC_ONLY)
#error This foundation build is macOS synthetic-only; production builds are not enabled.
#endif

namespace {
using Steady = std::chrono::steady_clock;
using Wall = std::chrono::system_clock;
std::atomic<int> fd_count{0}, session_count{0};
const napi_type_tag SESSION_TAG{0x750544e091ae44a1ULL, 0x8d6658fcf34f8b82ULL};
const napi_type_tag TARGET_TAG{0x917947cd14384372ULL, 0x82ae5672207842caULL};

void require(bool value, const char* code) { if (!value) throw std::runtime_error(code); }
void syscall_ok(int value, const char* code) { if (value < 0) throw std::runtime_error(std::string(code) + ":" + std::to_string(errno)); }
struct Fd {
  int value = -1;
  Fd() = default;
  explicit Fd(int fd) : value(fd) {
    syscall_ok(fd, "open_failed");
    if (++fd_count > 512) { ::close(value); value = -1; --fd_count; throw std::runtime_error("native_fd_limit"); }
  }
  Fd(Fd&& other) noexcept : value(other.value) { other.value = -1; }
  Fd& operator=(Fd&& other) noexcept { reset(); value = other.value; other.value = -1; return *this; }
  Fd(const Fd&) = delete;
  Fd& operator=(const Fd&) = delete;
  void reset() { if (value >= 0) { ::close(value); --fd_count; value = -1; } }
  ~Fd() { reset(); }
};
struct stat stat_fd(int fd) { struct stat st{}; syscall_ok(fstat(fd, &st), "fstat_failed"); return st; }
bool same_id(const struct stat& a, const struct stat& b) { return a.st_dev == b.st_dev && a.st_ino == b.st_ino; }
std::string private_access(int fd, bool directory, bool strict) {
  auto st = stat_fd(fd);
  require(directory ? S_ISDIR(st.st_mode) : S_ISREG(st.st_mode), "nonregular_object");
  require(st.st_uid == getuid() || (!strict && st.st_uid == 0), "foreign_owner");
  require(strict ? (st.st_mode & 0077) == 0 : ((st.st_mode & 0022) == 0 || (st.st_mode & S_ISVTX)), "unsafe_mode");
  acl_t acl = acl_get_fd_np(fd, ACL_TYPE_EXTENDED);
  if (!acl) {
    // Darwin also returns ENOENT for an absent ACL. Confirm absence on this FD.
    require(errno == ENOENT, "acl_unverified");
    filesec_t sec = filesec_init(); require(sec != nullptr, "acl_unverified");
    struct Security { filesec_t value; ~Security() { filesec_free(value); } } security{sec};
    struct stat checked{}; syscall_ok(fstatx_np(fd, &checked, sec), "acl_unverified");
    int present = 1; syscall_ok(filesec_query_property(sec, FILESEC_ACL, &present), "acl_unverified");
    require(!present && same_id(st, checked), "acl_unverified");
    return "none";
  }
  struct Acl { acl_t value; ~Acl() { acl_free(value); } } guard{acl};
  syscall_ok(acl_valid(acl), "acl_invalid");
  for (int index = 0; index < 256; ++index) {
    acl_entry_t entry;
    if (acl_get_entry(acl, index, &entry) < 0) { require(errno == EINVAL, "acl_iteration_failed"); return index ? "deny_only" : "none"; }
    acl_tag_t tag;
    syscall_ok(acl_get_tag_type(entry, &tag), "acl_tag_unverified");
    require(tag == ACL_EXTENDED_DENY, "unsafe_acl");
  }
  throw std::runtime_error("acl_entry_limit");
}
struct Anchor { Fd fd; std::string name; bool strict; };
struct Target;
struct ReadSnapshot;
struct Session {
  std::vector<Anchor> chain;
  std::vector<std::weak_ptr<Target>> targets;
  std::weak_ptr<ReadSnapshot> snapshot;
  uint64_t read_bytes = 0;
  bool read_only = false;
  bool coordination_only = false;
  Steady::time_point deadline;
  Wall::time_point wall_deadline;
  pid_t pid = getpid();
  bool closed = false;
  bool busy = false;
  Session() { if (++session_count > 8) { --session_count; throw std::runtime_error("native_session_limit"); } }
  ~Session();
  int root() const { return chain.back().fd.value; }
  void release() noexcept;
  void close();
  void check_deadline() {
    require(!closed, "session_closed");
    require(pid == getpid(), "session_process_mismatch");
    if (Steady::now() >= deadline || Wall::now() >= wall_deadline) {
      if (!coordination_only) release();
      throw std::runtime_error("session_expired");
    }
  }
  void namespace_guard() {
    require(!closed && pid == getpid(), "session_closed_or_wrong_process");
    for (size_t i = 0; i < chain.size(); ++i) {
      private_access(chain[i].fd.value, true, chain[i].strict);
      if (i) {
        struct stat entry{};
        syscall_ok(fstatat(chain[i - 1].fd.value, chain[i].name.c_str(), &entry, AT_SYMLINK_NOFOLLOW), "namespace_changed");
        require(S_ISDIR(entry.st_mode) && same_id(entry, stat_fd(chain[i].fd.value)), "namespace_changed");
      }
    }
  }
  void guard() { check_deadline(); namespace_guard(); check_deadline(); }
};
void napi_ok_or_throw(napi_status s) { require(s == napi_ok, "native_argument_error"); }
std::string string_arg(napi_env env, napi_value value) {
  napi_valuetype type; napi_ok_or_throw(napi_typeof(env, value, &type)); require(type == napi_string, "string_required");
  size_t size; napi_ok_or_throw(napi_get_value_string_utf8(env, value, nullptr, 0, &size)); require(size <= 4096, "string_limit");
  std::vector<char> bytes(size + 1); size_t got;
  napi_ok_or_throw(napi_get_value_string_utf8(env, value, bytes.data(), bytes.size(), &got));
  require(got == size && std::strlen(bytes.data()) == size, "invalid_string");
  return std::string(bytes.data(), size);
}
napi_value text(napi_env env, const std::string& value) { napi_value out; napi_ok_or_throw(napi_create_string_utf8(env, value.c_str(), value.size(), &out)); return out; }
napi_value object(napi_env env) { napi_value out; napi_ok_or_throw(napi_create_object(env, &out)); return out; }
void prop(napi_env env, napi_value out, const char* key, napi_value value) { napi_ok_or_throw(napi_set_named_property(env, out, key, value)); }
napi_value undefined(napi_env env) { napi_value out; napi_get_undefined(env, &out); return out; }
template<typename Fn> napi_value boundary(napi_env env, Fn work) {
  try { return work(); } catch (const std::exception& e) {
    bool pending = false; napi_is_exception_pending(env, &pending);
    if (!pending) napi_throw_error(env, "NATIVE_BAR_FS", e.what());
    return nullptr;
  }
}
std::shared_ptr<Session> session_arg(napi_env env, napi_value value) {
  bool matches = false; napi_ok_or_throw(napi_check_object_type_tag(env, value, &SESSION_TAG, &matches)); require(matches, "invalid_session_handle");
  void* pointer; napi_ok_or_throw(napi_unwrap(env, value, &pointer));
  return *static_cast<std::shared_ptr<Session>*>(pointer);
}
void qualify_volume(int fd) {
  struct statfs fs{}; syscall_ok(fstatfs(fd, &fs), "filesystem_unverified");
  require(std::string(fs.f_fstypename) == "apfs" && (fs.f_flags & MNT_LOCAL)
    && !(fs.f_flags & MNT_IGNORE_OWNERSHIP), "unsupported_filesystem");
  struct attrlist attrs{}; attrs.bitmapcount = ATTR_BIT_MAP_COUNT; attrs.volattr = ATTR_VOL_CAPABILITIES;
  struct { uint32_t length; vol_capabilities_attr_t caps; } result{};
  syscall_ok(fgetattrlist(fd, &attrs, &result, sizeof(result), 0), "volume_capabilities_unverified");
  require(result.length == sizeof(result) && (result.caps.valid[VOL_CAPABILITIES_INTERFACES] & VOL_CAP_INT_RENAME_EXCL)
    && (result.caps.capabilities[VOL_CAPABILITIES_INTERFACES] & VOL_CAP_INT_RENAME_EXCL), "exclusive_rename_unavailable");
}
struct Proof { struct stat metadata; std::string sha256; };
bool equal_metadata(const struct stat& a, const struct stat& b, bool renamed = false) {
  return same_id(a, b) && a.st_mode == b.st_mode && a.st_uid == b.st_uid && a.st_gid == b.st_gid
    && a.st_nlink == b.st_nlink && a.st_size == b.st_size && a.st_flags == b.st_flags
    && a.st_birthtimespec.tv_sec == b.st_birthtimespec.tv_sec && a.st_birthtimespec.tv_nsec == b.st_birthtimespec.tv_nsec
    && a.st_mtimespec.tv_sec == b.st_mtimespec.tv_sec && a.st_mtimespec.tv_nsec == b.st_mtimespec.tv_nsec
    && (renamed || (a.st_ctimespec.tv_sec == b.st_ctimespec.tv_sec && a.st_ctimespec.tv_nsec == b.st_ctimespec.tv_nsec));
}
Proof proof(int fd) {
  private_access(fd, false, true); auto before = stat_fd(fd);
  require(before.st_nlink == 1, "hard_link_refused");
  require(before.st_size >= 0 && before.st_size <= 1024 * 1024, "artifact_size_limit");
  std::vector<unsigned char> bytes(static_cast<size_t>(before.st_size));
  size_t offset = 0;
  while (offset < bytes.size()) {
    ssize_t got = pread(fd, bytes.data() + offset, bytes.size() - offset, static_cast<off_t>(offset));
    if (got < 0 && errno == EINTR) continue;
    require(got > 0, "artifact_read_changed"); offset += static_cast<size_t>(got);
  }
  unsigned char digest[CC_SHA256_DIGEST_LENGTH]; CC_SHA256(bytes.data(), static_cast<CC_LONG>(bytes.size()), digest);
  std::string hash; static const char* hex = "0123456789abcdef";
  for (auto byte : digest) { hash += hex[byte >> 4]; hash += hex[byte & 15]; }
  private_access(fd, false, true); require(equal_metadata(before, stat_fd(fd)), "artifact_read_changed");
  return {before, hash};
}
void compare(const Proof& a, const Proof& b, bool renamed = false) {
  require(equal_metadata(a.metadata, b.metadata, renamed) && a.sha256 == b.sha256, "target_changed");
}
Fd directory(int parent, const std::string& name) {
  Fd fd(openat(parent, name.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC));
  private_access(fd.value, true, true);
  require(stat_fd(parent).st_dev == stat_fd(fd.value).st_dev, "cross_device_refused"); return fd;
}
void binding(int parent, const std::string& name, int fd, bool is_directory) {
  private_access(fd, is_directory, true); struct stat entry{};
  syscall_ok(fstatat(parent, name.c_str(), &entry, AT_SYMLINK_NOFOLLOW), "namespace_changed");
  require(same_id(entry, stat_fd(fd)) && (is_directory ? S_ISDIR(entry.st_mode) : S_ISREG(entry.st_mode)), "namespace_changed");
}
Fd leaf(int parent, const std::string& name) {
  return Fd(openat(parent, name.c_str(), O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC));
}
std::string uuid() { uuid_t value; uuid_generate_random(value); char out[37]; uuid_unparse_lower(value, out); return out; }
void sync_dir(int fd) { syscall_ok(fsync(fd), "directory_sync_failed"); }
struct Target {
  std::weak_ptr<Session> session;
  Fd area_fd, day_fd, file_fd, hold_fd, slot_fd;
  std::string area, day, name, operation, destination, state = "previewed";
  Proof expected;
  bool moved = false;
  void close() { area_fd.reset(); day_fd.reset(); file_fd.reset(); hold_fd.reset(); slot_fd.reset(); }
  void source_parents(Session& s) {
    binding(s.root(), area, area_fd.value, true); binding(area_fd.value, day, day_fd.value, true);
  }
  void source_binding(Session& s) {
    source_parents(s);
    binding(day_fd.value, name, file_fd.value, false);
  }
  void held_binding(Session& s) {
    binding(s.root(), "maintenance-hold", hold_fd.value, true);
    binding(hold_fd.value, operation, slot_fd.value, true);
    binding(slot_fd.value, destination, file_fd.value, false);
  }
};
void release_snapshot(Session& session) noexcept;
Session::~Session() { release(); }
void Session::release() noexcept {
  if (closed) return;
  for (auto& weak : targets) if (auto target = weak.lock()) target->close();
  targets.clear(); release_snapshot(*this); chain.clear(); closed = true; --session_count;
}
void Session::close() { require(!busy, "session_busy"); release(); }
struct Busy {
  Session& session;
  explicit Busy(Session& value) : session(value) { require(!session.busy, "session_busy"); session.busy = true; }
  ~Busy() { session.busy = false; }
};
template<typename T> napi_value wrap(napi_env env, std::shared_ptr<T> value, const napi_type_tag& tag) {
  auto handle = object(env); auto* wrapper = new std::shared_ptr<T>(std::move(value));
  auto status = napi_wrap(env, handle, wrapper, [](napi_env, void* data, void*) { delete static_cast<std::shared_ptr<T>*>(data); }, nullptr, nullptr);
  if (status != napi_ok) { delete wrapper; napi_ok_or_throw(status); }
  napi_ok_or_throw(napi_type_tag_object(env, handle, &tag)); return handle;
}
std::shared_ptr<Target> target_arg(napi_env env, napi_value value) {
  bool matches = false; napi_ok_or_throw(napi_check_object_type_tag(env, value, &TARGET_TAG, &matches)); require(matches, "invalid_target_handle");
  void* pointer; napi_ok_or_throw(napi_unwrap(env, value, &pointer)); return *static_cast<std::shared_ptr<Target>*>(pointer);
}
napi_value target_status(napi_env env, const Target& t) {
  auto out = object(env); prop(env, out, "state", text(env, t.state));
  napi_value moved; napi_get_boolean(env, t.moved, &moved); prop(env, out, "moved", moved);
  prop(env, out, "holding", text(env, t.operation.empty() ? "" : "maintenance-hold/" + t.operation + "/" + t.destination));
  auto p = object(env);
  prop(env, p, "device", text(env, std::to_string(t.expected.metadata.st_dev)));
  prop(env, p, "inode", text(env, std::to_string(t.expected.metadata.st_ino)));
  prop(env, p, "size", text(env, std::to_string(t.expected.metadata.st_size)));
  prop(env, p, "uid", text(env, std::to_string(t.expected.metadata.st_uid)));
  prop(env, p, "gid", text(env, std::to_string(t.expected.metadata.st_gid)));
  prop(env, p, "mode", text(env, std::to_string(t.expected.metadata.st_mode)));
  prop(env, p, "nlink", text(env, std::to_string(t.expected.metadata.st_nlink)));
  auto ns = [](timespec time) {
    __int128 value = static_cast<__int128>(time.tv_sec) * 1000000000 + time.tv_nsec;
    bool negative = value < 0; if (negative) value = -value;
    std::string out; do { out.insert(out.begin(), static_cast<char>('0' + value % 10)); value /= 10; } while (value);
    return negative ? "-" + out : out;
  };
  prop(env, p, "mtime_ns", text(env, ns(t.expected.metadata.st_mtimespec)));
  prop(env, p, "ctime_ns", text(env, ns(t.expected.metadata.st_ctimespec)));
  prop(env, p, "sha256", text(env, t.expected.sha256)); prop(env, out, "proof", p); return out;
}
void hook(napi_env env, napi_value callback, const char* phase, const Target& t) {
  napi_valuetype type; napi_ok_or_throw(napi_typeof(env, callback, &type));
  if (type == napi_undefined) return;
  require(type == napi_function, "invalid_test_hook");
  napi_value result, args[] = {text(env, phase), target_status(env, t)};
  napi_ok_or_throw(napi_call_function(env, undefined(env), callback, 2, args, &result));
  napi_ok_or_throw(napi_typeof(env, result, &type)); require(type == napi_undefined, "test_hook_must_be_synchronous_void");
}
napi_value inspect_target(napi_env env, napi_callback_info info) {
  return boundary(env, [&] {
    size_t argc = 4; napi_value args[4]; napi_ok_or_throw(napi_get_cb_info(env, info, &argc, args, nullptr, nullptr)); require(argc == 4, "argument_count");
    auto s = session_arg(env, args[0]); Busy busy(*s); s->guard();
    require(!s->read_only, "read_only_session");
    auto t = std::make_shared<Target>(); t->session = s;
    t->area = string_arg(env, args[1]); t->day = string_arg(env, args[2]); t->name = string_arg(env, args[3]);
    require(t->area == "captures" || t->area == "receipts", "invalid_area");
    require(std::regex_match(t->day, std::regex("[0-9]{4}-[0-9]{2}-[0-9]{2}")), "invalid_day");
    require(std::regex_match(t->name, std::regex("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.json")), "invalid_name");
    size_t live = 0; for (auto it = s->targets.begin(); it != s->targets.end();) {
      if (it->expired()) it = s->targets.erase(it); else { ++live; ++it; }
    }
    require(live < 32, "native_target_limit");
    t->area_fd = directory(s->root(), t->area); t->day_fd = directory(t->area_fd.value, t->day);
    t->file_fd = leaf(t->day_fd.value, t->name); t->expected = proof(t->file_fd.value);
    require(t->expected.metadata.st_dev == stat_fd(s->root()).st_dev, "cross_device_refused");
    s->guard(); t->source_binding(*s); s->targets.push_back(t); return wrap(env, t, TARGET_TAG);
  });
}
napi_value status_target(napi_env env, napi_callback_info info) {
  return boundary(env, [&] { size_t argc = 1; napi_value args[1]; napi_ok_or_throw(napi_get_cb_info(env, info, &argc, args, nullptr, nullptr)); require(argc == 1, "argument_count"); return target_status(env, *target_arg(env, args[0])); });
}
napi_value stage_target(napi_env env, napi_callback_info info) {
  return boundary(env, [&] {
    size_t argc = 2; napi_value args[2]; napi_ok_or_throw(napi_get_cb_info(env, info, &argc, args, nullptr, nullptr)); require(argc == 2, "argument_count");
    auto t = target_arg(env, args[0]); auto s = t->session.lock(); require(s != nullptr, "session_closed"); Busy busy(*s);
    require(!s->read_only, "read_only_session");
    require(t->state == "previewed", "target_not_previewed");
    try {
      s->guard(); t->source_binding(*s); compare(t->expected, proof(t->file_fd.value)); t->state = "preparing";
      s->check_deadline();
      if (mkdirat(s->root(), "maintenance-hold", 0700) < 0) require(errno == EEXIST, "holding_create_failed");
      t->hold_fd = directory(s->root(), "maintenance-hold");
      t->operation = uuid(); t->destination = uuid();
      s->check_deadline();
      syscall_ok(mkdirat(t->hold_fd.value, t->operation.c_str(), 0700), "exclusive_slot_create_failed");
      t->slot_fd = directory(t->hold_fd.value, t->operation);
      sync_dir(t->slot_fd.value); sync_dir(t->hold_fd.value); sync_dir(s->root());
      hook(env, args[1], "before_move", *t);
      s->guard(); t->source_binding(*s); compare(t->expected, proof(t->file_fd.value));
      binding(s->root(), "maintenance-hold", t->hold_fd.value, true); binding(t->hold_fd.value, t->operation, t->slot_fd.value, true);
      hook(env, args[1], "after_source_check", *t);
      s->check_deadline();
      syscall_ok(renameatx_np(t->day_fd.value, t->name.c_str(), t->slot_fd.value, t->destination.c_str(),
        RENAME_EXCL | RENAME_NOFOLLOW_ANY | RENAME_RESOLVE_BENEATH), "exclusive_move_failed");
      t->moved = true; t->state = "staging";
      hook(env, args[1], "after_move", *t);
      auto held = leaf(t->slot_fd.value, t->destination); auto checked = proof(held.value);
      compare(t->expected, checked, true); t->file_fd = std::move(held); t->expected = checked;
      s->guard(); t->source_parents(*s); t->held_binding(*s);
      t->state = "durability_unknown";
      hook(env, args[1], "before_stage_sync", *t);
      syscall_ok(fsync(t->file_fd.value), "file_sync_failed");
      sync_dir(t->day_fd.value); sync_dir(t->slot_fd.value); sync_dir(t->hold_fd.value); sync_dir(s->root());
      s->guard(); t->source_parents(*s); t->held_binding(*s); compare(t->expected, proof(t->file_fd.value));
      t->state = "held_verified"; return target_status(env, *t);
    } catch (...) { if (t->state != "durability_unknown") t->state = "conflict"; throw; }
  });
}
napi_value purge_target(napi_env env, napi_callback_info info) {
  return boundary(env, [&] {
    size_t argc = 2; napi_value args[2]; napi_ok_or_throw(napi_get_cb_info(env, info, &argc, args, nullptr, nullptr)); require(argc == 2, "argument_count");
    auto t = target_arg(env, args[0]); auto s = t->session.lock(); require(s != nullptr, "session_closed"); Busy busy(*s);
    require(!s->read_only, "read_only_session");
    require(t->state == "held_verified", "target_not_held");
    try {
      s->guard();
      hook(env, args[1], "before_unlink", *t);
      s->guard(); t->held_binding(*s); compare(t->expected, proof(t->file_fd.value));
      s->check_deadline();
      syscall_ok(unlinkat(t->slot_fd.value, t->destination.c_str(), 0), "held_unlink_failed");
      t->state = "durability_unknown";
      hook(env, args[1], "after_unlink", *t);
      sync_dir(t->slot_fd.value);
      struct stat absent{}; require(fstatat(t->slot_fd.value, t->destination.c_str(), &absent, AT_SYMLINK_NOFOLLOW) < 0 && errno == ENOENT, "unlink_absence_unverified");
      require(stat_fd(t->file_fd.value).st_nlink == 0, "unlinked_identity_unverified");
      t->state = "purged"; return target_status(env, *t);
    } catch (...) { if (t->state != "durability_unknown") t->state = "conflict"; throw; }
  });
}
std::shared_ptr<Session> create_root(napi_env env, napi_callback_info info, bool read_only) {
    size_t argc = 2; napi_value args[2]; napi_ok_or_throw(napi_get_cb_info(env, info, &argc, args, nullptr, nullptr)); require(argc == 2, "argument_count");
    auto path = string_arg(env, args[0]);
    double ttl; napi_ok_or_throw(napi_get_value_double(env, args[1], &ttl)); require(ttl >= 1 && ttl <= 600000 && ttl == static_cast<int>(ttl), "invalid_deadline");
    char temp[PATH_MAX]; require(realpath(std::getenv("TMPDIR") ? std::getenv("TMPDIR") : "/tmp", temp), "temporary_anchor_unavailable");
    std::string prefix = std::string(temp) + "/native-bar-fs-synthetic-";
    require(path.compare(0, prefix.size(), prefix) == 0 && path.size() == prefix.size() + 12
      && path.substr(path.size() - 6) == "/store", "synthetic_root_required");
    const auto suffix = path.substr(prefix.size(), 6);
    require(suffix.find_first_not_of("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789") == std::string::npos, "synthetic_root_required");
    auto session = std::make_shared<Session>();
    session->read_only = read_only;
    session->deadline = Steady::now() + std::chrono::milliseconds(static_cast<int>(ttl));
    session->wall_deadline = Wall::now() + std::chrono::milliseconds(static_cast<int>(ttl));
    session->chain.push_back({Fd(open("/", O_RDONLY | O_DIRECTORY | O_CLOEXEC)), "", false});
    size_t start = 1; bool strict = false;
    while (start < path.size()) {
      size_t end = path.find('/', start); if (end == std::string::npos) end = path.size();
      auto name = path.substr(start, end - start); require(!name.empty() && name != "." && name != "..", "invalid_component");
      if (name.compare(0, 24, "native-bar-fs-synthetic-") == 0) strict = true;
      Fd fd(openat(session->chain.back().fd.value, name.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC));
      private_access(fd.value, true, strict);
      session->chain.push_back({std::move(fd), name, strict}); start = end + 1;
    }
    const int parent = session->chain[session->chain.size() - 2].fd.value;
    Fd marker(openat(parent, ".native-bar-fs-synthetic", O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC));
    private_access(marker.value, false, true); char bytes[32]{};
    require(read(marker.value, bytes, sizeof(bytes)) == 21 && std::string(bytes, 21) == "synthetic-fixture-v1\n", "synthetic_marker_required");
    qualify_volume(session->root()); session->guard();
    return session;
}
napi_value open_root_impl(napi_env env, napi_callback_info info, bool read_only) {
  return boundary(env, [&] { return wrap(env, create_root(env, info, read_only), SESSION_TAG); });
}
napi_value open_root(napi_env env, napi_callback_info info) { return open_root_impl(env, info, false); }
napi_value open_read_root(napi_env env, napi_callback_info info) { return open_root_impl(env, info, true); }
napi_value close_root(napi_env env, napi_callback_info info) {
  return boundary(env, [&] { size_t argc = 1; napi_value args[1]; napi_ok_or_throw(napi_get_cb_info(env, info, &argc, args, nullptr, nullptr)); require(argc == 1, "argument_count"); session_arg(env, args[0])->close(); return undefined(env); });
}
#include "native_bar_read.inc"
#include "native_bar_writer.inc"
napi_value backend_info(napi_env env, napi_callback_info) {
  return boundary(env, [&] {
    auto out = object(env); napi_value version, fds, sessions;
    napi_ok_or_throw(napi_create_int32(env, 1, &version)); prop(env, out, "protocol", version);
    napi_ok_or_throw(napi_create_int32(env, 2, &version)); prop(env, out, "read_protocol", version);
    napi_ok_or_throw(napi_create_int32(env, 3, &version)); prop(env, out, "coordination_protocol", version);
    prop(env, out, "mode", text(env, "synthetic_only"));
    napi_ok_or_throw(napi_create_int32(env, fd_count.load(), &fds)); prop(env, out, "live_fds", fds);
    napi_ok_or_throw(napi_create_int32(env, session_count.load(), &sessions)); prop(env, out, "live_sessions", sessions);
    return out;
  });
}
} // namespace

NAPI_MODULE_INIT() {
  napi_property_descriptor methods[] = {
    {"info", nullptr, backend_info, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"openRoot", nullptr, open_root, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"openReadRoot", nullptr, open_read_root, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"openCoordination", nullptr, open_coordination, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"coordinationCall", nullptr, coordination_call, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"inventory", nullptr, read_inventory, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"readEvidence", nullptr, read_evidence, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"verifyInventory", nullptr, verify_inventory, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"closeInventory", nullptr, close_inventory, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"closeRoot", nullptr, close_root, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"inspect", nullptr, inspect_target, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"status", nullptr, status_target, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"stage", nullptr, stage_target, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"purge", nullptr, purge_target, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  if (napi_define_properties(env, exports, sizeof(methods) / sizeof(methods[0]), methods) != napi_ok) return nullptr;
  return exports;
}
