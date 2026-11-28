// Paperboat's examples are read-only (examples.hpp).

#include "paperboat/core/examples.hpp"

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cstdlib>
#include <mutex>
#include <string>
#include <system_error>
#include <utility>

#include <nlohmann/json.hpp>

#include "paperboat/core/process.hpp"
#include "paperboat/core/workspace.hpp"

namespace paperboat::core::examples {

namespace fs = std::filesystem;
using nlohmann::json;

namespace {

fs::path resolved(const fs::path& p) {
  std::error_code ec;
  const fs::path a = fs::absolute(p, ec);
  if (ec) return p.lexically_normal();
  const fs::path c = fs::weakly_canonical(a, ec);
  return ec ? a.lexically_normal() : c;
}

bool at_or_under(const fs::path& p, const fs::path& root) {
  if (root.empty()) return false;
  if (p == root) return true;
  const auto in = p.lexically_relative(root);
  return !in.empty() && *in.begin() != "..";
}

std::string env(const char* name) {
  const char* v = std::getenv(name);
  return v ? v : "";
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

// What `paperboat example list --json` says: every example, and the roots it gives (none before 0.2.0-beta.9).
struct Listed {
  std::vector<Example> all;
  std::vector<fs::path> roots;
};

std::mutex listed_mutex;
fs::path opened_folder;  // serve_files' folder, when PAPERBOAT_EXAMPLE is set

// ponytail: kept for 5 s (per CLI and home), as hubs::known and recent() ask for every entry
Listed listed() {
  static std::string key;
  static std::chrono::steady_clock::time_point at;
  static Listed last;
  const std::string bin = env("PAPERBOAT_BIN").empty() ? "paperboat" : env("PAPERBOAT_BIN");
  const std::string k = bin + "\n" + env("PAPERBOAT_HOME") + "\n" + env("PAPERBOAT_EXAMPLES_DIR");
  const auto now = std::chrono::steady_clock::now();
  std::lock_guard lock(listed_mutex);
  if (k == key && now - at < std::chrono::seconds(5)) return last;
  Listed out;
  const auto r = ProcessRunner::run_sync({bin, "example", "list", "--json"}, {}, {}, std::chrono::seconds(60));
  const json doc = r.ok() ? json::parse(r.stdout_text, nullptr, /*allow_exceptions=*/false) : json();
  if (doc.is_array()) {
    for (const auto& e : doc) {
      if (!e.is_object()) continue;
      const auto text = [&](const char* f) { return e.contains(f) && e[f].is_string() ? e[f].get<std::string>() : std::string(); };
      if (const std::string root = text("root"); !root.empty()) {
        const fs::path p = resolved(root);
        if (std::find(out.roots.begin(), out.roots.end(), p) == out.roots.end()) out.roots.push_back(p);
      }
      if (!text("id").empty() && !text("path").empty())
        out.all.push_back({text("id"), text("name").empty() ? text("id") : text("name"), resolved(text("path"))});
    }
  }
  key = k;
  at = now;
  last = out;
  return out;
}

}  // namespace

std::vector<fs::path> roots() {
  if (auto r = listed().roots; !r.empty()) return r;
  std::vector<fs::path> out;  // a paperboat before 0.2.0-beta.9: its rules for where examples are
  std::error_code ec;
  if (const std::string v = env("PAPERBOAT_EXAMPLES_DIR"); !v.empty() && fs::is_directory(v, ec)) out.push_back(resolved(v));
  if (const fs::path cache = workspace::home() / "cache" / "examples"; fs::is_directory(cache, ec)) out.push_back(resolved(cache));
  return out;
}

void opened_at(const fs::path& folder) {
  std::lock_guard lock(listed_mutex);
  opened_folder = folder.empty() ? fs::path() : resolved(folder);
}

std::optional<Example> opened() {
  const std::string id = env("PAPERBOAT_EXAMPLE");
  if (id.empty()) return std::nullopt;
  const Listed l = listed();
  Example out{id, id, {}};
  for (const auto& e : l.all) {
    if (e.id == id) out = e;
  }
  std::lock_guard lock(listed_mutex);
  if (!opened_folder.empty()) out.path = opened_folder;  // the server's own folder: what it was started on
  if (out.path.empty()) return std::nullopt;  // ponytail: an id the list doesn't have, in a station the server started
  return out;
}

std::optional<Example> of(const fs::path& path) {
  if (path.empty()) return std::nullopt;
  const fs::path p = resolved(path);
  if (auto o = opened(); o && at_or_under(p, o->path)) return o;
  for (const auto& e : listed().all) {
    if (at_or_under(p, e.path)) return e;
  }
  return std::nullopt;
}

bool inside(const fs::path& path) {
  if (path.empty()) return false;
  const fs::path p = resolved(path);
  if (auto o = opened(); o && at_or_under(p, o->path)) return true;
  const Listed l = listed();
  for (const auto& r : roots()) {
    if (at_or_under(p, r)) return true;
  }
  if (!l.roots.empty()) return false;  // the platform says where examples are: no guessing
  for (fs::path d = p;; d = d.parent_path()) {
    if (checkout(d)) return true;
    if (d == d.parent_path() || d.empty()) return false;
  }
}

fs::path scratch(const fs::path& station_dir) {
  const fs::path p = resolved(station_dir);
  return workspace::home() / "cache" / "simplicial" / "examples" / (p.filename().string() + "-" + hash(p.generic_string()));
}

fs::path build_dir(const fs::path& station_dir) {
  return inside(station_dir) ? scratch(station_dir) / "build" : station_dir / "build";
}

}  // namespace paperboat::core::examples
