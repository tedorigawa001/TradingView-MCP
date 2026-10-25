// Protocol 6: paired read-only fixture context. No legacy session/target is exposed.
const napi_type_tag ADMISSION_CONTEXT_TAG{0x21d908a1ab345002ULL, 0xc4231da13c500021ULL};
const napi_type_tag ADMISSION_PAIR_TAG{0x21d908a1ab345003ULL, 0xc4231da13c500022ULL};
const napi_type_tag ADMISSION_SNAPSHOT_TAG{0x21d908a1ab345004ULL, 0xc4231da13c500023ULL};
const std::string ADMISSION_POLICY = "{\"schema\":\"native-bar-synthetic-admission-profile-v6\"}";
void akeys(const RJson& v, std::initializer_list<const char*> keys) {
  require(v.kind == RJson::Object && v.o.size() == keys.size(), "admission_fields");
  for (auto k : keys) require(v.o.count(k), "admission_fields");
}
void auint(const RJson& v) { require(matches(v.str(), "(?:0|[1-9][0-9]{0,29})"), "admission_decimal"); }
void ahash(const RJson& v) { require(matches(v.str(), "[0-9a-f]{64}"), "admission_hash"); }
void aid(const RJson& v) { require(matches(v.str(), READ_UUID), "admission_identifier"); }
std::vector<std::string> aparts(const std::string& p) {
  std::vector<std::string> result; size_t at = 0;
  while (at < p.size()) { auto end = p.find('/', at); if (end == std::string::npos) end = p.size();
    auto part = p.substr(at, end - at); require(!part.empty() && part != "." && part != "..", "admission_path"); result.push_back(part); at = end + 1; }
  require(!p.empty() && p.back() != '/' && p.find('\\') == std::string::npos && p.find('\0') == std::string::npos, "admission_path"); return result;
}
RJson aparse(napi_env env, napi_value input) {
  auto bytes = rbuffer(env, input, 65536); unsigned depth = 0, nodes = 0; bool quoted = false, escaped = false;
  for (unsigned char c : bytes) {
    if (quoted) { if (escaped) escaped = false; else if (c == '\\') escaped = true; else if (c == '"') quoted = false; continue; }
    if (c == '"') quoted = true;
    if (c == '{' || c == '[') require(++depth <= 24, "admission_input_depth");
    if (c == '}' || c == ']') { require(depth > 0, "admission_json"); --depth; }
    if (c == ',' || c == ':' || c == '[' || c == '{') require(++nodes <= 16384, "admission_input_nodes");
  }
  try { return rparse(env, bytes); } catch (...) {
    bool pending = false; napi_is_exception_pending(env, &pending); if (pending) { napi_value error; napi_get_and_clear_last_exception(env, &error); }
    throw std::runtime_error("admission_json");
  }
}
void abinding_schema(const RJson& p, bool file) {
  if (file) akeys(p, {"device","inode","uid","gid","mode","flags","birthtime_ns","acl","acl_hash","nlink","size","sha256"});
  else akeys(p, {"device","inode","uid","gid","mode","flags","birthtime_ns","acl","acl_hash"});
  for (auto k : {"device","inode","uid","gid","mode","flags","birthtime_ns"}) auint(p.at(k));
  require(p.at("acl").str() == "none" || p.at("acl").str() == "deny_only", "admission_acl_binding"); ahash(p.at("acl_hash"));
  if (file) { require(p.at("mode").str() == "33152" && p.at("nlink").str() == "1", "admission_marker_mode"); auint(p.at("size")); ahash(p.at("sha256")); }
}
void aregistration_schema(const RJson& r) {
  akeys(r, {"schema","scope","pins","authority_reference","temp_anchor","fixture_name","policy_hash","bindings","volume"});
  require(r.at("schema").str() == "native-bar-admission-read-registration-v1" && r.at("scope").str() == "synthetic_fixture_only", "admission_profile");
  const auto& p = r.at("pins"); akeys(p, {"fixture_id","store_id","epoch_id","authority_id","key_id","enrollment_hash","public_key_spki_sha256"});
  std::set<std::string> ids;
  for (auto k : {"fixture_id","store_id","epoch_id","authority_id","key_id"}) { aid(p.at(k)); require(ids.insert(p.at(k).str()).second, "admission_id_alias"); }
  aid(r.at("authority_reference")); require(ids.insert(r.at("authority_reference").str()).second, "admission_id_alias");
  ahash(p.at("enrollment_hash")); ahash(p.at("public_key_spki_sha256"));
  require(r.at("policy_hash").str() == qhash(ADMISSION_POLICY.data(), ADMISSION_POLICY.size()), "admission_policy_binding");
  require(matches(r.at("fixture_name").str(), "native-bar-fs-synthetic-[A-Za-z0-9]{6}"), "admission_fixture_required");
  const auto anchor = r.at("temp_anchor").str(); require(anchor.size() > 1 && anchor.front() == '/' && anchor.size() <= 4096, "admission_temp_anchor"); aparts(anchor.substr(1));
  const auto& b = r.at("bindings"); akeys(b, {"ancestors","fixture_parent","data","witness","markers"});
  for (auto k : {"fixture_parent","data","witness"}) { abinding_schema(b.at(k), false); require(b.at(k).at("mode").str() == "16832", "admission_directory_mode"); }
  const auto& a = b.at("ancestors"); require(a.kind == RJson::Array && a.a.size() >= 1 && a.a.size() <= 16, "admission_ancestors");
  auto components = aparts(anchor.substr(1)); require(a.a.size() == components.size() + 1, "admission_ancestors"); std::string path = "/";
  for (size_t i = 0; i < a.a.size(); ++i) { akeys(a.a[i], {"path","proof"}); abinding_schema(a.a[i].at("proof"), false);
    if (i) path += (i == 1 ? "" : "/") + components[i - 1]; require(a.a[i].at("path").str() == path, "admission_ancestors"); }
  akeys(b.at("markers"), {"base","admission"}); abinding_schema(b.at("markers").at("base"), true); abinding_schema(b.at("markers").at("admission"), true);
  const auto& v = r.at("volume"); akeys(v, {"filesystem","local","ownership_enforced","case_preserving","case_sensitive","read_only_mount"});
  require(v.at("filesystem").str() == "apfs", "admission_volume");
  for (auto k : {"local","ownership_enforced","case_preserving"}) require(v.at(k).kind == RJson::Bool && v.at(k).b, "admission_volume");
  require(v.at("case_sensitive").kind == RJson::Bool && v.at("read_only_mount").kind == RJson::Bool, "admission_volume");
}
struct AEntry { std::string role, path, kind, acl, acl_hash, category; struct stat st{}; bool readable = false, qualified = true, safe = true; uint64_t cap = 0; };
struct ASnapshot;
struct AdmissionRead {
  RJson registration; ReadLimits limits; std::vector<Anchor> chain; Fd data, witness;
  struct stat data_stat{}, witness_stat{}, parent_stat{};
  std::map<std::string, AEntry> controls; std::shared_ptr<ASnapshot> snapshot;
  Steady::time_point deadline; Wall::time_point wall_deadline, last_wall;
  uint64_t reads = 0, registration_bytes = 0; pid_t owner = getpid();
  bool reserved = false, closed = false, busy = false, poisoned = false; std::string state = "started", started_at;
  ~AdmissionRead(); void release();
  void clock() { require(!closed && !poisoned && owner == getpid(), "admission_context_closed"); const auto now = Wall::now();
    require(now >= last_wall && now < wall_deadline && Steady::now() < deadline, "admission_deadline_or_rollback"); last_wall = now; }
  void charge(uint64_t n) { clock(); require(n <= limits.read_bytes && reads <= limits.read_bytes - n, "admission_read_limit"); reads += n; }
};
struct ASnapshot { std::weak_ptr<AdmissionRead> owner; std::vector<AEntry> entries; std::map<size_t, std::string> read_set;
  uint64_t inventory_bytes = 0, metadata_bytes = 0; bool qualified = true, safe = true, closed = false;
  void release() { std::vector<AEntry>().swap(entries); read_set.clear(); closed = true; } };
