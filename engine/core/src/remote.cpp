// Julia and Python stations out of process: the Remote adapters, the lease and the runtime's
// socket (remote.hpp). The client half of paperboat-control/0 and paperboat-runtime/0 is Articula's
// (articula/server/src/omc.cpp), not paperboat's RuntimeClient:
// ponytail: copied, not linked; link paperboat::runtime once this engine's CMake project stops being
// called `paperboat` too (its paperboat_warnings and PAPERBOAT_* options collide with the platform's).

#include "paperboat/core/remote.hpp"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iostream>
#include <mutex>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <utility>
#include <vector>

#include <toml++/toml.hpp>

#include "paperboat/core/server.hpp"
#include "paperboat/core/station_manager.hpp"
#include "paperboat/toolkit/descriptor.hpp"
#include "paperboat/toolkit/model.hpp"
#include "paperboat/toolkit/plugin.hpp"
#include "paperboat/toolkit/station.hpp"

#ifndef _WIN32
#include <fcntl.h>
#include <poll.h>
#include <pthread.h>
#include <signal.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>
#endif

namespace paperboat::core {
namespace {

namespace fs = std::filesystem;
namespace tk = toolkit;
using namespace std::chrono_literals;
using Clock = std::chrono::steady_clock;

// --- definitions ---------------------------------------------------------------------------

// A definition keeps the order its file gave (a Python dict's params): nlohmann::json would sort the keys.
using Def = nlohmann::ordered_json;

std::string where(const std::string& name, const std::string& field) { return name + ": " + field; }

// A port: "u", or {id, type?, unit?, dimension?, components?}.
tk::PortDef port_from_json(const std::string& at, const Def& item) {
  tk::PortDef port;
  if (item.is_string()) {
    port.id = item.get<std::string>();
    return port;
  }
  if (!item.is_object() || !item.contains("id")) throw std::invalid_argument(at + ": a port is a name or {id, ...}");
  port.id = item.value("id", "");
  port.type = item.value("type", "signal");
  port.unit = item.value("unit", "");
  if (item.contains("dimension") && item["dimension"].is_number()) port.dimension = item["dimension"].get<std::size_t>();
  if (item.contains("components"))
    for (const auto& c : item["components"])
      port.components.push_back(c.is_string() ? tk::VectorComponent{c.get<std::string>(), ""}
                                              : tk::VectorComponent{c.value("id", ""), c.value("unit", "")});
  port.broadcast = item.value("broadcast", false);
  return port;
}

std::vector<tk::PortDef> ports_from_json(const std::string& at, const Def& list) {
  std::vector<tk::PortDef> out;
  if (list.is_null()) return out;
  if (!list.is_array()) throw std::invalid_argument(at + ": a list of ports");
  for (const auto& item : list) out.push_back(port_from_json(at, item));
  return out;
}

// A param from its default alone (a number, true/false, text) or from {default, type?, options?, unit?}.
tk::ParamDef param_from(const std::string& at, std::string id, const Def& spec) {
  tk::ParamDef param;
  param.id = std::move(id);
  const Def& value = spec.is_object() ? spec.value("default", Def()) : spec;
  if (value.is_boolean()) {
    param.type = "boolean";
    param.default_value = value.get<bool>() ? 1.0 : 0.0;
  } else if (value.is_number()) {
    param.default_value = value.get<double>();
  } else if (value.is_string()) {
    param.type = "text";
    param.default_text = value.get<std::string>();
  } else if (!value.is_null()) {
    throw std::invalid_argument(at + " " + param.id + ": a default is a number, true/false or text");
  }
  if (spec.is_object()) {
    param.type = spec.value("type", param.type);
    param.unit = spec.value("unit", "");
    if (spec.contains("options")) param.options = spec["options"].get<std::vector<std::string>>();
    if (!param.is_number() && param.default_text.empty() && param.type == "enum" && !param.options.empty())
      param.default_text = param.options.front();
  }
  return param;
}

// Params: {id: default, ...} (Python keeps its order), [[id, default], ...] or [{id, default, ...}, ...].
std::vector<tk::ParamDef> params_from_json(const std::string& at, const Def& list) {
  std::vector<tk::ParamDef> out;
  if (list.is_null()) return out;
  if (list.is_object()) {
    for (const auto& [id, spec] : list.items()) out.push_back(param_from(at, id, spec));
    return out;
  }
  if (!list.is_array()) throw std::invalid_argument(at + ": {id: default}, or a list of [id, default] or {id, default}");
  for (const auto& item : list) {
    if (item.is_array() && item.size() == 2 && item[0].is_string()) out.push_back(param_from(at, item[0].get<std::string>(), item[1]));
    else if (item.is_object() && item.contains("id")) out.push_back(param_from(at, item["id"].get<std::string>(), item));
    else throw std::invalid_argument(at + ": a param is [id, default] or {id, default}");
  }
  return out;
}

tk::Kind kind_from(const std::string& at, const std::string& name) {
  if (name == "source") return tk::Kind::Source;
  if (name == "probe") return tk::Kind::Probe;
  if (name == "monitor") return tk::Kind::Monitor;
  if (name == "function") return tk::Kind::Function;
  throw std::invalid_argument(at + ": kind is source, probe, function or monitor, not " + name);
}

tk::BlockDef block_def(const std::string& name, const Def& d) {
  if (!d.is_object()) throw std::invalid_argument(name + ": a definition is an object");
  tk::BlockDef def;
  def.type = name;
  def.label = d.value("label", name);
  def.kind = kind_from(where(name, "kind"), d.value("kind", "function"));
  def.inputs = ports_from_json(where(name, "inputs"), d.value("inputs", Def()));
  def.outputs = ports_from_json(where(name, "outputs"), d.value("outputs", Def()));
  def.params = params_from_json(where(name, "params"), d.value("params", Def()));
  def.feedthrough = d.value("feedthrough", true);
  def.elementwise = d.value("elementwise", false);
  def.description = d.value("description", "");
  if (d.contains("flows")) def.flows = d["flows"].get<std::vector<std::string>>();
  if (def.kind == tk::Kind::Monitor) def.instrument = d.value("instrument", "graph");
  return def;
}

// --- values --------------------------------------------------------------------------------

json value_json(const tk::Value& value) {
  if (const auto* number = std::get_if<double>(&value)) return *number;
  if (const auto* vector = std::get_if<tk::Vector>(&value)) return *vector;
  if (const auto* table = std::get_if<tk::Table>(&value)) return *table;
  if (const auto* text = std::get_if<std::string>(&value)) return *text;
  throw std::runtime_error("a handle (" + std::get<tk::Handle>(value).kind + ") cannot travel to a Julia or Python runtime");
}

json values_json(const tk::Values& values) {
  json out = json::object();
  for (const auto& [id, value] : values) out[id] = value_json(value);
  return out;
}

tk::Value value_from_json(const json& value) {
  if (value.is_number()) return value.get<double>();
  if (value.is_boolean()) return value.get<bool>() ? 1.0 : 0.0;
  if (value.is_string()) return value.get<std::string>();
  if (value.is_null()) return std::nan("");
  if (value.is_array()) {
    if (!value.empty() && value.front().is_array()) return value.get<tk::Table>();
    return value.get<tk::Vector>();
  }
  throw std::runtime_error("a value must be a number, text, a list or a table, not " + value.dump());
}

tk::Values values_from_json(const json& object) {
  tk::Values out;
  if (object.is_null()) return out;
  if (!object.is_object()) throw std::runtime_error("outputs must be a dict of port: value, not " + object.dump());
  for (const auto& [id, value] : object.items()) out[id] = value_from_json(value);
  return out;
}

std::vector<tk::Entity> entities_from_json(const json& list) {
  std::vector<tk::Entity> out;
  if (!list.is_array()) return out;
  for (const auto& item : list) {
    tk::Entity e;
    e.id = item.value("id", "");
    e.shape = item.value("shape", "box");
    const auto triple = [&](const char* key, std::array<double, 3>& into) {
      if (item.contains(key)) into = item[key].get<std::array<double, 3>>();
    };
    triple("pos", e.pos);
    triple("size", e.size);
    triple("rot", e.rot);
    triple("scale", e.scale);
    triple("to", e.to);
    e.color = item.value("color", "#888888");
    e.src = item.value("src", "");
    if (item.contains("vertices")) e.vertices = item["vertices"].get<std::vector<double>>();
    if (item.contains("indices")) e.indices = item["indices"].get<std::vector<double>>();
    if (item.contains("values")) e.values = item["values"].get<std::vector<double>>();
    if (item.contains("range")) e.range = item["range"].get<std::array<double, 2>>();
    out.push_back(std::move(e));
  }
  return out;
}

// The params a `new` passes as keywords: numbers, booleans as true/false, text (Config) over them.
json instance_params(const std::vector<tk::ParamDef>& defs, const tk::Values& params, const tk::Config& config) {
  json out = values_json(params);
  for (const auto& p : defs)
    if (p.type == "boolean" && out.contains(p.id) && out[p.id].is_number()) out[p.id] = out[p.id].get<double>() != 0.0;
  for (const auto& [key, value] : config) out[key] = value;
  return out;
}

json context_json(const tk::Context& ctx) {
  json c = {{"t", ctx.t}, {"dt", ctx.dt}, {"id", std::string(ctx.node)}};
  if (ctx.keys_down) c["keys"] = *ctx.keys_down;
  return c;
}

// An error the runtime answered with.
struct RemoteError : std::runtime_error {
  RemoteError(std::string type_, const std::string& message, std::string traceback_)
      : std::runtime_error(message), type(std::move(type_)), traceback(std::move(traceback_)) {}
  std::string type, traceback;
  void print(std::string_view runtime) const {
    if (!traceback.empty()) std::cerr << "[" << runtime << "] " << traceback << std::endl;
  }
};

// True when `e` says the type has no `method` (an optional one: entities, read, link…), not
// that the method failed. Python: AttributeError naming it; Julia: no such function, or none for
// this type (a station that defines no `read` reaches Base.read).
bool absent(const RemoteError& e, std::string_view method) {
  const std::string what = e.what(), m(method);
  if (e.type == "AttributeError") return what.find("'" + m + "'") != std::string::npos;
  if (e.type == "UndefVarError") return what.find(m) != std::string::npos;
  if (e.type == "MethodError") return what.find("no method matching " + m + "(") != std::string::npos;
  return false;
}

}  // namespace

tk::BlockDef remote_block_def(const std::string& name, const Def& definition) { return block_def(name, definition); }

tk::ObjectDef remote_object_def(const std::string& name, const Def& d) {
  if (!d.is_object()) throw std::invalid_argument(name + ": a definition is an object");
  tk::ObjectDef def;
  def.type = name;
  def.label = d.value("label", name);
  def.role = d.value("role", "body");
  def.props = params_from_json(where(name, "props"), d.value("props", Def()));
  if (d.contains("links")) def.links = d["links"].get<std::vector<std::string>>();
  def.description = d.value("description", "");
  if (d.contains("block") && d["block"].is_object()) {
    def.block = block_def(name, d["block"]);  // the linked block has its object's id
    def.block->kind = kind_from(where(name, "block.kind"), d["block"].value("kind", "probe"));
  }
  return def;
}

#ifndef _WIN32
namespace {

std::string env(const char* name) {
  const char* v = std::getenv(name);
  return v ? v : "";
}

// paperboatd's socket (paperboat/docs/control.md).
fs::path control_socket() {
  const fs::path dir = !env("PAPERBOAT_RUNTIME_DIR").empty() ? fs::path(env("PAPERBOAT_RUNTIME_DIR"))
                       : !env("XDG_RUNTIME_DIR").empty()     ? fs::path(env("XDG_RUNTIME_DIR")) / "paperboat"
                                                             : fs::temp_directory_path() / ("paperboat-" + std::to_string(getuid()));
  return dir / "control.sock";
}

// paperboatd: $PAPERBOATD, else on PATH (beside `paperboat`).
std::string daemon_path() {
  if (!env("PAPERBOATD").empty()) return env("PAPERBOATD");
  const std::string path = env("PATH");
  for (std::size_t at = 0; at <= path.size();) {
    const std::size_t end = std::min(path.find(':', at), path.size());
    const fs::path p = fs::path(path.substr(at, end - at)) / "paperboatd";
    if (access(p.c_str(), X_OK) == 0) return p.string();
    at = end + 1;
  }
  return "";
}

int connect_unix(const fs::path& path) {
  sockaddr_un addr{};
  addr.sun_family = AF_UNIX;
  std::string p = path.string();
  int dir = -1;
#ifdef __linux__
  // A lease's socket under a long home passes sun_path's 108 bytes: reach it through its folder's fd.
  if (p.size() >= sizeof addr.sun_path && (dir = ::open(path.parent_path().c_str(), O_PATH | O_CLOEXEC)) >= 0)
    p = "/proc/self/fd/" + std::to_string(dir) + "/" + path.filename().string();
#endif
  if (p.size() >= sizeof addr.sun_path) throw std::runtime_error("socket path too long: " + path.string());
  std::memcpy(addr.sun_path, p.c_str(), p.size() + 1);
  const int fd = ::socket(AF_UNIX, SOCK_STREAM, 0);
  if (fd >= 0) ::fcntl(fd, F_SETFD, FD_CLOEXEC);  // a restart (exec) drops the lease
#ifdef SO_NOSIGPIPE
  if (fd >= 0) {
    int one = 1;
    ::setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &one, sizeof one);
  }
#endif
  const bool ok = fd >= 0 && ::connect(fd, reinterpret_cast<sockaddr*>(&addr), sizeof addr) == 0;
  if (dir >= 0) ::close(dir);
  if (ok) return fd;
  if (fd >= 0) ::close(fd);
  return -1;
}

#ifndef MSG_NOSIGNAL
#define MSG_NOSIGNAL 0  // macOS: SO_NOSIGPIPE above
#endif

bool write_all(int fd, std::string_view data) {
  while (!data.empty()) {
    const ssize_t n = ::send(fd, data.data(), data.size(), MSG_NOSIGNAL);
    if (n <= 0) return false;
    data.remove_prefix(static_cast<std::size_t>(n));
  }
  return true;
}

// Exactly n bytes; false on a closed socket, or when `give_up` says so (polled every 100 ms).
template <class GiveUp>
bool read_all(int fd, char* out, std::size_t n, GiveUp give_up) {
  while (n > 0) {
    pollfd p{fd, POLLIN, 0};
    if (const int r = ::poll(&p, 1, 100); r <= 0) {
      if (r < 0 && errno != EINTR) return false;
      if (give_up()) return false;
      continue;
    }
    const ssize_t r = ::recv(fd, out, n, 0);
    if (r <= 0) return false;
    out += r;
    n -= static_cast<std::size_t>(r);
  }
  return true;
}

bool read_all_by(int fd, char* out, std::size_t n, Clock::time_point deadline) {
  return read_all(fd, out, n, [&] { return Clock::now() > deadline; });
}

// paperboatd, started as the CLI starts it when nobody listens.
int open_control() {
  const fs::path sock = control_socket();
  if (const int fd = connect_unix(sock); fd >= 0) return fd;
  const std::string d = daemon_path();
  if (d.empty()) throw std::runtime_error("paperboatd not found: install Paperboat (the paperboat-cli package) or set PAPERBOATD");
  fs::create_directories(sock.parent_path());
  if (const pid_t pid = fork(); pid == 0) {
    setsid();
    const std::string log = (sock.parent_path() / "paperboatd.log").string();
    const int out = ::open(log.c_str(), O_WRONLY | O_CREAT | O_APPEND, 0600);
    const int in = ::open("/dev/null", O_RDONLY);
    if (in >= 0) dup2(in, 0);
    if (out >= 0) dup2(out, 1), dup2(out, 2);
    // nothing else of the station's: paperboatd outlives it and would hold its port
    for (int fd = 3; fd < 1024; ++fd) ::close(fd);
    sigset_t none;
    sigemptyset(&none);
    pthread_sigmask(SIG_SETMASK, &none, nullptr);  // the station blocks its signals for its watcher
    execl(d.c_str(), d.c_str(), "--socket", sock.c_str(), static_cast<char*>(nullptr));
    _exit(127);
  }
  for (int i = 0; i < 200; ++i) {  // up to 20 s: a first start probes podman and docker
    std::this_thread::sleep_for(100ms);
    if (const int fd = connect_unix(sock); fd >= 0) return fd;
  }
  throw std::runtime_error("paperboatd did not start; see " + (sock.parent_path() / "paperboatd.log").string());
}

}  // namespace

