// The hubs for the page (hubs.hpp): what Malachite's `hub list` says, and a hub's files as the picker shows them.

#include "paperboat/core/hubs.hpp"

#include <algorithm>
#include <cctype>
#include <chrono>
#include <fstream>
#include <map>
#include <sstream>
#include <system_error>
#include <vector>

#include "paperboat/core/process.hpp"
#include "paperboat/core/station_manager.hpp"
#include "paperboat/toolkit/installer.hpp"

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

// A .psf's header: its station's name, version, sha256 and path (format 1), or only its name (format 0: "station":
// "cart-pole"); nothing when it isn't a flow file.
std::optional<json> header(const fs::path& psf) {
  std::ifstream in(psf, std::ios::binary);
  const json doc = json::parse(in, nullptr, /*allow_exceptions=*/false);
  if (!doc.is_object() || !doc.contains("station")) return std::nullopt;
  const json& st = doc["station"];
  if (st.is_string()) return json{{"name", st}};
  if (!st.is_object() || !st.value("name", json()).is_string()) return std::nullopt;
  json out = {{"name", st["name"]}};
  for (const char* k : {"version", "sha256", "path"}) {
    if (st.contains(k) && st[k].is_string()) out[k] = st[k];
  }
  return out;
}

// The one named `name` among `list`: the exact `version` first, then the newest; null when none is.
const StationInfo* pick(const std::vector<StationInfo>& list, const std::string& name, const std::string& version) {
  const StationInfo* best = nullptr;
  for (const auto& s : list) {
    if (s.name != name) continue;
    if (!version.empty() && s.version == version) return &s;
    if (!best || newer(s.version, best->version)) best = &s;
  }
  return best;
}

// A hub's stations: its .pst files and its station folders (a folder with a station.toml), hub-relative.
std::vector<StationInfo> hub_stations(const fs::path& root, const json& tree) {
  std::vector<fs::path> at;
  for (const auto& e : tree) {
    const std::string p = e["path"];
    if (ends_with(p, ".pst")) at.push_back(root / p);
    else if (p == "station.toml" || ends_with(p, "/station.toml")) at.push_back((root / p).parent_path());
  }
  auto out = stations(at);
  for (auto& s : out) s.at = s.at.lexically_relative(root);
  return out;
}

// `rel` (a flow's station.path) from the flow at `psf`, as a hub path; "" when it leaves the hub.
std::string beside(const std::string& psf, const std::string& rel) {
  const std::string p = (fs::path(psf).parent_path() / rel).lexically_normal().generic_string();
  return p.empty() || p.starts_with("..") || p.starts_with("/") ? "" : p;
}

json found(const char* where, const StationInfo& s, const Elsewhere& outside) {
  json out = {{"where", where}, {"path", s.at.generic_string()}, {"name", s.name}, {"version", s.version}};
  if (!s.sha256.empty()) out["sha256"] = s.sha256;
  if (s.port) out["port"] = s.port;
  else if (const auto* r = pick(outside.running, s.name, s.version); r && r->version == s.version) out["port"] = r->port;
  return {{"found", out}};
}

// The resolution, given the hub's stations (find() and entries() share it).
json resolve(const fs::path& root, const std::vector<StationInfo>& in_hub, const std::string& psf,
             const std::string& name, const std::string& version, const std::string& path, const Elsewhere& outside) {
  json looked = json::array();
  if (!root.empty() && !path.empty()) {
    const std::string at = beside(psf, path);
    for (const auto& s : in_hub) {
      if (!at.empty() && s.at.generic_string() == at && s.name == name) return found("path", s, outside);
    }
    looked.push_back({{"where", "path"}, {"at", path}});
  }
  if (!root.empty()) {
    if (const auto* s = pick(in_hub, name, version)) return found("workspace", *s, outside);
    looked.push_back({{"where", "workspace"}});
  }
  if (const auto* s = pick(outside.installed, name, version)) return found("installed", *s, outside);
  looked.push_back({{"where", "installed"}});
  if (const auto* s = pick(outside.running, name, version)) return found("running", *s, outside);
  looked.push_back({{"where", "running"}});
  json missing = {{"name", name}};
  if (!version.empty()) missing["version"] = version;
  return {{"missing", missing}, {"looked", looked}};
}

}  // namespace

bool newer(const std::string& a, const std::string& b) {
  std::stringstream x(a), y(b);
  for (std::string p, q;;) {
    const bool more_a = static_cast<bool>(std::getline(x, p, '.')), more_b = static_cast<bool>(std::getline(y, q, '.'));
    if (!more_a || !more_b) return more_a && !more_b;
    const long u = std::strtol(p.c_str(), nullptr, 10), v = std::strtol(q.c_str(), nullptr, 10);
    if (u != v) return u > v;
  }
}

std::vector<StationInfo> stations(const std::vector<fs::path>& at) {
  std::vector<StationInfo> out;
  std::vector<std::string> args;
  std::error_code ec;
  for (const auto& p : at) {
    if (fs::is_directory(p, ec)) {
      const auto m = StationManager::load_manifest(p);
      if (!m.name.empty()) out.push_back({p, m.name, m.version, "", 0});
    } else if (fs::is_regular_file(p, ec)) {
      args.push_back(p.string());
    }
  }
  if (args.empty()) return out;
  // ponytail: a Python call per listing (the engine has no unzip); read the zip here if hubs get many stations
  const fs::path repo = toolkit::find_repo_root();
  const auto py = StationManager::prepare_python_env(repo);
  args.insert(args.begin(), {py.python_bin.string(), (repo / "scripts" / "package_station.py").string(), "info"});
  const auto r = ProcessRunner::run_sync(args, repo, py.env, std::chrono::seconds(20));
  const json doc = json::parse(r.stdout_text, nullptr, /*allow_exceptions=*/false);
  if (!doc.is_object() || !doc.value("stations", json()).is_array()) return out;
  for (const auto& s : doc["stations"]) {
    if (s.value("name", "").empty()) continue;
    out.push_back({fs::path(s.value("path", "")), s["name"], s.value("version", ""), s.value("sha256", ""), 0});
  }
  return out;
}

