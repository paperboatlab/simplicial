#include <atomic>
#include <chrono>
#include <condition_variable>
#include <fstream>
#include <map>
#include <mutex>
#include <optional>
#include <thread>

#include "paperboat/core/server.hpp"
#include "paperboat/core/station_manager.hpp"
#include "paperboat/core/cache.hpp"
#include "paperboat/core/record.hpp"

#include <paperboat/toolkit/installer.hpp>
#include <paperboat/toolkit/platform.hpp>
#include <paperboat/toolkit/variables.hpp>

#ifndef PAPERBOAT_VERSION  // set by engine/core/CMakeLists.txt from the project version
#define PAPERBOAT_VERSION "0.0.0-dev"
#endif

namespace paperboat::core {

struct Session::State {
  State(const Station& b, Send s, Session::Remote r, Session::Live l)
      : spec(b),
        send(std::move(s)),
        remote(std::move(r)),
        live(std::move(l)),
        station(!b.initial_psf.is_null() && b.initial_psf.contains("station")
                    ? b.initial_psf["station"]
                    : (b.catalog->station.empty() ? json() : json::parse(b.catalog->station))),
        variables(!b.initial_psf.is_null() && b.initial_psf.contains("variables")
                      ? b.initial_psf["variables"]
                      : (b.catalog->variables.empty() ? json::array() : json::parse(b.catalog->variables))) {}

  const Station& spec;
  Send send;
  Session::Remote remote;  // variables.set from a live client (Julix): the server shares them
  Session::Live live;      // what the live client last sent, as the server keeps it
  // The flow's variables and, under the names it doesn't use, the live client's (never while holding `mutex`:
  // the server's lock is taken).
  json with_live(const json& own) const { return toolkit::with_live(own, live ? live() : json::array()); }
  std::mutex mutex;  // guards keys, station and variables: the socket thread writes, the run thread reads
  toolkit::KeySet keys;
  toolkit::KeySet pressed;  // pressed since the run last read the keys: a short tap still shows for one pass
  json station;
  json variables;  // the list (#36): the station's defaults until the UI sets its own
  std::optional<json> tuned;  // the list the UI sent during a run (#75), until the run takes it
  std::optional<double> speed;  // the speed the UI asked for during a run (run.speed, #219), until the run takes it
  int runs = 0;
  std::atomic<int> live_run{0};  // the number of the run that is going, else 0
  std::atomic<bool> closed{false};  // the socket closed: sends are dropped
  RunCache cache;  // what runs that evaluate once keep for the next run of this session
  std::mutex toolkit_mutex;
  std::string busy_toolkit;
  std::string busy_action;
  std::jthread toolkit_task;

  // Samples go out in batches (pb, signals): one `signals` message per 30 ms holds every sample
  // taken in that time, instead of a message each (a run as fast as it can sent ~19,000 a second
  // and the page could not keep up). Slower samples go out one by one, as they come. What a pass
  // also sends as state rides along: the newest run.progress, and the scene.patch entities merged
  // by id. Anything else sends the batch first, so the order holds. The flusher sends a batch
  // that a pause left.
  static constexpr auto kBatch = std::chrono::milliseconds(30);
  std::mutex out;  // the batch, and the order of what goes out
  std::vector<json> batch;
  std::optional<json> progress;      // the newest run.progress of the batch
  json patched = json::array();      // the batch's scene.patch entities, merged by id
  std::map<std::string, std::size_t> patched_at;
  std::chrono::steady_clock::time_point batch_since;
  std::atomic<std::thread::id> sender{};  // the thread inside send(): its close can't tear this down
  /** Marks this thread as the sender while `out` is held. */
  struct Sending {
    std::atomic<std::thread::id>& who;
    explicit Sending(std::atomic<std::thread::id>& w) : who(w) { who = std::this_thread::get_id(); }
    ~Sending() { who = std::thread::id{}; }
  };
  std::condition_variable_any wake;
  std::jthread flusher{[this](std::stop_token stop) {
    std::unique_lock lock(out);
    while (!stop.stop_requested()) {
      wake.wait_for(lock, stop, kBatch, [] { return false; });
      if (pending() && std::chrono::steady_clock::now() - batch_since >= kBatch) {
        Sending mark(sender);
        flush();
      }
    }
  }};
  std::jthread run;  // declared last: destroyed (stopped and joined) before the rest