struct RemoteRuntime::State {
  std::string runtime;
  fs::path project;
  std::string file;
  std::mutex mutex;  // one request in flight
  int control = -1;  // paperboatd: the lease lives as long as this connection
  int sock = -1;     // <ipc>/runtime.sock
  int generation = 0;
  long long next_id = 1;
  json lease;
  std::string body;  // the last frame read, as sent

  // acquire may pull the image: 30 minutes by default
  json control_call(const std::string& op, const json& args, std::chrono::seconds wait = 30min) {
    const long long id = next_id++;
    if (!write_all(control, json{{"id", id}, {"op", op}, {"args", args}}.dump() + "\n")) throw std::runtime_error("paperboatd went away");
    std::string line;
    const auto deadline = Clock::now() + wait;
    for (char c;;) {
      if (!read_all_by(control, &c, 1, deadline)) throw std::runtime_error("paperboatd went away");
      if (c != '\n') {
        line += c;
        continue;
      }
      const json m = json::parse(line, nullptr, false);
      line.clear();
      if (!m.is_object() || m.value("id", -1LL) != id) continue;  // an event
      if (!m.value("ok", false)) throw std::runtime_error("paperboatd: " + m.value("error", "refused " + op));
      return m["result"];
    }
  }

  void close_all() {
    if (sock >= 0) ::close(sock);
    if (control >= 0) ::close(control);
    sock = control = -1;
  }