AdmissionRead::~AdmissionRead() { release(); }
void AdmissionRead::release() { if (closed) return; if (snapshot) snapshot->release(); snapshot.reset(); controls.clear();
  data.reset(); witness.reset(); chain.clear(); closed = true; state = "closed";
  if (reserved) { session_count -= 2; reserved = false; } }
struct ABusy { AdmissionRead& c; explicit ABusy(AdmissionRead& c): c(c) { if(c.busy)c.poisoned=true;require(!c.busy, "admission_busy"); c.busy = true; } ~ABusy() { c.busy = false; } };
struct AFailure { AdmissionRead& c; int exceptions = std::uncaught_exceptions(); napi_env env;
  ~AFailure() { bool pending = false; napi_is_exception_pending(env, &pending); if (pending || std::uncaught_exceptions() > exceptions) c.release(); } };
std::shared_ptr<AdmissionRead> acontext(napi_env env, napi_value v, const napi_type_tag& tag) {
  bool tagged = false; napi_ok_or_throw(napi_check_object_type_tag(env, v, &tag, &tagged)); require(tagged, "admission_handle_required");
  void* p; napi_ok_or_throw(napi_unwrap(env, v, &p)); return *static_cast<std::shared_ptr<AdmissionRead>*>(p);
}
std::string aacl(AdmissionRead& c, int fd, bool dir, bool strict = true) {
  c.charge(1024); private_access(fd, dir, strict); auto raw = acl_get_fd_np(fd, ACL_TYPE_EXTENDED); std::string bytes = "none";
  if (!raw) require(errno == ENOENT, "admission_acl_unavailable");
  else { struct Guard { acl_t p; ~Guard() { acl_free(p); } } g{raw}; ssize_t n = 0; char* p = acl_to_text(raw, &n);
    struct Text { char* p; ~Text() { if (p) acl_free(p); } } t{p}; require(p && n >= 0 && n <= 65536, "admission_acl_limit"); bytes.assign(p, n); }
  c.charge(bytes.size() * 2); return qhash(bytes.data(), bytes.size());
}
RJson abinding(AdmissionRead& c, int fd, bool dir, bool strict = true) {
  const auto before = stat_fd(fd); const auto hash = aacl(c, fd, dir, strict); const auto after = stat_fd(fd);
  require(strict ? equal_metadata(before, after) : recovery_anchor_equal(before, after), "admission_binding_changed");
  return {{"device",std::to_string(after.st_dev)}, {"inode",std::to_string(after.st_ino)}, {"uid",std::to_string(after.st_uid)},
    {"gid",std::to_string(after.st_gid)}, {"mode",std::to_string(after.st_mode)}, {"flags",std::to_string(after.st_flags)},
    {"birthtime_ns",nanoseconds(after.st_birthtimespec)}, {"acl",private_access(fd,dir,strict)}, {"acl_hash",hash}};
}
void aexpected(const RJson& expected, const RJson& actual) {
  for (const auto& [key, value] : expected.o) if (key != "sha256" && key != "size" && key != "nlink")
    require(actual.o.count(key) && rsame(value, actual.at(key)), "admission_expected_binding");
}
std::vector<std::string> anames(AdmissionRead& c, int fd, uint64_t remaining) {
  DirectoryStream stream(fd); std::vector<std::string> result; std::set<std::string> folded;
  while (true) { c.clock(); errno = 0; auto e = readdir(stream.stream); if (!e) { require(!errno, "admission_readdir"); break; }
    // Charge the variable record actually returned, not sizeof(dirent): its fixed 1 KiB name buffer is mostly unused.
    std::string name(e->d_name); if (name == "." || name == "..") continue;
    c.charge(std::max<uint64_t>(e->d_reclen, offsetof(dirent, d_name) + name.size() + 1));
    require(result.size() < remaining, "admission_entry_limit"); require(folded.insert(name_key(name)).second, "admission_name_collision"); result.push_back(name); }
  std::sort(result.begin(), result.end()); return result;
}
void aexact(AdmissionRead& c, int parent, const std::string& name) {
  const auto list = anames(c, parent, 512); require(std::find(list.begin(), list.end(), name) != list.end(), "admission_exact_name");
}
std::string atemp() {
  char os[PATH_MAX], canonical[PATH_MAX]; const auto n = confstr(_CS_DARWIN_USER_TEMP_DIR, os, sizeof(os));
  require(n > 0 && n <= sizeof(os) && realpath(os, canonical), "admission_temp_unavailable"); return canonical;
}
int aroot(AdmissionRead& c, const std::string& role) { return role == "data" ? c.data.value : c.witness.value; }
// Shared OS ancestors are never listed: unrelated temp entries cannot exhaust the entry cap, collide or consume the read
// budget. Name-to-object binding plus pinned identity suffice there; renames inside the private fixture change the full
// metadata (mtime/ctime) of the parent, root or listed directory that every check below compares.
void aguard(AdmissionRead& c) {
  c.clock(); require(fd_count.load() + 48 <= 512, "admission_fd_headroom");
  for (size_t i = 0; i < c.chain.size(); ++i) {
    const bool strict = i + 1 == c.chain.size(); auto actual = abinding(c, c.chain[i].fd.value, true, strict);
    if (i + 1 < c.chain.size()) aexpected(c.registration.at("bindings").at("ancestors").a[i].at("proof"), actual);
    else { aexpected(c.registration.at("bindings").at("fixture_parent"), actual); require(equal_metadata(c.parent_stat, stat_fd(c.chain[i].fd.value)) && c.parent_stat.st_blocks == stat_fd(c.chain[i].fd.value).st_blocks, "admission_parent_changed"); }
    if (i) { struct stat entry{}; syscall_ok(fstatat(c.chain[i-1].fd.value, c.chain[i].name.c_str(), &entry, AT_SYMLINK_NOFOLLOW), "admission_anchor_changed");
      require(S_ISDIR(entry.st_mode) && same_id(entry, stat_fd(c.chain[i].fd.value)), "admission_anchor_changed"); }
  }
  if (c.data.value >= 0) for (const auto& role : {std::string("data"),std::string("witness")}) {
    int fd = aroot(c,role);const auto name=role == "data" ? "store" : "admission-witness";binding(c.chain.back().fd.value,name,fd,true);
    aexpected(c.registration.at("bindings").at(role), abinding(c,fd,true));
    const auto volume=read_volume(fd);const auto& expected_volume=c.registration.at("volume");
    require(volume.case_sensitive==expected_volume.at("case_sensitive").b && volume.read_only==expected_volume.at("read_only_mount").b,"admission_volume_binding");
    const auto& expected = role == "data" ? c.data_stat : c.witness_stat;
    require(equal_metadata(expected, stat_fd(fd)) && expected.st_blocks == stat_fd(fd).st_blocks, "admission_root_changed"); }
  c.clock();
}
// The exact on-disk name is listed once, when a control is first pinned; later reads compare that pinned or snapshot
// metadata and the unchanged parent instead of relisting the directory on every check.
std::pair<std::string,AEntry> aread(AdmissionRead& c, int parent, const std::string& name, const std::string& role, const std::string& path, uint64_t cap, const AEntry* expected = nullptr) {
  if (!expected) aexact(c,parent,name); auto file = leaf(parent,name); binding(parent,name,file.value,false); const auto before = stat_fd(file.value);
  require(before.st_nlink == 1 && before.st_size >= 0 && static_cast<uint64_t>(before.st_size) <= cap, "admission_file_limit");
  const auto acl = aacl(c,file.value,false); if (expected) require(equal_metadata(expected->st,before) && expected->acl_hash == acl
    && expected->st.st_blocks == before.st_blocks, "admission_file_changed");
  c.charge(before.st_size); std::string bytes(before.st_size,'\0'); size_t offset = 0;
  while (offset < bytes.size()) { c.clock(); auto n = pread(file.value,bytes.data()+offset,bytes.size()-offset,offset); if (n < 0 && errno == EINTR) continue;
    require(n > 0, "admission_short_read"); offset += n; }
  require(equal_metadata(before,stat_fd(file.value)) && before.st_blocks == stat_fd(file.value).st_blocks && aacl(c,file.value,false) == acl, "admission_file_changed");
  binding(parent,name,file.value,false); if (!expected) aexact(c,parent,name); AEntry e; e.role=role; e.path=path; e.kind="file"; e.st=before; e.acl=private_access(file.value,false,true); e.acl_hash=acl;
  return {bytes,e};
}
void acontrols(AdmissionRead& c, bool first) {
  const auto& r = c.registration; const auto& pins = r.at("pins");
  const RJson marker{{"schema","native-bar-admission-fixture-marker-v1"},{"fixture_id",pins.at("fixture_id")},{"store_id",pins.at("store_id")},
    {"epoch_id",pins.at("epoch_id")},{"policy_hash",r.at("policy_hash")},{"data_root","store"},{"witness_root","admission-witness"}};
  for (const auto& name : {std::string(".native-bar-fs-synthetic"),std::string(".native-bar-admission-synthetic"),std::string("policy.json")}) {
    const bool policy = name == "policy.json"; const auto key = policy ? "policy" : name == ".native-bar-fs-synthetic" ? "base" : "admission";
    auto value = aread(c,policy?c.data.value:c.chain.back().fd.value,name,policy?"data":"fixture",name,4096,
      first ? nullptr : &c.controls.at(key));
    const auto bytes = policy?ADMISSION_POLICY:name == ".native-bar-fs-synthetic"?"synthetic-fixture-v1\n":rcanonical(marker);
    require(value.first == bytes, "admission_control_bytes");
    if (!policy) { const auto& expected = r.at("bindings").at("markers").at(key); aexpected(expected,abinding(c,leaf(c.chain.back().fd.value,name).value,false));
      require(expected.at("size").str() == std::to_string(value.first.size()) && expected.at("sha256").str() == qhash(value.first.data(),value.first.size()), "admission_marker_binding"); }
    if (first) {value.second.category="control";c.controls.emplace(key,std::move(value.second));}
  }
}
struct AShape { std::string category; bool directory = false, pending = false, qualified = true, metadata = false; uint64_t cap = 0; };
AShape ashape(const std::string& role, const std::string& p) {
  auto is = [&](const std::string& pattern) { return matches(p,pattern); }; const std::string u=READ_UUID, seq="[1-9][0-9]{0,29}", day="[0-9]{4}-[0-9]{2}-[0-9]{2}";
  auto out=[](const std::string& kind,uint64_t cap=0,bool dir=false,bool pending=false,bool metadata=false) { return AShape{kind,dir,pending,true,metadata,cap}; };
  if (role=="fixture") { if(p=="store"||p=="admission-witness")return out("directory",0,true);
    if(p==".native-bar-fs-synthetic"||p==".native-bar-admission-synthetic")return out("control",4096,false,false,true); return {"unknown_private",false,false,false,false,0}; }
  if(role=="witness") { if(is(std::string(seq)+"\\.json"))return out("witness_record",16384,false,false,true); return {"unknown_private",false,false,false,false,0}; }
  if(p=="policy.json")return out("control",4096,false,false,true);
  if(is("producer/"+u+"/"+seq+"\\.json"))return out("producer_mirror",8192,false,false,true);
  if(is("producer|producer/"+u+"|captures|receipts|(?:captures|receipts)/"+day+"|maintenance|maintenance-hold|maintenance-hold/"+u+"|quarantine|quarantine/abandoned|quarantine/abandoned/"+u))return out("directory",0,true);
  if(is("captures/"+std::string(day)+"/"+u+"\\.json|maintenance-hold/"+u+"/"+u+"|quarantine/abandoned/"+u+"/"+u))return out("payload",1048576);
  if(is("receipts/"+std::string(day)+"/"+u+"\\.json"))return out("receipt",16384,false,false,true);
  if(is("\\.producer-"+u+"\\.tmp"))return out("pending",1048576,false,true,true);
  if(is("\\.ea-"+u+"-(?:[1-9]|[12][0-9]|3[0-7])-[1-3]\\.tmp"))return out("pending",65536,false,true,true);
  if(is("maintenance/"+u+"(?:\\.done)?\\.json|maintenance/"+u+"\\.(?:manifest|attempts)/"+u+"\\.json|maintenance/"+u+"\\.events/(?:[1-9]|1[0-9]|2[0-8])\\.json|quarantine/abandoned/"+u+"/"+u+"\\.timestamp\\.json"))return out("maintenance_metadata",65536,false,false,true);
  if(is("maintenance/"+u+"\\.(?:manifest|attempts|events)"))return out("directory",0,true);
  if(is("\\.writer\\.(?:lock|takeover)|\\.writer-(?:claim|ticket)-"+u+"\\.json|\\.writer-retired-"+u+"\\.lock"))return out("coordination",65536,false,false,true);
  if(is("\\.quarantine-reserve-"+u+"\\.tmp"))return out("reserve");
  // Legacy v1/v5/R-D private names (retention, v5 stages, R-D publication temporaries) never belong in a v6 store.
  if(is("(?:producer|maintenance|maintenance-hold|operations|quarantine)(?:/.*)?|\\.(?:ea-|producer-|writer|quarantine-reserve-|publication-).*|retention\\.json|(?:captures|receipts)/.*\\.stage"))return {"unknown_private",false,false,false,false,0};
  return out("ordinary_side");
}
AShape aclass(const std::string& role,const std::string& path,bool dir) {
  auto s=ashape(role,path); auto parts=aparts(path); std::string prefix;
  for(size_t i=0;i<parts.size();++i) { if(i)prefix+='/';prefix+=parts[i];const auto a=ashape(role,prefix),folded=ashape(role,name_key(prefix));
    if((name_key(prefix)!=prefix && folded.category!="ordinary_side") || (i+1<parts.size() && a.category!="ordinary_side" && !a.directory))s.qualified=false; }
  if(s.category!="ordinary_side" && dir!=s.directory)s.qualified=false; return s;
}
RJson aproof(const AEntry& e) {
  const auto& s=e.st; RJson p{{"device",std::to_string(s.st_dev)},{"inode",std::to_string(s.st_ino)},{"uid",std::to_string(s.st_uid)},
    {"gid",std::to_string(s.st_gid)},{"mode",std::to_string(s.st_mode)},{"flags",std::to_string(s.st_flags)},{"size",std::to_string(s.st_size)},
    {"nlink",std::to_string(s.st_nlink)},{"birthtime_ns",nanoseconds(s.st_birthtimespec)},{"mtime_ns",nanoseconds(s.st_mtimespec)},
    {"ctime_ns",nanoseconds(s.st_ctimespec)},{"acl",e.acl},{"acl_hash",e.acl_hash.empty()?RJson{}:RJson(e.acl_hash)},
    {"allocated_bytes",std::to_string(recovery_allocated(s))}}; return p;
}
RJson aentry(const AEntry& e) { return {{"root_role",e.role},{"path",e.path},{"kind",e.kind},{"proof",aproof(e)},
  {"role",e.category},{"namespace_qualified",e.qualified},{"access_qualified",e.safe},{"readable_evidence",e.readable},{"raw_byte_limit",std::to_string(e.cap)}}; }