  ~State() {
    // Stop every thread that sends, then wait out a send still in flight on another thread (a
    // close found by it deferred this teardown), before the batch and its mutex go.
    run = {};
    toolkit_task = {};
    flusher = {};
    std::lock_guard lock(out);
  }

  /** Send what the batch holds: one sample as itself, more as one `signals` (call with `out` held). */
  bool pending() const { return !batch.empty() || progress || !patched.empty(); }
  void flush() {
    if (!batch.empty() && !closed) send(batch.size() == 1 ? batch.front().dump() : json{{"type", "signals"}, {"list", std::move(batch)}}.dump());
    batch.clear();
    if (!patched.empty() && !closed) send(json{{"type", "scene.patch"}, {"entities", std::move(patched)}}.dump());
    patched = json::array();
    patched_at.clear();
    if (progress && !closed) send(progress->dump());
    progress.reset();
  }
  void emit(const json& msg) {
    if (closed) return;
    std::lock_guard lock(out);
    Sending mark(sender);
    const std::string type = msg.is_object() ? msg.value("type", "") : "";
    if (type == "signal" || type == "run.progress" || type == "scene.patch") {
      const auto now = std::chrono::steady_clock::now();
      if (!pending()) batch_since = now;
      if (type == "signal") {
        batch.push_back(msg);
      } else if (type == "run.progress") {
        progress = msg;
      } else {
        for (const auto& entity : msg.value("entities", json::array())) {
          const std::string id = entity.value("id", "");
          if (auto at = patched_at.find(id); at != patched_at.end()) {
            patched[at->second].update(entity);  // later fields win
          } else {
            patched_at[id] = patched.size();
            patched.push_back(entity);
          }
        }
      }
      if (now - batch_since >= kBatch) flush();
      return;
    }
    flush();
    send(msg.dump());
  }
  void log(const std::string& level, const std::string& text) {
    emit({{"type", "log"}, {"level", level}, {"text", text}});
  }
  // The build this station runs from: the nearest folder above its executable with a CMakeCache.txt,
  // found at run time (no build-machine path is compiled in, pb#177).
  toolkit::HostBuild host_build() const {
    std::error_code ec;
    for (auto dir = platform::exe_path().parent_path(); !dir.empty(); dir = dir.parent_path()) {
      if (std::filesystem::is_regular_file(dir / "CMakeCache.txt", ec)) return {.source_dir = {}, .build_dir = dir};
      if (dir == dir.parent_path()) break;
    }
    return {};
  }
  std::filesystem::path repo_root() const { return toolkit::find_repo_root(spec.catalog->dir); }
  json current_toolkits(std::string_view busy_name = {}, std::string_view busy_state = {}, bool fetch_versions = false) {
    std::string bname(busy_name);
    std::string bstate(busy_state);
    if (bname.empty()) {
      std::lock_guard lock(toolkit_mutex);
      bname = busy_toolkit;
      bstate = busy_action;
    }
    const auto list = toolkit::list_toolkits(repo_root(), spec.catalog->dir, fetch_versions);
    return json::parse(toolkit::toolkits_json(list, bname, bstate));
  }
  void emit_toolkits(std::string_view busy_name = {}, std::string_view busy_state = {}, bool fetch_versions = false) {
    emit({{"type", "toolkits.status"}, {"toolkits", current_toolkits(busy_name, busy_state, fetch_versions)}});
  }
  // The station as it shows: its objects made with their references resolved. Throws
  // VariableError, GraphError or json::exception.
  // `report`: also send what the variables come to (variables.values), for the UI.
  void show(const json& with_station, const json& with_variables, bool report = false) {
    const toolkit::Variables vars(with_live(with_variables));
    if (report) emit({{"type", "variables.values"}, {"values", vars.values()}});
    const auto objects = make_station(toolkit::resolve_station(with_station, *spec.catalog, vars), *spec.catalog);
    const auto state = spec.state ? spec.state() : nullptr;
    emit(scene_message(objects, state.get(), spec.view));
  }
};

Session::Session(const Station& station, Send send, Remote remote, Live live)
    : state_(std::make_unique<State>(station, std::move(send), std::move(remote), std::move(live))) {
  auto& s = *state_;
  const auto& catalog = *station.catalog;
  json station_view = {{"view", catalog.station_view}};
  if (!catalog.station_page.empty()) station_view["page"] = "/" + catalog.station_page;  // on this port, over HTTP
  if (!catalog.station_visible) station_view["visible"] = false;
  if (catalog.station_view == "scene") station_view["orientation"] = catalog.station_orientation;
  json hello = {{"type", "hello"},
                {"protocol", "paperboat/0"},
                {"engine", station.engine},
                {"version", PAPERBOAT_VERSION},
                {"station", station_view},
                {"run", settings_json(station.run)},
                {"flows", catalog.flows}};  // the flow types a sheet may be (#9)
  const json toolkits = s.current_toolkits(/*busy_name=*/{}, /*busy_state=*/{}, /*fetch_versions=*/true);
  if (!toolkits.empty()) hello["toolkits"] = toolkits;
  s.emit(hello);
  s.emit(json::parse(toolkit::catalog_message(catalog)));
  try {
    s.show(s.station, s.variables, !s.variables.empty());  // checked at load: the starters resolve against the defaults
  } catch (const std::exception& err) {
    if (catalog.missing_imports.empty()) {
      s.log("error", std::string("cannot show station: ") + err.what());
    }
  }
  if (!s.variables.empty()) s.emit({{"type", "variables.load"}, {"variables", s.variables}});
  s.emit({{"type", "graph.load"}, {"graph", json::parse(catalog.graph)}});
  if (!s.station.is_null()) s.emit({{"type", "station.load"}, {"station", s.station}});
  if (!station.initial_psf.is_null() && station.initial_psf.is_object()) {
    s.emit({{"type", "psf.load"},
            {"name", station.initial_psf_name},
            {"psf", station.initial_psf}});
  }
}

void Session::send_message(const json& message) { state_->emit(message); }

bool Session::on_own_thread() const {
  const auto me = std::this_thread::get_id();
  return state_->run.get_id() == me || state_->toolkit_task.get_id() == me || state_->flusher.get_id() == me || state_->sender == me;
}

void Session::close() { state_->closed = true; }

Session::~Session() = default;

void Session::on_message(const std::string& text) {
  auto& s = *state_;
  const json msg = json::parse(text, nullptr, /*allow_exceptions=*/false);
  const std::string type = msg.is_object() ? msg.value("type", "") : "";
  if (type == "graph.run") {
    if (!s.spec.catalog->missing_imports.empty()) {
      std::string missing;
      for (const auto& m : s.spec.catalog->missing_imports) missing += (missing.empty() ? "" : ", ") + m;
      s.log("error", "Cannot run: missing required toolkits (" + missing + "). Please install them first.");
      s.emit({{"type", "run.finished"}, {"run", "run-" + std::to_string(s.runs + 1)}, {"status", "failed"}});
      return;
    }
    json station, variables;
    {
      std::lock_guard lock(s.mutex);
      if (msg.contains("station")) s.station = msg.at("station");
      if (msg.contains("variables")) s.variables = msg.at("variables");
      station = s.station;
      variables = s.variables;
      s.pressed.clear();  // presses from before this run don't count
      s.tuned.reset();    // nor changes to the variables from before it
      s.speed.reset();    // nor a speed asked of an earlier run
    }
    variables = s.with_live(variables);  // the run takes Julix's values as they are now
    const int number = ++s.runs;
    const std::string id = "run-" + std::to_string(number);
    auto tune_now = [&s]() -> std::optional<json> {
      std::optional<json> tuned;
      {
        std::lock_guard lock(s.mutex);
        tuned = std::exchange(s.tuned, std::nullopt);
      }
      if (tuned) tuned = s.with_live(*tuned);
      return tuned;
    };
    auto speed_now = [&s]() -> std::optional<double> {
      std::lock_guard lock(s.mutex);
      return std::exchange(s.speed, std::nullopt);
    };
    s.live_run = number;
    auto keys_now = [&s] {
      std::lock_guard lock(s.mutex);
      auto down = s.keys;
      down.merge(s.pressed);
      s.pressed.clear();
      return down;
    };
    // Stop and join the previous run before starting this one. A new jthread starts as soon as it
    // is constructed, while the old one may still be emitting or pruning the cache.
    if (s.run.joinable()) {
      s.run.request_stop();
      s.run.join();
    }
    // A record of this run (#277), when the CLI asked for one.
    std::optional<RunRecord> record;
    if (auto meta = record_meta_from_env()) {
      json tools = json::array();
      try {
        tools = s.current_toolkits();
      } catch (...) {
        // the record is still worth keeping without the toolkit list
      }
      json request = {{"graph", msg.value("graph", json::object())},
                      {"variables", variables},
                      {"settings", msg.value("settings", json::object())}};
      if (!station.is_null()) request["station"] = station;
      try {  // what the run goes with: the station's defaults, and graph.run's overrides
        request["settings"] = settings_json(with_overrides(s.spec.run, msg.value("settings", json())));
      } catch (...) {
        // an invalid setting fails the run; the record still says what was asked
      }
      record.emplace(std::move(*meta), s.spec.engine, std::move(request), std::move(tools));
    }
    s.run = std::jthread([&s, id, number, graph = msg.value("graph", json::object()), station, variables, keys_now, tune_now,
                          speed_now, settings = msg.value("settings", json()), record = std::move(record)](std::stop_token stop) mutable {
      auto emit = [&s, number, &record](const json& m) {
        if (m.value("type", "") == "variables.patch") {  // a block set variables (#166): later runs start from them
          std::lock_guard lock(s.mutex);
          for (json* list : {&s.variables, s.tuned ? &*s.tuned : nullptr}) {
            if (!list || !list->is_array()) continue;
            for (auto& v : *list)
              if (const auto it = m.at("values").find(v.value("name", std::string{})); it != m.at("values").end() && !v.contains("expr")) v["value"] = *it;
          }
        }
        if (record) {
          try {
            record->add(m);
          } catch (const std::exception& err) {
            s.log("error", std::string("cannot write run record: ") + err.what());
            record.reset();  // one error, not one per message
          }
        }
        if (m.value("type", "") == "run.finished") {  // before the UI hears it: its next edit is not a tuning
          int mine = number;
          s.live_run.compare_exchange_strong(mine, 0);  // not if a newer run has started meanwhile
        }
        s.emit(m);
      };
      core::run(id, graph, station, s.spec, emit, keys_now, stop, settings, variables, tune_now, speed_now, &s.cache);
    });
  } else if (type == "station.set") {
    // An edit on the Station page: check it, keep it, and show it.
    try {
      const json station = msg.at("station");
      json variables;
      {
        std::lock_guard lock(s.mutex);
        variables = s.variables;
      }
      s.show(station, variables);
      std::lock_guard lock(s.mutex);
      s.station = station;
    } catch (const std::exception& err) {
      s.log("error", std::string("invalid station: ") + err.what());
    }
  } else if (type == "variables.set") {
    // Another client's live variables (Julix; Squero MX before it): share them through the server, not
    // this session's flow. They are read-only in the Variables card.
    if (const std::string source = msg.value("source", ""); !source.empty()) {
      if (state_->remote) state_->remote(msg.value("variables", json::array()), source);
      return;
    }
    // The variables changed (#36): check them, keep them, and show the station they shape.
    try {
      const json variables = msg.at("variables");
      if (s.live_run != 0) {
        // During a run (#75): the run owns the scene, so it isn't shown again. Keep the list for
        // the next run and hand it to this one, which takes the tunable variables' values.
        s.emit({{"type", "variables.values"}, {"values", toolkit::Variables(s.with_live(variables)).values()}});
        std::lock_guard lock(s.mutex);
        s.variables = variables;
        s.tuned = variables;
        return;
      }
      json station;
      {
        std::lock_guard lock(s.mutex);
        station = s.station;
      }
      s.show(station, variables, true);
      std::lock_guard lock(s.mutex);
      s.variables = variables;
    } catch (const toolkit::VariableError& err) {
      s.emit({{"type", "variables.values"}, {"values", json::object()}, {"error", err.what()}, {"at", err.where}});
      s.log("error", std::string("invalid variables: ") + err.what());
    } catch (const std::exception& err) {
      s.log("error", std::string("invalid variables: ") + err.what());
    }
  } else if (type == "analysis.request") {
    // Linear algebra on a handful of blocks: answered here, between socket messages.
    // ponytail: on the socket thread; a worker per request if an analysis gets slow.
    json station, variables;
    {
      std::lock_guard lock(s.mutex);
      station = s.station;
      variables = s.variables;
    }
    s.emit(analyse(msg, s.spec, station, s.with_live(variables)));
  } else if (type == "run.cancel") {
    s.run.request_stop();
  } else if (type == "run.speed") {
    // The speed changed during a run (#219): the run takes it at its next frame and answers with
    // a run.speed of its own. Between runs there is nothing to change (the next graph.run brings
    // its speed): ignored, as a change that crossed the run's end on the wire.
    double speed = 0;
    try {
      speed = checked_speed(msg.contains("speed") ? msg.at("speed") : json());
    } catch (const std::invalid_argument& err) {
      s.log("error", std::string("run.speed: ") + err.what());
      return;
    }
    if (s.live_run == 0) return;
    std::lock_guard lock(s.mutex);
    s.speed = speed;
  } else if (type == "input") {  // read by Key and Switch blocks
    const std::string key = msg.value("key", "");
    std::lock_guard lock(s.mutex);
    if (msg.value("down", false)) {
      s.keys.insert(key);
      s.pressed.insert(key);
    } else {
      s.keys.erase(key);
    }
  } else if (type == "station.restart") {
    s.log("info", "restarting station…");
    const auto dir = s.spec.catalog ? s.spec.catalog->dir : std::filesystem::path{};
    std::thread([dir] {
      std::this_thread::sleep_for(std::chrono::milliseconds(50));
      if (!dir.empty() && std::filesystem::is_regular_file(dir / "CMakeLists.txt")) {
        std::string err;
        StationManager::ensure_built(dir, false, false, &err);
      }
      restart_process();
    }).detach();
  } else if (type == "toolkit.install" || type == "toolkit.uninstall") {
    const std::string name = msg.value("name", "");
    const std::string version = msg.value("version", "");
    if (name.empty()) {
      s.log("error", type + ": toolkit name is required");
      return;
    }
    const std::string busy = type == "toolkit.install" ? "installing" : "uninstalling";
    {
      std::lock_guard lock(s.toolkit_mutex);
      s.busy_toolkit = name;
      s.busy_action = busy;
    }
    s.toolkit_task = std::jthread([&s, type, name, version, busy]() {
      s.emit_toolkits();
      auto logger = [&s](std::string_view level, std::string_view line) {
        s.log(std::string(level), std::string(line));
      };
      toolkit::ToolkitResult res;
      if (type == "toolkit.install") res = toolkit::install_toolkit(name, version, s.repo_root(), s.host_build(), logger);
      else res = toolkit::uninstall_toolkit(name, s.repo_root(), s.host_build(), logger);
      if (!res.ok) s.log("error", res.message);
      {
        std::lock_guard lock(s.toolkit_mutex);
        s.busy_toolkit.clear();
        s.busy_action.clear();
      }
      s.emit_toolkits();
    });
  } else if (type == "toolkit.versions") {
    std::thread([&s]() {
      s.emit_toolkits(/*busy_name=*/{}, /*busy_state=*/{}, /*fetch_versions=*/true);
    }).detach();
  } else {
    s.log("warn", "unknown message: " + type);
  }
}

json load_json(const std::filesystem::path& path) {
  std::ifstream in(path);
  if (!in) throw std::runtime_error("cannot open " + path.string());
  return json::parse(in);
}

int port_arg(int argc, char** argv, int fallback) {
  for (int i = 1; i + 1 < argc; ++i) {
    if (std::string(argv[i]) == "--port") return std::stoi(argv[i + 1]);
  }
  return fallback;
}

}  // namespace paperboat::core