  bool read_frame(json& out, const std::function<bool()>& give_up) {
    unsigned char len[4];
    if (!read_all(sock, reinterpret_cast<char*>(len), 4, give_up)) return false;
    const std::uint32_t n = len[0] | len[1] << 8 | len[2] << 16 | static_cast<std::uint32_t>(len[3]) << 24;
    body.assign(n, '\0');
    if (!read_all(sock, body.data(), n, give_up)) return false;
    out = json::parse(body, nullptr, false);
    if (out.is_discarded()) throw std::runtime_error(runtime + " sent a reply that isn't JSON (a NaN or Infinity in it?)");
    return true;
  }

  bool write_frame(const json& j) {
    const std::string text = j.dump();
    const auto n = static_cast<std::uint32_t>(text.size());
    std::string frame{static_cast<char>(n), static_cast<char>(n >> 8), static_cast<char>(n >> 16), static_cast<char>(n >> 24)};
    return write_all(sock, frame + text);
  }

  // Lease the runtime, wait for its hello, load the domain file.
  Def start() {
    close_all();
    control = open_control();
    std::cerr << "starting the " << runtime << " runtime…" << std::endl;
    lease = control_call("acquire", {{"runtime", runtime},
                                     {"mode", "station"},
                                     {"project", fs::absolute(project).string()},
                                     {"owner", "simplicial:" + fs::absolute(project).string()}});
    const fs::path path = fs::path(lease.value("ipc", "")) / "runtime.sock";
    for (const auto until = Clock::now() + 5min; (sock = connect_unix(path)) < 0;) {  // the image may still be pulling
      if (Clock::now() > until) throw std::runtime_error(runtime + " did not start (" + path.string() + ")");
      std::this_thread::sleep_for(100ms);
    }
    json hello;
    const auto deadline = Clock::now() + 2min;
    if (!read_frame(hello, [&] { return Clock::now() > deadline; }) || hello.value("type", "") != "hello")
      throw std::runtime_error(runtime + " said no hello");
    ++generation;
    std::cerr << runtime << " " << hello["runtime"].value("version", "") << " on " << lease.value("backend", "")
              << " (" << lease.value("instance", "") << ")" << std::endl;
    request("load", {{"path", file}}, nullptr);
    return Def::parse(body).value("result", Def::object());  // its definitions in the file's order
  }

