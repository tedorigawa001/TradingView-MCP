// Test-only independent observer: path getattrlist/ACL APIs, never the reader's FD observer.
#include <sys/attr.h>
#include <sys/acl.h>
#include <sys/mount.h>
#include <sys/vnode.h>
#include <sys/stat.h>
#include <unistd.h>
#include <CommonCrypto/CommonDigest.h>
#include <cstring>
#include <fstream>
#include <iostream>
#include <regex>
#include <stdexcept>
#include <string>
#include <vector>

template<class T> T attribute(const std::string& path,attrgroup_t common,attrgroup_t file=0,attrgroup_t volume=0) {
  attrlist attrs{};attrs.bitmapcount=ATTR_BIT_MAP_COUNT;attrs.commonattr=common;attrs.fileattr=file;attrs.volattr=volume;
  unsigned char bytes[sizeof(T)+16]{};
  if(getattrlist(path.c_str(),&attrs,bytes,sizeof(bytes),FSOPT_NOFOLLOW)!=0)throw std::runtime_error("expectation_attribute");
  uint32_t size;std::memcpy(&size,bytes,4);if(size!=sizeof(T)+4)throw std::runtime_error("expectation_attribute_size");
  T result;std::memcpy(&result,bytes+4,sizeof(T));return result;
}
std::string quote(const std::string& s) {
  std::string out="\"";for(unsigned char c:s) {if(c=='"'||c=='\\')out+='\\';if(c<32)throw std::runtime_error("expectation_path");out+=c;}return out+'"';
}
std::string hash(const std::string& s) {
  unsigned char digest[CC_SHA256_DIGEST_LENGTH];CC_SHA256(s.data(),static_cast<CC_LONG>(s.size()),digest);std::string out;
  const char* hex="0123456789abcdef";for(auto c:digest){out+=hex[c>>4];out+=hex[c&15];}return out;
}
std::string aclproof(const std::string& path) {
  auto acl=acl_get_link_np(path.c_str(),ACL_TYPE_EXTENDED);std::string bytes="none",kind="none";
  if(!acl) {if(errno!=ENOENT)throw std::runtime_error("expectation_acl");}
  else {
    struct Guard {acl_t p;~Guard(){acl_free(p);}} guard{acl};
    if(acl_valid(acl))throw std::runtime_error("expectation_acl_invalid");
    for(int i=0;i<256;++i) {acl_entry_t entry;if(acl_get_entry(acl,i,&entry)<0) {if(errno!=EINVAL)throw std::runtime_error("expectation_acl_entry");break;}
      acl_tag_t tag;if(acl_get_tag_type(entry,&tag)||tag!=ACL_EXTENDED_DENY)throw std::runtime_error("expectation_acl_grant");kind="deny_only";
      if(i==255)throw std::runtime_error("expectation_acl_limit");}
    ssize_t n=0;char* text=acl_to_text(acl,&n);if(!text||n<0||n>65536) {if(text)acl_free(text);throw std::runtime_error("expectation_acl_text");}
    bytes.assign(text,n);acl_free(text);
  }
  return "\"acl\":"+quote(kind)+",\"acl_hash\":"+quote(hash(bytes));
}
std::string proof(const std::string& path,bool file=false) {
  const auto birth=attribute<timespec>(path,ATTR_CMN_CRTIME);
  const auto type=attribute<fsobj_type_t>(path,ATTR_CMN_OBJTYPE);
  const auto mode=attribute<uint32_t>(path,ATTR_CMN_ACCESSMASK)|(type==VDIR?S_IFDIR:type==VREG?S_IFREG:0);
  if(type!=VDIR && type!=VREG)throw std::runtime_error("expectation_type");
  std::string out="{\"device\":"+quote(std::to_string(attribute<dev_t>(path,ATTR_CMN_DEVID)))
    +",\"inode\":"+quote(std::to_string(attribute<uint64_t>(path,ATTR_CMN_FILEID)))
    +",\"uid\":"+quote(std::to_string(attribute<uid_t>(path,ATTR_CMN_OWNERID)))
    +",\"gid\":"+quote(std::to_string(attribute<gid_t>(path,ATTR_CMN_GRPID)))+",\"mode\":"+quote(std::to_string(mode))
    +",\"flags\":"+quote(std::to_string(attribute<uint32_t>(path,ATTR_CMN_FLAGS)))
    +",\"birthtime_ns\":"+quote(std::to_string(static_cast<uint64_t>(birth.tv_sec)*1000000000ULL+birth.tv_nsec))+","+aclproof(path);
  if(file) {std::ifstream stream(path,std::ios::binary);if(!stream)throw std::runtime_error("expectation_marker");
    std::string bytes;char buffer[4097];stream.read(buffer,sizeof(buffer));bytes.assign(buffer,stream.gcount());if(bytes.size()>4096)throw std::runtime_error("expectation_marker_limit");
    out+=",\"nlink\":"+quote(std::to_string(attribute<uint32_t>(path,0,ATTR_FILE_LINKCOUNT)))
      +",\"size\":"+quote(std::to_string(attribute<off_t>(path,0,ATTR_FILE_DATALENGTH)))+",\"sha256\":"+quote(hash(bytes));}
  return out+"}";
}
int main(int argc,char** argv) {
  try {
    if(argc!=2)throw std::runtime_error("expectation_arguments");const std::string base=argv[1];
    if(!std::regex_match(base,std::regex("/private/(?:tmp|var/folders/[A-Za-z0-9_/-]+/T)/native-bar-fs-synthetic-[A-Za-z0-9]{6}")))throw std::runtime_error("expectation_fixture_only");
    const auto temp=base.substr(0,base.rfind('/'));std::vector<std::string> ancestors{"/"};
    for(size_t i=1;i<=temp.size();++i)if(i==temp.size()||temp[i]=='/')ancestors.push_back(temp.substr(0,i));
    std::string out="{\"bindings\":{\"ancestors\":[";
    for(size_t i=0;i<ancestors.size();++i) {if(i)out+=',';out+="{\"path\":"+quote(ancestors[i])+",\"proof\":"+proof(ancestors[i])+"}";}
    out+="],\"fixture_parent\":"+proof(base)+",\"data\":"+proof(base+"/store")+",\"witness\":"+proof(base+"/admission-witness")
      +",\"markers\":{\"base\":"+proof(base+"/.native-bar-fs-synthetic",true)+",\"admission\":"+proof(base+"/.native-bar-admission-synthetic",true)+"}}";
    const auto caps=attribute<vol_capabilities_attr_t>(base,0,0,ATTR_VOL_INFO|ATTR_VOL_CAPABILITIES);struct statfs fs{};
    if(statfs(base.c_str(),&fs)||std::string(fs.f_fstypename)!="apfs"||!(fs.f_flags&MNT_LOCAL)||(fs.f_flags&MNT_IGNORE_OWNERSHIP))throw std::runtime_error("expectation_local_apfs");
    const auto format=VOL_CAP_FMT_CASE_SENSITIVE|VOL_CAP_FMT_CASE_PRESERVING;
    if((caps.valid[VOL_CAPABILITIES_FORMAT]&format)!=format || !(caps.capabilities[VOL_CAPABILITIES_FORMAT]&VOL_CAP_FMT_CASE_PRESERVING)
      || !(caps.valid[VOL_CAPABILITIES_INTERFACES]&VOL_CAP_INT_EXTENDED_SECURITY)||!(caps.capabilities[VOL_CAPABILITIES_INTERFACES]&VOL_CAP_INT_EXTENDED_SECURITY))throw std::runtime_error("expectation_volume_capabilities");
    out+=",\"volume\":{\"filesystem\":\"apfs\",\"local\":true,\"ownership_enforced\":true,\"case_preserving\":true,\"case_sensitive\":";
    out+=(caps.capabilities[VOL_CAPABILITIES_FORMAT]&VOL_CAP_FMT_CASE_SENSITIVE)?"true":"false";out+=",\"read_only_mount\":";
    out+=(fs.f_flags&MNT_RDONLY)?"true":"false";std::cout<<out+"}}\n";return 0;
  }catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}
}
