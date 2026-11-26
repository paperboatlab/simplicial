// The workspace and the shared store (workspace.hpp).

#include "paperboat/core/workspace.hpp"

#include <chrono>
#include <cstdlib>
#include <fstream>
#include <system_error>

#ifdef _WIN32
#include <process.h>
#define getpid _getpid
#else
#include <unistd.h>
#endif

namespace paperboat::core::workspace {

namespace fs = std::filesystem;
using nlohmann::json;

namespace {

std::string env(const char* key) {
  const char* v = std::getenv(key);
  return v ? v : "";
}

std::string user_home() {
#ifdef _WIN32
  if (const auto v = env("USERPROFILE"); !v.empty()) return v;
#endif
  return env("HOME");
}

}  // namespace

fs::path home() {
  if (const auto v = env("PAPERBOAT_HOME"); !v.empty()) return v;
#ifdef _WIN32
  if (const auto v = env("LOCALAPPDATA"); !v.empty()) return fs::path(v) / "paperboat";
#endif
  if (const auto v = env("XDG_DATA_HOME"); !v.empty()) return fs::path(v) / "paperboat";
  return fs::path(user_home()) / ".local" / "share" / "paperboat";
}

json read(const fs::path& file) {
  std::ifstream in(file, std::ios::binary);
  if (!in) return nullptr;
  return json::parse(in, nullptr, /*allow_exceptions=*/false);
}

bool write(const fs::path& file, const json& doc) {
  std::error_code ec;
  fs::create_directories(file.parent_path(), ec);
  const fs::path tmp = file.string() + "." + std::to_string(getpid()) + ".tmp";  // one per process: apps write at once
  {
    std::ofstream out(tmp, std::ios::binary | std::ios::trunc);
    out << doc.dump(2) << "\n";
    if (!out) return fs::remove(tmp, ec), false;
  }
  fs::rename(tmp, file, ec);
  if (ec) fs::remove(tmp, ec);
  return !ec;
}

json recent() {
  const json doc = read(home() / "recent.json");
  json out = {{"version", 1}, {"recent", json::array()}};
  if (!doc.is_object() || !doc.value("recent", json()).is_array()) return out;
  for (const auto& e : doc["recent"]) {
    if (!e.is_object() || !e.value("path", json()).is_string() || !e.value("at", json()).is_number()) continue;
    if (const auto k = e.value("kind", ""); k != "folder" && k != "hub" && k != "file") continue;
    if (out["recent"].size() < kRecentMax) out["recent"].push_back(e);
  }
  return out;
}

void remember(const std::string& kind, const fs::path& path, const std::string& hub) {
  // ponytail: read, change, write; two apps opening at the same instant may lose one entry
  const auto at = std::chrono::duration_cast<std::chrono::seconds>(std::chrono::system_clock::now().time_since_epoch()).count();
  json entry = {{"kind", kind}, {"path", path.generic_string()}, {"app", "simplicial"}, {"at", at}};
  if (!hub.empty()) entry["hub"] = hub;
  json list = json::array({entry});
  const json before = recent();  // kept: a loop over a temporary's member would dangle
  for (const auto& e : before["recent"]) {
    if ((e["kind"] != entry["kind"] || e["path"] != entry["path"]) && list.size() < kRecentMax) list.push_back(e);
  }
  write(home() / "recent.json", {{"version", 1}, {"recent", list}});
}

void forget() { write(home() / "recent.json", {{"version", 1}, {"recent", json::array()}}); }

json settings() {
  const json doc = read(home() / "settings.json");
  const std::string t = doc.is_object() ? doc.value("theme", "") : "";
  return {{"version", 1}, {"theme", t == "light" || t == "dark" ? t : "system"}};
}

bool set_theme(const std::string& theme) {
  if (theme != "light" && theme != "dark" && theme != "system") return false;
  json doc = read(home() / "settings.json");
  if (!doc.is_object()) doc = json::object();
  doc["version"] = 1;
  doc["theme"] = theme;
  return write(home() / "settings.json", doc);
}

json place_of(const fs::path& dir, const json& hubs) {
  std::error_code ec;
  const fs::path at = fs::weakly_canonical(dir, ec);
  for (const auto& h : hubs) {
    const fs::path root = fs::weakly_canonical(fs::path(h.value("path", "")), ec);
    if (root.empty()) continue;
    const auto in = at.lexically_relative(root);
    if (!in.empty() && *in.begin() != "..")
      return {{"kind", "hub"}, {"root", root.string()}, {"name", h.value("name", root.filename().string())}, {"hub", h["id"]}};
  }
  return {{"kind", "folder"}, {"root", at.string()}, {"name", at.filename().string()}};
}

fs::path typed(const std::string& path) {
  fs::path p = path;
  if (path == "~") p = user_home();
  else if (path.starts_with("~/")) p = fs::path(user_home()) / path.substr(2);
  return p.is_absolute() ? p.lexically_normal() : fs::path{};
}

}  // namespace paperboat::core::workspace
