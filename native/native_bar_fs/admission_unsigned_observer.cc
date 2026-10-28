// Standalone test observer. Not linked into the addon and not built or invoked by an existing entry.
#if defined(__APPLE__)
#include <sys/attr.h>
#include <sys/acl.h>
#include <sys/mount.h>
#include <sys/stat.h>
#include <sys/vnode.h>
#include <fcntl.h>
#include <dirent.h>
#include <unistd.h>
#include <CommonCrypto/CommonDigest.h>
#include <algorithm>
#include <cerrno>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <map>
#include <memory>
#include <regex>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace {
constexpr uint64_t MAX_NODES = 19, MAX_WORK = 4194304, MAX_CONTENT = 131072, MAX_ACL = 65536, MAX_OUTPUT = 65536;
uint64_t work = 0, content = 0, nodes = 0;
void check(bool ok, const char* code) { if (!ok) throw std::runtime_error(code); }
void charge(uint64_t n) { check(n <= MAX_WORK - work, "observer_work_bound"); work += n; }
struct Fd {
  int value;
  explicit Fd(int fd) : value(fd) { check(fd >= 0, "observer_open_refused"); }
  ~Fd() { if (value >= 0) ::close(value); }
  Fd(const Fd&) = delete; Fd& operator=(const Fd&) = delete;
};
struct stat status(int fd) { struct stat s{}; charge(sizeof(s)); check(fstat(fd, &s) == 0, "observer_fstat"); return s; }
bool identity(const struct stat& a, const struct stat& b) {
  return a.st_dev == b.st_dev && a.st_ino == b.st_ino && a.st_uid == b.st_uid && a.st_gid == b.st_gid && a.st_mode == b.st_mode
    && a.st_flags == b.st_flags && a.st_birthtimespec.tv_sec == b.st_birthtimespec.tv_sec && a.st_birthtimespec.tv_nsec == b.st_birthtimespec.tv_nsec;
}
bool stable(const struct stat& a, const struct stat& b) {
  return identity(a, b) && a.st_size == b.st_size && a.st_nlink == b.st_nlink && a.st_blocks == b.st_blocks
    && a.st_mtimespec.tv_sec == b.st_mtimespec.tv_sec && a.st_mtimespec.tv_nsec == b.st_mtimespec.tv_nsec
    && a.st_ctimespec.tv_sec == b.st_ctimespec.tv_sec && a.st_ctimespec.tv_nsec == b.st_ctimespec.tv_nsec;
}
std::string quote(const std::string& s) {
  std::string r = "\""; for (unsigned char c : s) { check(c >= 32 && c < 127, "observer_text"); if (c == '"' || c == '\\') r += '\\'; r += c; } return r + '"';
}
std::string hex(const unsigned char* d) { const char* h = "0123456789abcdef"; std::string r; for (size_t i = 0; i < 32; i++) { r += h[d[i] >> 4]; r += h[d[i] & 15]; } return r; }
std::string hash(const std::string& b) { unsigned char d[32]; CC_SHA256(b.data(), static_cast<CC_LONG>(b.size()), d); return hex(d); }
std::string ns(timespec t) {
  check(t.tv_sec >= 0 && t.tv_nsec >= 0 && t.tv_nsec < 1000000000 && static_cast<uint64_t>(t.tv_sec) <= (UINT64_MAX - 999999999) / 1000000000, "observer_time");
  return std::to_string(static_cast<uint64_t>(t.tv_sec) * 1000000000 + static_cast<uint64_t>(t.tv_nsec));
}
template<class T> T attribute(const std::string& path, attrgroup_t common, attrgroup_t volume = 0) {
  attrlist a{}; a.bitmapcount = ATTR_BIT_MAP_COUNT; a.commonattr = common; a.volattr = volume;
  unsigned char bytes[sizeof(T) + 16]{}; charge(sizeof(bytes));
  check(getattrlist(path.c_str(), &a, bytes, sizeof(bytes), FSOPT_NOFOLLOW) == 0, "observer_attribute");
  uint32_t n; std::memcpy(&n, bytes, 4); check(n == sizeof(T) + 4, "observer_attribute_size");
  T out; std::memcpy(&out, bytes + 4, sizeof(out)); return out;
}
std::pair<std::string, std::string> acl(int fd) {
  const auto before = status(fd); charge(512);
  acl_t a = acl_get_fd_np(fd, ACL_TYPE_EXTENDED);
  if (!a) {
    check(errno == ENOENT, "observer_acl_unknown");
    filesec_t sec = filesec_init(); check(sec != nullptr, "observer_acl_unknown");
    struct Security { filesec_t s; ~Security() { filesec_free(s); } } guard{sec};
    struct stat after{}; int present = 1; charge(sizeof(after));
    check(fstatx_np(fd, &after, sec) == 0 && filesec_query_property(sec, FILESEC_ACL, &present) == 0
      && !present && identity(before, after), "observer_acl_unknown"); charge(4); return {"none", hash("none")};
  }
  struct Acl { acl_t a; ~Acl() { acl_free(a); } } guard{a}; check(acl_valid(a) == 0, "observer_acl_invalid");
  std::string kind = "none";
  for (int i = 0; ; ++i) {
    acl_entry_t e; charge(64);
    if (acl_get_entry(a, i, &e) < 0) { check(errno == EINVAL, "observer_acl_entry"); break; }
    check(i < 256, "observer_acl_entries"); acl_tag_t tag;
    check(acl_get_tag_type(e, &tag) == 0 && tag == ACL_EXTENDED_DENY, "observer_acl_allow"); kind = "deny_only";
  }
  ssize_t n = 0; char* t = acl_to_text(a, &n); check(t != nullptr, "observer_acl_text");
  struct Text { char* p; ~Text() { acl_free(p); } } text{t};
  check(n >= 0 && static_cast<uint64_t>(n) <= MAX_ACL, "observer_acl_text_bound"); charge(static_cast<uint64_t>(n));
  return {kind, hash(std::string(t, static_cast<size_t>(n)))};
}
struct Entry { std::string path; bool directory; };
std::vector<Entry> recipe(const std::string& c, const std::string& extra) {
  const std::vector<std::string> cases{"u0-unavailable", "u0-unsigned", "u1-unsigned", "u2-missing", "u2-extra", "u2-gap", "u3-pending",
    "u3-writer", "u3-reserve", "u3-maintenance", "u3-maintenance-bound", "u4-expected-inode"};
  check(std::find(cases.begin(), cases.end(), c) != cases.end(), "observer_case");
  std::vector<Entry> r{{"", true}, {"store", true}, {"admission-witness", true}, {".native-bar-fs-synthetic", false},
    {".native-bar-admission-synthetic", false}, {"store/policy.json", false}};
  if (c != "u2-missing") r.push_back({c == "u2-gap" ? "admission-witness/2.json" : "admission-witness/1.json", false});
  if (c == "u2-extra") r.push_back({"admission-witness/2.json", false});
  if (c == "u3-pending") r.push_back({"store/.producer-" + extra + ".tmp", false});
  if (c == "u3-writer") r.push_back({"store/.writer.lock", false});
  if (c == "u3-reserve") r.push_back({"store/.quarantine-reserve-" + extra + ".tmp", false});
  if (c == "u3-maintenance" || c == "u3-maintenance-bound") { r.push_back({"store/maintenance", true}); r.push_back({"store/maintenance/" + extra + ".json", false}); }
  check(r.size() <= 16, "observer_recipe_bound"); return r;
}
std::string parent(const std::string& path) { const auto p = path.rfind('/'); return p == std::string::npos ? "" : path.substr(0, p); }
std::string leaf(const std::string& path) { return path.substr(path.rfind('/') == std::string::npos ? 0 : path.rfind('/') + 1); }
struct Node {
  Fd fd; std::string absolute; struct stat initial; bool owned, directory; std::string proof, children;
  Node(int f, std::string p, bool o, bool d) : fd(f), absolute(std::move(p)), initial(status(f)), owned(o), directory(d) {}
};
std::vector<Entry> entries; std::string base; std::map<std::string, std::unique_ptr<Node>> opened;
std::string children(Node& node, const std::string& relative) {
  const int copy = dup(node.fd.value); check(copy >= 0, "observer_dup"); DIR* stream = fdopendir(copy);
  if (!stream) { ::close(copy); check(false, "observer_directory"); }
  struct Dir { DIR* s; ~Dir() { closedir(s); } } guard{stream};
  std::vector<std::string> found; unsigned scans = 0; errno = 0;
  while (auto* e = readdir(stream)) {
    check(++scans <= 18, "observer_directory_bound"); const std::string name(e->d_name); charge(sizeof(*e) + name.size());
    if (name == "." || name == "..") continue;
    check(std::any_of(entries.begin(), entries.end(), [&](const Entry& v) { return !v.path.empty() && parent(v.path) == relative && leaf(v.path) == name; }), "observer_unexpected_name");
    check(std::find(found.begin(), found.end(), name) == found.end(), "observer_duplicate_name"); found.push_back(name); errno = 0;
  }
  check(errno == 0, "observer_directory_read"); std::sort(found.begin(), found.end()); std::string json = "[";
  for (size_t i = 0; i < found.size(); i++) { if (i) json += ','; json += quote(found[i]); } return json + ']';
}
std::string fileHash(Node& n) {
  check(n.initial.st_nlink == 1 && n.initial.st_size >= 0 && static_cast<uint64_t>(n.initial.st_size) <= MAX_CONTENT, "observer_file_bound");
  std::string hashes[2];
  for (unsigned pass = 0; pass < 2; pass++) {
    CC_SHA256_CTX ctx; CC_SHA256_Init(&ctx); off_t offset = 0; unsigned char b[4096];
    while (offset < n.initial.st_size) {
      const size_t want = static_cast<size_t>(std::min<off_t>(sizeof(b), n.initial.st_size - offset));
      check(want <= 2 * MAX_CONTENT - content, "observer_content_bound");
      const ssize_t got = pread(n.fd.value, b, want, offset); check(got > 0 && static_cast<size_t>(got) <= want, "observer_content_read");
      charge(static_cast<uint64_t>(got)); content += static_cast<uint64_t>(got); CC_SHA256_Update(&ctx, b, static_cast<CC_LONG>(got)); offset += got;
    }
    unsigned char digest[32]; CC_SHA256_Final(digest, &ctx); hashes[pass] = hex(digest);
    check(stable(n.initial, status(n.fd.value)), "observer_content_changed");
  }
  check(hashes[0] == hashes[1], "observer_content_changed"); return quote(hashes[0]);
}
void observe(Node& n, const std::string& relative) {
  check(++nodes <= MAX_NODES, "observer_node_bound"); auto s = n.initial;
  check(n.directory ? S_ISDIR(s.st_mode) : S_ISREG(s.st_mode), "observer_type");
  check(n.owned ? s.st_flags == 0 && s.st_uid == getuid()
    && s.st_mode == (n.directory ? (S_IFDIR | 0700) : (S_IFREG | 0600))
    : (s.st_uid == 0 || s.st_uid == getuid()) && ((s.st_mode & 0022) == 0 || (s.st_mode & S_ISVTX)), "observer_access");
  // BSD creation may inherit the directory's group rather than the process's primary group. Bind children to the observed root.
  if (n.owned && !relative.empty()) {
    const auto root = opened.at("")->initial; check(s.st_dev == root.st_dev && s.st_gid == root.st_gid && s.st_uid == root.st_uid, "observer_owned_root");
  }
  check(attribute<dev_t>(n.absolute, ATTR_CMN_DEVID) == s.st_dev && attribute<uint64_t>(n.absolute, ATTR_CMN_FILEID) == s.st_ino
    && attribute<uid_t>(n.absolute, ATTR_CMN_OWNERID) == s.st_uid && attribute<gid_t>(n.absolute, ATTR_CMN_GRPID) == s.st_gid
    && ns(attribute<timespec>(n.absolute, ATTR_CMN_CRTIME)) == ns(s.st_birthtimespec), "observer_path_changed");
  const auto first = acl(n.fd.value); const std::string digest = n.directory ? "null" : fileHash(n);
  n.children = n.directory && n.owned ? children(n, relative) : "null"; const auto second = acl(n.fd.value);
  check(first == second && (n.owned ? stable(s, status(n.fd.value)) : identity(s, status(n.fd.value))), "observer_changed");
  check(s.st_size >= 0 && s.st_blocks >= 0 && static_cast<uint64_t>(s.st_blocks) <= UINT64_MAX / 512, "observer_size");
  n.proof = "{\"kind\":" + quote(n.directory ? "directory" : "file") + ",\"device\":" + quote(std::to_string(s.st_dev))
    + ",\"inode\":" + quote(std::to_string(s.st_ino)) + ",\"uid\":" + quote(std::to_string(s.st_uid)) + ",\"gid\":" + quote(std::to_string(s.st_gid))
    + ",\"mode\":" + quote(std::to_string(s.st_mode)) + ",\"flags\":" + quote(std::to_string(s.st_flags)) + ",\"birthtime_ns\":" + quote(ns(s.st_birthtimespec))
    + ",\"mtime_ns\":" + quote(ns(s.st_mtimespec)) + ",\"ctime_ns\":" + quote(ns(s.st_ctimespec))
    + ",\"nlink\":" + quote(std::to_string(s.st_nlink)) + ",\"size\":" + quote(std::to_string(s.st_size))
    + ",\"allocated_bytes\":" + quote(std::to_string(static_cast<uint64_t>(s.st_blocks) * 512))
    + ",\"acl\":" + quote(first.first) + ",\"acl_hash\":" + quote(first.second) + ",\"sha256\":" + digest + "}";
}
Node* openNode(const std::string& key, const std::string& absolute, int pfd, const std::string& name, bool owned, bool directory, bool missing) {
  const auto old = opened.find(key); if (old != opened.end()) return old->second.get();
  struct stat before{}; charge(sizeof(before));
  if (fstatat(pfd, name.c_str(), &before, AT_SYMLINK_NOFOLLOW) != 0) { if (missing && errno == ENOENT) return nullptr; check(false, "observer_path_stat"); }
  check(directory ? S_ISDIR(before.st_mode) : S_ISREG(before.st_mode), "observer_type");
  const int fd = openat(pfd, name.c_str(), O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC | (directory ? O_DIRECTORY : 0));
  auto node = std::make_unique<Node>(fd, absolute, owned, directory);
  check(identity(before, node->initial), "observer_open_changed"); observe(*node, owned ? key : "");
  Node* result = node.get(); opened.emplace(key, std::move(node)); return result;
}
Node* owned(size_t index) {
  const auto& e = entries.at(index); if (e.path.empty()) return openNode("", base, opened.at("@anchor")->fd.value, leaf(base), true, true, false);
  const auto p = parent(e.path); size_t pi = 0;
  for (; pi < entries.size() && entries[pi].path != p; pi++) {}
  check(pi < entries.size() && entries[pi].directory, "observer_recipe_parent"); Node* pn = owned(pi); if (!pn) return nullptr;
  return openNode(e.path, base + "/" + e.path, pn->fd.value, leaf(e.path), true, e.directory, true);
}
std::string volume() {
  auto c = attribute<vol_capabilities_attr_t>("/private/tmp", 0, ATTR_VOL_INFO | ATTR_VOL_CAPABILITIES);
  struct statfs fs{}; charge(sizeof(fs)); check(statfs("/private/tmp", &fs) == 0, "observer_volume");
  check(std::string(fs.f_fstypename) == "apfs" && (fs.f_flags & MNT_LOCAL) && !(fs.f_flags & MNT_IGNORE_OWNERSHIP), "observer_volume");
  const auto mask = VOL_CAP_FMT_CASE_SENSITIVE | VOL_CAP_FMT_CASE_PRESERVING;
  check((c.valid[VOL_CAPABILITIES_FORMAT] & mask) == mask && (c.capabilities[VOL_CAPABILITIES_FORMAT] & VOL_CAP_FMT_CASE_PRESERVING)
    && (c.valid[VOL_CAPABILITIES_INTERFACES] & VOL_CAP_INT_EXTENDED_SECURITY) && (c.capabilities[VOL_CAPABILITIES_INTERFACES] & VOL_CAP_INT_EXTENDED_SECURITY), "observer_volume_caps");
  return "{\"filesystem\":\"apfs\",\"local\":true,\"ownership_enforced\":true,\"case_preserving\":true,\"case_sensitive\":"
    + std::string(c.capabilities[VOL_CAPABILITIES_FORMAT] & VOL_CAP_FMT_CASE_SENSITIVE ? "true" : "false")
    + ",\"read_only_mount\":" + (fs.f_flags & MNT_RDONLY ? "true" : "false") + "}";
}
}  // namespace
int main(int argc, char** argv) {
  try {
    check(argc == 7 && std::string(argv[1]) == "--observer-v1", "observer_arguments");
    const std::string op(argv[2]), c(argv[3]), name(argv[4]), extra(argv[5]), item(argv[6]);
    check(op == "anchor" || op == "entry" || op == "inventory" || op == "absence", "observer_operation");
    check(std::regex_match(extra, std::regex("[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}")), "observer_extra");
    entries = recipe(c, extra);
    check(op == "anchor" ? name == "-" : std::regex_match(name, std::regex("native-bar-fs-synthetic-[A-Za-z0-9]{6}")), "observer_name");
    check(op == "entry" ? std::regex_match(item, std::regex("[0-9]|1[0-5]")) && std::stoul(item) < entries.size() : item == "-", "observer_index");
    Fd root(open("/", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC));
    auto r = std::make_unique<Node>(dup(root.value), "/", false, true); observe(*r, ""); opened.emplace("@root", std::move(r));
    Node* p = openNode("@private", "/private", root.value, "private", false, true, false);
    Node* anchor = openNode("@anchor", "/private/tmp", p->fd.value, "tmp", false, true, false);
    const std::string v = volume(); base = "/private/tmp/" + name;
    std::string records = "[", absent = "false", missing = "["; bool first = true, firstMissing = true;
    if (op == "absence") { struct stat s{}; charge(sizeof(s)); errno = 0;
      check(fstatat(anchor->fd.value, name.c_str(), &s, AT_SYMLINK_NOFOLLOW) != 0 && errno == ENOENT, "observer_not_absent"); absent = "true";
    } else if (op != "anchor") {
      for (size_t i = 0; i < entries.size(); i++) {
        if (op == "entry" && i != std::stoul(item)) continue; Node* n = owned(i);
        if (!n) { if (!firstMissing) missing += ','; missing += std::to_string(i); firstMissing = false; continue; }
      }
      for (size_t i = 0; i < entries.size(); i++) { auto n = opened.find(entries[i].path); if (n == opened.end()) continue;
        if (!first) records += ','; first = false; records += "{\"index\":" + std::to_string(i) + ",\"proof\":" + n->second->proof + ",\"children\":" + n->second->children + "}"; }
    }
    for (auto& n : opened) {
      const auto now = status(n.second->fd.value); check(n.second->owned ? stable(n.second->initial, now) : identity(n.second->initial, now), "observer_final_changed");
      check(attribute<uint64_t>(n.second->absolute, ATTR_CMN_FILEID) == now.st_ino && attribute<dev_t>(n.second->absolute, ATTR_CMN_DEVID) == now.st_dev, "observer_final_path_changed");
    }
    const std::string ancestors = "[{\"path\":\"/\",\"proof\":" + opened.at("@root")->proof + "},{\"path\":\"/private\",\"proof\":"
      + opened.at("@private")->proof + "},{\"path\":\"/private/tmp\",\"proof\":" + anchor->proof + "}]";
    const auto prefix = "{\"schema\":\"native-bar-unsigned-observer-v1\",\"case_id\":" + quote(c) + ",\"operation\":" + quote(op)
      + ",\"fixture_name\":" + (op == "anchor" ? "null" : quote(name)) + ",\"extra\":" + quote(extra)
      + ",\"ancestors\":" + ancestors + ",\"entries\":" + records + "],\"missing\":" + missing + "],\"absent\":" + absent + ",\"volume\":" + v;
    // Reserve the entire bounded JSON response once, including its counters and final newline.
    charge(MAX_OUTPUT); const std::string out = prefix + ",\"nodes\":\"" + std::to_string(nodes) + "\",\"content_bytes\":\"" + std::to_string(content)
      + "\",\"work_bytes\":\"" + std::to_string(work) + "\"}\n"; check(out.size() <= MAX_OUTPUT, "observer_output_bound");
    std::cout << out; return 0;
  } catch (const std::runtime_error& e) {
    const std::string code(e.what()); std::cerr << (code.size() <= 64 && std::regex_match(code, std::regex("observer_[a-z_]+")) ? code : "observer_refused") << '\n'; return 1;
  } catch (...) { std::cerr << "observer_refused\n"; return 1; }
}
#else
#include <iostream>
int main() { std::cerr << "observer_platform\n"; return 1; }
#endif
