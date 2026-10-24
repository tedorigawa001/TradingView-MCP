// Protocol 5: fixed native recovery steps over an independently admitted synthetic fixture.
const napi_type_tag RECOVERY_TAG{0x82c1532c16914b5eULL, 0xb1330992d52c283aULL};
const napi_type_tag RECOVERY_APPROVAL_TAG{0x972197591ac44240ULL, 0x943477e41a6f7920ULL};
struct RJson {
  enum Kind { Nil, Bool, Number, String, Array, Object } kind = Nil;
  bool b = false; int64_t n = 0; std::string s; std::vector<RJson> a; std::map<std::string, RJson> o;
  RJson() = default;
  RJson(const char* v): kind(String), s(v) {} RJson(std::string v): kind(String), s(std::move(v)) {}
  RJson(int v): kind(Number), n(v) {} RJson(bool v): kind(Bool), b(v) {}
  RJson(std::vector<RJson> v): kind(Array), a(std::move(v)) {}
  RJson(std::initializer_list<std::pair<const std::string, RJson>> v): kind(Object), o(v) {}
  const RJson& at(const std::string& k) const { require(kind == Object && o.count(k), "recovery_record_field"); return o.at(k); }
  const std::string& str() const { require(kind == String, "recovery_record_string"); return s; }
  int integer() const { require(kind == Number && n >= 0 && n <= 1000000, "recovery_record_integer"); return static_cast<int>(n); }
};
std::string rescape(const std::string& s) {
  std::string out = "\""; const char* hex = "0123456789abcdef";
  for (unsigned char c : s) {
    if (c == '"' || c == '\\') { out += '\\'; out += c; }
    else if (c == '\b') out += "\\b"; else if (c == '\f') out += "\\f"; else if (c == '\n') out += "\\n";
    else if (c == '\r') out += "\\r"; else if (c == '\t') out += "\\t";
    else if (c < 32) { out += "\\u00"; out += hex[c >> 4]; out += hex[c & 15]; } else out += c;
  } return out + '"';
}
std::string rcanonical(const RJson& v) {
  if (v.kind == RJson::Nil) return "null";
  if (v.kind == RJson::Bool) return v.b ? "true" : "false";
  if (v.kind == RJson::Number) return std::to_string(v.n);
  if (v.kind == RJson::String) return rescape(v.s);
  std::string out = v.kind == RJson::Array ? "[" : "{"; bool first = true;
  if (v.kind == RJson::Array) for (const auto& item : v.a) { if (!first) out += ','; first = false; out += rcanonical(item); }
  else for (const auto& [key, item] : v.o) { if (!first) out += ','; first = false; out += rescape(key) + ':' + rcanonical(item); }
  return out + (v.kind == RJson::Array ? ']' : '}');
}
std::string rhash(const RJson& v) { auto bytes = rcanonical(v); return qhash(bytes.data(), bytes.size()); }
bool rsame(const RJson& a, const RJson& b) { return rcanonical(a) == rcanonical(b); }
RJson rconvert(napi_env env, napi_value value, unsigned depth = 0) {
  require(depth < 64, "recovery_record_depth"); napi_valuetype type; napi_ok_or_throw(napi_typeof(env, value, &type));
  if (type == napi_null) return RJson{};
  if (type == napi_string) return RJson(string_arg(env, value));
  if (type == napi_boolean) { bool v; napi_ok_or_throw(napi_get_value_bool(env, value, &v)); return RJson(v); }
  if (type == napi_number) { double v; napi_ok_or_throw(napi_get_value_double(env, value, &v));
    require(v >= 0 && v <= 9007199254740991.0 && v == static_cast<int64_t>(v), "recovery_record_number"); RJson out(0); out.n = static_cast<int64_t>(v); return out; }
  require(type == napi_object, "recovery_record_type"); bool array; napi_ok_or_throw(napi_is_array(env, value, &array));
  RJson out; out.kind = array ? RJson::Array : RJson::Object;
  napi_value keys; uint32_t count;
  if (array) napi_ok_or_throw(napi_get_array_length(env, value, &count));
  else { napi_ok_or_throw(napi_get_property_names(env, value, &keys)); napi_ok_or_throw(napi_get_array_length(env, keys, &count)); }
  require(count <= 65536, "recovery_record_limit");
  for (uint32_t i = 0; i < count; ++i) {
    napi_value child;
    if (array) { napi_ok_or_throw(napi_get_element(env, value, i, &child)); out.a.push_back(rconvert(env, child, depth + 1)); }
    else { napi_value key; napi_ok_or_throw(napi_get_element(env, keys, i, &key)); napi_ok_or_throw(napi_get_property(env, value, key, &child));
      out.o.emplace(string_arg(env, key), rconvert(env, child, depth + 1)); }
  } return out;
}
struct RParser { napi_ref parse; };
void rparser_init(napi_env env) {
  napi_value global, json, parse; napi_ok_or_throw(napi_get_global(env, &global)); napi_ok_or_throw(napi_get_named_property(env, global, "JSON", &json));
  napi_ok_or_throw(napi_get_named_property(env, json, "parse", &parse)); auto p = std::make_unique<RParser>();
  napi_ok_or_throw(napi_create_reference(env, parse, 1, &p->parse));
  napi_ok_or_throw(napi_set_instance_data(env, p.get(), [](napi_env e, void* raw, void*) { auto p = static_cast<RParser*>(raw); napi_delete_reference(e, p->parse); delete p; }, nullptr)); p.release();
}
RJson rparse(napi_env env, const std::string& bytes, size_t limit = 65536) {
  require(bytes.size() <= limit, "recovery_record_limit"); void* raw; napi_ok_or_throw(napi_get_instance_data(env, &raw)); require(raw, "recovery_parser_unavailable");
  napi_value fn, input = text(env, bytes), out; napi_ok_or_throw(napi_get_reference_value(env, static_cast<RParser*>(raw)->parse, &fn));
  napi_ok_or_throw(napi_call_function(env, undefined(env), fn, 1, &input, &out)); auto value = rconvert(env, out);
  require(rcanonical(value) == bytes, "recovery_noncanonical_record"); return value;
}
napi_value rvalue(napi_env env, const RJson& v) {
  auto bytes = rcanonical(v); require(bytes.size() <= 8 * 1024 * 1024, "recovery_response_limit");
  void* raw; napi_ok_or_throw(napi_get_instance_data(env, &raw)); napi_value fn, input = text(env, bytes), out;
  napi_ok_or_throw(napi_get_reference_value(env, static_cast<RParser*>(raw)->parse, &fn));
  napi_ok_or_throw(napi_call_function(env, undefined(env), fn, 1, &input, &out)); return out;
}
std::string rnow() {
  const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(Wall::now().time_since_epoch()).count();
  time_t sec = ms / 1000; tm t{}; require(gmtime_r(&sec, &t), "recovery_clock_unavailable"); char bytes[32];
  require(strftime(bytes, sizeof(bytes), "%Y-%m-%dT%H:%M:%S", &t), "recovery_clock_unavailable");
  const auto tail = std::to_string(1000 + ms % 1000).substr(1); return std::string(bytes) + "." + tail + "Z";
}
std::string rwall(Wall::time_point t) {
  const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(t.time_since_epoch()).count(); time_t sec = ms / 1000; tm utc{};
  require(gmtime_r(&sec, &utc), "recovery_clock_unavailable"); char out[32]; require(strftime(out, sizeof(out), "%Y-%m-%dT%H:%M:%S", &utc), "recovery_clock_unavailable");
  return std::string(out) + "." + std::to_string(1000 + ms % 1000).substr(1) + "Z";
}
RJson rclock(const std::string& at) { return {{"utc_at", at}, {"elapsed", RJson{}}}; }
std::string rbuffer(napi_env env, napi_value v, size_t limit) {
  bool is; napi_ok_or_throw(napi_is_buffer(env, v, &is)); require(is, "recovery_bytes_required"); void* data; size_t size;
  napi_ok_or_throw(napi_get_buffer_info(env, v, &data, &size)); require(size <= limit, "recovery_record_limit"); return std::string(static_cast<char*>(data), size);
}
struct RTarget { std::string id, source, holding, final, acl_hash, flags; RJson proof; int state = 0; std::string pending, pending_owner; };
struct RStep { std::string kind; size_t target = 0; };
struct Recovery5 {
  std::shared_ptr<Quarantine> q; RJson bundle, audit, original, attempt, marker;
  std::vector<RTarget> targets; std::vector<RStep> steps; size_t next = 0; int ordinal = 0;
  std::string last_wall, marker_before, marker_after; Proof marker_proof{};
  bool approval_issued = false, consumed = false, begun = false, finished = false;
};
struct RApproval { std::shared_ptr<Recovery5> owner; bool used = false; };
std::shared_ptr<Recovery5> rarg(napi_env env, napi_value v) {
  bool tagged; napi_ok_or_throw(napi_check_object_type_tag(env, v, &RECOVERY_TAG, &tagged)); require(tagged, "recovery_handle_required");
  void* raw; napi_ok_or_throw(napi_unwrap(env, v, &raw)); return *static_cast<std::shared_ptr<Recovery5>*>(raw);
}
RJson rproof(napi_env env, Quarantine& q, const std::string& path, bool base = false) {
  auto fd = leaf(qdir(q, qparent(path)), qname(path)); binding(qdir(q, qparent(path)), qname(path), fd.value, false);
  auto p = qproof(q, fd.value); auto value = rconvert(env, qproof_value(env, p, private_access(fd.value, false, true)));
  value.o["acl_hash"] = recovery_acl_hash(fd.value, false);
  if (base) { value.o.erase("flags"); value.o.erase("acl_hash"); } return value;
}
void rproof_match(RJson expected, RJson actual, bool moved = false) {
  if (moved) { const auto before = expected.at("ctime_ns").str(), after = actual.at("ctime_ns").str();
    require(std::stoll(after) >= std::stoll(before), "recovery_target_clock"); expected.o.erase("ctime_ns"); actual.o.erase("ctime_ns"); }
  require(rsame(expected, actual), "recovery_target_changed");
}
RJson rdir(napi_env env, const struct stat& st, const std::string& acl, const std::string& hash) {
  auto v = rconvert(env, metadata_value(env, st, acl));
  for (const auto& k : {"size", "nlink", "mtime_ns", "ctime_ns"}) v.o.erase(k);
  v.o["acl_hash"] = hash; return v;
}
void rguard(Recovery5& r, bool locked) {
  auto& q = *r.q; require(!q.closed && !q.halted, "recovery_closed_or_halted"); coordination_guard(*q.coordination);
  auto now = rnow(); require(now >= r.last_wall, "recovery_clock_rollback"); r.last_wall = now;
  if (locked) qverify(q); else coordination_baseline(*q.coordination);
  ReadLimits limits; limits.entries = 512; const auto inventory = collect(*q.coordination->session, limits);
  uint64_t physical = recovery_allocated(inventory.root);
  for (const auto& e : inventory.entries) { auto allocated = recovery_allocated(e.metadata); require(physical <= UINT64_MAX - allocated, "recovery_capacity"); physical += allocated; }
  require(physical + q.budget <= 1024ULL * 1024 * 1024 && inventory.metadata_bytes + q.budget <= 16ULL * 1024 * 1024
    && inventory.inventory_bytes + q.budget <= 1024ULL * 1024 * 1024, "recovery_capacity");
  uint64_t data = 0; for (const auto& t : r.targets) data += std::stoull(t.proof.at("size").str());
  require(q.coordination->session->read_bytes + data * 24 + q.budget * 4 <= 256ULL * 1024 * 1024, "recovery_read_headroom");
  auto reserve = leaf(q.coordination->session->root(), q.reserve); const auto allocated = recovery_allocated(stat_fd(reserve.value));
  require(allocated >= std::stoull(r.original.at("scope").at("allocation").at("allocated_bytes").str()), "recovery_allocation_lost");
  struct statfs fs{}; syscall_ok(fstatfs(q.coordination->session->root(), &fs), "available_space_unverified");
  require(static_cast<__int128>(fs.f_bavail) * fs.f_bsize >= 2 * q.budget && fd_count.load() + 48 <= 512, "recovery_headroom");
}
void rreplay(Recovery5& r) {
  const auto& events = r.bundle.at("events").a; std::string previous; int seq = 0, last_ord = 0;
  std::map<std::string, std::pair<int, std::string>> attempts;
  for (const auto& a : r.bundle.at("attempts").a) attempts.emplace(a.at("attempt").at("attempt_id").str(), std::make_pair(a.at("ordinal").integer(), rhash(a.at("attempt"))));
  for (const auto& e : events) {
    const auto id = e.at("attempt_id").str(); require(attempts.count(id), "recovery_attempt_missing"); const auto [ord, hash] = attempts.at(id);
    require(ord >= last_ord && ord < r.ordinal && e.at("sequence").integer() == ++seq && e.at("attempt_hash").str() == hash
      && (seq == 1 ? e.at("previous_event_hash").kind == RJson::Nil : e.at("previous_event_hash").str() == previous), "recovery_prefix_binding");
    last_ord = ord; auto t = std::find_if(r.targets.begin(), r.targets.end(), [&](const auto& t) { return t.id == e.at("target_id").str(); }); require(t != r.targets.end(), "recovery_target_scope");
    const auto type = e.at("type").str(); const auto& p = e.at("proof");
    if (type == "move_pending") { require(t->state == 0, "recovery_phase"); rproof_match(t->proof, p); t->state = 1; t->pending = rhash(e); t->pending_owner = id; }
    else if (type == "held_verified") { require(t->state == 1 && t->pending_owner == id, "recovery_phase"); rproof_match(t->proof, p, true); t->state = 2; }
    else if (type == "quarantine_move_pending") { require(t->state == 2, "recovery_phase"); rproof_match(t->proof, p); t->state = 3; t->pending = rhash(e); t->pending_owner = id; }
    else if (type == "quarantined_verified") { require(t->state == 3 && t->pending_owner == id, "recovery_phase"); rproof_match(t->proof, p, true); t->state = 4; }
    else if (type == "recovered_verified") {
      require(ord > 1, "recovery_phase"); const auto place = e.at("location").str();
      const bool moved = (t->state == 1 && place == "holding") || (t->state == 3 && place == "quarantine"); rproof_match(t->proof, p, moved);
      require(((t->state == 0 || t->state == 1) && place == "source") || ((t->state >= 1 && t->state <= 3) && place == "holding") || (t->state >= 3 && place == "quarantine"), "recovery_phase");
      if (t->state == 1 || t->state == 3) require(e.at("from_pending_event_hash").str() == t->pending && id != t->pending_owner, "recovery_pending_binding");
      else require(e.at("from_pending_event_hash").kind == RJson::Nil, "recovery_pending_binding");
      t->state = place == "source" ? 0 : place == "holding" ? 2 : 4;
    } else throw std::runtime_error("recovery_event_scope");
    t->proof = p; previous = rhash(e);
  }
}
std::string rpath(const RTarget& t) { return t.state == 0 || t.state == 1 ? t.source : t.state == 2 || t.state == 3 ? t.holding : t.final; }
RJson rreport(Recovery5& r) {
  std::vector<RJson> steps; for (const auto& s : r.steps) steps.push_back({{"kind", s.kind}, {"target_index", static_cast<int>(s.target)}});
  return {{"schema", "native-bar-native-recovery-plan-v5"}, {"audit", r.audit}, {"steps", steps}, {"next", static_cast<int>(r.next)},
    {"finished", r.finished}, {"consumed", r.consumed}, {"execution_available", false}, {"recovery_execution_available", false}};
}
std::shared_ptr<Coordination> rcoord(napi_env env, napi_value value) {
  bool tagged; napi_ok_or_throw(napi_check_object_type_tag(env, value, &COORD_TAG, &tagged)); require(tagged, "recovery_coordination_required");
  void* raw; napi_ok_or_throw(napi_unwrap(env, value, &raw)); auto c = *static_cast<std::shared_ptr<Coordination>*>(raw);
  require(c->session->recovery_read, "recovery_coordination_required"); return c;
}
napi_value recovery_window(napi_env env, napi_callback_info info) {
  return boundary(env, [&] { size_t count = 1; napi_value args[1]; napi_ok_or_throw(napi_get_cb_info(env, info, &count, args, nullptr, nullptr)); require(count == 1, "argument_count");
    auto c = rcoord(env, args[0]); Busy busy(*c->session); coordination_guard(*c);
    return rvalue(env, {{"opened_at", rwall(c->session->wall_deadline - std::chrono::minutes(10))}, {"expires_at", rwall(c->session->wall_deadline)}}); });
}
napi_value qualify_recovery_channel(napi_env env, napi_callback_info info) {
  return boundary(env, [&] {
    size_t count = 0; napi_ok_or_throw(napi_get_cb_info(env, info, &count, nullptr, nullptr, nullptr)); require(count == 0, "argument_count");
    constexpr int fd = 4; require(S_ISSOCK(stat_fd(fd).st_mode), "recovery_inherited_socket_required");
    int type = 0; socklen_t length = sizeof(type);
    syscall_ok(getsockopt(fd, SOL_SOCKET, SO_TYPE, &type, &length), "recovery_channel_type");
    require(type == SOCK_STREAM, "recovery_inherited_socket_required");
    sockaddr_storage peer{}; length = sizeof(peer);
    syscall_ok(getpeername(fd, reinterpret_cast<sockaddr*>(&peer), &length), "recovery_channel_peer");
    require(peer.ss_family == AF_UNIX, "recovery_inherited_socket_required");
    const int flags = fcntl(fd, F_GETFL); syscall_ok(flags, "recovery_channel_flags");
    syscall_ok(fcntl(fd, F_SETFL, flags | O_NONBLOCK), "recovery_channel_nonblocking");
    const int checked = fcntl(fd, F_GETFL); syscall_ok(checked, "recovery_channel_flags");
    require(checked & O_NONBLOCK, "recovery_channel_nonblocking"); return undefined(env);
  });
}
napi_value retire_recovery_coordination(napi_env env, napi_callback_info info) {
  return boundary(env, [&] { size_t count = 3; napi_value args[3]; napi_ok_or_throw(napi_get_cb_info(env, info, &count, args, nullptr, nullptr)); require(count == 3, "argument_count");
    auto c = rcoord(env, args[0]); Busy busy(*c->session); coordination_guard(*c);
    const auto name = string_arg(env, args[1]); require(coordination_name(name), "recovery_retirement_scope");
    const auto expected = rparse(env, rbuffer(env, args[2], 65536)); const auto current = coordination_read(*c, name);
    require(current.has_value(), "recovery_retirement_changed"); Quarantine q; q.coordination = c;
    require(rsame(rproof(env, q, name), expected), "recovery_retirement_proof_changed");
    auto fd = leaf(c->session->root(), name); binding(c->session->root(), name, fd.value, false); compare(current->proof, qproof(q, fd.value));
    c->observed.insert_or_assign(name, *current); coordination_retire(*c, name); return text(env, c->retired.back()); });
}
Wall::time_point rtime(const std::string& value) {
  require(matches(value, "[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z"), "recovery_original_window");
  tm utc{}; require(strptime(value.c_str(), "%Y-%m-%dT%H:%M:%S", &utc), "recovery_original_window");
  const auto seconds = timegm(&utc);
  require(seconds >= 0 && seconds < std::chrono::duration_cast<std::chrono::seconds>(Wall::duration::max()).count(), "recovery_original_window");
  const auto time = Wall::time_point(std::chrono::seconds(seconds) + std::chrono::milliseconds(std::stoi(value.substr(20, 3))));
  require(rwall(time) == value, "recovery_original_window"); return time;
}
napi_value bind_recovery_original_window(napi_env env, napi_callback_info info) {
  return boundary(env, [&] { size_t count = 3; napi_value args[3]; napi_ok_or_throw(napi_get_cb_info(env, info, &count, args, nullptr, nullptr)); require(count == 3, "argument_count");
    auto c = rcoord(env, args[0]); Busy busy(*c->session); coordination_baseline(*c);
    const auto opened = rtime(string_arg(env, args[1])), expires = rtime(string_arg(env, args[2])); const auto now = Wall::now();
    require(!c->original_window_bound && !c->publications && c->own.empty() && expires - opened == std::chrono::minutes(10)
      && now >= opened && now < expires && expires <= c->session->wall_deadline, "recovery_original_window");
    c->session->wall_deadline = expires; c->session->deadline = std::min(c->session->deadline,
      Steady::now() + std::chrono::duration_cast<Steady::duration>(expires - Wall::now())); c->original_window_bound = true; return undefined(env); });
}
napi_value prepare_recovery(napi_env env, napi_callback_info info) {
  return boundary(env, [&] {
    size_t argc = 5; napi_value args[5]; napi_ok_or_throw(napi_get_cb_info(env, info, &argc, args, nullptr, nullptr)); require(argc == 4 || argc == 5, "argument_count");
    auto c = rcoord(env, args[0]); Busy busy(*c->session); coordination_baseline(*c);
    auto r = std::make_shared<Recovery5>(); r->q = std::make_shared<Quarantine>(); auto& q = *r->q; q.coordination = c; q.root = c->baseline.root;
    r->original = rparse(env, rbuffer(env, args[1], 65536)); r->bundle = rparse(env, rbuffer(env, args[2], 8 * 1024 * 1024), 8 * 1024 * 1024);
    r->audit = rparse(env, rbuffer(env, args[3], 65536)); const auto& o = r->original; const auto& p = o.at("plan"); const auto& layout = p.at("layout");
    require(rsame(r->bundle.at("original"), o) && r->bundle.at("completion").kind == RJson::Nil, "recovery_original_or_completed");
    require(o.at("schema").str() == "native-bar-quarantine-intent-v5" && layout.at("target_count").integer() >= 1 && layout.at("target_count").integer() <= 2, "recovery_profile");
    r->ordinal = r->audit.at("ordinal").integer(); require(r->ordinal == 2 || r->ordinal == 3
      || (r->ordinal == 1 && c->original_window_bound && r->bundle.at("attempts").a.empty() && r->bundle.at("events").a.empty()
        && r->bundle.at("markers").a.empty() && r->audit.at("opened_at").str() == p.at("opened_at").str()
        && r->audit.at("expires_at").str() == p.at("expires_at").str()), "recovery_ordinal");
    q.id = layout.at("maintenance_id").str(); q.chunk = layout.at("chunk_id").str(); q.attempt = layout.at("attempt_ids").a.at(r->ordinal - 1).str();
    require(matches(q.id, READ_UUID) && matches(q.chunk, READ_UUID) && matches(q.attempt, READ_UUID), "recovery_identifiers");
    q.reserve = layout.at("reserve_path").str(); require(q.reserve == ".quarantine-reserve-" + layout.at("reserve_id").str() + ".tmp", "recovery_layout");
    q.budget = (4 * (9 + 14 * layout.at("target_count").integer()) + 32) * 65536ULL + 1048576;
    const std::vector<std::string> dirs{"maintenance", "maintenance/" + q.id + ".manifest", "maintenance/" + q.id + ".events", "maintenance/" + q.id + ".attempts",
      "maintenance-hold", "maintenance-hold/" + q.id, "quarantine", "quarantine/abandoned", "quarantine/abandoned/" + q.id};
    require(layout.at("directories").a.size() == dirs.size(), "recovery_layout");
    for (size_t i = 0; i < dirs.size(); ++i) require(layout.at("directories").a[i].str() == dirs[i], "recovery_layout");
    std::vector<std::string> publications{"maintenance/" + q.id + ".manifest/" + q.chunk + ".json", "maintenance/" + q.id + ".json"};
    for (const auto& id : layout.at("attempt_ids").a) { require(matches(id.str(), READ_UUID), "recovery_identifiers"); publications.push_back("maintenance/" + q.id + ".attempts/" + id.str() + ".json"); }
    require(layout.at("attempt_ids").a.size() == 3, "recovery_layout");
    for (int i = 1; i <= 14 * layout.at("target_count").integer(); ++i) publications.push_back("maintenance/" + q.id + ".events/" + std::to_string(i) + ".json");
    for (const auto& id : layout.at("attempt_ids").a) publications.push_back("quarantine/abandoned/" + q.id + "/" + id.str() + ".timestamp.json");
    publications.push_back("maintenance/" + q.id + ".done.json"); require(publications.size() == layout.at("publications").a.size(), "recovery_layout");
    std::map<std::string, RJson> retired;
    if (argc == 5) { const auto list = rparse(env, rbuffer(env, args[4], 65536)); require(list.kind == RJson::Array && list.a.size() <= 16, "recovery_retirement_scope");
      for (const auto& entry : list.a) require(matches(entry.at("path").str(), "\\.writer-retired-" + READ_UUID + "\\.lock")
        && retired.emplace(entry.at("path").str(), entry.at("proof")).second, "recovery_retirement_scope"); }
    std::map<std::string, int> temporaries;
    for (size_t i = 0; i < publications.size(); ++i) {
      const auto& slot = layout.at("publications").a[i]; require(slot.at("path").str() == publications[i] && slot.at("temporaries").a.size() == 3, "recovery_layout");
      for (int ord = 1; ord <= 3; ++ord) { const auto& temp = slot.at("temporaries").a[ord - 1]; const auto path = temp.at("path").str();
        require(temp.at("ordinal").integer() == ord && matches(path, "\\.publication-" + READ_UUID + "\\.tmp") && temporaries.emplace(path, ord).second, "recovery_temporary_slot"); }
    }
    for (const auto& e : c->baseline.entries) {
      require(e.kind == "directory" || (e.kind == "file" && e.readable), "recovery_unqualified_entry"); q.expected.emplace(e.path, e);
      require((e.path.compare(0, 7, ".writer") != 0 || retired.count(e.path)) && e.path.compare(0, 8, "receipts") != 0 && e.path.compare(0, 10, "operations") != 0, "recovery_reference_or_coordination");
      if (e.kind == "directory") { auto fd = directory(qdir(q, qparent(e.path)), qname(e.path)); auto acl = coordination_acl(fd.value, true);
        q.dirs.emplace(e.path, QuarantineDir{std::move(fd), e.metadata, acl}); }
    }
    const auto root = rdir(env, c->baseline.root, c->baseline.root_acl, recovery_acl_hash(c->session->root(), true));
    require(rsame(root, p.at("native_binding").at("root")), "recovery_root_binding");
    std::vector<RJson> ancestors;
    for (size_t i = 0; i + 1 < c->session->chain.size(); ++i) { auto& a = c->session->chain[i];
      ancestors.push_back(rdir(env, stat_fd(a.fd.value), private_access(a.fd.value, true, a.strict), recovery_acl_hash(a.fd.value, true, a.strict))); }
    require(rhash(RJson(ancestors)) == p.at("native_binding").at("ancestor_digest").str(), "recovery_ancestor_binding");
    for (const auto& d : o.at("scope").at("layout_directories").a) {
      const auto path = d.at("path").str(); require(q.dirs.count(path), "recovery_layout_directory_binding"); auto& dir = q.dirs.at(path);
      require(rsame(d.at("proof"), rdir(env, stat_fd(dir.fd.value), private_access(dir.fd.value, true, true), recovery_acl_hash(dir.fd.value, true))), "recovery_layout_directory_binding");
    }
    std::map<std::string, RJson> records{{"policy.json", {{"schema", "native-bar-synthetic-quarantine-recovery-profile-v5"}}},
      {"maintenance/" + q.id + ".json", o}, {"maintenance/" + q.id + ".manifest/" + q.chunk + ".json", o.at("manifest")}};
    for (const auto& a : r->bundle.at("attempts").a) {
      const int ord = a.at("ordinal").integer(); require(ord >= 1 && ord < r->ordinal && a.at("attempt").at("attempt_id").str() == layout.at("attempt_ids").a.at(ord - 1).str(), "recovery_attempt_binding");
      records.emplace("maintenance/" + q.id + ".attempts/" + a.at("attempt").at("attempt_id").str() + ".json", a);
    }
    require(r->bundle.at("events").a.size() <= 28 && r->bundle.at("markers").a.size() <= 2, "recovery_record_limit");
    for (const auto& e : r->bundle.at("events").a) records.emplace("maintenance/" + q.id + ".events/" + std::to_string(e.at("sequence").integer()) + ".json", e);
    for (const auto& m : r->bundle.at("markers").a) records.emplace("quarantine/abandoned/" + q.id + "/" + m.at("record").at("attempt_id").str() + ".timestamp.json", m.at("record"));
    std::vector<RJson> inventory;
    for (const auto& e : c->baseline.entries) {
      RJson file, dir, hash;
      if (e.kind == "file") { file = rproof(env, q, e.path); hash = file.at("sha256");
        if (retired.count(e.path)) require(rsame(file, retired.at(e.path)) && e.metadata.st_size <= 256, "recovery_retirement_changed");
        if (records.count(e.path)) require(hash.str() == rhash(records.at(e.path)) && file.at("size").str() == std::to_string(rcanonical(records.at(e.path)).size()), "recovery_record_changed");
      } else dir = rdir(env, e.metadata, e.acl, e.acl_hash);
      inventory.push_back({{"path", e.path}, {"kind", e.kind}, {"size", std::to_string(e.metadata.st_size)}, {"sha256", hash},
        {"allocated_bytes", std::to_string(recovery_allocated(e.metadata))}, {"proof", file}, {"directory_proof", dir}});
    }
    for (const auto& record : records) require(q.expected.count(record.first), "recovery_record_missing");
    for (const auto& record : retired) require(q.expected.count(record.first), "recovery_retirement_missing");
    std::set<std::string> private_allowed(dirs.begin(), dirs.end());
    for (const auto& record : records) private_allowed.insert(record.first);
    for (const auto& t : o.at("manifest").at("targets").a) { private_allowed.insert("maintenance-hold/" + q.id + "/" + t.at("target_id").str()); private_allowed.insert("quarantine/abandoned/" + q.id + "/" + t.at("target_id").str()); }
    for (const auto& [path, e] : q.expected) {
      if (matches(path, "(?:maintenance|maintenance-hold|quarantine)(?:/.*)?")) require(private_allowed.count(path), "recovery_unplanned_transaction_entry");
      if (path.compare(0, 20, ".quarantine-reserve-") == 0) require(path == q.reserve, "recovery_unplanned_reserve");
      if (path.compare(0, 13, ".publication-") == 0) require(temporaries.count(path) && temporaries.at(path) < r->ordinal
        && e.kind == "file" && e.metadata.st_size <= 65536, "recovery_unplanned_temporary");
    }
    require(r->audit.at("inventory_hash").str() == rhash(RJson(inventory)) && r->audit.at("original_envelope_hash").str() == rhash(o)
      && r->audit.at("scope_digest").str() == o.at("scope_digest").str() && r->audit.at("intent_hash").str() == rhash(o.at("intent"))
      && r->audit.at("native_binding_hash").str() == rhash(p.at("native_binding"))
      && r->audit.at("reference_hash").str() == o.at("intent").at("baseline").at("reference_hash").str(), "recovery_audit_binding");
    require(r->audit.at("current_reference_hash").str() == rhash({{"inventory_hash", r->audit.at("inventory_hash")},
      {"original_reference_hash", r->audit.at("reference_hash")}, {"native_binding_hash", r->audit.at("native_binding_hash")}}), "recovery_reference_generation");
    auto audit_fields = r->audit; audit_fields.o.erase("plan_hash"); require(rhash(audit_fields) == r->audit.at("plan_hash").str(), "recovery_plan_hash");
    require(r->audit.at("schema").str() == "native-bar-recovery-attempt-plan-v5" && r->audit.at("maintenance_id").str() == q.id
      && matches(r->audit.at("plan_id").str(), READ_UUID) && r->audit.at("plan_id").str() != p.at("plan_id").str(), "recovery_audit_binding");
    require(r->audit.at("opened_at").str() == rwall(c->session->wall_deadline - std::chrono::minutes(10))
      && r->audit.at("expires_at").str() == rwall(c->session->wall_deadline) && r->audit.at("issued_at").str() >= r->audit.at("opened_at").str()
      && r->audit.at("observed_at").str() > r->audit.at("issued_at").str() && r->audit.at("observed_at").str() <= rnow(), "recovery_lease_binding");
    for (const auto& t : o.at("manifest").at("targets").a) {
      const auto id = t.at("target_id").str(), source = t.at("source_path").str(); require(matches(id, READ_UUID) && matches(source, "captures/[0-9]{4}-[0-9]{2}-[0-9]{2}/" + READ_UUID + "\\.json"), "recovery_target_scope");
      const auto access = std::find_if(p.at("native_binding").at("targets").a.begin(), p.at("native_binding").at("targets").a.end(), [&](const auto& a) { return a.at("target_id").str() == id; });
      require(access != p.at("native_binding").at("targets").a.end(), "recovery_target_scope");
      for (const auto& parent : access->at("parents").a) { const auto path = parent.at("path").str(); require(q.dirs.count(path), "recovery_parent"); auto& d = q.dirs.at(path);
        require(rsame(parent.at("proof"), rdir(env, stat_fd(d.fd.value), private_access(d.fd.value, true, true), recovery_acl_hash(d.fd.value, true))), "recovery_parent"); }
      r->targets.push_back({id, source, "maintenance-hold/" + q.id + "/" + id, "quarantine/abandoned/" + q.id + "/" + id,
        access->at("acl_hash").str(), access->at("flags").str(), t.at("proof"), 0, "", ""});
    }
    require(r->targets.size() == static_cast<size_t>(layout.at("target_count").integer()), "recovery_target_limit"); rreplay(*r);
    std::vector<RJson> observations, actions;
    r->steps.push_back({"attempt", 0});
    for (size_t i = 0; i < r->targets.size(); ++i) {
      auto& t = r->targets[i]; const int durable = t.state; std::vector<std::pair<std::string, int>> places{{t.source, 0}, {t.holding, 2}, {t.final, 4}};
      std::string location; RJson actual; int found = 0;
      for (const auto& [path, state] : places) if (q.expected.count(path)) {
        ++found; require(q.expected.at(path).kind == "file", "recovery_location_conflict");
        require(durable == state || (durable == 1 && (state == 0 || state == 2)) || (durable == 3 && (state == 2 || state == 4)), "recovery_location_conflict");
        actual = rproof(env, q, path); require(actual.at("acl_hash").str() == t.acl_hash, "recovery_target_acl");
        require(actual.at("flags").str() == t.flags, "recovery_target_flags");
        auto base = actual; base.o.erase("flags"); base.o.erase("acl_hash"); rproof_match(t.proof, base, (durable == 1 && state == 2) || (durable == 3 && state == 4));
        t.proof = base; t.state = state; location = state == 0 ? "source" : state == 2 ? "holding" : "quarantine";
      }
      require(found == 1, "recovery_location_conflict"); observations.push_back({{"target_id", t.id}, {"source", location == "source" ? t.proof : RJson{}},
        {"holding", location == "holding" ? t.proof : RJson{}}, {"quarantine", location == "quarantine" ? t.proof : RJson{}}});
      if (durable != 1 && durable != 3) t.pending.clear();
      if (!r->bundle.at("events").a.empty()) { r->steps.push_back({"recovered_verified", i}); actions.push_back({{"target_id", t.id}, {"action", "verify"}}); }
      if (t.state == 0) { r->steps.push_back({"move_pending", i}); r->steps.push_back({"stage", i}); r->steps.push_back({"held_verified", i}); actions.push_back({{"target_id", t.id}, {"action", "stage"}}); }
      if (t.state != 4) { r->steps.push_back({"quarantine_move_pending", i}); r->steps.push_back({"quarantine", i}); r->steps.push_back({"quarantined_verified", i}); actions.push_back({{"target_id", t.id}, {"action", "quarantine"}}); }
    }
    require(rsame(RJson(observations), r->audit.at("observations")) && rsame(RJson(actions), r->audit.at("actions")), "recovery_native_action_scope");
    require(r->audit.at("prefix_count").integer() == static_cast<int>(r->bundle.at("events").a.size())
      && (r->bundle.at("events").a.empty() ? r->audit.at("prefix_hash").kind == RJson::Nil : r->audit.at("prefix_hash").str() == rhash(r->bundle.at("events").a.back())), "recovery_prefix_binding");
    auto reserve = rproof(env, q, q.reserve); require(rsame(reserve, o.at("scope").at("allocation").at("proof")), "recovery_allocation_lost");
    r->steps.push_back({"marker", 0}); r->steps.push_back({"completion", 0});
    size_t sequence = r->bundle.at("events").a.size();
    for (const auto& s : r->steps) {
      if (s.kind == "stage" || s.kind == "quarantine") continue;
      std::string path = s.kind == "attempt" ? "maintenance/" + q.id + ".attempts/" + q.attempt + ".json"
        : s.kind == "marker" ? "quarantine/abandoned/" + q.id + "/" + q.attempt + ".timestamp.json"
        : s.kind == "completion" ? "maintenance/" + q.id + ".done.json" : "maintenance/" + q.id + ".events/" + std::to_string(++sequence) + ".json";
      const auto& slots = layout.at("publications").a; auto slot = std::find_if(slots.begin(), slots.end(), [&](const auto& v) { return v.at("path").str() == path; });
      require(slot != slots.end() && !q.expected.count(path), "recovery_publication_slot"); const auto temp = slot->at("temporaries").a.at(r->ordinal - 1).at("path").str();
      require(matches(temp, "\\.publication-" + READ_UUID + "\\.tmp") && !q.expected.count(temp), "recovery_temporary_slot"); q.publications.push_back(path); q.temporaries.push_back(temp);
    }
    require(sequence <= 14 * r->targets.size() && c->baseline.entries.size() + q.publications.size() * 2 + 32 <= 512, "recovery_capacity");
    r->last_wall = rnow(); rguard(*r, false); return wrap(env, r, RECOVERY_TAG);
  });
}
RJson rbase(RJson proof) { proof.o.erase("flags"); proof.o.erase("acl_hash"); proof.o.erase("allocated_bytes"); return proof; }
void rtarget_verify(napi_env env, Recovery5& r, size_t index, napi_value hook, bool sync) {
  auto& t = r.targets.at(index); auto& q = *r.q; const auto path = rpath(t);
  read_hook(env, hook, "before_recovery_verify", path); rguard(r, true);
  auto proof = rproof(env, q, path); require(proof.at("acl_hash").str() == t.acl_hash, "recovery_target_acl"); rproof_match(t.proof, rbase(proof));
  require(proof.at("flags").str() == t.flags, "recovery_target_flags");
  if (sync) { auto fd = leaf(qdir(q, qparent(path)), qname(path)); qsync(q, fd.value, env, hook, path);
    qsync(q, qdir(q, qparent(path)), env, hook, qparent(path), true); }
  rproof_match(t.proof, rbase(rproof(env, q, path))); rguard(r, true);
}
void rmove(napi_env env, Recovery5& r, size_t index, bool final, napi_value hook) {
  auto& q = *r.q; auto& t = r.targets.at(index);
  require(t.state == (final ? 3 : 1) && r.next > 0 && r.steps[r.next - 1].kind == (final ? "quarantine_move_pending" : "move_pending"), "recovery_move_without_fresh_pending");
  const auto from = final ? t.holding : t.source, to = final ? t.final : t.holding;
  read_hook(env, hook, "before_move", to); rguard(r, true); rtarget_verify(env, r, index, hook, false);
  auto fd = leaf(qdir(q, qparent(from)), qname(from)); binding(qdir(q, qparent(from)), qname(from), fd.value, false);
  read_hook(env, hook, "after_source_check", to); rguard(r, true);
  read_hook(env, hook, "before_rename", to); qlocked(q); qbind_dirs(q);
  syscall_ok(renameatx_np(qdir(q, qparent(from)), qname(from).c_str(), qdir(q, qparent(to)), qname(to).c_str(),
    RENAME_EXCL | RENAME_NOFOLLOW_ANY | RENAME_RESOLVE_BENEATH), "recovery_exclusive_move_failed");
  q.expected.erase(from); qrefresh(q, qparent(from)); auto moved = leaf(qdir(q, qparent(to)), qname(to)); qremember(q, to, moved.value, false);
  read_hook(env, hook, "after_move", to); auto proof = rproof(env, q, to); rproof_match(t.proof, rbase(proof), true);
  require(proof.at("acl_hash").str() == t.acl_hash, "recovery_target_acl"); require(proof.at("flags").str() == t.flags, "recovery_target_flags");
  t.proof = rbase(proof); t.state = final ? 4 : 2;
  qsync(q, moved.value, env, hook, to); qsync(q, qdir(q, qparent(from)), env, hook, qparent(from), true);
  qsync(q, qdir(q, qparent(to)), env, hook, qparent(to), true); rguard(r, true);
}
RJson rattempt(Recovery5& r) {
  const auto& o = r.original; const auto& a = r.audit;
  RJson attempt{{"schema", "native-bar-maintenance-attempt-v2"}, {"attempt_id", r.q->attempt}, {"maintenance_id", r.q->id},
    {"intent_hash", rhash(o.at("intent"))}, {"binding_hash", rhash(o.at("intent").at("binding"))}, {"approval_plan_hash", r.ordinal == 1 ? o.at("plan").at("plan_hash") : a.at("plan_hash")},
    {"issued", rclock(a.at("opened_at").str())}, {"expires_at", a.at("expires_at")}, {"resume_after_event_hash", a.at("prefix_hash")},
    {"reference_hash", a.at("reference_hash")}, {"actions", a.at("actions")}, {"observations", a.at("observations")}};
  return {{"schema", "native-bar-recovery-attempt-v5"}, {"ordinal", r.ordinal},
    {"previous_envelope_hash", r.bundle.at("attempts").a.empty() ? RJson{} : RJson(rhash(r.bundle.at("attempts").a.back()))}, {"attempt", attempt}, {"plan", a}};
}
RJson revent(Recovery5& r, const std::string& type, size_t index) {
  auto& t = r.targets.at(index); const auto& events = r.bundle.at("events").a;
  RJson e{{"schema", "native-bar-maintenance-event-v2"}, {"maintenance_id", r.q->id}, {"intent_hash", rhash(r.original.at("intent"))},
    {"attempt_id", r.q->attempt}, {"attempt_hash", rhash(r.attempt.at("attempt"))}, {"sequence", static_cast<int>(events.size() + 1)},
    {"previous_event_hash", events.empty() ? RJson{} : RJson(rhash(events.back()))}, {"target_id", t.id}, {"clock", rclock(rnow())}, {"type", type}, {"proof", t.proof}};
  if (type == "recovered_verified") { e.o["location"] = t.state == 0 ? "source" : t.state == 2 ? "holding" : "quarantine";
    e.o["from_pending_event_hash"] = t.pending.empty() ? RJson{} : RJson(t.pending); }
  return e;
}
RJson rstep(napi_env env, Recovery5& r, napi_value hook) {
  auto& q = *r.q; require(r.begun && r.consumed && r.next < r.steps.size() && !r.finished, "recovery_step_unavailable");
  rguard(r, true); const auto s = r.steps.at(r.next); read_hook(env, hook, "before_recovery_step", s.kind); rguard(r, true);
  RJson record, publication;
  if (s.kind == "stage" || s.kind == "quarantine") rmove(env, r, s.target, s.kind == "quarantine", hook);
  else {
    if (s.kind == "attempt") { r.attempt = rattempt(r); record = r.attempt; }
    else if (s.kind == "marker" || s.kind == "completion") {
      std::vector<RJson> targets;
      for (size_t i = 0; i < r.targets.size(); ++i) { require(r.targets[i].state == 4, "recovery_incomplete"); rtarget_verify(env, r, i, hook, true);
        targets.push_back({{"target_id", r.targets[i].id}, {"proof", r.targets[i].proof}}); }
      if (s.kind == "marker") { record = {{"schema", "native-bar-recovery-timestamp-v5"}, {"maintenance_id", q.id}, {"attempt_id", q.attempt},
          {"intent_hash", rhash(r.original.at("intent"))}, {"last_event_hash", rhash(r.bundle.at("events").a.back())}, {"targets", targets}, {"verified_at", rnow()}};
        r.marker_before = rnow(); }
      else {
        std::vector<RJson> published, used; std::set<std::string> seen;
        for (const auto& a : r.bundle.at("attempts").a) published.push_back(rhash(a));
        for (const auto& e : r.bundle.at("events").a) if (seen.insert(e.at("attempt_id").str()).second) used.push_back(e.at("attempt_hash"));
        auto proof = rconvert(env, qproof_value(env, r.marker_proof, private_access(leaf(qdir(q, "quarantine/abandoned/" + q.id), q.attempt + ".timestamp.json").value, false, true)));
        proof.o["acl_hash"] = rproof(env, q, "quarantine/abandoned/" + q.id + "/" + q.attempt + ".timestamp.json").at("acl_hash");
        record = {{"schema", "native-bar-recovery-completion-v5"}, {"maintenance_id", q.id}, {"intent_hash", rhash(r.original.at("intent"))},
          {"last_event_hash", rhash(r.bundle.at("events").a.back())}, {"published_attempt_hashes", published}, {"used_attempt_hashes", used},
          {"final_attempt_id", q.attempt}, {"clock", rclock(rnow())}, {"targets", targets},
          {"marker", {{"path", "quarantine/abandoned/" + q.id + "/" + q.attempt + ".timestamp.json"}, {"hash", rhash(r.marker)}, {"proof", proof},
            {"publication", {{"before", rclock(r.marker_before)}, {"after", rclock(r.marker_after)}}}}}};
      }
    } else {
      if (s.kind == "recovered_verified" || s.kind == "held_verified" || s.kind == "quarantined_verified") rtarget_verify(env, r, s.target, hook, true);
      if (s.kind == "move_pending") require(r.targets[s.target].state == 0, "recovery_phase");
      if (s.kind == "quarantine_move_pending") require(r.targets[s.target].state == 2, "recovery_phase"); record = revent(r, s.kind, s.target);
    }
    const auto path = q.publications.at(q.next); const auto proof = qpublish_record(q, q.next, rcanonical(record), env, hook);
    auto full = rproof(env, q, path); full.o["allocated_bytes"] = std::to_string(recovery_allocated(proof.metadata));
    publication = {{"path", path}, {"record", record}, {"proof", full}};
    if (s.kind == "attempt") r.bundle.o["attempts"].a.push_back(record);
    else if (s.kind == "marker") { r.marker = record; r.marker_proof = proof; r.marker_after = rnow(); auto native = full; native.o.erase("allocated_bytes");
      r.bundle.o["markers"].a.push_back({{"record", record}, {"proof", native}}); }
    else if (s.kind == "completion") { r.bundle.o["completion"] = record; r.finished = true; }
    else { r.bundle.o["events"].a.push_back(record); if (s.kind == "move_pending") r.targets[s.target].state = 1; if (s.kind == "quarantine_move_pending") r.targets[s.target].state = 3; }
  }
  ++r.next; rguard(r, true); read_hook(env, hook, "after_recovery_step", s.kind); rguard(r, true);
  return {{"state", rreport(r)}, {"publication", publication}, {"bundle", r.bundle}, {"publication_acknowledged_at", rnow()}, {"execution_available", false}, {"recovery_execution_available", false}};
}
napi_value recovery_call(napi_env env, napi_callback_info info) {
  return boundary(env, [&] {
    size_t argc = 4; napi_value args[4]; napi_ok_or_throw(napi_get_cb_info(env, info, &argc, args, nullptr, nullptr)); require(argc == 4, "argument_count");
    auto r = rarg(env, args[0]); Busy busy(*r->q->coordination->session); const auto action = string_arg(env, args[1]);
    napi_valuetype supplied; napi_ok_or_throw(napi_typeof(env, args[2], &supplied));
    require(action == "consume" || supplied == napi_undefined, "recovery_no_caller_paths_phases_or_payload");
    if (action == "close") { r->q->closed = true; r->q->dirs.clear(); r->q->expected.clear(); return undefined(env); }
    if (action == "report") return rvalue(env, rreport(*r));
    try {
      rguard(*r, r->begun);
      if (action == "approve") { require(!r->approval_issued && !r->consumed, "recovery_approval_already_issued"); r->approval_issued = true;
        return wrap(env, std::make_shared<RApproval>(RApproval{r, false}), RECOVERY_APPROVAL_TAG); }
      if (action == "consume") {
        bool tagged; napi_ok_or_throw(napi_check_object_type_tag(env, args[2], &RECOVERY_APPROVAL_TAG, &tagged)); require(tagged, "recovery_approval_required");
        void* raw; napi_ok_or_throw(napi_unwrap(env, args[2], &raw)); auto approval = *static_cast<std::shared_ptr<RApproval>*>(raw);
        require(approval->owner == r && !approval->used && !r->consumed, "recovery_approval_issuer_or_consumed"); approval->used = true; r->consumed = true; return undefined(env);
      }
      if (action == "begin") { require(r->consumed && !r->begun, "recovery_approval_required"); coordination_baseline(*r->q->coordination); qlocked(*r->q);
        r->q->root = stat_fd(r->q->coordination->session->root()); r->q->begun = true; r->begun = true; rguard(*r, true); return undefined(env); }
      if (action == "verify") { require(r->begun, "recovery_step_unavailable"); rguard(*r, true); return undefined(env); }
      if (action == "step") { auto out = rvalue(env, rstep(env, *r, args[3])); rguard(*r, true); return out; }
      throw std::runtime_error("invalid_recovery_action");
    } catch (...) { r->q->halted = true; throw; }
  });
}
