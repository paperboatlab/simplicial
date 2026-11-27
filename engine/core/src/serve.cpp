// The transport: one Session per WebSocket connection, and plain HTTP on the same port for
// a web station (the station's own page, GUIDELINES §6.4) and its bridge script. The only
// file that knows sockets.

#include <algorithm>
#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <map>
#include <memory>
#include <mutex>
#include <sstream>
#include <thread>

#include <nlohmann/json.hpp>

#include <ixwebsocket/IXHttpServer.h>
#include <ixwebsocket/IXNetSystem.h>

#include "paperboat/toolkit/installer.hpp"
#include "paperboat/toolkit/platform.hpp"
#include "paperboat/core/hubs.hpp"
#include "paperboat/core/process.hpp"
#include "paperboat/core/server.hpp"
#include "paperboat/core/station_manager.hpp"
#include "paperboat/core/workspace.hpp"

namespace paperboat::core {

extern const char* const kStationJs;  // web/station.js, embedded at build time

namespace {

namespace fs = std::filesystem;

std::string content_type(const fs::path& file) {
  static const std::map<std::string, std::string> types = {
      {".html", "text/html; charset=utf-8"}, {".js", "text/javascript; charset=utf-8"},
      {".mjs", "text/javascript; charset=utf-8"}, {".css", "text/css; charset=utf-8"},
      {".json", "application/json"}, {".svg", "image/svg+xml"}, {".png", "image/png"},
      {".jpg", "image/jpeg"}, {".jpeg", "image/jpeg"}, {".gif", "image/gif"}, {".webp", "image/webp"},
      {".woff2", "font/woff2"}, {".wasm", "application/wasm"}, {".txt", "text/plain; charset=utf-8"}};
  auto it = types.find(file.extension().string());
  return it == types.end() ? "application/octet-stream" : it->second;
}

ix::HttpResponsePtr respond(int status, const std::string& type, std::string body) {
  ix::WebSocketHttpHeaders headers;
  headers["Content-Type"] = type;
  headers["Cache-Control"] = "no-cache";
  return std::make_shared<ix::HttpResponse>(status, status == 200 ? "OK" : "Not Found", ix::HttpErrorCode::Ok, headers,
                                            std::move(body));
}

std::string decode(const std::string& uri) {
  std::string out;
  for (std::size_t i = 0; i < uri.size(); ++i) {
    if (uri[i] == '%' && i + 2 < uri.size()) {
      out += static_cast<char>(std::stoi(uri.substr(i + 1, 2), nullptr, 16));
      i += 2;
    } else {
      out += uri[i];
    }
  }
  return out;
}

// GET /paperboat/station.js: the bridge. GET /<page's folder>/…: a file of the web station,
// only from inside that folder. Everything else is 404: the engine is not a file server.
ix::HttpResponsePtr http(const Station& station, const ix::HttpRequestPtr& request) {
  const std::string path = decode(request->uri.substr(0, request->uri.find('?')));
  if (path == "/paperboat/station.js") return respond(200, "text/javascript; charset=utf-8", kStationJs);
  const auto& catalog = *station.catalog;
  if (catalog.station_page.empty() || path.size() < 2) return respond(404, "text/plain", "not found\n");
  std::error_code ec;
  const fs::path root = fs::weakly_canonical(catalog.dir / fs::path(catalog.station_page).parent_path(), ec);
  const fs::path file = fs::weakly_canonical(catalog.dir / path.substr(1), ec);
  const auto inside = file.lexically_relative(root);
  if (ec || inside.empty() || *inside.begin() == ".." || !fs::is_regular_file(file))
    return respond(404, "text/plain", "not found\n");
  std::ifstream in(file, std::ios::binary);
  std::stringstream body;
  body << in.rdbuf();
  return respond(200, content_type(file), body.str());
}

// One query parameter, decoded (`?hub=…&path=…`); "" when it isn't there.
std::string query(const std::string& uri, const std::string& name) {
  const auto q = uri.find('?');
  if (q == std::string::npos) return "";
  std::stringstream in(uri.substr(q + 1));
  for (std::string pair; std::getline(in, pair, '&');) {
    if (!pair.starts_with(name + "=")) continue;
    std::string v = pair.substr(name.size() + 1);
    std::replace(v.begin(), v.end(), '+', ' ');  // the page's URLSearchParams: a space is '+', a '+' is %2B
    return decode(v);
  }
  return "";
}

bool from_here(const std::string& remote) { return remote == "127.0.0.1" || remote == "::1" || remote == "::ffff:127.0.0.1"; }
bool from_page(const ix::HttpRequestPtr& request) { return request->headers.find("X-Paperboat-Page") != request->headers.end(); }

// The hub `id` as Malachite's `hub list` names it: its folder, or empty.
fs::path hub_root(const std::string& cli, const std::string& id) {
  for (const auto& h : hubs::known(cli)) {
    if (!id.empty() && h.value("id", "") == id) return h.value("path", "");
  }
  return {};
}

// The workspace a route works in: `folder=<absolute path>` (a folder on this computer), else `hub=<id>` (Malachite's);
// empty when neither names one that is there.
fs::path root_of(const std::string& cli, const std::string& uri) {
  const std::string folder = query(uri, "folder");
  if (folder.empty()) return hub_root(cli, query(uri, "hub"));
  const fs::path p = folder;
  std::error_code ec;
  return p.is_absolute() && fs::is_directory(p, ec) ? p : fs::path{};
}

// Where the page server writes the log of a station it started (`station/start`), by its port.
fs::path start_log(int port) { return platform::shared_tmp_dir() / ("simplicial-station-" + std::to_string(port) + ".log"); }

// A flow's station (plans/2026-11-26_12-55_psf_pst_rework.md), for this computer only:
// GET /__paperboat/station/find?hub=&path=<psf> (or &name=&version=): where it is (hubs::find);
// POST /__paperboat/station/start?hub=&path=<pst or station folder> (or ?name=&version=, an installed one), from
// the page: `paperboat start` it on a free port, in the background, and answer {port, url} (the page then waits on
// /__paperboat/status); GET /__paperboat/station/log?port=: what a start the page asked for wrote.
ix::HttpResponsePtr station_route(const std::string& path, const ix::HttpRequestPtr& request, const std::string& cli) {
  const std::string id = query(request->uri, "hub"), rel = query(request->uri, "path");
  const std::string name = query(request->uri, "name"), version = query(request->uri, "version");
  std::error_code ec;
  const fs::path root = root_of(cli, request->uri);
  if ((!id.empty() || !query(request->uri, "folder").empty()) && (root.empty() || !fs::is_directory(root, ec)))
    return respond(404, "text/plain", "no such hub or folder\n");
  if (path == "/__paperboat/station/find") {
    if (rel.empty() && name.empty()) return respond(400, "text/plain", "a flow's path or a station's name\n");
    return respond(200, "application/json", hubs::find(root, rel, name, version, hubs::elsewhere()).dump());
  }
  if (path == "/__paperboat/station/log") {
    const std::string port = query(request->uri, "port");
    if (port.empty() || port.find_first_not_of("0123456789") != std::string::npos || port.size() > 5) return respond(400, "text/plain", "a port\n");
    std::ifstream in(start_log(std::stoi(port)), std::ios::binary);
    std::stringstream body;
    body << in.rdbuf();
    return respond(200, "text/plain; charset=utf-8", body.str());
  }
  if (path != "/__paperboat/station/start") return respond(404, "text/plain", "not found\n");
  if (request->method != "POST" || !from_page(request)) return respond(405, "text/plain", "POST from the page starts a station\n");
  fs::path target;
  if (!root.empty()) {
    const auto at = hubs::inside(root, rel);
    if (!at || !(at->extension() == ".pst" ? fs::is_regular_file(*at, ec) : fs::is_regular_file(*at / "station.toml", ec)))
      return respond(400, "text/plain", "not a .pst or a station folder in the hub\n");
    target = *at;
    if (target.extension() == ".pst") workspace::remember("file", target, id);
  } else {
    const json f = hubs::find({}, "", name, version, hubs::elsewhere());
    if (!f.contains("found") || f["found"]["where"] != "installed") return respond(404, "text/plain", "no installed station " + name + "\n");
    target = f["found"].value("path", "");
  }
  const int port = StationManager::find_free_port(51301, 51399);
  if (port <= 0) return respond(503, "text/plain", "no free station port (51301-51399)\n");
  const int pid = ProcessRunner::run_detached({platform::exe_path().string(), "start", target.string(), "--port", std::to_string(port)},
                                              {}, {}, start_log(port));
  if (pid <= 0) return respond(500, "text/plain", "can't start " + target.filename().string() + "\n");
  return respond(200, "application/json", json{{"port", port}, {"url", "ws://localhost:" + std::to_string(port)}}.dump());
}

// The paperboat CLI (Malachite adds `hub`), or $PAPERBOAT_BIN (the platform's name for it; a stand-in in tests).
std::string paperboat_cli() {
  const char* env = std::getenv("PAPERBOAT_BIN");
  return env && *env ? env : "paperboat";
}

// What the page works in, switched at runtime (one per page server; plans/2026-11-26_11-05_one_file_workflow.md).
std::mutex workspace_lock;
json current_workspace = nullptr;  // {kind, root, name, hub?} or null: the Start page

// GET /__paperboat/workspace: {workspace, home}. POST (from the page) {folder: path} | {hub: id} | {file: path} | {}:
// work in that folder (or the hub whose folder holds it), that hub, the folder or hub of that file ({workspace,
// path}: the file's path in it), or nothing (Close folder, Close hub). The store every app shares:
// GET /__paperboat/recent and /__paperboat/settings; POST {clear: true} and {theme} (from the page).
ix::HttpResponsePtr workspace_route(const std::string& path, const ix::HttpRequestPtr& request, const std::string& cli) {
  const bool post = request->method == "POST";
  if (post && !from_page(request)) return respond(405, "text/plain", "POST from the page\n");
  const json body = post ? json::parse(request->body, nullptr, /*allow_exceptions=*/false) : json::object();
  if (post && !body.is_object()) return respond(400, "text/plain", "a JSON object\n");
  if (path == "/__paperboat/recent") {
    if (post && body.value("clear", false)) workspace::forget();
    return respond(200, "application/json", workspace::recent().dump());
  }
  if (path == "/__paperboat/settings") {
    if (post && !workspace::save_settings(body)) return respond(400, "text/plain", "theme: light, dark or system; scale: 0.75, 1 or 1.25\n");
    return respond(200, "application/json", workspace::settings().dump());
  }
  std::lock_guard lock(workspace_lock);
  json out = {{"home", workspace::typed("~").string()}};
  if (post) {
    std::error_code ec;
    if (body.contains("hub")) {
      const std::string id = body.value("hub", "");
      json h;
      for (const auto& k : hubs::known(cli)) {
        if (k.value("id", "") == id) h = k;
      }
      const fs::path root = h.is_object() ? fs::path(h.value("path", "")) : fs::path{};
      if (root.empty() || !fs::is_directory(root, ec)) return respond(404, "text/plain", "no such hub, or its folder is gone\n");
      current_workspace = {{"kind", "hub"}, {"root", root.string()}, {"name", h.value("name", root.filename().string())}, {"hub", id}};
    } else if (body.contains("folder") || body.contains("file")) {
      const bool file = body.contains("file");
      const fs::path at = workspace::typed(body.value(file ? "file" : "folder", ""));
      const fs::path dir = file ? at.parent_path() : at;
      if (at.empty() || !fs::is_directory(dir, ec)) return respond(404, "text/plain", "no such folder\n");
      current_workspace = workspace::place_of(dir, hubs::known(cli));
      if (file) out["path"] = fs::weakly_canonical(at, ec).lexically_relative(current_workspace["root"].get<std::string>()).generic_string();
    } else {
      current_workspace = nullptr;
    }
    if (current_workspace.is_object())
      workspace::remember(current_workspace["kind"], current_workspace["root"].get<std::string>(), current_workspace.value("hub", ""));
  }
  out["workspace"] = current_workspace;
  return respond(200, "application/json", out.dump());
}

// The hubs for the page's File › Open and Save as (paperboat#16): GET /__paperboat/hubs, a hub's files
// (GET /__paperboat/hub/files?hub=<id>, with their stations: hubs::entries), and one .psf in it (GET to read, POST
// to write: /__paperboat/hub/file?hub=<id>&path=<in the hub>). Only for this computer, and a write only from the
// page itself (its own header, which a cross-site form can't send). Nothing when `path` isn't a hub or station route.
// Ctrl+K's Open example: <name> (paperboat#72): GET /__paperboat/examples (`paperboat example list --app simplicial`,
// [] without the CLI) and POST /__paperboat/example/open?id=<id>[&to=<folder>] (`paperboat example open <id> --to`:
// in place, a new window; `to`, the page's folder, is where the example's banner copies it), and the banner's
// POST /__paperboat/example/copy?id=<id>&to=<folder> (`paperboat example copy <id> --to <folder> --open`, paperboat#75).
ix::HttpResponsePtr hub_route(const std::string& path, const ix::HttpRequestPtr& request, const std::string& remote) {
  const bool station = path.starts_with("/__paperboat/station/");
  const bool store = path == "/__paperboat/workspace" || path == "/__paperboat/recent" || path == "/__paperboat/settings";
  const bool launcher = path == "/__paperboat/launcher";
  const bool example = path == "/__paperboat/examples" || path == "/__paperboat/example/open" || path == "/__paperboat/example/copy";
  if (!path.starts_with("/__paperboat/hub") && !station && !store && !launcher && !example) return nullptr;
  if (!from_here(remote)) return respond(403, "text/plain", "hubs are only for this computer\n");
  const std::string cli = paperboat_cli();
  if (launcher) {  // Run › Manage runtimes…: the Launcher on its Runtimes page (paperboat#69)
    if (request->method != "POST" || !from_page(request)) return respond(405, "text/plain", "POST from the page\n");
    const auto r = ProcessRunner::run_sync({cli, "launcher", "--page", "runtimes"}, {}, {}, std::chrono::seconds(10));
    return r.ok() ? respond(200, "application/json", "{}") : respond(502, "text/plain", r.stderr_text.empty() ? "can't run " + cli + "\n" : r.stderr_text);
  }
  if (path == "/__paperboat/examples") return respond(200, "application/json", hubs::examples(cli).dump());
  if (path == "/__paperboat/example/open" || path == "/__paperboat/example/copy") {
    if (request->method != "POST" || !from_page(request)) return respond(405, "text/plain", "POST from the page\n");
    const std::string id = query(request->uri, "id"), to = query(request->uri, "to");
    const json r = path.ends_with("/open") ? hubs::open_example(cli, id, to) : hubs::copy_example(cli, id, to);
    return r.contains("error") ? respond(502, "text/plain", r["error"].get<std::string>() + "\n") : respond(200, "application/json", r.dump());
  }
  if (station) return station_route(path, request, cli);
  if (store) return workspace_route(path, request, cli);
  if (path == "/__paperboat/hubs") return respond(200, "application/json", hubs::list(cli).dump());
  const fs::path root = root_of(cli, request->uri);
  std::error_code ec;
  if (root.empty() || !fs::is_directory(root, ec)) return respond(404, "text/plain", "no such hub or folder\n");
  if (path == "/__paperboat/hub/files") return respond(200, "application/json", hubs::entries(root, hubs::elsewhere()).dump());
  if (path == "/__paperboat/hub/malachite") {  // Open in Malachite
    if (request->method != "POST" || !from_page(request)) return respond(405, "text/plain", "POST from the page\n");
    const int pid = ProcessRunner::run_detached({cli, "app", "open", "malachite", root.string()}, {}, {}, {});
    return pid > 0 ? respond(200, "application/json", "{}") : respond(500, "text/plain", "can't run " + cli + "\n");
  }
  if (path != "/__paperboat/hub/file") return respond(404, "text/plain", "not found\n");
  const auto file = hubs::inside(root, query(request->uri, "path"));
  if (!file || file->extension() != ".psf") return respond(400, "text/plain", "not a .psf in the hub or folder\n");
  const std::string hub = query(request->uri, "folder").empty() ? query(request->uri, "hub") : "";
  if (request->method == "GET") {
    std::ifstream in(*file, std::ios::binary);
    if (!in) return respond(404, "text/plain", "not found\n");
    std::stringstream body;
    body << in.rdbuf();
    workspace::remember("file", *file, hub);
    return respond(200, "application/json", body.str());
  }
  if (request->method != "POST" || !from_page(request))
    return respond(405, "text/plain", "POST from the page writes a file\n");
  // to a temp file, then renamed: a sync client never sees half a file
  fs::create_directories(file->parent_path(), ec);
  const fs::path tmp = file->string() + ".saving";
  {
    std::ofstream out(tmp, std::ios::binary | std::ios::trunc);
    out << request->body;
    if (!out) return respond(500, "text/plain", "can't write " + file->filename().string() + "\n");
  }
  fs::rename(tmp, *file, ec);
  if (ec) {
    fs::remove(tmp, ec);
    return respond(500, "text/plain", "can't write " + file->filename().string() + "\n");
  }
  workspace::remember("file", *file, hub);
  return respond(200, "application/json", "{}");
}

}  // namespace

int serve_files(const fs::path& dir, int port, const std::string& host, const fs::path& folder) {
  ix::initNetSystem();
  std::error_code ec;
  if (!folder.empty()) {
    if (!fs::is_directory(folder, ec)) {
      std::cerr << "error: " << folder.string() << " is not a folder\n";
      return 1;
    }
    current_workspace = workspace::place_of(fs::absolute(folder, ec), hubs::known(paperboat_cli()));
    workspace::remember(current_workspace["kind"], current_workspace["root"].get<std::string>(), current_workspace.value("hub", ""));
  }
  const fs::path root = fs::weakly_canonical(dir, ec);
  ix::HttpServer server(port, host);
  server.setOnConnectionCallback([&root](const ix::HttpRequestPtr& request, const std::shared_ptr<ix::ConnectionState>& conn) {
    std::string path = decode(request->uri.substr(0, request->uri.find('?')));
    if (auto hub = hub_route(path, request, conn->getRemoteIp())) return hub;
    // The Station dialog lists what is running, like `paperboat list --json` does.
    if (path == "/__paperboat/stations") {
      nlohmann::json out = nlohmann::json::array();
      for (const auto& b : StationManager::list_running_stations()) {
        out.push_back({{"name", b.domain.empty() ? b.engine : b.domain},
                       {"engine", b.engine},
                       {"domain", b.domain},
                       {"port", b.port},
                       {"url", b.ws_url.empty() ? "ws://localhost:" + std::to_string(b.port) : b.ws_url}});
      }
      return respond(200, "application/json", out.dump());
    }
    // What each station is doing, starting ones included (pb#332), as `paperboat status --json` gives it:
    // the wait screen polls it while its station builds.
    if (path == "/__paperboat/status") return respond(200, "application/json", StationManager::status_json());
    // Toolkits installed into a release (pb#353): the web parts `toolkit install` bundled, which the
    // app imports at startup, and their files.
    const std::string tk_prefix = "/__paperboat/toolkits";
    if (path == tk_prefix) {
      nlohmann::json out = nlohmann::json::array();
      std::error_code te;
      for (const auto& d : fs::directory_iterator(toolkit::toolkits_dir(toolkit::find_repo_root()), te)) {
        const std::string name = d.path().filename().string();
        if (name.starts_with(".") || !fs::is_regular_file(d.path() / "web-dist" / "index.js", te)) continue;
        nlohmann::json t = {{"name", name}, {"js", tk_prefix + "/" + name + "/index.js"}};
        if (fs::is_regular_file(d.path() / "web-dist" / "index.css", te)) t["css"] = tk_prefix + "/" + name + "/index.css";
        out.push_back(t);
      }
      return respond(200, "application/json", out.dump());
    }
    if (path.starts_with(tk_prefix + "/")) {
      const std::string rest = path.substr(tk_prefix.size() + 1);  // <name>/<file>
      const auto slash = rest.find('/');
      std::error_code te;
      if (slash != std::string::npos) {
        const fs::path dist = fs::weakly_canonical(toolkit::toolkits_dir(toolkit::find_repo_root()) / rest.substr(0, slash) / "web-dist", te);
        const fs::path file = fs::weakly_canonical(dist / rest.substr(slash + 1), te);
        const auto in_dist = file.lexically_relative(dist);
        if (!te && !in_dist.empty() && *in_dist.begin() != ".." && fs::is_regular_file(file, te)) {
          std::ifstream in(file, std::ios::binary);
          std::stringstream body;
          body << in.rdbuf();
          return respond(200, content_type(file), body.str());
        }
      }
      return respond(404, "text/plain", "not found\n");
    }
    std::error_code e;
    fs::path file = fs::weakly_canonical(root / (path.size() > 1 ? path.substr(1) : "index.html"), e);
    const auto inside = file.lexically_relative(root);
    if (e || inside.empty() || *inside.begin() == "..") return respond(404, "text/plain", "not found\n");
    if (!fs::is_regular_file(file)) file = root / "index.html";  // the app's own routes
    std::ifstream in(file, std::ios::binary);
    if (!in) return respond(404, "text/plain", "not found\n");
    std::stringstream body;
    body << in.rdbuf();
    return respond(200, content_type(file), body.str());
  });
  if (auto [ok, error] = server.listen(); !ok) {
    std::cerr << "error: cannot serve the web app on port " << port << ": " << error << '\n';
    return 1;
  }
  server.start();
  std::cout << "Paperboat web app on http://localhost:" << port << "/  (Ctrl+C stops it)" << std::endl;
  server.wait();
  return 0;
}

struct Server::State {
  State(const Station& b, int p) : station(b), port(p), server(p, "127.0.0.1") {}
  const Station& station;
  int port;
  ix::HttpServer server;  // also upgrades WebSocket connections, on the same port
  std::mutex mutex;
  std::map<std::string, std::unique_ptr<Session>> sessions;  // by connection id
  // Live variables from a client that is not this flow (Julix), shared by every session: the connection
  // that sent them (they go when it closes) and what it calls itself.
  std::string remote_source;
  std::string remote_label = "julix";
  json remote_variables = json::array();

