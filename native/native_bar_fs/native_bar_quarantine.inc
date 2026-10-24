// Protocol 4: isolated, bounded synthetic quarantine; no unlink or restart authority.
const napi_type_tag QUARANTINE_TAG{0xb055a9a0a64e4869ULL, 0x8f6fd4889a614d7eULL};
const std::string QUARANTINE_POLICY = "{\"schema\":\"native-bar-synthetic-quarantine-profile-v4\"}";
struct QuarantineTarget {
  std::string id, source, holding, final, acl, category;
  Proof expected;
  int phase = 0;
};
struct QuarantineDir { Fd fd; struct stat metadata; std::string acl; };
struct Quarantine {
  std::shared_ptr<Coordination> coordination;
  std::string id = uuid(), chunk = uuid(), attempt = uuid(), reserve = ".quarantine-reserve-" + uuid() + ".tmp";
  std::vector<QuarantineTarget> targets;
  std::vector<std::string> publications, temporaries;
  std::map<std::string, QuarantineDir> dirs;
  std::map<std::string, ReadEntry> expected;
  std::map<std::string, Proof> published;
  struct stat root{};
  bool begun = false, halted = false, closed = false;
  size_t next = 0;
  uint64_t budget = 0;
};
std::string qparent(const std::string& path) { auto slash = path.rfind('/'); return slash == std::string::npos ? "" : path.substr(0, slash); }
std::string qname(const std::string& path) { return path.substr(path.rfind('/') == std::string::npos ? 0 : path.rfind('/') + 1); }
int qdir(Quarantine& q, const std::string& path) { return path.empty() ? q.coordination->session->root() : q.dirs.at(path).fd.value; }
void qbind_dirs(Quarantine& q) {
  for (const auto& [path, dir] : q.dirs) {
    exact_name(qdir(q, qparent(path)), qname(path)); binding(qdir(q, qparent(path)), qname(path), dir.fd.value, true);
    require(equal_metadata(dir.metadata, stat_fd(dir.fd.value)) && coordination_acl(dir.fd.value, true) == dir.acl, "quarantine_parent_changed");
  }
}
std::string qhash(const void* bytes, size_t size) {
  unsigned char digest[CC_SHA256_DIGEST_LENGTH]; CC_SHA256(bytes, static_cast<CC_LONG>(size), digest);
  const char* hex = "0123456789abcdef"; std::string hash; for (auto b : digest) { hash += hex[b >> 4]; hash += hex[b & 15]; } return hash;
}
Proof qproof(Quarantine& q, int fd) {
  auto& s = *q.coordination->session; s.guard(); private_access(fd, false, true); const auto before = stat_fd(fd);
  require(before.st_nlink == 1, "hard_link_refused"); require(before.st_size >= 0 && before.st_size <= 1024 * 1024, "artifact_size_limit");
  require(s.read_bytes + before.st_size <= 256ULL * 1024 * 1024, "evidence_read_budget"); s.read_bytes += before.st_size;
  // Hash only the size charged above, even if a peer grows the object between fstat and pread.
  std::vector<unsigned char> bytes(static_cast<size_t>(before.st_size)); size_t offset = 0;
  while (offset < bytes.size()) {
    s.guard(); auto n = pread(fd, bytes.data() + offset, std::min<size_t>(65536, bytes.size() - offset), offset);
    if (n < 0 && errno == EINTR) continue; require(n > 0, "artifact_read_changed"); offset += n;
  }
  private_access(fd, false, true); require(equal_metadata(before, stat_fd(fd)), "target_changed");
  const auto hash = qhash(bytes.data(), bytes.size()); s.guard(); return {before, hash};
}
void qlocked(Quarantine& q) {
  require(!q.closed && !q.halted, "quarantine_closed_or_halted"); auto& c = *q.coordination;
  coordination_guard(c); require(!c.uncertain && !c.foreign_churn && c.retired.empty(), "quarantine_stale_coordination");
  auto own = c.own.find(".writer.lock"); require(own != c.own.end() && own->second.present, "writer_not_owned");
  auto current = coordination_read(c, ".writer.lock"); require(current.has_value(), "writer_not_owned"); compare(own->second.proof, current->proof);
}
void qverify(Quarantine& q) {
  qlocked(q); qbind_dirs(q); auto actual = collect(*q.coordination->session, ReadLimits{});
  require(actual.namespace_valid && equal_metadata(q.root, actual.root), "quarantine_inventory_changed");
  size_t count = 0;
  for (const auto& e : actual.entries) {
    auto own = q.coordination->own.find(e.path);
    if (own != q.coordination->own.end() && own->second.present) {
      require(equal_metadata(own->second.proof.metadata, e.metadata), "coordination_changed"); continue;
    }
    const auto it = q.expected.find(e.path);
    require(it != q.expected.end() && equal_metadata(it->second.metadata, e.metadata) && it->second.acl == e.acl, "quarantine_inventory_changed"); ++count;
  }
  require(count == q.expected.size(), "quarantine_inventory_changed"); qlocked(q);
}
void qrefresh(Quarantine& q, const std::string& path) {
  const int fd = qdir(q, path); const auto st = stat_fd(fd);
  auto before = path.empty() ? q.root : q.dirs.at(path).metadata;
  before.st_size = st.st_size; before.st_nlink = st.st_nlink; before.st_mtimespec = st.st_mtimespec; before.st_ctimespec = st.st_ctimespec;
  require(equal_metadata(before, st), "quarantine_parent_changed");
  if (path.empty()) q.root = st;
  else { q.dirs.at(path).metadata = st; q.expected.at(path).metadata = st; }
}
void qremember(Quarantine& q, const std::string& path, int fd, bool dir) {
  ReadEntry e; e.path = path; e.kind = dir ? "directory" : "file"; e.metadata = stat_fd(fd);
  e.acl = private_access(fd, dir, true); evidence_role(e); q.expected.insert_or_assign(path, e); qrefresh(q, qparent(path));
}
void qsync(Quarantine& q, int fd, napi_env env, napi_value callback, const std::string& path, bool directory_fd = false) {
  read_hook(env, callback, "before_sync", path); qlocked(q); qbind_dirs(q);
  syscall_ok(fsync(fd), "quarantine_sync_failed");
  if (!directory_fd) syscall_ok(fcntl(fd, F_FULLFSYNC), "quarantine_fullsync_failed");
  read_hook(env, callback, "after_sync", path); qlocked(q);
}
void qmkdir(Quarantine& q, const std::string& path, napi_env env, napi_value callback) {
  if (q.dirs.count(path)) return;
  read_hook(env, callback, "before_create_directory", path); qverify(q);
  syscall_ok(mkdirat(qdir(q, qparent(path)), qname(path).c_str(), 0700), "quarantine_exclusive_directory_failed");
  auto fd = directory(qdir(q, qparent(path)), qname(path));
  QuarantineDir d{std::move(fd), {}, ""}; d.metadata = stat_fd(d.fd.value); d.acl = coordination_acl(d.fd.value, true);
  q.dirs.emplace(path, std::move(d)); qremember(q, path, qdir(q, path), true);
  read_hook(env, callback, "after_create_directory", path); qverify(q);
  qsync(q, qdir(q, path), env, callback, path, true); qsync(q, qdir(q, qparent(path)), env, callback, qparent(path), true);
}
napi_value qproof_value(napi_env env, const Proof& p, const std::string& acl) {
  auto out = metadata_value(env, p.metadata, acl); prop(env, out, "sha256", text(env, p.sha256)); return out;
}
napi_value qreport(napi_env env, Quarantine& q) {
  auto out = object(env); prop(env, out, "maintenance_id", text(env, q.id)); prop(env, out, "chunk_id", text(env, q.chunk));
  prop(env, out, "attempt_id", text(env, q.attempt)); prop(env, out, "reserve_path", text(env, q.reserve));
  prop(env, out, "budget_bytes", text(env, std::to_string(q.budget))); prop(env, out, "execution_available", boolean_value(env, false));
  prop(env, out, "halted", boolean_value(env, q.halted)); prop(env, out, "published_count", text(env, std::to_string(q.next)));
  napi_value targets, slots; napi_ok_or_throw(napi_create_array_with_length(env, q.targets.size(), &targets));
  for (size_t i = 0; i < q.targets.size(); ++i) {
    const auto& t = q.targets[i]; auto item = object(env); prop(env, item, "target_id", text(env, t.id));
    prop(env, item, "source_path", text(env, t.source)); prop(env, item, "holding_path", text(env, t.holding));
    prop(env, item, "quarantine_path", text(env, t.final)); prop(env, item, "proof", qproof_value(env, t.expected, t.category));
    prop(env, item, "phase", text(env, std::to_string(t.phase))); napi_ok_or_throw(napi_set_element(env, targets, i, item));
  }
  napi_ok_or_throw(napi_create_array_with_length(env, q.publications.size(), &slots));
  for (size_t i = 0; i < q.publications.size(); ++i) napi_ok_or_throw(napi_set_element(env, slots, i, text(env, q.publications[i])));
  prop(env, out, "targets", targets); prop(env, out, "publications", slots);
  napi_value temps; napi_ok_or_throw(napi_create_array_with_length(env, q.temporaries.size(), &temps));
  for (size_t i = 0; i < q.temporaries.size(); ++i) napi_ok_or_throw(napi_set_element(env, temps, i, text(env, q.temporaries[i])));
  prop(env, out, "temporary_paths", temps); return out;
}
napi_value prepare_quarantine(napi_env env, napi_callback_info info) {
  return boundary(env, [&] {
    size_t argc = 2; napi_value args[2]; napi_ok_or_throw(napi_get_cb_info(env, info, &argc, args, nullptr, nullptr)); require(argc == 2, "argument_count");
    bool tagged = false; napi_ok_or_throw(napi_check_object_type_tag(env, args[0], &COORD_TAG, &tagged)); require(tagged, "invalid_coordination_handle");
    void* raw; napi_ok_or_throw(napi_unwrap(env, args[0], &raw)); auto c = *static_cast<std::shared_ptr<Coordination>*>(raw); Busy busy(*c->session);
    coordination_baseline(*c); require(c->baseline.entries.size() <= 128, "quarantine_fixture_inventory_limit");
    uint32_t count; napi_ok_or_throw(napi_get_array_length(env, args[1], &count)); require(count > 0 && count <= 16, "quarantine_target_limit");
    auto q = std::make_shared<Quarantine>(); q->coordination = c; q->root = c->baseline.root;
    for (const auto& e : c->baseline.entries) {
      require(e.path != "maintenance" && e.path != "maintenance-hold" && e.path != "quarantine" && e.path != "operations", "quarantine_existing_transactions_blocked");
      q->expected.emplace(e.path, e);
      if (e.kind == "directory") {
        auto fd = directory(qdir(*q, qparent(e.path)), qname(e.path));
        q->dirs.emplace(e.path, QuarantineDir{std::move(fd), e.metadata, ""});
        q->dirs.at(e.path).acl = coordination_acl(qdir(*q, e.path), true);
      }
    }
    auto policy = leaf(c->session->root(), "policy.json"); auto pp = qproof(*q, policy.value);
    std::string bytes(static_cast<size_t>(pp.metadata.st_size), '\0');
    require(pread(policy.value, bytes.data(), bytes.size(), 0) == static_cast<ssize_t>(bytes.size()) && bytes == QUARANTINE_POLICY, "quarantine_synthetic_profile_required");
    compare(pp, qproof(*q, policy.value));
    std::set<uint32_t> selected; uint64_t data_bytes = 0;
    for (uint32_t i = 0; i < count; ++i) {
      napi_value value; uint32_t index; napi_ok_or_throw(napi_get_element(env, args[1], i, &value)); double number;
      napi_ok_or_throw(napi_get_value_double(env, value, &number)); require(number >= 0 && number < c->baseline.entries.size() && number == static_cast<uint32_t>(number), "invalid_quarantine_index"); index = static_cast<uint32_t>(number);
      require(selected.insert(index).second, "duplicate_quarantine_target"); const auto& e = c->baseline.entries[index];
      require(e.readable && matches(e.path, "captures/[0-9]{4}-[0-9]{2}-[0-9]{2}/" + READ_UUID + "\\.json"), "quarantine_capture_fixture_required");
      for (const auto& entry : c->baseline.entries) require(!(entry.path.compare(0, 9, "receipts/") == 0 && qname(entry.path) == qname(e.path)), "quarantine_committed_capture_refused");
      auto fd = leaf(qdir(*q, qparent(e.path)), qname(e.path)); auto p = qproof(*q, fd.value); require(equal_metadata(e.metadata, p.metadata), "target_changed");
      const auto id = uuid(); q->targets.push_back({id, e.path, "maintenance-hold/" + q->id + "/" + id,
        "quarantine/abandoned/" + q->id + "/" + id, coordination_acl(fd.value, true, false), private_access(fd.value, false, true), p}); data_bytes += p.metadata.st_size;
    }
    const auto prefix = "maintenance/" + q->id;
    q->publications = {prefix + ".manifest/" + q->chunk + ".json", prefix + ".json", prefix + ".attempts/" + q->attempt + ".json"};
    for (size_t i = 0; i < count * 4; ++i) q->publications.push_back(prefix + ".events/" + std::to_string(i + 1) + ".json");
    q->publications.push_back("quarantine/abandoned/" + q->id + "/timestamp.json"); q->publications.push_back(prefix + ".done.json");
    for (size_t i = 0; i < q->publications.size(); ++i) q->temporaries.push_back(".publication-" + uuid() + ".tmp");
    // Fixed bounded fixture scope: include all publications, their temporaries, allocation overhead and recovery space.
    q->budget = (q->publications.size() * 2 + 32) * 65536ULL + 1024 * 1024;
    require(c->baseline.metadata_bytes + q->budget <= 16ULL * 1024 * 1024 && c->baseline.inventory_bytes + q->budget <= 1024ULL * 1024 * 1024
      && c->baseline.entries.size() + q->publications.size() * 2 + 128 <= 30000 && c->session->read_bytes + data_bytes * 24 + q->budget * 4 <= 256ULL * 1024 * 1024, "quarantine_capacity_limit");
    coordination_baseline(*c); return wrap(env, q, QUARANTINE_TAG);
  });
}
void qbegin(Quarantine& q, napi_env env, napi_value callback) {
  require(!q.begun, "quarantine_already_started"); qlocked(q); coordination_baseline(*q.coordination); q.root = stat_fd(q.coordination->session->root()); qverify(q);
  require(fd_count.load() + 48 <= 512, "quarantine_descriptor_headroom_required");
  for (const auto& t : q.targets) {
    auto fd = leaf(qdir(q, qparent(t.source)), qname(t.source)); compare(t.expected, qproof(q, fd.value));
    binding(qdir(q, qparent(t.source)), qname(t.source), fd.value, false);
  }
  struct statfs space{}; syscall_ok(fstatfs(q.coordination->session->root(), &space), "filesystem_unverified");
  require(static_cast<__int128>(space.f_bavail) * space.f_bsize >= q.budget * 2, "quarantine_headroom_required");
  read_hook(env, callback, "before_reserve", q.reserve); qverify(q);
  Fd reserve(openat(q.coordination->session->root(), q.reserve.c_str(), O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600));
  qremember(q, q.reserve, reserve.value, false); read_hook(env, callback, "after_create_reserve", q.reserve); qverify(q);
  read_hook(env, callback, "before_allocate", q.reserve); qverify(q);
  fstore_t allocation{}; allocation.fst_flags = F_ALLOCATEALL; allocation.fst_posmode = F_PEOFPOSMODE; allocation.fst_length = q.budget;
  syscall_ok(fcntl(reserve.value, F_PREALLOCATE, &allocation), "quarantine_reservation_failed");
  require(allocation.fst_bytesalloc >= static_cast<off_t>(q.budget), "quarantine_reservation_unverified");
  qremember(q, q.reserve, reserve.value, false); read_hook(env, callback, "after_allocate", q.reserve); qverify(q);
  qsync(q, reserve.value, env, callback, q.reserve); qsync(q, q.coordination->session->root(), env, callback, "", true);
  read_hook(env, callback, "after_reserve", q.reserve); qverify(q);
  for (const auto& path : {std::string("maintenance"), "maintenance/" + q.id + ".manifest", "maintenance/" + q.id + ".events", "maintenance/" + q.id + ".attempts",
    std::string("maintenance-hold"), "maintenance-hold/" + q.id, std::string("quarantine"), std::string("quarantine/abandoned"), "quarantine/abandoned/" + q.id}) qmkdir(q, path, env, callback);
  q.begun = true; qverify(q);
}
Proof qpublish(Quarantine& q, size_t index, const std::string& bytes, napi_env env, napi_value callback) {
  require(q.begun && index == q.next && index < q.publications.size() && !bytes.empty() && bytes.size() <= 65536, "quarantine_publication_scope");
  if (index >= 3 && index < 3 + q.targets.size() * 4) {
    const auto local = index - 3; require(q.targets[local / 4].phase == static_cast<int>(local % 4), "quarantine_publication_order");
  } else if (index >= 3) for (const auto& t : q.targets) require(t.phase == 4, "quarantine_incomplete_targets");
  const auto path = q.publications[index], parent = qparent(path), temp = q.temporaries[index];
  // Root temporaries are deliberately outside transaction namespaces and remain preserved on interruption.
  read_hook(env, callback, "before_create_metadata", path); qverify(q);
  Fd fd(openat(q.coordination->session->root(), temp.c_str(), O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600)); qremember(q, temp, fd.value, false);
  const auto created = stat_fd(fd.value);
  read_hook(env, callback, "after_create_metadata", path); qverify(q);
  read_hook(env, callback, "before_write_metadata", path); qverify(q); size_t offset = 0;
  while (offset < bytes.size()) { qlocked(q); auto n = pwrite(fd.value, bytes.data() + offset, bytes.size() - offset, offset);
    if (n < 0 && errno == EINTR) continue; require(n > 0, "quarantine_write_failed"); offset += n; }
  read_hook(env, callback, "after_write_before_proof", path); const auto written = qproof(q, fd.value);
  auto expected = created; expected.st_size = written.metadata.st_size; expected.st_mtimespec = written.metadata.st_mtimespec; expected.st_ctimespec = written.metadata.st_ctimespec;
  require(equal_metadata(expected, written.metadata) && written.metadata.st_size == static_cast<off_t>(bytes.size())
    && written.sha256 == qhash(bytes.data(), bytes.size()), "quarantine_publication_bytes_changed");
  qremember(q, temp, fd.value, false); read_hook(env, callback, "after_write_metadata", path); qverify(q);
  qsync(q, fd.value, env, callback, path); compare(written, qproof(q, fd.value));
  read_hook(env, callback, "before_publish_metadata", path); qverify(q);
  binding(q.coordination->session->root(), temp, fd.value, false); compare(written, qproof(q, fd.value)); qlocked(q);
  syscall_ok(renameatx_np(q.coordination->session->root(), temp.c_str(), qdir(q, parent), qname(path).c_str(),
    RENAME_EXCL | RENAME_NOFOLLOW_ANY | RENAME_RESOLVE_BENEATH), "quarantine_exclusive_publication_failed");
  q.expected.erase(temp); qrefresh(q, ""); qremember(q, path, fd.value, false);
  read_hook(env, callback, "after_publish_metadata", path); read_hook(env, callback, "before_readback", path);
  auto readback = leaf(qdir(q, parent), qname(path));
  binding(qdir(q, parent), qname(path), readback.value, false); auto p = qproof(q, readback.value); compare(written, p, true);
  read_hook(env, callback, "after_readback", path);
  qverify(q); qsync(q, fd.value, env, callback, path); qsync(q, qdir(q, parent), env, callback, parent, true);
  qsync(q, q.coordination->session->root(), env, callback, "", true); qverify(q);
  q.published.emplace(path, p); ++q.next;
  if (index >= 3 && index < 3 + q.targets.size() * 4 && (index - 3) % 4 % 2 == 1) ++q.targets[(index - 3) / 4].phase;
  return p;
}
Proof qmove(Quarantine& q, size_t index, bool final, napi_env env, napi_value callback) {
  require(q.begun && index < q.targets.size(), "quarantine_move_scope"); auto& t = q.targets[index];
  const int expected_phase = final ? 2 : 0; const size_t pending = 3 + index * 4 + (final ? 3 : 1);
  require(t.phase == expected_phase && q.next == pending, "quarantine_move_without_pending");
  const auto from = final ? t.holding : t.source, to = final ? t.final : t.holding;
  read_hook(env, callback, "before_move", to); qverify(q);
  auto fd = leaf(qdir(q, qparent(from)), qname(from)); compare(t.expected, qproof(q, fd.value));
  require(coordination_acl(fd.value, true, false) == t.acl, "quarantine_target_acl_changed"); binding(qdir(q, qparent(from)), qname(from), fd.value, false);
  read_hook(env, callback, "after_source_check", to); qlocked(q); qbind_dirs(q);
  read_hook(env, callback, "before_rename", to); q.coordination->session->check_deadline();
  syscall_ok(renameatx_np(qdir(q, qparent(from)), qname(from).c_str(), qdir(q, qparent(to)), qname(to).c_str(),
    RENAME_EXCL | RENAME_NOFOLLOW_ANY | RENAME_RESOLVE_BENEATH), "quarantine_exclusive_move_failed");
  q.expected.erase(from); qrefresh(q, qparent(from));
  auto moved = leaf(qdir(q, qparent(to)), qname(to)); qremember(q, to, moved.value, false);
  read_hook(env, callback, "after_move", to); binding(qdir(q, qparent(to)), qname(to), moved.value, false);
  auto p = qproof(q, moved.value); compare(t.expected, p, true); require(coordination_acl(moved.value, true, false) == t.acl, "quarantine_target_acl_changed");
  qverify(q); qsync(q, moved.value, env, callback, to); qsync(q, qdir(q, qparent(from)), env, callback, qparent(from), true);
  qsync(q, qdir(q, qparent(to)), env, callback, qparent(to), true); qverify(q); t.expected = p; ++t.phase; return p;
}
napi_value quarantine_call(napi_env env, napi_callback_info info) {
  return boundary(env, [&] {
    size_t argc = 5; napi_value args[5]; napi_ok_or_throw(napi_get_cb_info(env, info, &argc, args, nullptr, nullptr)); require(argc == 5, "argument_count");
    bool tagged = false; napi_ok_or_throw(napi_check_object_type_tag(env, args[0], &QUARANTINE_TAG, &tagged)); require(tagged, "invalid_quarantine_handle");
    void* raw; napi_ok_or_throw(napi_unwrap(env, args[0], &raw)); auto q = *static_cast<std::shared_ptr<Quarantine>*>(raw); Busy busy(*q->coordination->session);
    const auto action = string_arg(env, args[1]);
    if (action == "close") { q->closed = true; q->dirs.clear(); q->expected.clear(); return undefined(env); }
    if (action == "report") return qreport(env, *q);
    try {
      if (action == "begin") { qbegin(*q, env, args[4]); return undefined(env); }
      if (action == "verify") { qverify(*q); return undefined(env); }
      double number; napi_ok_or_throw(napi_get_value_double(env, args[2], &number)); require(number >= 0 && number <= 100 && number == static_cast<size_t>(number), "invalid_quarantine_index");
      if (action == "stage" || action == "quarantine") {
        auto p = qmove(*q, static_cast<size_t>(number), action == "quarantine", env, args[4]);
        return qproof_value(env, p, q->targets.at(static_cast<size_t>(number)).category);
      }
      if (action == "publish") {
        bool buffer; napi_ok_or_throw(napi_is_buffer(env, args[3], &buffer)); require(buffer, "quarantine_bytes_required"); void* data; size_t size;
        napi_ok_or_throw(napi_get_buffer_info(env, args[3], &data, &size)); require(size <= 65536, "quarantine_metadata_limit");
        auto p = qpublish(*q, static_cast<size_t>(number), std::string(static_cast<char*>(data), size), env, args[4]);
        return qproof_value(env, p, q->expected.at(q->publications.at(static_cast<size_t>(number))).acl);
      }
      throw std::runtime_error("invalid_quarantine_action");
    } catch (...) { q->halted = true; throw; }
  });
}
