// Test-only: change one byte of a synthetic fixture file through a held shared mapping. The page changes without
// updating mtime/ctime while the mapping is held, so only a content rehash can notice it.
#include <sys/mman.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <iostream>
#include <regex>
#include <string>

int main(int argc, char** argv) {
  if (argc != 2) return 2;
  const std::string path = argv[1];
  if (!std::regex_match(path, std::regex("/private/(?:tmp|var/folders/[A-Za-z0-9_/-]+/T)/native-bar-fs-synthetic-[A-Za-z0-9]{6}/(?:store|admission-witness)/[A-Za-z0-9._/-]+")))
    return 3;
  const int fd = open(path.c_str(), O_RDWR | O_NOFOLLOW | O_CLOEXEC);
  struct stat st{};
  if (fd < 0 || fstat(fd, &st) != 0 || !S_ISREG(st.st_mode) || st.st_size < 1) return 4;
  auto* bytes = static_cast<unsigned char*>(mmap(nullptr, static_cast<size_t>(st.st_size), PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0));
  if (bytes == MAP_FAILED) return 5;
  bytes[0] ^= 1;
  std::cout << "ready" << std::endl;
  std::string line; std::getline(std::cin, line);  // Hold the mapping until the test closes stdin.
  munmap(bytes, static_cast<size_t>(st.st_size)); close(fd); return 0;
}
