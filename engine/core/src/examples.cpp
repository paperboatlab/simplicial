// Paperboat's examples are read-only (examples.hpp).

#include "paperboat/core/examples.hpp"

#include <cstdint>
#include <cstdlib>
#include <string>
#include <system_error>

#include "paperboat/core/workspace.hpp"

namespace paperboat::core::examples {

namespace fs = std::filesystem;

namespace {

fs::path canonical(const fs::path& p) {
  std::error_code ec;
  const fs::path a = fs::absolute(p, ec);
  if (ec) return p.lexically_normal();
  const fs::path c = fs::weakly_canonical(a, ec);
  return ec ? a.lexically_normal() : c;
}

bool under(const fs::path& p, const fs::path& root) {
  const auto in = p.lexically_relative(root);
  return !in.empty() && *in.begin() != "..";
}

// A paperboat-examples checkout: golden.py at its top and an example (<group>/<example>/example.toml) in it.
bool checkout(const fs::path& dir) {
  std::error_code ec;
  if (!fs::is_regular_file(dir / "golden.py", ec)) return false;
  for (const auto& group : fs::directory_iterator(dir, ec)) {
    std::error_code ge;
    if (!group.is_directory(ge) || group.path().filename().string().starts_with(".")) continue;
    for (const auto& ex : fs::directory_iterator(group.path(), ge)) {
      std::error_code ee;
      if (fs::is_regular_file(ex.path() / "example.toml", ee)) return true;
    }
  }
  return false;
}

// FNV-1a: the same folder gets the same scratch on every run and build.
std::string hash(const std::string& s) {
  std::uint64_t h = 1469598103934665603ull;
  for (const unsigned char c : s) h = (h ^ c) * 1099511628211ull;
  static constexpr char kHex[] = "0123456789abcdef";
  std::string out(16, '0');
  for (int i = 15; i >= 0; --i, h >>= 4) out[static_cast<std::size_t>(i)] = kHex[h & 15];
  return out;
}

}  // namespace

std::vector<fs::path> roots() {
  std::vector<fs::path> out;
  std::error_code ec;
  if (const char* v = std::getenv("PAPERBOAT_EXAMPLES_DIR"); v && *v && fs::is_directory(v, ec)) out.push_back(canonical(v));
  if (const fs::path cache = workspace::home() / "cache" / "examples"; fs::is_directory(cache, ec)) out.push_back(canonical(cache));
  return out;
}

bool inside(const fs::path& path) {
  if (path.empty()) return false;
  const fs::path p = canonical(path);
  for (const auto& r : roots()) {
    if (p == r || under(p, r)) return true;
  }
  for (fs::path d = p;; d = d.parent_path()) {
    if (checkout(d)) return true;
    if (d == d.parent_path() || d.empty()) return false;
  }
}

fs::path scratch(const fs::path& station_dir) {
  const fs::path p = canonical(station_dir);
  return workspace::home() / "cache" / "simplicial" / "examples" / (p.filename().string() + "-" + hash(p.generic_string()));
}

fs::path build_dir(const fs::path& station_dir) {
  return inside(station_dir) ? scratch(station_dir) / "build" : station_dir / "build";
}

}  // namespace paperboat::core::examples