void afootprint(AdmissionRead& c,uint64_t entries,uint64_t inventory,uint64_t metadata,uint64_t response_buffer=0) {
  require(entries<=c.limits.entries && inventory<=c.limits.inventory_bytes,"admission_inventory_limit");
  const auto frame=16384+entries*5120; const auto meta=c.registration_bytes+44+3*frame+65536+metadata;
  require(meta<=c.limits.metadata_bytes,"admission_metadata_limit");
  require(frame+c.registration_bytes+44+4*response_buffer<=c.limits.response_bytes,"admission_response_limit");
}
void aappend(AdmissionRead& c,ASnapshot& snap,AEntry e,bool metadata) {
  require(e.st.st_size>=0,"admission_size"); const auto size=static_cast<uint64_t>(e.st.st_size);
  require(size<=c.limits.inventory_bytes && snap.inventory_bytes<=c.limits.inventory_bytes-size,"admission_inventory_limit");
  if(metadata)require(size<=c.limits.metadata_bytes && snap.metadata_bytes<=c.limits.metadata_bytes-size,"admission_metadata_limit");
  afootprint(c,snap.entries.size()+1,snap.inventory_bytes+size,snap.metadata_bytes+(metadata?size:0));
  snap.inventory_bytes+=size; if(metadata)snap.metadata_bytes+=size; snap.qualified=snap.qualified&&e.qualified; snap.safe=snap.safe&&e.safe; snap.entries.push_back(std::move(e));
}
void ascan(AdmissionRead& c,ASnapshot& snap,int fd,const std::string& role,const std::string& prefix,unsigned depth=0) {
  require(depth<=16,"admission_depth_limit"); const auto before=stat_fd(fd); const auto dir_acl=aacl(c,fd,true);
  const auto list=anames(c,fd,c.limits.entries-snap.entries.size());
  for(const auto& name:list) { require(depth<16,"admission_depth_limit");c.clock(); AEntry e;e.role=role;e.path=prefix.empty()?name:prefix+"/"+name; require(e.path.size()<=512,"admission_path_limit");
    c.charge(1024);syscall_ok(fstatat(fd,name.c_str(),&e.st,AT_SYMLINK_NOFOLLOW),"admission_inventory_changed");
    require(e.st.st_dev==stat_fd(aroot(c,role)).st_dev,"admission_cross_device");
    e.kind=S_ISDIR(e.st.st_mode)?"directory":S_ISREG(e.st.st_mode)?"file":S_ISLNK(e.st.st_mode)?"symlink":"nonregular";
    const auto s=aclass(role,e.path,e.kind=="directory");e.category=s.category;e.qualified=s.qualified;e.cap=s.cap;
    if(e.kind=="directory") { auto child=directory(fd,name);binding(fd,name,child.value,true);require(equal_metadata(e.st,stat_fd(child.value)),"admission_inventory_changed");
      e.acl=private_access(child.value,true,true);e.acl_hash=aacl(c,child.value,true); aappend(c,snap,e,false);
      ascan(c,snap,child.value,role,e.path,depth+1);binding(fd,name,child.value,true);require(equal_metadata(e.st,stat_fd(child.value)) && e.st.st_blocks==stat_fd(child.value).st_blocks,"admission_inventory_changed");
    } else {
      e.safe=e.kind=="file" && e.st.st_uid==getuid() && !(e.st.st_mode&0077) && e.st.st_nlink==1;e.acl="unverified";
      if(e.safe) { auto file=leaf(fd,name);require(equal_metadata(e.st,stat_fd(file.value)),"admission_inventory_changed");
        try {e.acl_hash=aacl(c,file.value,false);e.acl=private_access(file.value,false,true);} catch(const std::runtime_error& error) {
          if(std::string(error.what())!="unsafe_acl")throw;e.safe=false;e.acl="unsafe"; }
        struct stat linked{};syscall_ok(fstatat(fd,name.c_str(),&linked,AT_SYMLINK_NOFOLLOW),"admission_inventory_changed");
        require(same_id(linked,stat_fd(file.value)) && equal_metadata(e.st,stat_fd(file.value)),"admission_inventory_changed"); }
      e.readable=e.safe && e.kind=="file" && e.qualified && !s.pending && e.cap && e.st.st_size>=0 && static_cast<uint64_t>(e.st.st_size)<=e.cap;
      if(e.cap && !s.pending && e.st.st_size>=0 && static_cast<uint64_t>(e.st.st_size)>e.cap)e.qualified=false;
      aappend(c,snap,e,s.metadata);
    }
  }
  require(equal_metadata(before,stat_fd(fd)) && before.st_blocks==stat_fd(fd).st_blocks && aacl(c,fd,true)==dir_acl,"admission_inventory_changed");
}
std::shared_ptr<ASnapshot> acollect(AdmissionRead& c) {
  aguard(c);acontrols(c,false);auto s=std::make_shared<ASnapshot>();
  for(size_t i=0;i<c.chain.size();++i) { AEntry e;e.role="fixture";e.path=i+1==c.chain.size()?"fixture-parent":"ancestor-"+std::to_string(i);e.kind="directory";e.category="directory";
    e.st=stat_fd(c.chain[i].fd.value);e.acl=private_access(c.chain[i].fd.value,true,i+1==c.chain.size());e.acl_hash=aacl(c,c.chain[i].fd.value,true,i+1==c.chain.size());aappend(c,*s,e,false); }
  for(const auto& role:{std::string("data"),std::string("witness")}) { AEntry e;e.role="fixture";e.path=role=="data"?"store":"admission-witness";e.kind="directory";e.category="directory";
    e.st=stat_fd(aroot(c,role));e.acl=private_access(aroot(c,role),true,true);e.acl_hash=aacl(c,aroot(c,role),true);aappend(c,*s,e,false); }
  for(const auto& key:{std::string("base"),std::string("admission")})aappend(c,*s,c.controls.at(key),true);
  require(anames(c,c.chain.back().fd.value,4)==std::vector<std::string>({".native-bar-admission-synthetic",".native-bar-fs-synthetic","admission-witness","store"}),"admission_fixture_namespace");
  ascan(c,*s,c.data.value,"data","");ascan(c,*s,c.witness.value,"witness","");aguard(c);return s;
}
void asame(const ASnapshot& a,const ASnapshot& b) {
  require(a.entries.size()==b.entries.size(),"admission_inventory_changed");
  for(size_t i=0;i<a.entries.size();++i) {
    auto left=aentry(a.entries[i]),right=aentry(b.entries[i]);
    if(a.entries[i].role=="fixture" && a.entries[i].path.compare(0,9,"ancestor-")==0)
      for(auto k:{"size","nlink","mtime_ns","ctime_ns","allocated_bytes"}) {left.o["proof"].o.erase(k);right.o["proof"].o.erase(k);}
    require(rsame(left,right),"admission_inventory_changed");
  }
}
RJson afacts() { return {{"scope","synthetic_fixture_only"},{"execution_available",false},{"recovery_execution_available",false},
  {"admission_verified",false},{"approval_authenticated",false},{"view_verified",false},{"fixture_signature_verified",false},
  {"checkpoint_pair_verified",false},{"logical_prefix_verified",false},{"authority_state_verified",false},{"original_intake_verified",false},
  {"committed_history_available",false},{"elapsed_clock_qualified",false},{"physical_capacity_verified",false},{"native_snapshot_verified",false},
  {"original_acknowledgement","not_proven"},{"storage_visibility_at_as_of","not_proven"}}; }
