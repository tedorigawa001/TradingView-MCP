// Synthetic coordination only. No data target, publication journal or reusable execution grant.
const napi_type_tag COORD_TAG{0x75abbe382118431bULL, 0xb35b5906ae0b82ffULL};
struct CoordinationRecord { std::string body; Proof proof; bool present = true; std::string acl; };
struct Coordination {
  std::shared_ptr<Session> session;
  std::vector<std::pair<struct stat, std::string>> anchors;
  ReadSnapshot baseline;
  std::map<std::string, size_t> baseline_root;
  std::map<std::string, CoordinationRecord> own, observed;
  std::vector<std::string> temporaries, retired;
  bool uncertain = false, foreign_churn = false;
  unsigned publications = 0;
  void close() {
    session->release(); baseline.release(); baseline_root.clear(); own.clear(); observed.clear();
    decltype(anchors)().swap(anchors); decltype(temporaries)().swap(temporaries); decltype(retired)().swap(retired);
  }
};
std::string coordination_acl(int fd, bool strict) {
  private_access(fd, true, strict);
  auto acl = acl_get_fd_np(fd, ACL_TYPE_EXTENDED);
  if (!acl) { require(errno == ENOENT, "acl_unverified"); return "none"; }
  struct Acl { acl_t value; ~Acl() { acl_free(value); } } guard{acl};
  ssize_t size = 0; auto bytes = acl_to_text(acl, &size); require(bytes != nullptr, "acl_unverified");
  struct Text { char* value; ~Text() { acl_free(value); } } text_guard{bytes};
  require(size >= 0 && size <= 65536, "acl_entry_limit"); return std::string(bytes, static_cast<size_t>(size));
}
bool coordination_name(const std::string& name) {
  static const std::regex re("\\.writer-(?:claim|ticket)-" + READ_UUID + "\\.json");
  return name == ".writer.lock" || name == ".writer.takeover" || std::regex_match(name, re);
}
void coordination_guard(Coordination& c, bool cleanup = false) {
  try {
    if (cleanup) c.session->namespace_guard(); else c.session->guard();
    read_volume(c.session->root());
    for (size_t i = 0; i < c.anchors.size(); ++i) {
      const auto current = stat_fd(c.session->chain[i].fd.value); auto expected = c.anchors[i].first;
      // Entry churn is allowed only in directories, not access-control/identity changes.
      expected.st_size = current.st_size; expected.st_nlink = current.st_nlink;
      expected.st_mtimespec = current.st_mtimespec; expected.st_ctimespec = current.st_ctimespec;
      require(equal_metadata(current, expected), "coordination_anchor_changed");
      require(coordination_acl(c.session->chain[i].fd.value, c.session->chain[i].strict) == c.anchors[i].second, "coordination_acl_changed");
    }
  } catch (...) {
    // A later successful retry or restoration cannot revive an observed unsafe baseline.
    c.foreign_churn = true; throw;
  }
}
std::string coordination_bytes(Session& s, int fd) {
  auto st = stat_fd(fd); require(st.st_size >= 0 && st.st_size <= 256, "unsafe_writer_lock");
  require(s.read_bytes + st.st_size <= 256ULL * 1024 * 1024, "evidence_read_budget");
  s.read_bytes += st.st_size;
  std::string out(static_cast<size_t>(st.st_size), '\0'); size_t offset = 0;
  while (offset < out.size()) {
    auto n = pread(fd, out.data() + offset, out.size() - offset, offset);
    if (n < 0 && errno == EINTR) continue; require(n > 0, "writer_read_changed"); offset += n;
  }
  return out;
}
Proof coordination_proof(Coordination& c, int fd) {
  private_access(fd, false, true); const auto before = stat_fd(fd); require(before.st_nlink == 1, "hard_link_refused");
  const auto bytes = coordination_bytes(*c.session, fd);
  private_access(fd, false, true); require(equal_metadata(before, stat_fd(fd)), "writer_read_changed");
  unsigned char digest[CC_SHA256_DIGEST_LENGTH]; CC_SHA256(bytes.data(), static_cast<CC_LONG>(bytes.size()), digest);
  const char* hex = "0123456789abcdef"; std::string hash; for (auto b : digest) { hash += hex[b >> 4]; hash += hex[b & 15]; }
  return {before, hash};
}
std::optional<CoordinationRecord> coordination_read(Coordination& c, const std::string& name, bool cleanup = false) {
  require(coordination_name(name), "invalid_coordination_name"); coordination_guard(c, cleanup);
  struct stat named{};
  if (fstatat(c.session->root(), name.c_str(), &named, AT_SYMLINK_NOFOLLOW) < 0) {
    require(errno == ENOENT, "writer_read_failed"); return std::nullopt;
  }
  exact_name(c.session->root(), name); auto fd = leaf(c.session->root(), name);
  binding(c.session->root(), name, fd.value, false);
  require(named.st_size <= 256, "unsafe_writer_lock");
  const auto before = coordination_proof(c, fd.value); auto body = coordination_bytes(*c.session, fd.value); compare(before, coordination_proof(c, fd.value));
  binding(c.session->root(), name, fd.value, false); coordination_guard(c, cleanup);
  return CoordinationRecord{body, before, true, private_access(fd.value, false, true)};
}
bool coordination_release(Coordination& c, const std::string& name, const std::string& body) {
  coordination_guard(c, true); auto own = c.own.find(name);
  auto current = coordination_read(c, name, true);
  if (!current) {
    if (own != c.own.end() && own->second.present) { c.uncertain = true; return false; }
    return true;
  }
  require(own != c.own.end() && own->second.present && body == own->second.body, "coordination_not_owned");
  compare(own->second.proof, current->proof); require(current->body == body, "coordination_changed");
  // Retire the exact owned object to an unpredictable private coordination slot before unlinking.
  const auto slot = ".writer-release-" + uuid() + ".tmp";
  require(c.temporaries.size() < 64, "coordination_temporary_limit"); const bool prior_uncertainty = c.uncertain;
  c.temporaries.push_back(slot); c.uncertain = true;
  syscall_ok(renameatx_np(c.session->root(), name.c_str(), c.session->root(), slot.c_str(),
    RENAME_EXCL | RENAME_NOFOLLOW_ANY | RENAME_RESOLVE_BENEATH), "coordination_release_move_failed");
  auto fd = leaf(c.session->root(), slot); binding(c.session->root(), slot, fd.value, false);
  compare(own->second.proof, coordination_proof(c, fd.value), true); coordination_guard(c, true);
  syscall_ok(unlinkat(c.session->root(), slot.c_str(), 0), "coordination_release_failed");
  require(stat_fd(fd.value).st_nlink == 0, "coordination_release_unverified"); sync_dir(c.session->root());
  struct stat absent{};
  require(fstatat(c.session->root(), slot.c_str(), &absent, AT_SYMLINK_NOFOLLOW) < 0 && errno == ENOENT, "coordination_release_unverified");
  own->second.present = false; c.temporaries.pop_back(); c.uncertain = prior_uncertainty || !c.temporaries.empty(); return true;
}
bool coordination_publish(Coordination& c, const std::string& name, const std::string& body) {
  require(coordination_name(name) && body.size() <= 128 && !body.empty(), "invalid_coordination_publication");
  coordination_guard(c); require(c.publications < 64 && !c.uncertain, "coordination_publication_limit");
  auto listed = names(c.session->root(), 30000); require(listed.size() < 30000 - 2, "inventory_entry_limit");
  for (const auto& entry : listed) if (name_key(entry) == name_key(name)) {
    require(entry == name, "ambiguous_namespace_name"); return false;
  }
  const auto temp = ".writer-publish-" + uuid() + ".tmp";
  Fd fd(openat(c.session->root(), temp.c_str(), O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600));
  ++c.publications; c.temporaries.push_back(temp); c.uncertain = true;
  private_access(fd.value, false, true); size_t offset = 0;
  while (offset < body.size()) {
    c.session->guard(); auto n = pwrite(fd.value, body.data() + offset, body.size() - offset, offset);
    if (n < 0 && errno == EINTR) continue; require(n > 0, "coordination_write_failed"); offset += n;
  }
  syscall_ok(fsync(fd.value), "coordination_sync_failed"); const auto written = coordination_proof(c, fd.value);
  c.session->guard(); binding(c.session->root(), temp, fd.value, false);
  const int renamed = renameatx_np(c.session->root(), temp.c_str(), c.session->root(), name.c_str(),
    RENAME_EXCL | RENAME_NOFOLLOW_ANY | RENAME_RESOLVE_BENEATH);
  if (renamed < 0 && errno == EEXIST) {
    // This is only our verified temporary, never the contending writer's destination.
    binding(c.session->root(), temp, fd.value, false); compare(written, coordination_proof(c, fd.value));
    syscall_ok(unlinkat(c.session->root(), temp.c_str(), 0), "coordination_temporary_release_failed");
    sync_dir(c.session->root()); c.temporaries.pop_back(); c.uncertain = false; return false;
  }
  syscall_ok(renamed, "coordination_publish_failed");
  // Track ownership before a later sync/deadline failure so finally can release this exact publication.
  auto published = coordination_proof(c, fd.value); compare(written, published, true);
  c.own.insert_or_assign(name, CoordinationRecord{body, published, true, private_access(fd.value, false, true)});
  c.temporaries.pop_back(); c.uncertain = false;
  binding(c.session->root(), name, fd.value, false); sync_dir(c.session->root()); coordination_guard(c); return true;
}
void coordination_retire(Coordination& c, const std::string& name) {
  require(name == ".writer.lock" || name == ".writer.takeover", "invalid_retirement_role");
  coordination_guard(c); auto observed = c.observed.find(name);
  require(observed != c.observed.end() && c.retired.size() < 16, "retirement_observation_required");
  auto current = coordination_read(c, name); require(current.has_value(), "coordination_changed");
  compare(observed->second.proof, current->proof);
  auto fd = leaf(c.session->root(), name); binding(c.session->root(), name, fd.value, false); compare(current->proof, coordination_proof(c, fd.value));
  const auto dest = ".writer-retired-" + uuid() + ".lock"; c.retired.push_back(dest); c.uncertain = true;
  coordination_guard(c);
  syscall_ok(renameatx_np(c.session->root(), name.c_str(), c.session->root(), dest.c_str(),
    RENAME_EXCL | RENAME_NOFOLLOW_ANY | RENAME_RESOLVE_BENEATH), "coordination_retire_failed");
  auto moved = leaf(c.session->root(), dest); binding(c.session->root(), dest, moved.value, false);
  compare(observed->second.proof, coordination_proof(c, moved.value), true); sync_dir(c.session->root()); c.uncertain = false;
}
void coordination_baseline(Coordination& c) {
  coordination_guard(c); require(!c.uncertain && !c.foreign_churn && c.retired.empty(), "fresh_preview_required_after_coordination_change");
  auto current = collect(*c.session, ReadLimits{}); same_inventory(current, collect(*c.session, ReadLimits{}));
  require(current.namespace_valid && c.baseline.namespace_valid, "unqualified_namespace");
  if (c.publications) {
    // APFS counts regular children in directory nlink. Bind its delta to the exact live owned publications.
    const auto live = std::count_if(c.own.begin(), c.own.end(), [](const auto& item) { return item.second.present; });
    require(current.root.st_nlink == c.baseline.root.st_nlink + live, "writer_baseline_changed");
    auto adjusted = current.root; adjusted.st_mtimespec = c.baseline.root.st_mtimespec;
    adjusted.st_ctimespec = c.baseline.root.st_ctimespec; adjusted.st_size = c.baseline.root.st_size; adjusted.st_nlink = c.baseline.root.st_nlink;
    require(equal_metadata(adjusted, c.baseline.root) && current.root_acl == c.baseline.root_acl, "writer_baseline_changed");
  } else require(equal_metadata(current.root, c.baseline.root), "writer_baseline_changed");
  std::vector<ReadEntry> baseline;
  for (const auto& e : current.entries) {
    auto own = c.own.find(e.path);
    if (own == c.own.end()) baseline.push_back(e);
    else {
      require(own->second.present && equal_metadata(own->second.proof.metadata, e.metadata), "coordination_changed");
      auto actual = coordination_read(c, e.path); require(actual.has_value(), "coordination_changed"); compare(own->second.proof, actual->proof);
    }
  }
  for (const auto& [name, own] : c.own) if (own.present) {
    const auto key = name;
    require(std::any_of(current.entries.begin(), current.entries.end(), [&](const ReadEntry& e) { return e.path == key; }), "coordination_changed");
  }
  current.entries = std::move(baseline); current.root = c.baseline.root; same_inventory(c.baseline, current); coordination_guard(c);
}
napi_value open_coordination(napi_env env, napi_callback_info info) {
  return boundary(env, [&] {
    auto c = std::make_shared<Coordination>(); c->session = create_root(env, info, true); c->session->coordination_only = true;
    for (const auto& anchor : c->session->chain) c->anchors.push_back({stat_fd(anchor.fd.value), coordination_acl(anchor.fd.value, anchor.strict)});
    coordination_guard(*c);
    c->baseline = collect(*c->session, ReadLimits{}); same_inventory(c->baseline, collect(*c->session, ReadLimits{}));
    for (size_t i = 0; i < c->baseline.entries.size(); ++i) if (c->baseline.entries[i].path.find('/') == std::string::npos)
      c->baseline_root.emplace(c->baseline.entries[i].path, i);
    require(c->baseline.namespace_valid, "unqualified_namespace");
    require(c->baseline.inventory_bytes <= 1024ULL * 1024 * 1024 - 16384 && c->baseline.metadata_bytes <= 16ULL * 1024 * 1024 - 16384
      && c->baseline.entries.size() <= 30000 - 128, "coordination_headroom_required");
    struct statfs fs{}; syscall_ok(fstatfs(c->session->root(), &fs), "filesystem_unverified");
    require(!(fs.f_flags & MNT_RDONLY) && static_cast<__int128>(fs.f_bavail) * fs.f_bsize >= 4 * 1024 * 1024, "coordination_headroom_required");
    return wrap(env, c, COORD_TAG);
  });
}
napi_value coordination_call(napi_env env, napi_callback_info info) {
  return boundary(env, [&] {
    size_t argc = 4; napi_value args[4]; napi_ok_or_throw(napi_get_cb_info(env, info, &argc, args, nullptr, nullptr)); require(argc == 4, "argument_count");
    bool matches = false; napi_ok_or_throw(napi_check_object_type_tag(env, args[0], &COORD_TAG, &matches)); require(matches, "invalid_coordination_handle");
    void* pointer; napi_ok_or_throw(napi_unwrap(env, args[0], &pointer)); auto c = *static_cast<std::shared_ptr<Coordination>*>(pointer);
    const auto action = string_arg(env, args[1]); Busy busy(*c->session);
    if (action == "close") { c->close(); return undefined(env); }
    if (action == "cleanup") {
      bool released = !c->uncertain;
      for (auto& [name, record] : c->own) if (record.present) {
        try { if (!coordination_release(*c, name, record.body)) released = false; } catch (...) { released = false; }
      }
      return boolean_value(env, released);
    }
    if (action == "release") return boolean_value(env, coordination_release(*c, string_arg(env, args[2]), string_arg(env, args[3])));
    if (action == "delta") {
      coordination_guard(*c, true);
      auto out = object(env); napi_value entries; napi_ok_or_throw(napi_create_array_with_length(env, c->own.size(), &entries)); size_t i = 0;
      for (const auto& [name, record] : c->own) {
        auto item = object(env); prop(env, item, "path", text(env, name)); prop(env, item, "present", boolean_value(env, record.present));
        auto p = metadata_value(env, record.proof.metadata, record.acl); prop(env, p, "sha256", text(env, record.proof.sha256)); prop(env, item, "proof", p);
        napi_ok_or_throw(napi_set_element(env, entries, i++, item));
      }
      prop(env, out, "entries", entries); prop(env, out, "retired_count", text(env, std::to_string(c->retired.size())));
      prop(env, out, "unresolved_temporaries", text(env, std::to_string(c->temporaries.size())));
      for (const auto& pair : {std::pair<const char*, const std::vector<std::string>*>{"retired_paths", &c->retired}, {"temporary_paths", &c->temporaries}}) {
        napi_value paths; napi_ok_or_throw(napi_create_array_with_length(env, pair.second->size(), &paths));
        for (size_t j = 0; j < pair.second->size(); ++j) napi_ok_or_throw(napi_set_element(env, paths, j, text(env, (*pair.second)[j])));
        prop(env, out, pair.first, paths);
      }
      prop(env, out, "uncertain", boolean_value(env, c->uncertain)); return out;
    }
    coordination_guard(*c);
    if (action == "check") return undefined(env);
    if (action == "baseline") { coordination_baseline(*c); return boolean_value(env, true); }
    if (action == "preview") { auto out = inventory_report(env, *c->session, c->baseline); coordination_guard(*c); return out; }
    if (action == "locked") {
      auto own = c->own.find(".writer.lock"); require(own != c->own.end() && own->second.present, "writer_not_owned");
      auto current = coordination_read(*c, ".writer.lock"); require(current.has_value(), "writer_not_owned");
      compare(own->second.proof, current->proof); return boolean_value(env, true);
    }
    if (action == "names") {
      auto listed = names(c->session->root(), 30000); napi_value out; napi_ok_or_throw(napi_create_array_with_length(env, listed.size(), &out));
      std::set<std::string> expected;
      for (const auto& entry : c->baseline_root) expected.insert(entry.first);
      for (const auto& [name, record] : c->own) if (record.present) expected.insert(name);
      if (std::set<std::string>(listed.begin(), listed.end()) != expected) c->foreign_churn = true;
      for (size_t i = 0; i < listed.size(); ++i) napi_ok_or_throw(napi_set_element(env, out, i, text(env, listed[i])));
      coordination_guard(*c); return out;
    }
    const auto name = string_arg(env, args[2]); require(coordination_name(name), "invalid_coordination_name");
    if (action == "read") {
      auto record = coordination_read(*c, name);
      auto own = c->own.find(name); auto original = c->baseline_root.find(name);
      const struct stat* expected = own != c->own.end() && own->second.present ? &own->second.proof.metadata
        : original != c->baseline_root.end() ? &c->baseline.entries[original->second].metadata : nullptr;
      if (record ? !expected || !equal_metadata(*expected, record->proof.metadata) : expected != nullptr) c->foreign_churn = true;
      if (!record) { napi_value out; napi_ok_or_throw(napi_get_null(env, &out)); return out; }
      if (name == ".writer.lock" || name == ".writer.takeover") c->observed.insert_or_assign(name, *record);
      return text(env, record->body);
    }
    if (action == "publish") return boolean_value(env, coordination_publish(*c, name, string_arg(env, args[3])));
    if (action == "retire") { coordination_retire(*c, name); return boolean_value(env, true); }
    throw std::runtime_error("invalid_coordination_action");
  });
}