Elsewhere elsewhere() {
  Elsewhere out;
  std::vector<fs::path> dirs;
  std::error_code ec;
  // the user's stations (an example opens where it is, a copy of one lives in the user's folder: paperboat#75)
  if (const fs::path parent = StationManager::user_stations_dir(); !parent.empty() && fs::is_directory(parent, ec)) {
    for (const auto& d : fs::directory_iterator(parent, ec)) {
      if (fs::is_regular_file(d.path() / "station.toml", ec)) dirs.push_back(d.path());
    }
  }
  out.installed = stations(dirs);
  for (const auto& r : StationManager::list_running_stations()) {
    const auto m = StationManager::load_manifest(r.station_dir);
    out.running.push_back({r.station_dir, r.engine, m.name.empty() ? "" : m.version, "", r.port});
  }
  return out;
}

json entries(const fs::path& root, const Elsewhere& outside) {
  json tree = files(root);
  const auto in_hub = hub_stations(root, tree);
  for (auto& e : tree) {
    const std::string p = e["path"];
    for (const auto& s : in_hub) {
      if (s.at.generic_string() == p) e["station"] = {{"name", s.name}, {"version", s.version}};
    }
    if (!ends_with(p, ".psf")) continue;
    const auto h = header(root / p);
    if (!h) continue;
    e["station"] = *h;
    const json r = resolve(root, in_hub, p, h->value("name", ""), h->value("version", ""), h->value("path", ""), outside);
    if (r.contains("missing")) {
      e["parent"] = nullptr;
      e["warn"] = h->value("name", "") + (h->contains("version") ? " " + h->value("version", "") : "") + " not found";
    } else if (const std::string w = r["found"]["where"]; w == "path" || w == "workspace") {
      e["parent"] = r["found"]["path"];
    }
  }
  return tree;
}

json find(const fs::path& root, const std::string& psf, const std::string& name, const std::string& version,
          const Elsewhere& outside) {
  std::string n = name, v = version, path;
  if (!root.empty() && !psf.empty()) {
    if (const auto at = inside(root, psf)) {
      if (const auto h = header(*at)) {
        if (n.empty()) n = h->value("name", "");
        if (v.empty()) v = h->value("version", "");
        path = h->value("path", "");
      }
    }
  }
  if (n.empty()) return {{"error", "no station named"}};
  const json tree = root.empty() ? json::array() : files(root);
  return resolve(root, root.empty() ? std::vector<StationInfo>{} : hub_stations(root, tree), psf, n, v, path, outside);
}

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

json examples(const std::string& cli) {
  const auto r = ProcessRunner::run_sync({cli, "example", "list", "--app", "simplicial", "--json"}, {}, {}, std::chrono::seconds(60));
  const json all = r.ok() ? json::parse(r.stdout_text, nullptr, /*allow_exceptions=*/false) : json();
  json out = json::array();
  if (!all.is_array()) return out;
  for (const auto& e : all) {
    if (e.is_object() && e.value("id", "") != "" && e.value("name", "") != "") out.push_back(e);
  }
  return out;
}

namespace {

// `<cli> example <argv…> --json` (no shell): its JSON, or {error}: the CLI's, else its stderr, else "can't run".
json run_example(const std::string& cli, std::vector<std::string> argv) {
  const std::string what = cli + " example " + argv[0] + " " + argv[1];
  argv.insert(argv.begin(), {cli, "example"});
  argv.push_back("--json");
  const auto r = ProcessRunner::run_sync(argv, {}, {}, std::chrono::seconds(120));
  const json doc = json::parse(r.stdout_text, nullptr, /*allow_exceptions=*/false);
  if (r.ok() && doc.is_object() && !doc.contains("error")) return doc;
  if (doc.is_object() && doc.contains("error") && doc["error"].is_string()) return {{"error", doc["error"]}};
  std::string why = r.stderr_text;
  while (!why.empty() && std::isspace(static_cast<unsigned char>(why.back()))) why.pop_back();
  return {{"error", why.empty() ? "can't run " + what : why}};
}

// A folder the page names for --to: absolute, never a flag for the CLI.
bool folder_ok(const std::string& to) { return !to.starts_with('-') && fs::path(to).is_absolute(); }

}  // namespace

json open_example(const std::string& cli, const std::string& id, const std::string& to) {
  if (id.empty() || id.starts_with('-')) return {{"error", "no example named"}};
  if (to.empty()) return run_example(cli, {"open", id});
  if (!folder_ok(to)) return {{"error", to + " is not an absolute folder"}};
  return run_example(cli, {"open", id, "--to", to});
}

json copy_example(const std::string& cli, const std::string& id, const std::string& to) {
  if (id.empty() || id.starts_with('-')) return {{"error", "no example named"}};
  if (!folder_ok(to)) return {{"error", (to.empty() ? "no folder" : to + " is not an absolute folder")}};
  return run_example(cli, {"copy", id, "--to", to, "--open"});
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
