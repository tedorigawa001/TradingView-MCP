// Test setup only: create one empty preallocated reserve in an already marked invented fixture.
// Never linked into the addon or called by runtime modules.
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <limits.h>
#include <cstdlib>
#include <cstring>
#include <regex>
#include <string>
int main(int argc, char** argv) {
  if (argc != 4) return 2;
  char temp[PATH_MAX], root[PATH_MAX];
  if (!realpath(std::getenv("TMPDIR") ? std::getenv("TMPDIR") : "/tmp", temp) || !realpath(argv[1], root) || std::string(root) != argv[1]) return 3;
  const std::string prefix = std::string(temp) + "/native-bar-fs-synthetic-", path(root), name(argv[2]);
  if (path.compare(0, prefix.size(), prefix) || path.size() != prefix.size() + 12 || path.substr(path.size() - 6) != "/store"
    || path.substr(prefix.size(), 6).find_first_not_of("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789") != std::string::npos
    || !std::regex_match(name, std::regex("\\.quarantine-reserve-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.tmp"))) return 4;
  char* end = nullptr; const auto amount = std::strtoll(argv[3], &end, 10);
  if (!end || *end || (amount != 9175040 && amount != 12845056)) return 5;
  int parent = open((path + "/..").c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  int marker = openat(parent, ".native-bar-fs-synthetic", O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  char bytes[32]{}; struct stat m{};
  if (marker < 0 || fstat(marker, &m) || m.st_uid != getuid() || m.st_mode != (S_IFREG | 0600) || m.st_nlink != 1
    || read(marker, bytes, sizeof(bytes)) != 21 || std::string(bytes, 21) != "synthetic-fixture-v1\n") return 6;
  int directory = open(root, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC); struct stat d{};
  if (directory < 0 || fstat(directory, &d) || d.st_uid != getuid() || d.st_mode != (S_IFDIR | 0700)) return 7;
  int fd = openat(directory, name.c_str(), O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
  if (fd < 0) return 8;
  fstore_t store{}; store.fst_flags = F_ALLOCATEALL; store.fst_posmode = F_PEOFPOSMODE; store.fst_length = amount;
  if (fcntl(fd, F_PREALLOCATE, &store) < 0 || fsync(fd)) return 9;
  struct stat result{};
  if (fstat(fd, &result) || result.st_size != 0 || result.st_blocks * 512 < amount) return 10;
  close(fd); close(directory); close(marker); close(parent); return 0;
}