void aown(napi_env env,napi_value object,const char* name,napi_value value) {
  napi_property_descriptor field{name,nullptr,nullptr,nullptr,nullptr,value,napi_default_jsproperty,nullptr};
  napi_ok_or_throw(napi_define_properties(env,object,1,&field));
}
void astamp(napi_env env,napi_value report,AdmissionRead& c) {
  // Final counters and time include all postconstruction filesystem guards; no inherited setter runs.
  aown(env,report,"read_bytes",text(env,std::to_string(c.reads)));
  aown(env,report,"observed_at",text(env,rnow()));c.clock();
}
RJson areport(AdmissionRead& c,const ASnapshot& s,bool verified=false) {
  RJson out=afacts();out.o["schema"]="native-bar-native-admission-inventory-v6";std::vector<RJson> entries;
  for(size_t i=0;i<s.entries.size();++i) {auto e=aentry(s.entries[i]);e.o["index"]=static_cast<int>(i);entries.push_back(e);}
  out.o["entries"]=entries;out.o["joint_generation"]=rhash(RJson(entries));out.o["inventory_complete"]=true;
  out.o["namespace_qualified"]=s.qualified;out.o["access_qualified"]=s.safe;out.o["native_snapshot_verified"]=verified;
  out.o["inventory_bytes"]=std::to_string(s.inventory_bytes);out.o["metadata_bytes"]=std::to_string(s.metadata_bytes);out.o["read_bytes"]=std::to_string(c.reads);
  out.o["live_fds"]=std::to_string(fd_count.load());out.o["live_sessions"]=std::to_string(session_count.load());
  out.o["context_started_at"]=c.started_at;out.o["observed_at"]=rnow();
  const auto pending=std::count_if(s.entries.begin(),s.entries.end(),[](const AEntry& e){return e.category=="pending";});
  out.o["pending_candidates"]=std::to_string(pending);return out;
}
std::shared_ptr<ASnapshot> asnapshot(napi_env env,napi_value v,const std::shared_ptr<AdmissionRead>& c) {
  bool tagged=false;napi_ok_or_throw(napi_check_object_type_tag(env,v,&ADMISSION_SNAPSHOT_TAG,&tagged));require(tagged,"admission_snapshot_required");void* raw;napi_ok_or_throw(napi_unwrap(env,v,&raw));
  auto s=*static_cast<std::shared_ptr<ASnapshot>*>(raw);require(!s->closed && s->owner.lock()==c && c->snapshot==s,"admission_snapshot_owner");return s;
}
std::pair<std::string,AEntry> aselected(AdmissionRead& c,const ASnapshot& snap,size_t index) {
  const auto& e=snap.entries.at(index);require(e.readable && (e.role=="data"||e.role=="witness"),"admission_not_readable");
  aguard(c);acontrols(c,false); auto parts=aparts(e.path);int parent=aroot(c,e.role);std::vector<Fd> chain;std::string prefix;
  for(size_t i=0;i+1<parts.size();++i) {if(i)prefix+='/';prefix+=parts[i];auto dir=directory(parent,parts[i]);binding(parent,parts[i],dir.value,true);
    const auto expected=std::find_if(snap.entries.begin(),snap.entries.end(),[&](const auto& item){return item.role==e.role && item.path==prefix;});
    require(expected!=snap.entries.end() && equal_metadata(expected->st,stat_fd(dir.value)) && expected->st.st_blocks==stat_fd(dir.value).st_blocks
      && expected->acl_hash==aacl(c,dir.value,true),"admission_parent_changed");chain.push_back(std::move(dir));parent=chain.back().value; }
  auto result=aread(c,parent,parts.back(),e.role,e.path,e.cap,&e);parent=aroot(c,e.role);
  prefix.clear();
  for(size_t i=0;i<chain.size();++i) {if(i)prefix+='/';prefix+=parts[i];binding(parent,parts[i],chain[i].value,true);
    const auto expected=std::find_if(snap.entries.begin(),snap.entries.end(),[&](const auto& item){return item.role==e.role && item.path==prefix;});
    require(expected!=snap.entries.end() && equal_metadata(expected->st,stat_fd(chain[i].value)) && expected->st.st_blocks==stat_fd(chain[i].value).st_blocks
      && expected->acl_hash==aacl(c,chain[i].value,true),"admission_parent_changed");parent=chain[i].value;}
  aguard(c);return result;
}

