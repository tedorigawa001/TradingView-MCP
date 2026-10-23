// Read protocol 2 is synthetic-only and cannot mint mutation targets or grants.
const napi_type_tag SNAPSHOT_TAG{0x390acbaef4004161ULL, 0x99ba0af99c7be001ULL};
struct ReadLimits {
  uint64_t entries = 30000, inventory_bytes = 1024ULL * 1024 * 1024;
  uint64_t read_bytes = 256ULL * 1024 * 1024, metadata_bytes = 16ULL * 1024 * 1024;
  uint64_t response_bytes = 8ULL * 1024 * 1024;
};
struct ReadEntry {
  std::string path, kind, acl = "unverified", reason;
  struct stat metadata{};
  bool evidence = false, metadata_file = false, readable = false, namespace_valid = true;
};
struct ReadSnapshot {
  std::weak_ptr<Session> session;
  ReadLimits limits;
  std::vector<ReadEntry> entries;
  struct stat root{};
  std::string root_acl;
  uint64_t inventory_bytes = 0, metadata_bytes = 0;
  bool closed = false, namespace_valid = true;
  void release() noexcept { std::vector<ReadEntry>().swap(entries); closed = true; }
};
void release_snapshot(Session& s) noexcept { if (auto value = s.snapshot.lock()) value->release(); s.snapshot.reset(); }
std::string nanoseconds(timespec time) {
  __int128 n = static_cast<__int128>(time.tv_sec) * 1000000000 + time.tv_nsec;
  bool negative = n < 0; if (negative) n = -n;
  std::string out; do { out.insert(out.begin(), static_cast<char>('0' + n % 10)); n /= 10; } while (n);
  return negative ? "-" + out : out;
}
std::string name_key(const std::string& name) {
  auto value = CFStringCreateWithBytes(nullptr, reinterpret_cast<const UInt8*>(name.data()), name.size(), kCFStringEncodingUTF8, false);
  require(value != nullptr, "invalid_utf8_name");
  auto normalized = CFStringCreateMutableCopy(nullptr, 0, value); CFRelease(value);
  require(normalized != nullptr, "name_normalization_failed");
  struct Ref { CFMutableStringRef v; ~Ref() { CFRelease(v); } } ref{normalized};
  CFStringNormalize(normalized, kCFStringNormalizationFormC);
  CFStringFold(normalized, kCFCompareCaseInsensitive, nullptr);
  CFStringNormalize(normalized, kCFStringNormalizationFormC);
  auto length = CFStringGetMaximumSizeForEncoding(CFStringGetLength(normalized), kCFStringEncodingUTF8) + 1;
  require(length > 0 && length <= 8192, "name_normalization_limit");
  std::vector<char> bytes(static_cast<size_t>(length));
  require(CFStringGetCString(normalized, bytes.data(), length, kCFStringEncodingUTF8), "name_normalization_failed");
  return bytes.data();
}
struct DirectoryStream {
  Fd fd;
  DIR* stream = nullptr;
  explicit DirectoryStream(int parent) : fd(openat(parent, ".", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)) {
    stream = fdopendir(fd.value); require(stream != nullptr, "directory_enumeration_failed");
  }
  ~DirectoryStream() { if (stream) { closedir(stream); fd.value = -1; --fd_count; } }
};
std::vector<std::string> names(int parent, uint64_t remaining) {
  DirectoryStream stream(parent); std::vector<std::string> result; std::set<std::string> keys;
  while (true) {
    errno = 0; auto entry = readdir(stream.stream);
    if (!entry) { require(errno == 0, "directory_enumeration_failed"); break; }
    std::string name(entry->d_name); if (name == "." || name == "..") continue;
    require(result.size() < remaining, "inventory_entry_limit");
    require(keys.insert(name_key(name)).second, "ambiguous_namespace_name");
    result.push_back(name);
  }
  std::sort(result.begin(), result.end()); return result;
}
void exact_name(int parent, const std::string& name) {
  const auto listed = names(parent, 30000);
  require(std::find(listed.begin(), listed.end(), name) != listed.end(), "exact_name_changed");
}
// The TypeScript readers accept zod uuid() identifiers (RFC version 1-8 and variant 8-b, or nil/max), lower-case only here.
const std::string READ_UUID = "(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"
  "|0{8}-0{4}-0{4}-0{4}-0{12}|f{8}-f{4}-f{4}-f{4}-f{12})";
