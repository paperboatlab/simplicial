#pragma once

#include <cstdint>
#include <filesystem>
#include <functional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace paperboat::toolkit {
class Registry;
}

namespace paperboat::core {

struct RunningStation {
  int port = 0;
  int pid = 0;
  std::string engine;
  std::string domain;
  std::filesystem::path cwd;
  std::filesystem::path station_dir;
  std::string executable;
  std::string ws_url;
  int64_t started_at = 0;
};

// A station on its way up (pb#332), from `paperboat start/run` until it serves: what a wait screen
// shows instead of scraping logs. The stage words are the contract.
struct StartingStation {
  std::string name;
  std::filesystem::path dir;
  int port = 0;
  int pid = 0;  // the paperboat process starting it
  std::string state;  // "building", "starting" or "failed"
  std::string stage;  // "prepare", "configure", "compile" (building), "waiting" (starting: launched, not answering yet)
  int64_t started_at_ms = 0;
  int64_t updated_at_ms = 0;
  std::string error;  // when failed
};

struct StationRunOptions {
  int port = 0;  // 0: default for station or 51301
  bool build = true;
  bool clean = false;
  bool time_metrics = false;
  bool verbose = false;
  std::vector<std::pair<std::string, std::string>> vars;
  std::string psf_file = "";
  bool run = false;
  std::string record = "";  // --record <dir>: keep a run record there (#277)
  std::string command = "";  // the command line, as the record names it
};

enum class StationKind {
  Cpp,
  Python,
  Julia,
  Unknown
};

struct StationManifest {
  int format = 0;
  std::string name;
  std::string version = "0.1.0";
  std::string engine = ">=0.1";
  std::string language;  // "cpp" or "python"
  std::string run;       // path to binary or script relative to station root
  int port = 51301;
  std::string descriptor = "descriptor.toml";
  std::vector<std::string> toolkits;
  std::string golden;    // from [test].golden
  std::string solver;    // default solver: "rk4", "rk45", "rk2", "euler", "discrete", "cvode", "ida"
  // [run] solver and [run.solver_options] as graph.run settings JSON ("" if neither); the
  // station gets it as PAPERBOAT_RUN and announces it in hello.run.
  std::string run_settings;
  bool has_manifest = false;
};

struct CheckStep {
  std::string name;       // "manifest", "catalog", "smoke", "golden"
  bool ok = false;
  bool skipped = false;
  std::string message;
  double duration_seconds = 0.0;
};

struct CheckResult {
  bool ok = false;
  std::string name;
  std::string version = "0.1.0";
  std::string language;
  std::string domain;
  std::string engine;
  std::string solver;
  std::vector<std::string> errors;
  std::vector<std::string> warnings;
  std::vector<std::string> imported_packages;
  std::vector<std::string> missing_toolkits;
  int block_count = 0;
  int object_count = 0;
  bool has_starter_graph = false;
  bool has_starter_station = false;
  std::vector<CheckStep> steps;
  bool manifest_ok = false;
  bool catalog_ok = false;
  bool smoke_ok = false;
  bool golden_ok = false;
};

// Called when a check stage starts (`done` false) and when it ends (`done` true).
using CheckProgress = std::function<void(const CheckStep& step, bool done)>;
// Called per file packed or extracted: files done, files in all, bytes so far.
using PackProgress = std::function<void(int files, int total, uint64_t bytes)>;

struct PackResult {
  bool ok = false;
  std::filesystem::path package_path;
  std::string name;
  std::string version;
  int file_count = 0;
  uint64_t total_bytes = 0;
  std::string sha256;
  // The dependencies: "" (none declared), "lockfile" (the lockfile only) or "bundled" (wheels/ or
  // .julia/ too, `--bundle-deps`).
  std::string deps;
  std::vector<std::string> errors;
};

struct UnpackResult {
  bool ok = false;
  std::filesystem::path destination_dir;
  std::string name;
  std::string version;
  int file_count = 0;
  std::vector<std::string> errors;
};

class StationManager {
 public:
  // Port inspection & cleanup
  static bool is_port_listening(int port);
  static int find_pid_by_port(int port);
  static bool free_port(int port, int timeout_ms = 2000);
  static bool stop_user_service(const std::string& unit_name);