napi_value begin_admission_read(napi_env env,napi_callback_info info) {
  return boundary(env,[&] {
    const auto steady=Steady::now();const auto wall=Wall::now();const auto started_at=rnow();size_t argc=1;napi_value args[1];
    napi_ok_or_throw(napi_get_cb_info(env,info,&argc,args,nullptr,nullptr));require(argc==1,"argument_count");
    const auto wire=aparse(env,args[0]);akeys(wire,{"registration","limits","ttl_ms"});aregistration_schema(wire.at("registration"));
    const auto ttl=wire.at("ttl_ms").integer();require(ttl>=1 && ttl<=600000,"admission_deadline");
    auto c=std::make_shared<AdmissionRead>();c->registration=wire.at("registration");c->registration_bytes=rcanonical(c->registration).size();c->started_at=started_at;
    c->deadline=steady+std::chrono::milliseconds(ttl);c->wall_deadline=wall+std::chrono::milliseconds(ttl);c->last_wall=wall;
    const auto& l=wire.at("limits");akeys(l,{"entries","inventory_bytes","metadata_bytes","read_bytes","response_bytes"});c->limits.entries=512;
    for(auto field:{std::pair<const char*,uint64_t*>{"entries",&c->limits.entries},{"inventory_bytes",&c->limits.inventory_bytes},
        {"metadata_bytes",&c->limits.metadata_bytes},{"read_bytes",&c->limits.read_bytes},{"response_bytes",&c->limits.response_bytes}}) {
      const auto& value=l.at(field.first);require(value.kind==RJson::Number && value.n>=1 && static_cast<uint64_t>(value.n)<=*field.second,"admission_limits");*field.second=value.n;
    }
    c->clock();require(fd_count.load()+48<=512,"admission_fd_headroom");
    if(session_count.fetch_add(2)+2>8) {session_count-=2;throw std::runtime_error("admission_root_lease_limit");}c->reserved=true;
    const auto& markers=c->registration.at("bindings").at("markers");uint64_t common=ADMISSION_POLICY.size();
    for(auto name:{"base","admission"}) {const auto text=markers.at(name).at("size").str();require(text.size()<=4,"admission_marker_limit");const auto size=std::stoull(text);require(size<=4096,"admission_marker_limit");common+=size;}
    afootprint(*c,c->registration.at("bindings").at("ancestors").a.size()+6,common,common);
    c->clock();return wrap(env,c,ADMISSION_CONTEXT_TAG);
  });
}
napi_value open_admission_pair(napi_env env,napi_callback_info info) {
  return boundary(env,[&] {
    size_t argc=1;napi_value args[1];napi_ok_or_throw(napi_get_cb_info(env,info,&argc,args,nullptr,nullptr));require(argc==1,"argument_count");
    auto c=acontext(env,args[0],ADMISSION_CONTEXT_TAG);ABusy busy(*c);AFailure fail{*c,std::uncaught_exceptions(),env};c->clock();require(c->state=="started","admission_pair_already_opened");
    const auto anchor=c->registration.at("temp_anchor").str();require(anchor=="/private/tmp" || anchor==atemp(),"admission_temp_anchor_refused");
    c->chain.push_back({Fd(open("/",O_RDONLY|O_DIRECTORY|O_CLOEXEC)),"",false});
    aexpected(c->registration.at("bindings").at("ancestors").a[0].at("proof"),abinding(*c,c->chain.back().fd.value,true,false));
    auto parts=aparts(anchor.substr(1));parts.push_back(c->registration.at("fixture_name").str());
    for(size_t i=0;i<parts.size();++i) {c->clock();const bool strict=i+1==parts.size();
      Fd fd(openat(c->chain.back().fd.value,parts[i].c_str(),O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC));
      struct stat linked{};syscall_ok(fstatat(c->chain.back().fd.value,parts[i].c_str(),&linked,AT_SYMLINK_NOFOLLOW),"admission_anchor_changed");
      require(S_ISDIR(linked.st_mode) && same_id(linked,stat_fd(fd.value)),"admission_anchor_changed");
      const auto& expected=strict?c->registration.at("bindings").at("fixture_parent"):c->registration.at("bindings").at("ancestors").a[i+1].at("proof");
      aexpected(expected,abinding(*c,fd.value,true,strict));c->chain.push_back({std::move(fd),parts[i],strict});
    }
    c->parent_stat=stat_fd(c->chain.back().fd.value);
    c->data=directory(c->chain.back().fd.value,"store");c->witness=directory(c->chain.back().fd.value,"admission-witness");
    c->data_stat=stat_fd(c->data.value);c->witness_stat=stat_fd(c->witness.value);
    require(!same_id(c->data_stat,c->witness_stat) && c->data_stat.st_dev==c->parent_stat.st_dev && c->witness_stat.st_dev==c->parent_stat.st_dev,"admission_root_alias");
    for(auto role:{std::string("data"),std::string("witness")}) {aexpected(c->registration.at("bindings").at(role),abinding(*c,aroot(*c,role),true));
      const auto facts=read_volume(aroot(*c,role));const auto& v=c->registration.at("volume");
      require(facts.case_sensitive==v.at("case_sensitive").b && facts.read_only==v.at("read_only_mount").b,"admission_volume_binding");}
    acontrols(*c,true);aguard(*c);c->state="pair_open";return wrap(env,c,ADMISSION_PAIR_TAG);
  });
}
napi_value admission_inventory(napi_env env,napi_callback_info info) {
  return boundary(env,[&] {
    size_t argc=2;napi_value args[2];napi_ok_or_throw(napi_get_cb_info(env,info,&argc,args,nullptr,nullptr));require(argc==2,"argument_count");
    auto c=acontext(env,args[0],ADMISSION_PAIR_TAG);ABusy busy(*c);AFailure fail{*c,std::uncaught_exceptions(),env};c->clock();require(c->state=="pair_open","admission_inventory_once");
    auto snap=acollect(*c);read_hook(env,args[1],"admission_inventory_between_passes");asame(*snap,*acollect(*c));
    snap->owner=c;c->snapshot=snap;c->state="snapshot_ready";auto out=object(env);
    auto report=rvalue(env,areport(*c,*snap));aown(env,out,"snapshot",wrap(env,snap,ADMISSION_SNAPSHOT_TAG));aown(env,out,"report",report);aguard(*c);astamp(env,report,*c);return out;
  });
}
napi_value admission_read_evidence(napi_env env,napi_callback_info info) {
  return boundary(env,[&] {
    size_t argc=5;napi_value args[5];napi_ok_or_throw(napi_get_cb_info(env,info,&argc,args,nullptr,nullptr));require(argc==5,"argument_count");
    auto c=acontext(env,args[0],ADMISSION_PAIR_TAG);ABusy busy(*c);AFailure fail{*c,std::uncaught_exceptions(),env};c->clock();
    require(c->state=="snapshot_ready","admission_read_window_closed");auto snap=asnapshot(env,args[1],c);const auto role=string_arg(env,args[2]);
    double index;napi_ok_or_throw(napi_get_value_double(env,args[3],&index));require(index>=0 && index<snap->entries.size() && index==static_cast<size_t>(index),"admission_index");
    const auto i=static_cast<size_t>(index);require((role=="data"||role=="witness") && snap->entries[i].role==role,"admission_root_role");
    afootprint(*c,snap->entries.size(),snap->inventory_bytes,snap->metadata_bytes,snap->entries[i].cap);
    auto result=aselected(*c,*snap,i);const auto hash=qhash(result.first.data(),result.first.size());
    read_hook(env,args[4],"admission_read_after_bytes",snap->entries[i].path);const auto again=aselected(*c,*snap,i);
    require(qhash(again.first.data(),again.first.size())==hash,"admission_read_changed");
    const auto previous=snap->read_set.find(i);require(previous==snap->read_set.end() || previous->second==hash,"admission_read_changed");snap->read_set[i]=hash;
    auto proof=afacts();proof.o["schema"]="native-bar-native-admission-bytes-v6";proof.o["native_bytes_verified"]=true;proof.o["sha256"]=hash;proof.o["entry"]=aentry(snap->entries[i]);
    proof.o["context_started_at"]=c->started_at;proof.o["observed_at"]=rnow();
    auto out=object(env);napi_value buffer;napi_ok_or_throw(napi_create_buffer_copy(env,result.first.size(),result.first.data(),nullptr,&buffer));
    auto facts=rvalue(env,proof);aown(env,out,"bytes",buffer);aown(env,out,"facts",facts);
    const auto final_bytes=aselected(*c,*snap,i).first;require(qhash(final_bytes.data(),final_bytes.size())==hash,"admission_read_changed");aguard(*c);astamp(env,facts,*c);return out;
  });
}
napi_value admission_verify(napi_env env,napi_callback_info info) {
  return boundary(env,[&] {
    size_t argc=3;napi_value args[3];napi_ok_or_throw(napi_get_cb_info(env,info,&argc,args,nullptr,nullptr));require(argc==3,"argument_count");
    auto c=acontext(env,args[0],ADMISSION_PAIR_TAG);ABusy busy(*c);AFailure fail{*c,std::uncaught_exceptions(),env};c->clock();
    require(c->state=="snapshot_ready"||c->state=="native_checked","admission_verify_state");auto snap=asnapshot(env,args[1],c);
    read_hook(env,args[2],"admission_verify_before_scan");asame(*snap,*acollect(*c));
    for(const auto& [index,hash]:snap->read_set) {const auto bytes=aselected(*c,*snap,index).first;require(qhash(bytes.data(),bytes.size())==hash,"admission_read_changed");}
    asame(*snap,*acollect(*c));require(snap->qualified && snap->safe,"admission_inventory_unqualified");acontrols(*c,false);aguard(*c);
    c->state="native_checked";auto report=areport(*c,*snap,true);report.o["schema"]="native-bar-native-admission-verification-v6";
    auto out=rvalue(env,report);aguard(*c);astamp(env,out,*c);return out;
  });
}
napi_value close_admission_inventory(napi_env env,napi_callback_info info) {
  return boundary(env,[&] {size_t argc=2;napi_value args[2];napi_ok_or_throw(napi_get_cb_info(env,info,&argc,args,nullptr,nullptr));require(argc==2,"argument_count");
    auto c=acontext(env,args[0],ADMISSION_PAIR_TAG);if(c->busy)c->poisoned=true;require(!c->busy,"admission_busy");
    bool tagged=false;napi_ok_or_throw(napi_check_object_type_tag(env,args[1],&ADMISSION_SNAPSHOT_TAG,&tagged));require(tagged,"admission_snapshot_required");
    void* raw;napi_ok_or_throw(napi_unwrap(env,args[1],&raw));auto s=*static_cast<std::shared_ptr<ASnapshot>*>(raw);
    require(s->owner.lock()==c,"admission_snapshot_owner");if(c->closed||s->closed)return undefined(env);
    require(c->snapshot==s,"admission_snapshot_owner");s->release();c->state="snapshot_closed";return undefined(env);});
}
napi_value close_admission_context(napi_env env,napi_callback_info info) {
  return boundary(env,[&] {size_t argc=1;napi_value args[1];napi_ok_or_throw(napi_get_cb_info(env,info,&argc,args,nullptr,nullptr));require(argc==1,"argument_count");
    auto c=acontext(env,args[0],ADMISSION_CONTEXT_TAG);if(c->busy)c->poisoned=true;require(!c->busy,"admission_busy");c->release();return undefined(env);});
}