bool matches(const std::string& value, const std::string& pattern) { return std::regex_match(value, std::regex(pattern)); }
bool evidence_name(const std::string& p) {
  const auto u = READ_UUID;
  return matches(p, "(?:captures|receipts)/[0-9]{4}-[0-9]{2}-[0-9]{2}/" + u + "\\.json")
    || matches(p, "(?:captures|receipts)/[0-9]{4}-[0-9]{2}-[0-9]{2}/\\." + u + "-[0-9a-f]{8}-[1-9][0-9]*-[0-9a-f]{12}\\.stage")
    || p == "policy.json" || p == "retention.json" || p == ".writer.lock" || p == ".writer.takeover"
    || matches(p, "\\.writer-(?:(?:claim|ticket)-" + u + "\\.json|retired-" + u + "\\.lock)")
    || matches(p, "maintenance/" + u + "(?:\\.done)?\\.json")
    || matches(p, "maintenance/" + u + "\\.(?:manifest|attempts)/" + u + "\\.json")
    || matches(p, "maintenance/" + u + "\\.events/[1-9][0-9]{0,4}\\.json")
    || matches(p, "operations/" + u + "\\.reservation\\.json")
    || matches(p, "operations/" + u + "\\.created/" + u + "\\.json")
    || matches(p, "maintenance-hold/" + u + "/" + u)
    || matches(p, "quarantine/abandoned/" + u + "/(?:timestamp\\.json|" + u + ")");
}
void evidence_role(ReadEntry& e) {
  const auto& p = e.path;
  const auto u = READ_UUID;
  e.evidence = evidence_name(p);
  // On a case-insensitive volume a folded variant of an evidence name can be the very object a reader opens by its
  // canonical name, so it must not pass as an unrelated side file.
  if (!e.evidence && evidence_name(name_key(p))) e.namespace_valid = false;
  e.metadata_file = e.evidence && p.compare(0, 9, "captures/") != 0
    && p.compare(0, 17, "maintenance-hold/") != 0
    && !(p.compare(0, 21, "quarantine/abandoned/") == 0 && p.find("timestamp.json") == std::string::npos);
  const bool private_tree = p.compare(0, 12, "maintenance/") == 0 || p.compare(0, 17, "maintenance-hold/") == 0
    || p.compare(0, 11, "operations/") == 0 || p.compare(0, 21, "quarantine/abandoned/") == 0;
  if (private_tree && !e.evidence) {
    e.namespace_valid = e.kind == "directory" && (matches(p, "maintenance/" + u + "\\.(?:manifest|events|attempts)")
      || matches(p, "operations/" + u + "\\.created") || matches(p, "maintenance-hold/" + u)
      || p == "quarantine/abandoned" || matches(p, "quarantine/abandoned/" + u));
  }
  if (p.find('/') == std::string::npos) {
    for (const auto& directory : {"captures", "receipts", "operations", "maintenance", "maintenance-hold", "quarantine"}) {
      if (p == directory && e.kind != "directory") e.namespace_valid = false;
    }
    for (const auto& known : {"captures", "receipts", "operations", "maintenance", "maintenance-hold", "quarantine", "policy.json", "retention.json", ".writer.lock", ".writer.takeover"}) {
      if (name_key(p) == known && p != known) e.namespace_valid = false;
    }
  }
  if (p.compare(0, 11, "quarantine/") == 0 && p.find('/', 11) == std::string::npos
    && name_key(p.substr(11)) == "abandoned" && (p != "quarantine/abandoned" || e.kind != "directory")) e.namespace_valid = false;
  if (e.evidence && e.kind != "file") e.namespace_valid = false;
}
void read_hook(napi_env env, napi_value callback, const char* phase, const std::string& path = "") {
  napi_valuetype type; napi_ok_or_throw(napi_typeof(env, callback, &type)); if (type == napi_undefined) return;
  require(type == napi_function, "invalid_test_hook"); napi_value result;
  napi_value args[] = {text(env, phase), text(env, path)};
  napi_ok_or_throw(napi_call_function(env, undefined(env), callback, 2, args, &result));
  napi_ok_or_throw(napi_typeof(env, result, &type)); require(type == napi_undefined, "test_hook_must_be_synchronous_void");
}
ReadLimits read_limits(napi_env env, napi_value value) {
  ReadLimits result; napi_valuetype type; napi_ok_or_throw(napi_typeof(env, value, &type));
  if (type == napi_undefined) return result;
  require(type == napi_object, "invalid_read_limits"); napi_value keys;
  napi_ok_or_throw(napi_get_property_names(env, value, &keys)); uint32_t length;
  napi_ok_or_throw(napi_get_array_length(env, keys, &length)); require(length <= 5, "invalid_read_limits");
  for (uint32_t i = 0; i < length; ++i) {
    napi_value key, field; napi_ok_or_throw(napi_get_element(env, keys, i, &key)); const auto name = string_arg(env, key);
    uint64_t* limit = name == "entries" ? &result.entries : name == "inventory_bytes" ? &result.inventory_bytes
      : name == "read_bytes" ? &result.read_bytes : name == "metadata_bytes" ? &result.metadata_bytes
      : name == "response_bytes" ? &result.response_bytes : nullptr;
    require(limit != nullptr, "invalid_read_limits"); napi_ok_or_throw(napi_get_property(env, value, key, &field));
    double n; napi_ok_or_throw(napi_get_value_double(env, field, &n));
    require(n >= 1 && n <= *limit && n == static_cast<uint64_t>(n), "invalid_read_limits"); *limit = static_cast<uint64_t>(n);
  }
  return result;
}
struct ReadVolume { bool case_sensitive, read_only; };
ReadVolume read_volume(int fd) {
  qualify_volume(fd); struct statfs fs{}; syscall_ok(fstatfs(fd, &fs), "filesystem_unverified");
  struct attrlist attrs{}; attrs.bitmapcount = ATTR_BIT_MAP_COUNT; attrs.volattr = ATTR_VOL_CAPABILITIES;
  struct { uint32_t length; vol_capabilities_attr_t caps; } data{};
  syscall_ok(fgetattrlist(fd, &attrs, &data, sizeof(data), 0), "volume_capabilities_unverified");
  const auto format = VOL_CAP_FMT_CASE_SENSITIVE | VOL_CAP_FMT_CASE_PRESERVING;
  require(data.length == sizeof(data) && (data.caps.valid[VOL_CAPABILITIES_FORMAT] & format) == format
    && (data.caps.capabilities[VOL_CAPABILITIES_FORMAT] & VOL_CAP_FMT_CASE_PRESERVING)
    && (data.caps.valid[VOL_CAPABILITIES_INTERFACES] & VOL_CAP_INT_EXTENDED_SECURITY)
    && (data.caps.capabilities[VOL_CAPABILITIES_INTERFACES] & VOL_CAP_INT_EXTENDED_SECURITY), "read_capabilities_unverified");
  return {bool(data.caps.capabilities[VOL_CAPABILITIES_FORMAT] & VOL_CAP_FMT_CASE_SENSITIVE), bool(fs.f_flags & MNT_RDONLY)};
}
void scan(Session& s, int fd, const std::string& path, ReadSnapshot& out, unsigned depth = 0) {
  require(depth <= 16, "inventory_depth_limit"); s.check_deadline();
  const auto before = stat_fd(fd); private_access(fd, true, true);
  const auto children = names(fd, out.limits.entries - out.entries.size());
  for (const auto& name : children) {
    s.check_deadline(); require(out.entries.size() < out.limits.entries, "inventory_entry_limit");
    ReadEntry e; e.path = path.empty() ? name : path + "/" + name; require(e.path.size() <= 512, "inventory_path_limit");
    syscall_ok(fstatat(fd, name.c_str(), &e.metadata, AT_SYMLINK_NOFOLLOW), "inventory_changed");
    require(e.metadata.st_dev == stat_fd(s.root()).st_dev, "cross_device_refused");
    e.kind = S_ISDIR(e.metadata.st_mode) ? "directory" : S_ISREG(e.metadata.st_mode) ? "file"
      : S_ISLNK(e.metadata.st_mode) ? "symlink" : "nonregular";
    evidence_role(e);
    require(e.metadata.st_size >= 0, "inventory_size_unverified"); out.inventory_bytes += static_cast<uint64_t>(e.metadata.st_size);
    require(out.inventory_bytes <= out.limits.inventory_bytes, "inventory_byte_limit");
    if (e.kind == "directory") {
      auto child = directory(fd, name); binding(fd, name, child.value, true);
      require(equal_metadata(e.metadata, stat_fd(child.value)), "inventory_changed");
      e.acl = private_access(child.value, true, true); out.entries.push_back(e);
      scan(s, child.value, e.path, out, depth + 1); binding(fd, name, child.value, true);
      require(equal_metadata(e.metadata, stat_fd(child.value)), "inventory_changed");
    } else {
      if (e.kind != "file") e.reason = "preserved_nonregular";
      else if (e.metadata.st_uid != getuid() || (e.metadata.st_mode & 0077)) e.reason = "preserved_unsafe_access";
      else {
        // Bind the name without the ACL check, so a grant on one file preserves that file instead of aborting the inventory.
        auto file = leaf(fd, name); struct stat named{};
        syscall_ok(fstatat(fd, name.c_str(), &named, AT_SYMLINK_NOFOLLOW), "namespace_changed");
        require(same_id(named, stat_fd(file.value)) && S_ISREG(named.st_mode), "namespace_changed");
        require(equal_metadata(e.metadata, stat_fd(file.value)), "inventory_changed");
        try { e.acl = private_access(file.value, false, true); }
        catch (const std::runtime_error& error) { if (std::string(error.what()) != "unsafe_acl") throw; e.acl = "unsafe"; e.reason = "preserved_unsafe_acl"; }
        require(equal_metadata(e.metadata, stat_fd(file.value)), "inventory_changed");
      }
      if (e.reason.empty() && e.metadata.st_nlink != 1) e.reason = "preserved_hardlink";
      if (e.reason.empty() && e.metadata.st_size > 1024 * 1024) e.reason = "preserved_oversize";
      if (e.reason.empty() && !e.evidence) e.reason = "preserved_unknown";
      if (!e.namespace_valid) e.reason = "unqualified_private_namespace";
      e.readable = e.reason.empty();
      if (e.metadata_file) { out.metadata_bytes += e.metadata.st_size; require(out.metadata_bytes <= out.limits.metadata_bytes, "inventory_metadata_limit"); }
      out.entries.push_back(e);
    }
    out.namespace_valid = out.namespace_valid && e.namespace_valid;
  }
  require(equal_metadata(before, stat_fd(fd)), "inventory_changed"); s.check_deadline();
}
ReadSnapshot collect(Session& s, const ReadLimits& limits) {
  s.guard(); read_volume(s.root()); ReadSnapshot out; out.limits = limits;
  out.root_acl = private_access(s.root(), true, true); out.root = stat_fd(s.root()); scan(s, s.root(), "", out);
  // Per entry: 512 bytes bound every fixed key, punctuation and maximal decimal/label value; the path is charged its
  // worst JSON form (6 for a control byte, 2 for a quote or backslash, 3 for a non-ASCII byte escaped as UTF-16).
  uint64_t response_bound = 4096;
  for (const auto& e : out.entries) {
    response_bound += 512;
    for (unsigned char c : e.path) response_bound += c < 0x20 ? 6 : c == 0x22 || c == 0x5c ? 2 : c >= 0x80 ? 3 : 1;
  }
  require(response_bound <= limits.response_bytes, "inventory_response_limit");
  s.guard(); require(equal_metadata(out.root, stat_fd(s.root())), "inventory_changed"); return out;
}
void same_inventory(const ReadSnapshot& a, const ReadSnapshot& b) {
  require(equal_metadata(a.root, b.root) && a.root_acl == b.root_acl && a.entries.size() == b.entries.size(), "inventory_changed");
  for (size_t i = 0; i < a.entries.size(); ++i) {
    const auto& x = a.entries[i]; const auto& y = b.entries[i];
    require(x.path == y.path && x.acl == y.acl && x.reason == y.reason && equal_metadata(x.metadata, y.metadata), "inventory_changed");
  }
}
napi_value metadata_value(napi_env env, const struct stat& st, const std::string& acl) {
  auto out = object(env);
  for (const auto& p : std::vector<std::pair<const char*, std::string>>{{"device", std::to_string(st.st_dev)}, {"inode", std::to_string(st.st_ino)},
    {"uid", std::to_string(st.st_uid)}, {"gid", std::to_string(st.st_gid)}, {"mode", std::to_string(st.st_mode)},
    {"nlink", std::to_string(st.st_nlink)}, {"size", std::to_string(st.st_size)}, {"flags", std::to_string(st.st_flags)},
    {"birthtime_ns", nanoseconds(st.st_birthtimespec)}, {"mtime_ns", nanoseconds(st.st_mtimespec)}, {"ctime_ns", nanoseconds(st.st_ctimespec)}, {"acl", acl}}) prop(env, out, p.first, text(env, p.second));
  return out;
}
napi_value boolean_value(napi_env env, bool value) { napi_value out; napi_ok_or_throw(napi_get_boolean(env, value, &out)); return out; }
napi_value inventory_report(napi_env env, Session& s, const ReadSnapshot& snapshot) {
  auto out = object(env); prop(env, out, "schema", text(env, "native-bar-native-inventory-v2"));
  prop(env, out, "execution_available", boolean_value(env, false)); prop(env, out, "inventory_complete", boolean_value(env, true));
  prop(env, out, "verification_scope", text(env, "synthetic_native_read_only"));
  prop(env, out, "namespace_qualified", boolean_value(env, snapshot.namespace_valid));
  prop(env, out, "elapsed_clock_qualified", boolean_value(env, false));
  prop(env, out, "root", metadata_value(env, snapshot.root, snapshot.root_acl));
  prop(env, out, "inventory_bytes", text(env, std::to_string(snapshot.inventory_bytes)));
  prop(env, out, "metadata_bytes", text(env, std::to_string(snapshot.metadata_bytes)));
  auto volume = object(env); auto facts = read_volume(s.root());
  prop(env, volume, "filesystem", text(env, "apfs")); prop(env, volume, "local", boolean_value(env, true));
  prop(env, volume, "ownership_enforced", boolean_value(env, true));
  prop(env, volume, "case_preserving", boolean_value(env, true)); prop(env, volume, "case_sensitive", boolean_value(env, facts.case_sensitive));
  prop(env, volume, "read_only_mount", boolean_value(env, facts.read_only)); prop(env, out, "volume", volume);
  napi_value entries; napi_ok_or_throw(napi_create_array_with_length(env, snapshot.entries.size(), &entries));
  for (size_t i = 0; i < snapshot.entries.size(); ++i) {
    const auto& e = snapshot.entries[i]; auto item = object(env);
    prop(env, item, "path", text(env, e.path)); prop(env, item, "kind", text(env, e.kind));
    prop(env, item, "proof", metadata_value(env, e.metadata, e.acl));
    prop(env, item, "readable_evidence", boolean_value(env, e.readable)); prop(env, item, "namespace_qualified", boolean_value(env, e.namespace_valid));
    prop(env, item, "reason", text(env, e.reason)); napi_ok_or_throw(napi_set_element(env, entries, i, item));
  }
  prop(env, out, "entries", entries); return out;
}
std::shared_ptr<ReadSnapshot> snapshot_arg(napi_env env, napi_value value, const std::shared_ptr<Session>& s) {
  bool matches = false; napi_ok_or_throw(napi_check_object_type_tag(env, value, &SNAPSHOT_TAG, &matches)); require(matches, "invalid_inventory_handle");
  void* pointer; napi_ok_or_throw(napi_unwrap(env, value, &pointer)); auto snapshot = *static_cast<std::shared_ptr<ReadSnapshot>*>(pointer);
  require(!snapshot->closed && snapshot->session.lock() == s, "inventory_closed_or_wrong_session"); return snapshot;
}
napi_value read_inventory(napi_env env, napi_callback_info info) {
  return boundary(env, [&] {
    size_t argc = 3; napi_value args[3]; napi_ok_or_throw(napi_get_cb_info(env, info, &argc, args, nullptr, nullptr)); require(argc == 3, "argument_count");
    auto s = session_arg(env, args[0]); Busy busy(*s); s->guard(); require(s->read_only, "read_only_session_required");
    if (auto old = s->snapshot.lock()) require(old->closed, "inventory_already_open");
    auto limits = read_limits(env, args[2]); auto snapshot = std::make_shared<ReadSnapshot>(collect(*s, limits));
    read_hook(env, args[1], "inventory_between_passes"); same_inventory(*snapshot, collect(*s, limits));
    snapshot->session = s; auto handle = wrap(env, snapshot, SNAPSHOT_TAG);
    prop(env, handle, "report", inventory_report(env, *s, *snapshot)); s->snapshot = snapshot; s->guard(); return handle;
  });
}
napi_value close_inventory(napi_env env, napi_callback_info info) {
  return boundary(env, [&] {
    size_t argc = 2; napi_value args[2]; napi_ok_or_throw(napi_get_cb_info(env, info, &argc, args, nullptr, nullptr)); require(argc == 2, "argument_count");
    auto s = session_arg(env, args[0]); require(!s->busy, "session_busy");
    bool matches = false; napi_ok_or_throw(napi_check_object_type_tag(env, args[1], &SNAPSHOT_TAG, &matches)); require(matches, "invalid_inventory_handle");
    void* pointer; napi_ok_or_throw(napi_unwrap(env, args[1], &pointer)); auto snap = *static_cast<std::shared_ptr<ReadSnapshot>*>(pointer);
    require(snap->session.lock() == s, "inventory_closed_or_wrong_session"); snap->release(); return undefined(env);
  });
}
napi_value verify_inventory(napi_env env, napi_callback_info info) {
  return boundary(env, [&] {
    size_t argc = 3; napi_value args[3]; napi_ok_or_throw(napi_get_cb_info(env, info, &argc, args, nullptr, nullptr)); require(argc == 3, "argument_count");
    auto s = session_arg(env, args[0]); Busy busy(*s); s->guard(); read_volume(s->root()); auto snap = snapshot_arg(env, args[1], s);
    read_hook(env, args[2], "verify_before_scan"); same_inventory(*snap, collect(*s, snap->limits)); s->guard(); return boolean_value(env, true);
  });
}
napi_value read_evidence(napi_env env, napi_callback_info info) {
  return boundary(env, [&] {
    size_t argc = 4; napi_value args[4]; napi_ok_or_throw(napi_get_cb_info(env, info, &argc, args, nullptr, nullptr)); require(argc == 4, "argument_count");
    auto s = session_arg(env, args[0]); Busy busy(*s); s->guard(); read_volume(s->root()); auto snap = snapshot_arg(env, args[1], s);
    double index; napi_ok_or_throw(napi_get_value_double(env, args[2], &index));
    require(index >= 0 && index < snap->entries.size() && index == static_cast<size_t>(index), "invalid_inventory_index");
    const auto& e = snap->entries[static_cast<size_t>(index)]; require(e.readable, "evidence_not_readable");
    require(s->read_bytes + e.metadata.st_size <= snap->limits.read_bytes, "evidence_read_budget");
    require(static_cast<uint64_t>(e.metadata.st_size) * 4 + 4096 <= snap->limits.response_bytes, "evidence_response_limit");
    read_hook(env, args[3], "read_before_open", e.path); s->guard();
    require(equal_metadata(snap->root, stat_fd(s->root())), "inventory_changed");
    std::vector<Fd> parents; int parent = s->root(); size_t start = 0;
    while (true) {
      auto slash = e.path.find('/', start); if (slash == std::string::npos) break;
      auto component = e.path.substr(start, slash - start); exact_name(parent, component); auto dir = directory(parent, component);
      const auto path = e.path.substr(0, slash);
      auto original = std::find_if(snap->entries.begin(), snap->entries.end(), [&](const ReadEntry& item) { return item.path == path; });
      require(original != snap->entries.end() && equal_metadata(original->metadata, stat_fd(dir.value)), "inventory_changed");
      binding(parent, component, dir.value, true); parents.push_back(std::move(dir)); parent = parents.back().value; start = slash + 1;
    }
    const auto name = e.path.substr(start); exact_name(parent, name); auto file = leaf(parent, name); binding(parent, name, file.value, false);
    require(equal_metadata(e.metadata, stat_fd(file.value)), "inventory_changed");
    auto acl = private_access(file.value, false, true); require(acl == e.acl, "inventory_changed");
    s->read_bytes += e.metadata.st_size;
    std::vector<unsigned char> bytes(static_cast<size_t>(e.metadata.st_size)); size_t offset = 0;
    while (offset < bytes.size()) {
      s->check_deadline(); auto n = pread(file.value, bytes.data() + offset, bytes.size() - offset, offset);
      if (n < 0 && errno == EINTR) continue; require(n > 0, "evidence_read_changed"); offset += static_cast<size_t>(n);
    }
    read_hook(env, args[3], "read_after_bytes", e.path);
    require(equal_metadata(e.metadata, stat_fd(file.value)) && private_access(file.value, false, true) == e.acl, "evidence_read_changed");
    binding(parent, name, file.value, false); exact_name(parent, name);
    // Recheck every pinned parent after a callback or concurrent namespace change.
    int ancestor = s->root(); size_t pos = 0;
    for (const auto& dir : parents) {
      auto slash = e.path.find('/', pos); const auto component = e.path.substr(pos, slash - pos);
      exact_name(ancestor, component); binding(ancestor, component, dir.value, true); ancestor = dir.value; pos = slash + 1;
    }
    s->guard(); read_volume(s->root()); require(equal_metadata(snap->root, stat_fd(s->root())), "inventory_changed");
    unsigned char digest[CC_SHA256_DIGEST_LENGTH]; CC_SHA256(bytes.data(), static_cast<CC_LONG>(bytes.size()), digest);
    static const char* hex = "0123456789abcdef"; std::string hash; for (auto b : digest) { hash += hex[b >> 4]; hash += hex[b & 15]; }
    auto out = object(env); napi_value content; void* copied;
    napi_ok_or_throw(napi_create_buffer_copy(env, bytes.size(), bytes.data(), &copied, &content)); prop(env, out, "bytes", content);
    auto p = metadata_value(env, e.metadata, e.acl); prop(env, p, "sha256", text(env, hash)); prop(env, out, "proof", p);
    prop(env, out, "execution_available", boolean_value(env, false)); prop(env, out, "lease_read_bytes", text(env, std::to_string(s->read_bytes)));
    s->guard(); return out;
  });
}
