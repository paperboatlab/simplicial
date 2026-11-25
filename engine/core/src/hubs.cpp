// The hubs for the page (hubs.hpp): what Malachite's `hub list` says, and a hub's files as the picker shows them.

#include "paperboat/core/hubs.hpp"

#include <algorithm>
#include <chrono>
#include <system_error>
#include <vector>

#include "paperboat/core/process.hpp"

namespace paperboat::core::hubs {

namespace fs = std::filesystem;
using nlohmann::json;

namespace {

bool hidden(const std::string& name) { return name.empty() || name[0] == '.' || name == "node_modules"; }

void walk(const fs::path& dir, const std::string& rel, json& out) {
  std::error_code ec;
  std::vector<std::pair<bool, std::string>> kids;  // (is a file, name): folders sort first
  for (const auto& d : fs::directory_iterator(dir, ec)) {
    const std::string name = d.path().filename().string();
    if (hidden(name)) continue;
    std::error_code te;
    if (d.is_directory(te) && !d.is_symlink(te)) kids.emplace_back(false, name);  // a linked folder could loop
    else if (d.is_regular_file(te)) kids.emplace_back(true, name);
  }
  std::sort(kids.begin(), kids.end());
  for (const auto& [file, name] : kids) {
    const std::string path = rel.empty() ? name : rel + "/" + name;
    out.push_back({{"path", path}, {"kind", file ? "file" : "folder"}});
    if (!file) walk(dir / name, path, out);
  }
}

bool ends_with(const std::string& s, const std::string& tail) {
  return s.size() >= tail.size() && s.compare(s.size() - tail.size(), tail.size(), tail) == 0;
}

}  // namespace

json known(const std::string& cli) {
  const auto r = ProcessRunner::run_sync({cli, "hub", "list", "--json"}, {}, {}, std::chrono::seconds(5));
  if (!r.ok()) return json::array();
  const json all = json::parse(r.stdout_text, nullptr, /*allow_exceptions=*/false);
  json out = json::array();
  if (!all.is_array()) return out;
  for (const auto& h : all) {
    if (h.is_object() && h.value("id", "") != "" && h.value("path", "") != "") out.push_back(h);
  }
  return out;
}

json list(const std::string& cli) {
  json out = json::array();
  for (const auto& h : known(cli)) {
    const fs::path root = h.value("path", "");
    std::error_code ec;
    const bool missing = h.value("missing", false) || !fs::is_directory(root, ec);
    json hub = {{"id", h["id"]},
                {"name", h.value("name", root.filename().string())},
                {"place", h.value("place", "local")},
                {"path", h.value("shown", root.string())},
                {"psf", 0},
                {"pst", 0}};
    if (missing) {
      hub["missing"] = true;
    } else {
      // ponytail: walks the whole hub on every list; keep a count per hub if hubs get big
      int psf = 0, pst = 0;
      for (const auto& e : files(root)) {
        const std::string p = e["path"];
        if (ends_with(p, ".psf")) ++psf;
        if (ends_with(p, ".pst")) ++pst;
      }
      hub["psf"] = psf;
      hub["pst"] = pst;
    }
    if (h.contains("conflicts") && h["conflicts"].is_array() && !h["conflicts"].empty()) hub["conflicts"] = h["conflicts"].size();
    out.push_back(hub);
  }
  return out;
}

json files(const fs::path& root) {
  json out = json::array();
  walk(root, "", out);
  return out;
}

std::optional<fs::path> inside(const fs::path& root, const std::string& rel) {
  if (rel.empty() || rel.front() == '/' || rel.find('\\') != std::string::npos) return std::nullopt;
  for (const auto& part : fs::path(rel)) {
    if (hidden(part.string())) return std::nullopt;  // `..`, `.malachite` and the like
  }
  std::error_code ec;
  const fs::path base = fs::weakly_canonical(root, ec);
  if (ec) return std::nullopt;
  const fs::path file = fs::weakly_canonical(base / rel, ec);  // a link out of the hub resolves outside it
  const auto in = file.lexically_relative(base);
  if (ec || in.empty() || *in.begin() == ".." || in == ".") return std::nullopt;
  return file;
}

}  // namespace paperboat::core::hubs