  // One request; notifications meanwhile go to ctx's Console. A cancelled run stops waiting a
  // few seconds after it asked (the connection goes with it: the next instance starts the runtime again).
  json request(const std::string& op, const json& args, const tk::Context* ctx) {
    if (sock < 0) throw std::runtime_error("the " + runtime + " runtime has stopped; the next run starts it again");
    const long long id = next_id++;
    if (!write_frame({{"id", id}, {"op", op}, {"args", args}})) {
      close_all();
      throw std::runtime_error("the " + runtime + " runtime has stopped");
    }
    std::optional<Clock::time_point> cancelled;
    const auto give_up = [&] {
      if (!ctx || !ctx->stop_requested()) return false;
      if (!cancelled) cancelled = Clock::now();
      return Clock::now() - *cancelled > 3s;
    };
    for (json m;;) {
      if (!read_frame(m, give_up)) {
        close_all();
        throw std::runtime_error(cancelled ? "cancelled while " + runtime + " was still in " + op : "the " + runtime + " runtime has stopped");
      }
      if (m.contains("type")) {  // a notification
        const std::string type = m.value("type", "");
        std::string text = m.value("text", type == "fast_error" ? m.value("message", "") : "");
        while (!text.empty() && (text.back() == '\n' || text.back() == '\r')) text.pop_back();
        if (text.empty()) continue;
        const std::string level = type == "log" ? m.value("level", "info") : m.value("name", "") == "stderr" ? "warn" : "info";
        if (ctx) ctx->log(text, level);
        else std::cerr << "[" << runtime << "] " << text << std::endl;
        continue;
      }
      if (m.value("id", -1LL) != id) continue;
      if (m.value("ok", false)) return m.value("result", json());
      const json& e = m["error"];
      if (!e.is_object()) throw RemoteError("", e.dump(), "");
      const std::string type = e.value("type", ""), message = e.value("message", "failed");
      // Python's message lacks its type (Julia's has it): "ZeroDivisionError: division by zero"
      throw RemoteError(type, type.empty() || message.starts_with(type) ? message : type + ": " + message, e.value("traceback", ""));
    }
  }
};