  void publish_remote(const std::string& connection, const json& variables, const std::string& label) {
    std::vector<Session*> targets;
    {
      std::lock_guard lock(mutex);
      remote_source = connection;
      remote_label = label;
      remote_variables = variables;
      for (auto& [id, session] : sessions) targets.push_back(session.get());
    }
    const json message = {{"type", "variables.remote"}, {"source", label}, {"variables", variables}};
    for (Session* session : targets) session->send_message(message);
  }

  void clear_remote(const std::string& source) {
    std::vector<Session*> targets;
    {
      std::lock_guard lock(mutex);
      if (remote_source != source) return;
      remote_source.clear();
      remote_variables = json::array();
      for (auto& [id, session] : sessions) targets.push_back(session.get());
    }
    const json message = {{"type", "variables.remote"}, {"source", remote_label}, {"variables", json::array()}};
    for (Session* session : targets) session->send_message(message);
  }
};

Server::Server(const Station& station, int port) : state_(std::make_unique<State>(station, port)) {
  ix::initNetSystem();
  auto& s = *state_;
  s.server.setOnConnectionCallback(
      [&s](const ix::HttpRequestPtr& request, const std::shared_ptr<ix::ConnectionState>&) {
        const std::string path = decode(request->uri.substr(0, request->uri.find('?')));
        if (path == "/variables.remote") {
          json variables;
          std::string label;
          {
            std::lock_guard lock(s.mutex);
            variables = s.remote_variables;
            label = s.remote_label;
          }
          auto response = respond(200, "application/json", json{{"source", label}, {"variables", variables}}.dump());
          response->headers["Access-Control-Allow-Origin"] = "*";
          return response;
        }
        return http(s.station, request);
      });
  s.server.setOnClientMessageCallback(
      [&s](std::shared_ptr<ix::ConnectionState> conn, ix::WebSocket& ws, const ix::WebSocketMessagePtr& msg) {
        const std::string& id = conn->getId();
        if (msg->type == ix::WebSocketMessageType::Open) {
          // sendText is thread-safe in IXWebSocket, so runs can send from their own thread.
          auto session = std::make_unique<Session>(
              s.station, [&ws](const std::string& text) { ws.sendText(text); },
              [&s, id](const json& variables, const std::string& label) { s.publish_remote(id, variables, label); },
              [&s] {
                std::lock_guard lock(s.mutex);
                return s.remote_variables;
              });
          Session* created = nullptr;
          json remote_snapshot;
          std::string remote_label;
          {
            std::lock_guard lock(s.mutex);
            created = session.get();
            s.sessions[id] = std::move(session);
            remote_snapshot = s.remote_variables;
            remote_label = s.remote_label;
          }
          // A client that opens after Julix sent its variables gets them too.
          if (created && !remote_snapshot.empty())
            created->send_message({{"type", "variables.remote"}, {"source", remote_label}, {"variables", remote_snapshot}});
        } else if (msg->type == ix::WebSocketMessageType::Close) {
          std::unique_ptr<Session> gone;  // destroyed outside the lock: joins its run
          {
            std::lock_guard lock(s.mutex);
            if (auto it = s.sessions.find(id); it != s.sessions.end()) gone = std::move(it->second), s.sessions.erase(it);
          }
          s.clear_remote(id);
          // A run's own send can be what finds the socket closed: this callback then runs on the
          // run's thread, which can't join itself (that aborted the station). Mute the session and
          // let another thread stop and join it.
          if (gone && gone->on_own_thread()) {
            gone->close();
            std::thread([dying = std::move(gone)]() mutable { dying.reset(); }).detach();
          }
        } else if (msg->type == ix::WebSocketMessageType::Message) {
          Session* session = nullptr;
          {
            std::lock_guard lock(s.mutex);
            if (auto it = s.sessions.find(id); it != s.sessions.end()) session = it->second.get();
          }
          if (session) session->on_message(msg->str);  // each connection has its own callback thread
        }
      });
}

Server::~Server() { stop(); }

std::string Server::start() {
  if (auto [ok, error] = state_->server.listen(); !ok) return error;
  state_->server.start();

  const auto* cat = state_->station.catalog;
  RunningStation rb;
  rb.port = state_->port;
  rb.pid = platform::current_pid();
  rb.engine = state_->station.engine;
  rb.domain = cat ? cat->domain : "";
  rb.cwd = std::filesystem::current_path();
  rb.station_dir = cat ? cat->dir : std::filesystem::path{};
  rb.executable = "";
  rb.ws_url = "ws://localhost:" + std::to_string(state_->port);
  rb.started_at = 0;
  StationManager::register_running_station(rb);

  set_restart_handler([this] {
    StationManager::unregister_running_station(state_->port);
    state_->server.stop();
    exec_remembered_args();
  });
  return {};
}

void Server::stop() {
  StationManager::unregister_running_station(state_->port);
  set_restart_handler(nullptr);
  state_->server.stop();
  std::lock_guard lock(state_->mutex);
  state_->sessions.clear();
}

int serve(const Station& station, int port) {
  Server server(station, port);
  if (auto error = server.start(); !error.empty()) {
    std::cerr << "cannot listen on port " << port << ": " << error << '\n';
    return 1;
  }
  std::cout << "paperboat station (" << station.engine << ") on ws://localhost:" << port << std::endl;
  for (;;) std::this_thread::sleep_for(std::chrono::hours(1));
}

}  // namespace paperboat::core