  // Runtime registry (/tmp/paperboat-runtime/station-<port>.json)
  static std::filesystem::path runtime_dir();
  static std::filesystem::path runtime_record_path(int port);
  static void register_running_station(const RunningStation& station);
  static void unregister_running_station(int port);
  static std::vector<RunningStation> list_running_stations();
  // Stations being started (runtime_dir()/starting-<pid>.json), dead or stale ones pruned: a record
  // whose process is gone, or a failed one older than a minute.
  static std::filesystem::path start_record_path(int pid);
  static void write_start_record(StartingStation& station);  // stamps updated_at_ms
  static void remove_start_record(int pid);
  static std::vector<StartingStation> list_starting_stations();
  // `paperboat status --json` and the web host's /__paperboat/status: every station starting or
  // running, `{ "stations": [{ name, state, stage?, elapsed, port, url?, error? }] }`. `filter`: a
  // name or port; empty, all.
  static std::string status_json(std::string_view filter = {});

  // Incremental build for C++ stations
  static bool needs_rebuild(const std::filesystem::path& station_dir,
                            const std::filesystem::path& build_dir = {});
  static bool ensure_built(const std::filesystem::path& station_dir,
                           bool clean = false,
                           bool verbose = false,
                           std::string* error_msg = nullptr,
                           double* elapsed_seconds = nullptr,
                           const std::function<void(std::string_view stage)>& on_stage = {});
  // A checkout's built scratchpad (engine/build/scratchpad/paperboat-scratchpad, or under Release/ etc.
  // with a multi-config generator, .exe on Windows), or the sibling prebuilt binary next to the
  // running executable in an installed prefix; empty when neither exists.
  static std::filesystem::path scratchpad_binary(const std::filesystem::path& root);

  // Python environment resolution & C++ binding builder
  struct PythonEnv {
    std::filesystem::path python_bin;
    std::vector<std::pair<std::string, std::string>> env;
  };
  // The interpreter is the station's .venv, $PAPERBOAT_PYTHON, the checkout's .venv, else python3.
  static PythonEnv prepare_python_env(const std::filesystem::path& repo_root = {},
                                     const std::filesystem::path& station_dir = {});
  // A Julia station's environment: its own project, depot and load path, whatever the host sets (#322).
  static std::vector<std::pair<std::string, std::string>> julia_env(const std::filesystem::path& dir);
  // The folder that holds the `paperboat` Python package, put on PYTHONPATH (pb#223): a checkout's
  // python/, else an installed package's <prefix>/lib/paperboat/python; empty if neither.
  static std::filesystem::path python_package_dir(const std::filesystem::path& root);

  // Station kind and directory resolution
  static StationKind detect_station_kind(const std::filesystem::path& path);
  static std::filesystem::path user_stations_dir();
  static std::filesystem::path resolve_station_dir(const std::filesystem::path& path_or_domain = {});

  // Lifecycle execution
  static int run_station(const std::filesystem::path& path_or_domain = {},
                         const StationRunOptions& opts = {});
  static bool stop_station(const std::string& target, bool all = false);
  static bool restart_station(const std::string& target, const StationRunOptions& opts = {});

  // The examples an optional toolkit ships (ocv-01-…, opt-01-…: not Paperboat's examples, which `paperboat example`
  // lists and copies): engine/toolkit/<name>/examples/*, and a sibling simplicial-toolkit-<name>/examples/*. Sorted.
  static std::vector<std::filesystem::path> toolkit_examples(const std::filesystem::path& repo_root = {});

  // Web application management
  static bool start_app(int port = 30471, const std::string& host = "0.0.0.0", bool daemon = false,
                        const std::filesystem::path& folder = {});
  static bool stop_app(int port = 30471);
  static bool restart_app(int port = 30471, const std::string& host = "0.0.0.0");
  static bool build_app();

  // Verification & checking
  static StationManifest load_manifest(const std::filesystem::path& station_dir, std::string* error_msg = nullptr);
  static int find_free_port(int start_port = 18765, int end_port = 18999);
  // Optional toolkit packages compiled into this binary (opencv, optimization): the CLI sets
  // this before check_station, so a descriptor that imports one is validated statically.
  static void set_registry_extension(std::function<void(toolkit::Registry&)> extension);
  static CheckResult check_station(const std::filesystem::path& path = {}, bool fast = false,
                                   const CheckProgress& progress = {});

  // Packaging & unpack
  static PackResult pack_station(const std::filesystem::path& path = {},
                                 const std::filesystem::path& out_path = {},
                                 bool fast = true,
                                 const PackProgress& progress = {},
                                 bool bundle_deps = false);
  static UnpackResult unpack_station(const std::filesystem::path& archive_path,
                                     const std::filesystem::path& dest_dir = {},
                                     bool verify = true,
                                     const PackProgress& progress = {});
};

}  // namespace paperboat::core