RemoteRuntime::RemoteRuntime(std::string runtime, fs::path project, std::string file) : state_(new State) {
  state_->runtime = std::move(runtime);
  state_->project = std::move(project);
  state_->file = std::move(file);
  try {
    std::lock_guard lock(state_->mutex);
    types_ = state_->start().value("types", Def::array());
  } catch (const RemoteError& e) {  // the file failed to load: its traceback says where
    e.print(state_->runtime);
    state_->close_all();
    delete state_;
    throw;
  } catch (...) {
    state_->close_all();
    delete state_;
    throw;
  }
}

RemoteRuntime::~RemoteRuntime() {
  end();
  delete state_;
}

void RemoteRuntime::end() noexcept {
  // ponytail: no lock, so a signal can end a runtime that's busy; the process exits right after
  // Not kept warm: the next start loads edited code (and Python modules) fresh. A paperboatd before
  // paperboat#66 ignores `stop` and keeps it warm for its idle timeout.
  if (state_->control >= 0 && state_->lease.contains("id")) {
    try {
      state_->control_call("release", {{"lease", state_->lease["id"]}, {"stop", true}}, 15s);
    } catch (...) {
    }
  }
  state_->close_all();
}

RemoteRuntime::Instance RemoteRuntime::make(const std::string& type, const json& params) {
  std::lock_guard lock(state_->mutex);
  const json args = {{"type", type}, {"params", params}};
  if (state_->sock < 0) state_->start();  // it stopped: start it again for this run
  json made;
  try {
    made = state_->request("new", args, nullptr);
  } catch (const RemoteError&) {
    throw;
  } catch (const std::runtime_error&) {
    if (state_->sock >= 0) throw;
    std::cerr << "the " << state_->runtime << " runtime had stopped: starting it again" << std::endl;
    state_->start();  // it died since the last run (a crash, an OOM kill)
    made = state_->request("new", args, nullptr);
  }
  return {made.value("instance", 0), state_->generation};
}

json RemoteRuntime::call(const Instance& instance, std::string_view method, json args, const tk::Context* ctx) {
  std::lock_guard lock(state_->mutex);
  if (instance.generation != state_->generation) throw std::runtime_error("the " + state_->runtime + " runtime restarted; run again");
  return state_->request("call", {{"instance", instance.id}, {"method", std::string(method)}, {"args", std::move(args)}}, ctx);
}

void RemoteRuntime::drop(const Instance& instance) noexcept {
  std::lock_guard lock(state_->mutex);
  if (instance.generation != state_->generation || state_->sock < 0) return;
  try {
    state_->request("drop", {{"instance", instance.id}}, nullptr);
  } catch (...) {
  }
}

#else  // _WIN32: no runtimes yet (pb#438 phase 8)

struct RemoteRuntime::State {};
RemoteRuntime::RemoteRuntime(std::string, fs::path, std::string) : state_(nullptr) {
  throw std::runtime_error("Julia and Python stations need Linux or macOS for now");
}
RemoteRuntime::~RemoteRuntime() = default;
void RemoteRuntime::end() noexcept {}
RemoteRuntime::Instance RemoteRuntime::make(const std::string&, const json&) { return {}; }
json RemoteRuntime::call(const Instance&, std::string_view, json, const tk::Context*) { return {}; }
void RemoteRuntime::drop(const Instance&) noexcept {}

#endif

// --- the adapters --------------------------------------------------------------------------

namespace {

// One instance in the runtime: dropped with its adapter. Optional methods the type lacks are
// remembered, so a block that draws nothing costs one call per run, not one per frame.
class Remote {
 public:
  Remote(RemoteRuntime& runtime, RemoteRuntime::Instance instance, std::string name)
      : runtime_(runtime), instance_(instance), name_(std::move(name)) {}
  ~Remote() { runtime_.drop(instance_); }
  Remote(const Remote&) = delete;
  Remote& operator=(const Remote&) = delete;

  json call(std::string_view method, json args, const tk::Context* ctx = nullptr) const {
    try {
      return runtime_.call(instance_, method, std::move(args), ctx);
    } catch (const RemoteError& e) {
      if (!absent(e, method)) e.print(name_);
      throw;
    }
  }
  // nullopt when the type has no such method.
  std::optional<json> maybe(std::string_view method, json args, const tk::Context* ctx = nullptr) const {
    {
      std::lock_guard lock(mutex_);
      if (absent_.contains(std::string(method))) return std::nullopt;
    }
    try {
      return call(method, std::move(args), ctx);
    } catch (const RemoteError& e) {
      if (!absent(e, method)) throw;
      std::lock_guard lock(mutex_);
      absent_.insert(std::string(method));
      return std::nullopt;
    }
  }

 private:
  RemoteRuntime& runtime_;
  RemoteRuntime::Instance instance_;
  std::string name_;  // its type, for its tracebacks
  mutable std::mutex mutex_;
  mutable std::set<std::string, std::less<>> absent_;
};

// A signal block: step(ctx, inputs) -> {port: value}; current() without feedthrough; entities().
class RemoteBlock final : public tk::Block {
 public:
  RemoteBlock(RemoteRuntime& runtime, RemoteRuntime::Instance instance, std::string name, bool feedthrough)
      : remote_(runtime, instance, std::move(name)), feedthrough_(feedthrough) {}
  tk::Values step(const tk::Context& ctx, const tk::Values& in) override {
    return values_from_json(remote_.call("step", json::array({context_json(ctx), values_json(in)}), &ctx));
  }
  tk::Values outputs() const override {
    return feedthrough_ ? tk::Values{} : values_from_json(remote_.call("current", json::array()));
  }
  bool feedthrough() const override { return feedthrough_; }
  std::vector<tk::Entity> entities() const override {
    return entities_from_json(remote_.maybe("entities", json::array()).value_or(json()));
  }

 private:
  Remote remote_;
  bool feedthrough_;
};

// A block on a Step flow's path: enter(ctx, inputs), tick(ctx, inputs) -> the port to leave by ("" stays).
class RemoteStep final : public tk::Step {
 public:
  RemoteStep(RemoteRuntime& runtime, RemoteRuntime::Instance instance, std::string name)
      : remote_(runtime, instance, std::move(name)) {}
  tk::Values outputs() const override { return values_from_json(remote_.maybe("outputs", json::array()).value_or(json())); }
  void enter(const tk::Context& ctx, const tk::Values& in) override {
    remote_.maybe("enter", json::array({context_json(ctx), values_json(in)}), &ctx);
  }
  std::string tick(const tk::Context& ctx, const tk::Values& in) override {
    const json port = remote_.call("tick", json::array({context_json(ctx), values_json(in)}), &ctx);
    return port.is_string() ? port.get<std::string>() : "";
  }
  bool may_start() const override { return flag("may_start"); }
  bool ends_run() const override { return flag("ends_run"); }
  bool restarts() const override { return flag("restarts"); }
  bool shared() const override { return flag("shared"); }

 private:
  bool flag(std::string_view method) const {
    const json v = remote_.maybe(method, json::array()).value_or(false);
    return v.is_boolean() ? v.get<bool>() : v.is_number() && v.get<double>() != 0.0;
  }
  Remote remote_;
};

// A station object: read() -> its linked block's outputs, step(ctx, inputs), entities(id, z), link(slot, other id).
class RemoteObject final : public tk::StationObject {
 public:
  RemoteObject(RemoteRuntime& runtime, RemoteRuntime::Instance instance, std::string name)
      : remote_(runtime, instance, std::move(name)) {}
  tk::Values read() const override { return values_from_json(remote_.maybe("read", json::array()).value_or(json())); }
  void step(const tk::Context& ctx, const tk::Values& in) override {
    remote_.maybe("step", json::array({context_json(ctx), values_json(in)}), &ctx);
  }
  std::vector<tk::Entity> entities(const std::string& id, double z) const override {
    return entities_from_json(remote_.maybe("entities", json::array({id, z})).value_or(json()));
  }
  void link(std::string_view slot, tk::StationObject&) override { remote_.maybe("link", json::array({std::string(slot)})); }

 private:
  Remote remote_;
};

// A model: the engine's solver integrates derivatives(t, x, inputs) -> dx from initial(); read(x) -> outputs.
class RemoteModel final : public tk::Model {
 public:
  RemoteModel(std::unique_ptr<Remote> remote, tk::solve::State initial, std::string_view solver)
      : tk::Model(std::move(initial), solver), remote_(std::move(remote)) {}
  tk::Values read() const override { return values_from_json(remote_->maybe("read", json::array({x()})).value_or(json())); }
  tk::solve::State derivatives(double t, const tk::solve::State& x, const tk::Values& in) const override {
    return remote_->call("derivatives", json::array({t, x, values_json(in)})).get<tk::solve::State>();
  }
  std::vector<tk::Entity> entities(const std::string& id, double z) const override {
    return entities_from_json(remote_->maybe("entities", json::array({id, z, x()})).value_or(json()));
  }

 private:
  std::unique_ptr<Remote> remote_;
};

std::string read_text(const fs::path& path) {
  std::ifstream in(path);
  if (!in) throw std::runtime_error("cannot read " + path.string());
  std::stringstream text;
  text << in.rdbuf();
  return text.str();
}

}  // namespace

void RemoteRuntime::register_types(tk::Registry& registry, const std::string& package) {
  for (const auto& item : types_) {
    const std::string name = item.value("name", "");
    const Def definition = item.value("definition", Def::object());
    const std::string base = definition.value("base", "block");
    if (base == "object" || base == "model") {
      tk::StationTemplate t;
      t.def = remote_object_def(name, definition);
      t.name = package + "/" + name;
      const auto props = t.def.props;
      if (base == "model") {
        const std::string fallback = definition.value("solver", "auto");
        t.make = [this, name, props, fallback](const tk::Values& values) -> std::unique_ptr<tk::StationObject> {
          auto remote = std::make_unique<Remote>(*this, make(name, instance_params(props, values, {})), name);
          const json initial = remote->call("initial", json::array());
          return std::make_unique<RemoteModel>(std::move(remote), initial.get<tk::solve::State>(), tk::get_text(values, "solver", fallback));
        };
      } else {
        t.make = [this, name, props](const tk::Values& values) -> std::unique_ptr<tk::StationObject> {
          return std::make_unique<RemoteObject>(*this, make(name, instance_params(props, values, {})), name);
        };
      }
      registry.add(std::move(t));
      continue;
    }
    if (base != "block" && base != "step") throw std::invalid_argument(name + ": base is block, step, object or model, not " + base);
    tk::Template t;
    t.def = remote_block_def(name, definition);
    t.name = package + "/" + name;
    const auto params = t.def.params;
    if (base == "step") {
      t.make_step = [this, name, params](const tk::Values& values, const tk::Config& config) -> std::unique_ptr<tk::Step> {
        return std::make_unique<RemoteStep>(*this, make(name, instance_params(params, values, config)), name);
      };
    } else {
      const bool feedthrough = t.def.feedthrough;
      t.make = [this, name, params, feedthrough](const tk::Values& values, const tk::Config& config) -> std::unique_ptr<tk::Block> {
        return std::make_unique<RemoteBlock>(*this, make(name, instance_params(params, values, config)), name, feedthrough);
      };
    }
    registry.add(std::move(t));
  }
}

int host_remote_station(const fs::path& dir, int argc, char** argv, std::vector<std::string> process) {
  remember_args(std::move(process));
#ifndef _WIN32
  // Ctrl+C or a stop ends the runtime with the station: block the signals in every thread
  // (the server's come later and inherit the mask) and wait for them on one.
  static sigset_t signals;
  sigemptyset(&signals);
  for (const int s : {SIGINT, SIGTERM, SIGHUP}) sigaddset(&signals, s);
  pthread_sigmask(SIG_BLOCK, &signals, nullptr);
  static std::atomic<RemoteRuntime*> running{nullptr};
  std::thread([] {
    int sig = 0;
    sigwait(&signals, &sig);
    if (RemoteRuntime* r = running.load()) r->end();
    _exit(0);
  }).detach();
#endif
  std::string error;
  const StationManifest manifest = StationManager::load_manifest(dir, &error);
  if (!error.empty() || !manifest.has_manifest) {
    std::cerr << "error: " << (error.empty() ? "no station.toml in " + dir.string() : error) << '\n';
    return 1;
  }
  if (manifest.language != "julia" && manifest.language != "python") {
    std::cerr << "error: " << dir.string() << " is a " << manifest.language << " station, not a Julia or Python one\n";
    return 1;
  }
  try {
    const fs::path descriptor = dir / manifest.descriptor;
    const std::string domain = tk::descriptor_domain(read_text(descriptor));
    if (domain.empty()) throw std::runtime_error(descriptor.string() + ": needs a `domain`, the package its types join");
    RemoteRuntime runtime(manifest.language, dir, manifest.run);
#ifndef _WIN32
    running = &runtime;
#endif
    static tk::Registry registry = tk::builtins();
    for (const auto& p : tk::load_plugins(registry))  // installed toolkits, as the scratchpad loads them
      if (!p.ok) std::cerr << "toolkit " << p.name << " not loaded: " << p.message << " (" << p.path.string() << ")\n";
    runtime.register_types(registry, domain);
    static tk::Catalog catalog;
    catalog = tk::load_descriptor_file(descriptor, registry);
    Station station{.engine = manifest.name.empty() ? domain : manifest.name, .catalog = &catalog};
    if (!manifest.solver.empty()) station.run.solver = manifest.solver;
    // The run's length and step: what a C++ station sets in code, station.toml [run] here.
    const toml::table doc = toml::parse_file((dir / "station.toml").string());
    station.run.duration = doc["run"]["duration"].value_or(station.run.duration);
    station.run.dt = doc["run"]["dt"].value_or(station.run.dt);
    station.run.emit_every = std::max<int>(1, doc["run"]["emit_every"].value_or(station.run.emit_every));
    station.run.speed = doc["run"]["speed"].value_or(station.run.speed);
    if (doc["run"]["mode"].value_or(std::string("clock")) == "once") station.run.mode = RunSettings::Mode::Once;
    if (const auto* view = doc["view"].as_table()) {  // the scene's camera hint, as a C++ station's Station::view
      std::stringstream text;
      text << toml::json_formatter{*view};
      station.view = json::parse(text.str());
    }
    const int code = main(station, argc, argv, manifest.port);
#ifndef _WIN32
    running = nullptr;
#endif
    return code;
  } catch (const std::exception& e) {
    std::cerr << "error: " << e.what() << '\n';
    return 1;
  }
}

}  // namespace paperboat::core
