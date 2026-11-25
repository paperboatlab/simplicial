// The Paperboat unified CLI: build and start stations, list running stations,
// manage the web application, orchestrate examples, and install/browse toolkits.

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#include <process.h>  // _spawnvp
#else
#include <fcntl.h>
#include <unistd.h>  // execvp, dup2
#endif
#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <optional>
#include <sstream>
#include <iostream>
#include <map>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include <nlohmann/json.hpp>

#include "paperboat/core/station_manager.hpp"
#include "paperboat/core/process.hpp"
#include "paperboat/toolkit/apps.hpp"
#include "paperboat/toolkit/descriptor.hpp"
#include "paperboat/toolkit/platform.hpp"
#include "paperboat/toolkit/self.hpp"
#include "paperboat/toolkit/update.hpp"
#include "paperboat/toolkit/installer.hpp"
#include "paperboat/toolkit/plugin.hpp"
#ifdef PAPERBOAT_HAS_OPENCV
#include "paperboat/toolkit/opencv.hpp"
#endif
#if defined(PAPERBOAT_HAS_OPTIMIZATION) || defined(PAPERBOAT_HAS_OPTIMIZE_CMD)
#include "paperboat/toolkit/expression.hpp"
#include "paperboat/toolkit/optimization.hpp"
#endif
#ifdef PAPERBOAT_HAS_CONTROL
#include "paperboat/toolkit/control.hpp"
#endif
#include "paperboat_new.hpp"
#include "paperboat_tui.hpp"

namespace {

using nlohmann::json;
namespace core = paperboat::core;
namespace tk = paperboat::toolkit;
namespace tui = paperboat::tui;
namespace platform = paperboat::platform;

using Command = int (*)(const std::vector<std::string_view>&);
namespace fs = std::filesystem;

// The optional packages this build has (opencv, optimization): they are linked into the CLI
// and registered for `toolkit list` and for `check` (which cannot link them itself).
void add_optional_packages(tk::Registry& all) {
#ifdef PAPERBOAT_HAS_OPENCV
  tk::opencv::register_opencv(all);
#endif
#ifdef PAPERBOAT_HAS_OPTIMIZATION
  tk::optimization::register_optimization(all);
#endif
#ifdef PAPERBOAT_HAS_CONTROL
  tk::control::register_control(all);
#endif
  for (const auto& p : tk::load_plugins(all))  // installed toolkits, when they are plugins (pb#352)
    if (!p.ok) std::cerr << "toolkit " << p.name << " not loaded: " << p.message << " (" << p.path.string() << ")\n";
}

const tk::Registry& full_registry() {
  static const tk::Registry r = [] {
    tk::Registry all = tk::builtins();
    add_optional_packages(all);
    return all;
  }();
  return r;
}

bool launch_console(const std::vector<std::string>& args);

void print_help() {
  std::cout << R"(paperboat - Unified Paperboat command-line tool

Usage:
  paperboat <command> [arguments...]

Start and stop (Paperboat and stations):
  start [station] [options]  Without a target: Paperboat (web UI on port 3047) and,
                             in a checkout, the scratchpad station (port 8765).
                             A station (folder, name or .pst): build it and run it in the foreground.
                               --port <N>      Listen port (station 8765, web UI 3047)
                               --daemon        Run in the background (Paperboat)
                               --host <H>      The web UI's listen host (default 0.0.0.0)
                             Station only:
                               --no-build      Skip the C++ build step
                               --clean         Clean the build directory first
                               --time          Print build and startup timing
                               --verbose       Verbose build output
                               --var <key=val> Set a default variable value
                               --record <dir>  Keep the run as <dir>/record.json (#277)
  stop [target | --all]      Without a target: Paperboat. Otherwise a station (port, name or folder).
                             --all stops every running station.
  restart [target]           Restart Paperboat or a station
  list, ps [--json]          Everything running, with a KIND column: station, paperboat or squero
  status [<station|port>] [--json]
                             What each station is doing: building (prepare, configure, compile),
                             starting (launched, not answering yet), failed (and why: kept a
                             minute), running. --json is what a wait screen polls
  run [path | file.pst]      Start a station (the same options as start)

Stations:
  new <name> [--cpp | --python | --julia] [--dir <path>]
                             Scaffold a new station in ./<name> (or --dir) that passes `check` as it is:
                             a block, a starter graph and its expected.json. C++ by default;
                             a Julia one needs `paperboat deps install` first.
  stations [--json]          List the stations you can run (examples, installed)
  build [path] [--clean]     Compile a C++ station (Python and Julia ones have nothing to compile)
  rebuild [path]             Clean and compile a C++ station (build --clean)
  open <file.psf> [--run] [--port <N>] [--no-build] [--record <dir>]
                             Open a saved Station's flow (.psf) with its station (--run: headless);
                             --record keeps each run as <dir>/record.json

Paperboat Web UI:
  web start|stop|restart     The same as start, stop and restart without a target
  web build                  Run the production frontend build
  (start --daemon and web start --daemon keep it in the background; stop ends it)

Examples Orchestration:
  examples start [--dir <P>] Launch all example stations (ports 8765-8773)
  examples stop              Stop all example stations
  examples status            Show status of example stations

Toolkits:
  toolkit list [name] [--json]
                             List all toolkits, or inspect blocks/instruments of <name>
  toolkit install <name> [--repo <url> | --path <dir>] [--version <ver>]
                             Install an optional toolkit from any repo or local folder
  toolkit update <name|--all>
                             Update an installed toolkit, or every installed one
  toolkit uninstall <name>   Remove an optional toolkit
  toolkit versions <name>    Query remote versions/tags for a toolkit

Verification & Packaging:
  check [path] [--fast] [--json | --json-stream]
                             4-stage verification (manifest, catalog, smoke, golden)
  pack [path] [--out <pkg>] [--bundle-deps] [--json-stream]
                             Package station into .pst archive (lockfiles, not environments;
                             --bundle-deps adds Python wheels/ or the Julia .julia/ depot)
  unpack <pkg> [--dir <dir>] [--json-stream]
                             Unpack and verify .pst archive
                             --json-stream prints one JSON event per line as work goes
)";
#if defined(PAPERBOAT_HAS_OPTIMIZATION) || defined(PAPERBOAT_HAS_OPTIMIZE_CMD)
  std::cout << R"(
Optimization:
  optimize <problem.json> [--json] [--grid <N>]
                             Solve a fmincon-shaped problem (LP, QP or NLP) with the optimization
                             toolkit; --grid adds a 2-variable preview of the objective
)";
#endif
  std::cout << R"(
Updating:
  update [--check] [--no-build] [--channel release|beta|dev|source]
                             Update paperboat, its installed apps and toolkits, each on its channel
                             ([release] stable, beta prereleases, dev branch). --check only reports.
  use [<version> | --list] [--json]
                             List installed paperboat versions or switch the active one (installing
                             a release version if not already present).

Dependencies:
  deps install [path]        Create the station's isolated environment and install its
                             requirements (Python: .venv + requirements.txt; Julia: .julia depot +
                             Project.toml). C++ dependencies stay with CMake/toolkits.

Squero apps (from apps.toml):
  squero list [--json]            The Squero apps and libraries, installed, a sibling checkout, or not (KIND)
  squero install <name>[@<V>]     Clone a release (default: newest, else main) and build it. Deps resolve
                                  in their apps.toml range (paperboat-shared@0.1); one installed outside it
                                  fails the install, or with --force is reinstalled in range
  squero update <name|--all>      Install the newest release of an installed Squero app or dep
  squero uninstall <name>         Remove a Squero app or library
  squero versions <name>          Release versions on GitHub, prereleases too, newest first
  squero path <name>              The installed app's output folder
  squero start|stop|restart <name> [--port <N>] [--daemon]
                                  Start, stop or restart a Squero app

Paperboat CLI & Launcher:
  launcher                   Open the Paperboat Launcher desktop app (if installed)
  (no command)               Open the Paperboat CLI (apps/cli) on a terminal;
                             the basic prompt when it isn't built or PAPERBOAT_NO_CONSOLE is set
  repl                       The basic prompt
  top                        Process overview in Paperboat CLI
  commands [--json]          The command table (for completion)

General:
  version, --version         Show CLI version
  help, --help               Show this help message
)";
}

int cmd_start(const std::vector<std::string_view>& args);

namespace {

std::string quote_word(std::string_view text) {
  std::string out = "'";
  for (const char c : text) {
    if (c == '\'') out += "'\\''";
    else out += c;
  }
  out += "'";
  return out;
}

int run_deps(const std::vector<std::string>& args, const fs::path& cwd,
             const std::vector<std::pair<std::string, std::string>>& env = {}) {
  std::cout << "  $";
  for (const auto& arg : args) std::cout << " " << quote_word(arg);
  std::cout << "\n";
  // Capture rather than stream: Julia's atexit writer can race a closed pipe.
  const core::ProcessResult result = core::ProcessRunner::run_sync(args, cwd, env);
  if (!result.stdout_text.empty()) std::cout << result.stdout_text;
  if (!result.stderr_text.empty()) std::cerr << result.stderr_text;
  if (result.timed_out) std::cerr << "  [error] command timed out\n";
  return result.exit_code;
}

fs::path find_program_file(std::string_view name) {
  const char* path_env = std::getenv("PATH");
  if (!path_env) return {};
  std::stringstream ss(path_env);
  std::string dir;
  std::error_code ec;
  while (std::getline(ss, dir, ':')) {
    const fs::path candidate = fs::path(dir) / std::string(name);
    if (fs::is_regular_file(candidate, ec)) return candidate;
  }
  return {};
}

}  // namespace

int cmd_deps(const std::vector<std::string_view>& args) {
  std::string_view verb = args.empty() ? "" : args[0];
  if (verb != "install") {
    std::cerr << "error: usage: paperboat deps install [path]\n";
    return 2;
  }
  std::string path;
  bool force = false;
  for (std::size_t i = 1; i < args.size(); ++i) {
    if (args[i] == "--force") force = true;
    else if (path.empty()) path = std::string(args[i]);
    else {
      std::cerr << "error: one path only\n";
      return 2;
    }
  }
  const fs::path dir = core::StationManager::resolve_station_dir(path.empty() ? fs::current_path() : fs::path(path));
  if (!fs::is_directory(dir)) {
    std::cerr << "error: station directory not found: " << dir << "\n";
    return 1;
  }
  const core::StationKind kind = core::StationManager::detect_station_kind(dir);
  std::cout << "deps: " << dir.filename().string() << "\n";
  if (kind == core::StationKind::Python) {
    const fs::path requirements = dir / "requirements.txt";
    const fs::path pyproject = dir / "pyproject.toml";
    if (!fs::is_regular_file(requirements) && !fs::is_regular_file(pyproject)) {
      std::cout << "  no requirements.txt or pyproject.toml: nothing to install\n";
      return 0;
    }
    const fs::path venv = dir / ".venv";
#ifdef _WIN32
    const fs::path python = venv / "Scripts" / "python.exe";
    const std::string base = "python";
#else
    const fs::path python = venv / "bin" / "python3";
    const std::string base = "python3";
#endif
    if (!fs::is_regular_file(python) || force) {
      std::error_code ec;
      fs::remove_all(venv, ec);
      std::cout << "  creating .venv (isolated from the host site-packages)\n";
      if (run_deps({base, "-m", "venv", venv.string()}, dir) != 0) return 1;
    }
    std::vector<std::string> pip = {python.string(), "-m", "pip", "install", "--disable-pip-version-check"};
    if (fs::is_directory(dir / "wheels")) {  // a `pack --bundle-deps` package installs offline
      std::cout << "  installing from wheels/ (offline)\n";
      pip.insert(pip.end(), {"--no-index", "--find-links", (dir / "wheels").string()});
    }
    if (fs::is_regular_file(requirements)) { pip.push_back("-r"); pip.push_back(requirements.string()); }
    else { pip.push_back("."); }
    // The host's PYTHONPATH must not satisfy a requirement the venv lacks (#322).
    if (run_deps(pip, dir, {{"PYTHONPATH", ""}, {"PYTHONHOME", ""}}) != 0) return 1;
    std::cout << "  [ok] Python environment ready: " << venv.string() << "\n";
    return 0;
  }
  if (kind == core::StationKind::Julia) {
    const fs::path project = dir / "Project.toml";
    if (!fs::is_regular_file(project)) {
      std::cerr << "error: Julia station needs Project.toml\n";
      return 1;
    }
    fs::path julia = fs::path(std::getenv("PAPERBOAT_JULIA") ? std::getenv("PAPERBOAT_JULIA") : "");
    if (julia.empty()) julia = find_program_file("julia");
    if (julia.empty()) {
      std::cerr << "error: no julia found (set PAPERBOAT_JULIA or put julia on PATH)\n";
      return 1;
    }
    const fs::path depot = dir / ".julia";
    std::error_code ec;
    fs::create_directories(depot, ec);
    std::cout << "  julia " << julia.string() << " · project " << project.string() << " · depot " << depot.string() << "\n";
    return run_deps({julia.string(), "--project=" + project.string(), "-e", "using Pkg; Pkg.instantiate()"}, dir,
                    {{"JULIA_PROJECT", project.string()}, {"JULIA_DEPOT_PATH", depot.string()},
                     {"JULIA_LOAD_PATH", "@:@stdlib"}, {"JULIA_NUM_THREADS", "1"}});
  }
  if (kind == core::StationKind::Cpp) {
    std::cout << "  C++ dependencies are CMake packages or toolkits; see toolkit_requirements.toml\n";
    return 0;
  }
  std::cerr << "error: cannot detect station type in " << dir << "\n";
  return 1;
}

#if defined(PAPERBOAT_HAS_OPTIMIZATION) || defined(PAPERBOAT_HAS_OPTIMIZE_CMD)
// The solvers print through both std::cout (the toolkit) and C stdio (Ipopt, MUMPS). Catch the
// process's stdout file descriptor while a solve runs, so `--json` prints exactly one object
// and the trace can travel with the result.
class StdoutCapture {
 public:
  StdoutCapture() {
    static std::atomic<int> serial{0};
    path_ = fs::temp_directory_path() /
            ("pb_trace_" + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()) + "_" +
             std::to_string(serial.fetch_add(1)) + ".log");
  }

  bool begin() {
    flush();
#ifdef _WIN32
    saved_ = _dup(_fileno(stdout));
    file_ = _open(path_.string().c_str(), _O_CREAT | _O_TRUNC | _O_WRONLY | _O_BINARY, _S_IREAD | _S_IWRITE);
    if (saved_ < 0 || file_ < 0) return false;
    return _dup2(file_, _fileno(stdout)) == 0;
#else
    saved_ = dup(STDOUT_FILENO);
    file_ = open(path_.c_str(), O_CREAT | O_TRUNC | O_WRONLY, 0600);
    if (saved_ < 0 || file_ < 0) return false;
    return dup2(file_, STDOUT_FILENO) >= 0;
#endif
  }

  std::string end() {
    flush();
    if (saved_ >= 0) {
#ifdef _WIN32
      _dup2(saved_, _fileno(stdout));
      _close(saved_);
      if (file_ >= 0) _close(file_);
#else
      dup2(saved_, STDOUT_FILENO);
      close(saved_);
      if (file_ >= 0) close(file_);
#endif
    }
    saved_ = -1;
    file_ = -1;
    std::ifstream in(path_);
    std::string text((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    std::error_code ec;
    fs::remove(path_, ec);
    return text;
  }

 private:
  static void flush() {
    std::cout.flush();
    std::cerr.flush();
    std::fflush(nullptr);
  }

  fs::path path_;
  int saved_ = -1;
  int file_ = -1;
};

// `paperboat optimize <problem.json> [--json]`: one fmincon-shaped problem through the
// optimization toolkit, the same reader and solver the `lp`, `qp` and `nlp` blocks use.
int cmd_optimize(const std::vector<std::string_view>& args) {
  std::string path;
  bool json_out = false;
  int grid_points = 0;
  for (std::size_t i = 0; i < args.size(); ++i) {
    const auto arg = args[i];
    if (arg == "--json") {
      json_out = true;
    } else if (arg == "--grid" && i + 1 < args.size()) {
      grid_points = std::atoi(std::string(args[++i]).c_str());
    } else if (!arg.starts_with("-") && path.empty()) {
      path = std::string(arg);
    } else {
      std::cerr << "error: usage: paperboat optimize <problem.json> [--json] [--grid N]\n";
      return 2;
    }
  }
  if (path.empty()) {
    std::cerr << "error: usage: paperboat optimize <problem.json> [--json] [--grid N]\n";
    return 2;
  }

  std::ifstream file(path);
  if (!file) {
    std::cerr << "error: cannot read " << path << "\n";
    return 1;
  }
  const std::string text((std::istreambuf_iterator<char>(file)), std::istreambuf_iterator<char>());

  nlohmann::json doc;
  try {
    doc = nlohmann::json::parse(text);
  } catch (const std::exception& e) {
    std::cerr << "error: " << path << " is not JSON: " << e.what() << "\n";
    return 1;
  }

  const bool nonlinear = doc.contains("fun");
  const bool quadratic = !nonlinear && doc.contains("H") && !doc["H"].is_null();
  const std::string kind = nonlinear ? "nlp" : quadratic ? "qp" : "lp";

  tk::optimization::Options options;
  if (doc.contains("options") && doc["options"].is_object()) {
    const auto& opts = doc["options"];
    if (opts.contains("display") && opts["display"].is_string()) {
      options.display = opts["display"].get<std::string>();
    }
    if (opts.contains("tol") && opts["tol"].is_number()) {
      options.eps_abs = opts["tol"].get<double>();
      options.eps_rel = opts["tol"].get<double>();
    }
    if (opts.contains("max_iter") && opts["max_iter"].is_number_integer()) {
      options.max_iter = opts["max_iter"].get<int>();
    }
  }

  // The readers take a file; hand them the text the app already has.
  const fs::path temp = fs::temp_directory_path() /
                        ("pb_optimize_" + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()) + ".json");
  {
    std::ofstream out(temp);
    out << text;
  }

  StdoutCapture capture;
  capture.begin();
  tk::optimization::Result result;
  std::string error;
  std::optional<tk::optimization::NlpProblem> nlp_problem;
  try {
    if (nonlinear) {
      if (!tk::optimization::has_nlp()) {
        error = "the NLP solver needs Ipopt; build Paperboat with the Ipopt toolkit";
      } else {
        nlp_problem = tk::optimization::read_nlp_problem(temp.string());
        tk::optimization::NlpWorkspace workspace(options);
        result = workspace.solve(temp.string());
      }
    } else {
      tk::optimization::Workspace workspace(options);
      result = workspace.solve(temp.string(), quadratic);
    }
  } catch (const std::exception& e) {
    error = e.what();
  }
  const std::string trace = capture.end();
  std::error_code ec;
  fs::remove(temp, ec);

  std::vector<std::string> lines;
  {
    std::istringstream reader(trace);
    for (std::string line; std::getline(reader, line);) {
      if (!line.empty()) lines.push_back(line);
    }
  }

  nlohmann::json out;
  out["ok"] = error.empty();
  out["kind"] = kind;
  out["status"] = result.status;
  out["objective"] = result.objective;
  out["iterations"] = result.iterations;
  out["x"] = result.x;
  out["trace"] = lines;
  if (!error.empty()) out["error"] = error;

  // A 2-variable preview of the objective on a grid, so the app can draw the surface without
  // a second expression parser. It is the same reader and evaluation the solver uses.
  const std::size_t count = result.x.empty() ? 0 : result.x.size();
  if (grid_points >= 2 && count == 2 && error.empty()) {
    const auto bound = [&](const char* key, std::size_t index, double fallback) {
      if (!doc.contains(key) || !doc[key].is_array()) return fallback;
      const auto& values = doc[key];
      if (index >= values.size() || !values[index].is_number()) return fallback;
      return values[index].get<double>();
    };
    std::vector<double> lo(2), hi(2);
    for (std::size_t i = 0; i < 2; ++i) {
      const double span = std::max(1.0, std::abs(result.x[i]));
      lo[i] = bound("lb", i, result.x[i] - span);
      hi[i] = bound("ub", i, result.x[i] + span);
      if (!(hi[i] > lo[i])) {
        lo[i] = result.x[i] - span;
        hi[i] = result.x[i] + span;
      }
    }

    std::unique_ptr<tk::Expression> nlp_expression;
    if (nonlinear) {
      nlp_expression = std::make_unique<tk::Expression>(nlp_problem->objective,
                                                        std::vector<std::string>{"x1", "x2"});
    }

    const auto value_at = [&](const std::vector<double>& at) {
      if (nlp_expression) return (*nlp_expression)(at);
      double value = 0.0;
      if (quadratic) {
        const auto& H = doc["H"];
        for (std::size_t i = 0; i < 2; ++i) {
          for (std::size_t j = 0; j < 2; ++j) {
            if (H[i][j].is_number()) value += 0.5 * H[i][j].get<double>() * at[i] * at[j];
          }
        }
      }
      if (doc.contains("f") && doc["f"].is_array()) {
        const auto& f = doc["f"];
        for (std::size_t i = 0; i < 2 && i < f.size(); ++i) {
          if (f[i].is_number()) value += f[i].get<double>() * at[i];
        }
      }
      return value;
    };

    nlohmann::json gx = nlohmann::json::array();
    nlohmann::json gy = nlohmann::json::array();
    for (int i = 0; i < grid_points; ++i) {
      const double u = static_cast<double>(i) / static_cast<double>(grid_points - 1);
      gx.push_back(lo[0] + u * (hi[0] - lo[0]));
      gy.push_back(lo[1] + u * (hi[1] - lo[1]));
    }
    nlohmann::json gz = nlohmann::json::array();
    for (int row = 0; row < grid_points; ++row) {
      nlohmann::json zrow = nlohmann::json::array();
      for (int col = 0; col < grid_points; ++col) {
        zrow.push_back(value_at({gx[col].get<double>(), gy[row].get<double>()}));
      }
      gz.push_back(zrow);
    }
    out["grid"] = {{"x", gx}, {"y", gy}, {"z", gz}};
  }

  if (json_out) {
    std::cout << out.dump() << '\n';
  } else {
    for (const auto& line : lines) std::cout << line << '\n';
    if (!error.empty()) {
      std::cerr << "error: " << error << '\n';
    } else {
      std::cout << "  " << kind << " · " << result.status << " · objective " << result.objective << " · x = [";
      for (std::size_t i = 0; i < result.x.size(); ++i) std::cout << (i ? ", " : "") << result.x[i];
      std::cout << "]\n";
    }
  }
  return error.empty() ? 0 : 1;
}
#endif

int cmd_run(const std::vector<std::string_view>& args) {
  core::StationRunOptions opts;
  std::string path;

  for (std::size_t i = 0; i < args.size(); ++i) {
    auto a = args[i];
    if (a == "--port" && i + 1 < args.size()) {
      opts.port = std::stoi(std::string(args[++i]));
    } else if (a == "--run") {
      opts.run = true;  // headless: the starter graph once, as `paperboat check` reads it
    } else if (a == "--no-build") {
      opts.build = false;
    } else if (a == "--clean") {
      opts.clean = true;
    } else if (a == "--time") {
      opts.time_metrics = true;
    } else if (a == "--verbose") {
      opts.verbose = true;
    } else if (a == "--record") {
      if (i + 1 >= args.size()) {
        std::cerr << "error: --record takes a directory\n";
        return 2;
      }
      opts.record = std::string(args[++i]);
    } else if (a == "--var" && i + 1 < args.size()) {
      std::string setting(args[++i]);
      auto eq = setting.find('=');
      if (eq != std::string::npos && eq > 0) {
        opts.vars.emplace_back(setting.substr(0, eq), setting.substr(eq + 1));
      }
    } else if (!a.starts_with("-") && path.empty()) {
      path = std::string(a);
    }
  }

  if (path.empty() && core::StationManager::detect_station_kind(fs::current_path()) == core::StationKind::Unknown) {
    launch_console({"run"});  // the station picker; returns only when the console can't open
  }
  opts.command = "paperboat run";
  for (auto a : args) opts.command += " " + std::string(a);
  return core::StationManager::run_station(path, opts);
}

int cmd_open(const std::vector<std::string_view>& args) {
  std::string file_path;
  core::StationRunOptions opts;
  bool run_headless = false;
  int port = 0;

  for (std::size_t i = 0; i < args.size(); ++i) {
    auto a = args[i];
    if (a == "--run") {
      run_headless = true;
    } else if (a == "--port" && i + 1 < args.size()) {
      port = std::stoi(std::string(args[++i]));
    } else if (a == "--run") {
      opts.run = true;  // headless: the starter graph once, as `paperboat check` reads it
    } else if (a == "--no-build") {
      opts.build = false;
    } else if (a == "--record") {
      if (i + 1 >= args.size()) {
        std::cerr << "error: --record takes a directory\n";
        return 2;
      }
      opts.record = std::string(args[++i]);
    } else if (!a.starts_with("-") && file_path.empty()) {
      file_path = std::string(a);
    }
  }

  if (file_path.empty()) {
    std::cerr << "usage: paperboat open <file.psf|file.paperboat.json> [--run] [--port <port>] [--no-build] [--record <dir>]\n";
    return 2;
  }

  const fs::path p(file_path);
  if (!fs::is_regular_file(p)) {
    std::cerr << "error: file not found: " << file_path << '\n';
    return 1;
  }

  json proj;
  try {
    std::ifstream in(p);
    in >> proj;
  } catch (const std::exception& err) {
    std::cerr << "error: invalid project file: " << err.what() << '\n';
    return 1;
  }

  if (!proj.is_object() || !proj.contains("paperboat") || !proj["paperboat"].is_number_integer()) {
    std::cerr << "error: invalid project file: missing \"paperboat\" format version\n";
    return 1;
  }
  if (proj["paperboat"] != 0) {
    std::cerr << "error: unsupported project version " << proj["paperboat"] << " (this tool supports version 0)\n";
    return 1;
  }
  if (!proj.contains("station") || !proj["station"].is_string()) {
    std::cerr << "error: invalid project file: missing \"station\" specification\n";
    return 1;
  }
  if (!proj.contains("flow") || !proj["flow"].is_object()) {
    std::cerr << "error: invalid project file: missing \"flow\" graph\n";
    return 1;
  }

  const std::string station_name = proj["station"].get<std::string>();
  const fs::path station_dir = core::StationManager::resolve_station_dir(station_name);
  if (station_dir.empty() || !fs::is_directory(station_dir)) {
    std::cerr << "error: station \"" << station_name << "\" not found\n";
    return 1;
  }

  // Check required toolkits
  const auto manifest = core::StationManager::load_manifest(station_dir);
  const auto installed_toolkits = tk::list_toolkits();
  for (const auto& req : manifest.toolkits) {
    bool found = false;
    for (const auto& t : installed_toolkits) {
      if (t.name == req) {
        if (t.installed || t.builtin) found = true;
        break;
      }
    }
    if (!found) {
      std::cerr << "error: required toolkit \"" << req << "\" is not installed\n";
      return 1;
    }
  }

  opts.port = port;
  opts.psf_file = fs::canonical(p).string();
  opts.run = run_headless;
  opts.command = "paperboat open";
  for (auto a : args) opts.command += " " + std::string(a);

  if (run_headless) {
    return core::StationManager::run_station(station_dir, opts);
  }

  core::StationManager::start_app();
  std::cout << "[ok] opening flow \"" << p.filename().string() << "\" with station " << station_name << '\n';
  return core::StationManager::run_station(station_dir, opts);
}

int cmd_build(const std::vector<std::string_view>& args) {
  std::string path;
  bool clean = false;
  for (auto a : args) {
    if (a == "--clean") clean = true;
    else if (!a.starts_with("-") && path.empty()) path = std::string(a);
  }
  const fs::path dir = core::StationManager::resolve_station_dir(path);
  const auto kind = core::StationManager::detect_station_kind(dir);
  if (kind == core::StationKind::Python) {  // the same steps for both: build, check, run
    std::cout << "[ok] " << dir.filename().string() << " is a Python station: nothing to compile\n";
    return 0;
  }
  if (kind != core::StationKind::Cpp) {
    std::cerr << "error: not a C++ station: " << (path.empty() ? dir.string() : path) << '\n';
    return 2;
  }
  std::string err;
  double elapsed = 0.0;
  if (!core::StationManager::ensure_built(dir, clean, /*verbose=*/true, &err, &elapsed)) {
    std::cerr << "error: build failed: " << err << '\n';
    return 1;
  }
  std::cout << "[ok] built " << dir.filename().string() << " in " << std::fixed << std::setprecision(1) << elapsed
            << " s\n";
  return 0;
}

int cmd_rebuild(const std::vector<std::string_view>& args) {
  auto with_clean = args;
  with_clean.emplace_back("--clean");
  return cmd_build(with_clean);
}

// The first sentence of a descriptor's opening comment ("# Pole on a cart, balanced by PID
// blocks. Served by ..."): the one-line description the picker shows.
std::string describe(const fs::path& dir) {
  std::ifstream in(dir / "descriptor.toml");
  std::string line;
  if (!std::getline(in, line) || !line.starts_with("# ")) return {};
  line = line.substr(2);
  if (auto dot = line.find(". "); dot != std::string::npos) line = line.substr(0, dot);
  if (!line.empty() && line.back() == '.') line.pop_back();
  return line;
}

int cmd_stations(const std::vector<std::string_view>& args) {
  bool json_out = false;
  for (auto a : args) {
    if (a == "--json") json_out = true;
  }

  // Examples first (in their port order), then the user's installed stations; by name.
  std::map<std::string, json> found;
  std::vector<std::string> order;
  const auto add = [&](const fs::path& dir, std::string source, int fallback_port) {
    const auto kind = core::StationManager::detect_station_kind(dir);
    if (kind == core::StationKind::Unknown) return;
    const auto manifest = core::StationManager::load_manifest(dir);
    std::string name = manifest.has_manifest && !manifest.name.empty() ? manifest.name : dir.filename().string();
    for (std::string_view suffix : {"-cpp", "-python"}) {
      if (name.ends_with(suffix)) name.resize(name.size() - suffix.size());
    }
    if (found.contains(name)) return;
    order.push_back(name);
    found[name] = {
        {"name", name},
        {"language", kind == core::StationKind::Cpp ? "cpp" : "python"},
        {"port", manifest.has_manifest && manifest.port > 0 ? manifest.port : fallback_port},
        {"dir", dir.string()},
        {"description", name == "scratchpad" ? "Standard toolkits with no domain (Flow & Board)" : describe(dir)},
        {"source", std::move(source)},
    };
  };
  const fs::path root = tk::find_repo_root();
  if (!root.empty() && fs::is_directory(root / "engine" / "scratchpad")) {
    add(root / "engine" / "scratchpad", "builtin", 8765);
  } else if (const fs::path wb = core::StationManager::scratchpad_binary(root); !wb.empty()) {
    order.push_back("scratchpad");
    found["scratchpad"] = {
        {"name", "scratchpad"},
        {"language", "cpp"},
        {"port", 8765},
        {"dir", wb.string()},
        {"description", "Standard toolkits with no domain (Flow & Board)"},
        {"source", "builtin"},
    };
  }
  for (const auto& ex : core::StationManager::get_examples()) add(ex.dir, "example", ex.port);
  std::error_code ec;
  for (const auto& entry : fs::directory_iterator(core::StationManager::user_stations_dir(), ec)) {
    if (entry.is_directory()) add(entry.path(), "installed", 8765);
  }

  if (json_out) {
    json arr = json::array();
    for (const auto& name : order) arr.push_back(found[name]);
    std::cout << arr.dump(2) << '\n';
    return 0;
  }
  if (order.empty()) {
    std::cout << "No stations found. Set PAPERBOAT_EXAMPLES_DIR or unpack a .pst.\n";
    return 0;
  }
  std::cout << std::left << std::setw(20) << "NAME" << std::setw(9) << "TYPE" << std::setw(7) << "PORT"
            << "DESCRIPTION\n";
  for (const auto& name : order) {
    const auto& b = found[name];
    std::cout << std::left << std::setw(20) << name << std::setw(9) << b["language"].get<std::string>()
              << std::setw(7) << b["port"].get<int>() << b["description"].get<std::string>() << '\n';
  }
  return 0;
}

// The first sentence of an app's description, for the one-line listings.
std::string first_sentence(std::string text) {
  if (const auto dot = text.find(". "); dot != std::string::npos) text.resize(dot);
  if (!text.empty() && text.back() == '.') text.pop_back();
  return text;
}

constexpr int kWebAppPort = 3047;

// A Squero app (or library dep) from apps.toml: `target` is the name, or the command that launches it.
// A path or a ./relative name is never one: that is a station folder.
std::optional<tk::AppEntry> find_squero(std::string_view target) {
  if (target.empty() || target.starts_with('.') || target.find_first_of("/\\") != std::string_view::npos) return std::nullopt;
  for (auto& app : tk::list_apps())
    if (app.name == target || (!app.launch.empty() && app.launch == target)) return app;
  return std::nullopt;
}

// What is running, stations and squeros alike; `kind` says which.
struct RunningItem {
  std::string kind;  // "station" | "paperboat" | "squero"
  std::string name;
  std::string detail;
  int port = 0;
  int pid = 0;
  std::string url;
  json extra = json::object();
};

std::vector<RunningItem> running_items() {
  std::vector<RunningItem> items;
  for (const auto& b : core::StationManager::list_running_stations()) {
    items.push_back({"station", b.domain.empty() ? "unknown" : b.domain, b.engine, b.port, b.pid, b.ws_url,
                     {{"engine", b.engine}, {"domain", b.domain}, {"ws_url", b.ws_url}, {"cwd", b.cwd.string()},
                      {"station_dir", b.station_dir.string()}, {"started_at", b.started_at}}});
  }
  const auto running_web = [&](const std::string& kind, const std::string& name, const std::string& detail, int port) {
    if (!core::StationManager::is_port_listening(port)) return;
    items.push_back({kind, name, detail, port, core::StationManager::find_pid_by_port(port),
                     "http://localhost:" + std::to_string(port), {{"engine", ""}, {"domain", name}, {"ws_url", ""}}});
  };
  running_web("paperboat", "paperboat", "the Paperboat web UI", kWebAppPort);
  for (const auto& a : tk::list_apps())
    if (a.kind == "squero" && a.port > 0) running_web("squero", a.name, first_sentence(a.description), a.port);
  return items;
}

int cmd_list(const std::vector<std::string_view>& args) {
  bool json_out = false;
  for (auto a : args) {
    if (a == "--json") json_out = true;
  }

  const auto items = running_items();
  if (json_out) {
    json arr = json::array();
    for (const auto& it : items) {
      json row = {{"kind", it.kind}, {"name", it.name}, {"port", it.port}, {"pid", it.pid}, {"url", it.url}};
      row.update(it.extra);
      arr.push_back(std::move(row));
    }
    std::cout << arr.dump(2) << '\n';
    return 0;
  }

  if (items.empty()) {
    std::cout << "Nothing is running. `paperboat start` starts Paperboat; `paperboat start <station>` a station; `paperboat squero start <name>` a Squero app.\n";
    return 0;
  }

  std::cout << std::left << std::setw(9) << "KIND" << std::setw(7) << "PORT" << std::setw(8) << "PID" << std::setw(22)
            << "NAME" << std::setw(28) << "DETAIL" << "URL\n";
  for (const auto& it : items) {
    std::cout << std::left << std::setw(9) << it.kind << std::setw(7) << it.port << std::setw(8) << it.pid
              << std::setw(22) << it.name << std::setw(28) << it.detail << it.url << '\n';
  }
  return 0;
}

// What each station is doing, starting ones included (pb#332): building (prepare, configure,
// compile), starting (waiting for it to answer), failed (with why), running. `--json` is the document
// a wait screen polls, the same as the web host's /__paperboat/status.
int cmd_status(const std::vector<std::string_view>& args) {
  bool json_out = false;
  std::string target;
  for (auto a : args) {
    if (a == "--json") json_out = true;
    else if (!a.starts_with("-")) target = std::string(a);
  }
  const json doc = json::parse(core::StationManager::status_json(target));
  if (json_out) {
    std::cout << doc.dump(2) << '\n';
    return 0;
  }
  const auto& list = doc["stations"];
  if (list.empty()) {
    std::cout << (target.empty() ? "No station is starting or running." : "No station \"" + target + "\" is starting or running.")
              << " `paperboat start <station>` starts one.\n";
    return 0;
  }
  std::cout << std::left << std::setw(10) << "STATE" << std::setw(11) << "STAGE" << std::setw(7) << "PORT" << std::setw(24)
            << "NAME" << "ELAPSED\n";
  for (const auto& b : list) {
    std::ostringstream elapsed;
    if (b.contains("elapsed")) elapsed << std::fixed << std::setprecision(1) << b["elapsed"].get<double>() << " s";
    std::cout << std::left << std::setw(10) << b.value("state", "") << std::setw(11) << b.value("stage", "-") << std::setw(7)
              << b.value("port", 0) << std::setw(24) << b.value("name", "") << elapsed.str() << '\n';
    if (b.contains("error")) std::cout << "  " << b["error"].get<std::string>() << '\n';
  }
  return 0;
}

int cmd_web(const std::vector<std::string_view>& args);
void start_scratchpad();
Command find_command(std::string_view name);

// `start`, `stop` and `restart` with no target are for Paperboat itself (`web` UI + scratchpad); `web <verb>` is the same.
int main_web(std::string_view verb, const std::vector<std::string_view>& args) {
  std::vector<std::string_view> forwarded = {verb};
  forwarded.insert(forwarded.end(), args.begin(), args.end());
  return cmd_web(forwarded);
}

// The first argument that is not a flag or a flag's value: what `start`/`stop`/`restart` act on.
std::string target_of(const std::vector<std::string_view>& args) {
  for (std::size_t i = 0; i < args.size(); ++i) {
    if (args[i] == "--port" || args[i] == "--host" || args[i] == "--var" || args[i] == "--version") ++i;
    else if (!args[i].starts_with("-")) return std::string(args[i]);
  }
  return {};
}

std::vector<std::string_view> without(const std::vector<std::string_view>& args, std::string_view target) {
  std::vector<std::string_view> rest;
  bool dropped = false;
  for (auto a : args) {
    if (!dropped && a == target) dropped = true;
    else rest.push_back(a);
  }
  return rest;
}

// --port N, else the program's own port from apps.toml.
int port_of(const tk::AppEntry& app, const std::vector<std::string_view>& args) {
  for (std::size_t i = 0; i + 1 < args.size(); ++i)
    if (args[i] == "--port") return std::stoi(std::string(args[i + 1]));
  return app.port;
}

int stop_squero(tk::AppEntry app, const std::vector<std::string_view>& args = {}) {
  if (app.kind == "library") {
    std::cerr << "error: " << app.name << " is a library, not a squero app\n";
    return 1;
  }
  app.port = port_of(app, args);
  if (app.port <= 0) {
    std::cerr << "error: " << app.name << " has no port in apps.toml, so paperboat can't find it to stop it\n";
    return 1;
  }
  if (!core::StationManager::is_port_listening(app.port)) {
    std::cout << app.name << " is not running\n";
    return 0;
  }
  const int pid = core::StationManager::find_pid_by_port(app.port);
  core::StationManager::free_port(app.port, 2000);
  if (core::StationManager::is_port_listening(app.port)) {
    std::cerr << "error: could not stop " << app.name << " (pid " << pid << ", port " << app.port << ")\n";
    return 1;
  }
  std::cout << "stopped " << app.name << " (pid " << pid << ", port " << app.port << ")\n";
  return 0;
}

fs::path find_in_path(std::string_view name) {
  if (name.empty()) return {};
  const char* path_env = std::getenv("PATH");
  if (!path_env) return {};
  std::stringstream ss(path_env);
  std::string dir;
  std::error_code ec;
#ifdef _WIN32
  constexpr char delim = ';';
#else
  constexpr char delim = ':';
#endif
  while (std::getline(ss, dir, delim)) {
    if (dir.empty()) continue;
    const fs::path p = fs::path(dir) / name;
    if (fs::is_regular_file(p, ec)) return p;
#ifdef _WIN32
    const fs::path p_exe = fs::path(dir) / (std::string(name) + ".exe");
    if (fs::is_regular_file(p_exe, ec)) return p_exe;
#endif
  }
  return {};
}

fs::path resolve_app_binary(const tk::AppEntry& app) {
  const fs::path root = tk::find_repo_root();
  std::error_code ec;
  // 1. Sibling checkout
  if (!root.empty()) {
    const fs::path sibling = root.parent_path() / app.name;
    const fs::path cand1 = sibling / app.launch;
    if (fs::is_regular_file(cand1, ec)) return cand1;
    const fs::path cand2 = sibling / "server" / "build" / fs::path(app.launch).filename();
    if (fs::is_regular_file(cand2, ec)) return cand2;
  }
  // 2. Installed app directory
  const fs::path cand3 = tk::apps_dir() / app.name / app.launch;
  if (fs::is_regular_file(cand3, ec)) return cand3;
  const fs::path cand4 = tk::apps_dir() / app.name / "server" / "build" / fs::path(app.launch).filename();
  if (fs::is_regular_file(cand4, ec)) return cand4;
  // 3. System PATH
  fs::path in_path = find_in_path(app.launch);
  if (!in_path.empty()) return in_path;
  in_path = find_in_path(fs::path(app.launch).filename().string());
  if (!in_path.empty()) return in_path;

  return {};
}

// Run a Squero app in the foreground through its launch command, or --daemon: detached, with a log.
int start_squero(const tk::AppEntry& app, std::vector<std::string_view> rest) {
  if (app.launch.empty()) {
    std::cerr << "error: " << app.name << " has no launch command in apps.toml\n";
    return 1;
  }
  const auto daemon = std::ranges::find(rest, std::string_view("--daemon"));
  const bool is_daemon = (daemon != rest.end());
  if (const Command launch = find_command(app.launch)) {
    if (!is_daemon) return launch(rest);
    rest.erase(daemon);
    std::vector<std::string> argv = {platform::exe_path().string(), "squero", "start", app.name};
    for (auto a : rest) argv.emplace_back(a);
    const fs::path log = platform::shared_tmp_dir() / ("paperboat-" + app.name + ".log");
    const int pid = core::ProcessRunner::run_detached(argv, {}, {}, log);
    if (pid <= 0) {
      std::cerr << "error: could not start " << app.name << '\n';
      return 1;
    }
    std::cout << "started " << app.name << " (pid " << pid << ", port " << port_of(app, rest) << ") · log " << log.string() << '\n';
    return 0;
  }

  const fs::path bin = resolve_app_binary(app);
  if (bin.empty()) {
    std::cerr << "error: cannot find " << app.launch << " for " << app.name
              << " (run `paperboat squero install " << app.name << "`)\n";
    return 1;
  }

  if (is_daemon) rest.erase(daemon);
  std::vector<std::string> argv = {bin.string()};
  for (auto a : rest) argv.emplace_back(a);
  // The app calls back into this paperboat (`squero-studio-mx`: `paperboat list`, `paperboat optimize`).
  const std::vector<std::pair<std::string, std::string>> env = {{"PAPERBOAT_BIN", platform::exe_path().string()}};

  if (is_daemon) {
    const fs::path log = platform::shared_tmp_dir() / ("paperboat-" + app.name + ".log");
    const int pid = core::ProcessRunner::run_detached(argv, {}, env, log);
    if (pid <= 0) {
      std::cerr << "error: could not start " << app.name << '\n';
      return 1;
    }
    std::cout << "started " << app.name << " (pid " << pid << ", port " << port_of(app, rest) << ") · log " << log.string() << '\n';
    return 0;
  }

  return core::ProcessRunner::run_stream(argv, {}, env, [](std::string_view stream, std::string_view line) {
    if (stream == "stderr") std::cerr << line << '\n';
    else std::cout << line << '\n';
  });
}

int cmd_restart(const std::vector<std::string_view>& args) {
  const std::string target = target_of(args);
  if (target.empty()) return main_web("restart", args);
  core::StationRunOptions opts;
  for (std::size_t i = 0; i < args.size(); ++i) {
    if (args[i] == "--port" && i + 1 < args.size()) {
      opts.port = std::stoi(std::string(args[++i]));
    }
  }
  return core::StationManager::restart_station(target, opts) ? 0 : 1;
}

int cmd_stop(const std::vector<std::string_view>& args) {
  const bool all = std::ranges::find(args, std::string_view("--all")) != args.end();
  const std::string target = target_of(args);
  if (!all && target.empty()) return main_web("stop", args);
  return core::StationManager::stop_station(target, all) ? 0 : 1;
}

// start: no target is Paperboat (web UI + scratchpad); otherwise a station. Squero apps use `paperboat squero start`.
int cmd_start(const std::vector<std::string_view>& args) {
  const std::string target = target_of(args);
  if (target.empty()) return main_web("start", args);
  std::error_code ec;
  if (!fs::exists(target, ec) && !fs::exists(core::StationManager::resolve_station_dir(target), ec)) {
    std::cerr << "error: \"" << target << "\" is not a station\n"
              << "  stations: `paperboat stations` (or a folder or .pst)   squero apps: `paperboat squero start <name>`\n";
    return 1;
  }
  return cmd_run(args);
}

int cmd_web(const std::vector<std::string_view>& args) {
  if (args.empty()) {
    std::cerr << "usage: paperboat web <start|stop|restart|build> [options]\n";
    return 2;
  }
  auto sub = args[0];
  int port = 3047;
  std::string host = "0.0.0.0";
  bool daemon = false;

  for (std::size_t i = 1; i < args.size(); ++i) {
    if (args[i] == "--port" && i + 1 < args.size()) {
      port = std::stoi(std::string(args[++i]));
    } else if (args[i] == "--host" && i + 1 < args.size()) {
      host = std::string(args[++i]);
    } else if (args[i] == "--daemon") {
      daemon = true;
    }
  }

  if (sub == "start") {
    start_scratchpad();
    return core::StationManager::start_app(port, host, daemon) ? 0 : 1;
  } else if (sub == "stop") {
    return core::StationManager::stop_app(port) ? 0 : 1;
  } else if (sub == "restart") {
    start_scratchpad();
    return core::StationManager::restart_app(port, host) ? 0 : 1;
  } else if (sub == "build") {
    return core::StationManager::build_app() ? 0 : 1;
  } else {
    std::cerr << "error: unknown app subcommand: " << sub << '\n';
    return 2;
  }
}

int cmd_examples(const std::vector<std::string_view>& args) {
  if (args.empty()) {
    std::cerr << "usage: paperboat examples <start|stop|status|fetch> [--dir <path>]\n";
    return 2;
  }
  auto sub = args[0];
  std::string dir;
  for (std::size_t i = 1; i < args.size(); ++i) {
    if (args[i] == "--dir" && i + 1 < args.size()) {
      dir = std::string(args[++i]);
    }
  }

  if (sub == "fetch") {
    return core::StationManager::fetch_examples() ? 0 : 1;
  } else if (sub == "start") {
    return core::StationManager::start_examples(dir) ? 0 : 1;
  } else if (sub == "stop") {
    return core::StationManager::stop_examples() ? 0 : 1;
  } else if (sub == "status") {
    auto list = core::StationManager::status_examples(dir);
    std::cout << std::left << std::setw(8) << "PORT"
              << std::setw(26) << "NAME"
              << std::setw(10) << "TYPE"
              << std::setw(12) << "STATUS"
              << std::setw(8) << "PID"
              << "WS URL\n";
    for (const auto& item : list) {
      std::cout << std::left << std::setw(8) << item.port
                << std::setw(26) << item.name
                << std::setw(10) << item.type
                << std::setw(12) << (item.running ? "running" : "idle")
                << std::setw(8) << (item.running ? std::to_string(item.pid) : "-")
                << item.ws_url << '\n';
    }
    return 0;
  } else {
    std::cerr << "error: unknown examples subcommand: " << sub << '\n';
    return 2;
  }
}

int cmd_toolkit(const std::vector<std::string_view>& args) {
  if (args.empty()) {
    launch_console({"toolkit"});  // the toolkit manager; returns only when the console can't open
    std::cerr << "usage: paperboat toolkit <list|install|update|uninstall|versions> [args...]\n";
    return 2;
  }
  auto sub = args[0];
  bool json_out = false;
  bool rebuild = true;
  bool all = false;
  std::string name;
  std::string version;
  std::string source;  // --repo <url> or --path <dir>

  for (std::size_t i = 1; i < args.size(); ++i) {
    auto a = args[i];
    if (a == "--json") json_out = true;
    else if (a == "--all") all = true;
    else if (a == "--no-build") rebuild = false;
    else if ((a == "--version" || a == "-v") && i + 1 < args.size()) {
      version = std::string(args[++i]);
    }
    else if ((a == "--repo" || a == "--path") && i + 1 < args.size()) {
      source = std::string(args[++i]);
    }
    else if (!a.starts_with("-") && name.empty()) name = std::string(a);
  }

  if (sub == "list") {
    if (!name.empty()) {
      auto res = tk::inspect_toolkit(name, full_registry());
      if (!res.found) {
        std::cerr << "paperboat toolkit: unknown toolkit or package \"" << name << "\"\n";
        return 1;
      }
      if (json_out) {
        std::cout << tk::toolkit_inspect_json(res) << '\n';
      } else {
        std::cout << tk::toolkit_inspect_text(res);
      }
      return 0;
    }
    auto list = tk::list_toolkits();
    if (json_out) {
      std::cout << tk::toolkits_json(list) << '\n';
      return 0;
    }
    for (const auto& t : list) {
      const char* status = t.builtin ? "built-in toolkit" : (t.installed ? "installed" : "not installed");
      std::cout << t.name << "\t" << status << "\t" << (t.repo.empty() ? "-" : t.repo);
      if (!t.description.empty()) std::cout << "\t" << t.description;
      std::cout << '\n';
    }
    return 0;
  }

  if (sub == "versions") {
    if (name.empty()) {
      std::cerr << "error: toolkit name required (e.g. `paperboat toolkit versions opencv`)\n";
      return 2;
    }
    auto vers = tk::list_toolkit_versions(name);
    if (vers.empty()) {
      std::cout << "No remote version tags found for toolkit \"" << name << "\".\n";
      return 0;
    }
    for (const auto& v : vers) {
      std::cout << v << '\n';
    }
    return 0;
  }

  if (sub == "update" && all) {
    int failed = 0;
    for (const auto& t : tk::list_toolkits()) {
      if (!t.installed || t.builtin) continue;
      std::vector<std::string_view> one = {"update", t.name};
      if (!rebuild) one.emplace_back("--no-build");
      failed += cmd_toolkit(one) != 0;
    }
    return failed ? 1 : 0;
  }

  if (name.empty()) {
    std::cerr << "error: toolkit name required\n";
    return 2;
  }

  auto log = [](std::string_view level, std::string_view text) {
    (level == "error" ? std::cerr : std::cout) << "[" << level << "] " << text << '\n';
  };

  tk::HostBuild host{.source_dir = {}, .build_dir = {}, .skip_rebuild = !rebuild};
  tk::ToolkitResult res;
  if (sub == "install" || sub == "add" || sub == "update") {
    res = tk::install_toolkit(name, version, {}, host, log, source);
  } else if (sub == "uninstall" || sub == "remove") {
    res = tk::uninstall_toolkit(name, {}, host, log);
  } else {
    std::cerr << "error: unknown toolkit subcommand: " << sub << '\n';
    return 2;
  }

  if (!res.ok) {
    std::cerr << "paperboat toolkit: " << res.message << '\n';
    return 1;
  }
  return 0;
}

// paperboat squero: manage and run Squero apps (apps.toml).
int cmd_squero(const std::vector<std::string_view>& args) {
  if (args.empty()) {
    std::cerr << "usage: paperboat squero <list|install|update|uninstall|versions|path|start|stop|restart> [name[@version]] [--version V] [--all] [--force] [--json]\n";
    return 2;
  }
  const auto sub = args[0];
  bool json_out = false;
  bool all = false;
  bool force = false;
  std::string name;
  std::string version;
  for (std::size_t i = 1; i < args.size(); ++i) {
    if (args[i] == "--json") json_out = true;
    else if (args[i] == "--all") all = true;
    else if (args[i] == "--force") force = true;
    else if ((args[i] == "--version" || args[i] == "-v") && i + 1 < args.size()) version = std::string(args[++i]);
    else if (args[i] == "--port" && i + 1 < args.size()) ++i;
    else if (!args[i].starts_with("-") && name.empty()) name = std::string(args[i]);
  }
  if (const auto at = name.find('@'); at != std::string::npos) {  // name@version
    version = name.substr(at + 1);
    name.resize(at);
  }

  if (sub == "list") {
    const auto list = tk::list_apps();
    if (json_out) {
      json arr = json::array();
      for (const auto& a : list) {
        json deps = json::array(), ranges = json::object();
        for (const auto& d : a.deps) {
          deps.push_back(d.name);
          if (!d.range.empty()) ranges[d.name] = d.range;
        }
        arr.push_back({{"name", a.name}, {"repo", a.repo}, {"description", a.description},
                       {"installed", a.installed}, {"checkout", a.checkout}, {"version", a.version}, {"deps", deps}, {"dep_ranges", ranges},
                       {"built_with", a.built_with}, {"kind", a.kind}, {"launch", a.launch}, {"port", a.port},
                       {"missing_prerequisites", a.installed ? std::string() : tk::missing_prerequisites(a.name)}});
      }
      std::cout << arr.dump(2) << '\n';
      return 0;
    }
    if (list.empty()) std::cerr << "no apps (apps.toml not found in the repository root)\n";
    std::cout << std::left << std::setw(20) << "NAME" << std::setw(9) << "KIND" << std::setw(15) << "VERSION" << "DESCRIPTION\n";
    for (const auto& a : list) {
      std::cout << std::left << std::setw(20) << a.name << std::setw(9) << a.kind << std::setw(15)
                << (a.installed ? a.version : a.checkout ? "checkout" : "not installed") << a.description << '\n';
      if (!a.installed) continue;
      for (const auto& d : a.deps) {  // what it was built against, and whether the dep installed now still pairs
        const auto it = std::ranges::find(list, d.name, &tk::AppEntry::name);
        const std::string now = it != list.end() && it->installed ? it->version : "";
        const std::string built = a.built_with.contains(d.name) ? a.built_with.at(d.name) : "";
        std::string line = "with " + d.name + " " + (built.empty() ? "?" : built);
        if (!d.range.empty()) line += " (needs " + d.range + ")";
        if (now.empty()) line += "; it is not installed now";
        else if (now != built) line += "; " + now + " is installed now";
        if (!now.empty() && !tk::dep_satisfied(now, d, a.version))
          line += ", outside the range: paperboat squero install " + a.name + (a.version == "dev" ? "" : "@" + a.version) +
                  " --force";
        std::cout << std::string(44, ' ') << line << '\n';
      }
    }
    return 0;
  }
  if (sub == "update" && all) {
    int failed = 0;
    for (const auto& a : tk::list_apps()) {
      if (!a.installed) continue;
      const auto r = tk::install_app(a.name, {}, {}, [](std::string_view l, std::string_view t) {
        (l == "error" ? std::cerr : std::cout) << "[" << l << "] " << t << '\n';
      }, force);
      if (!r.ok) std::cerr << "paperboat squero: " << r.message << '\n';
      failed += !r.ok;
    }
    return failed ? 1 : 0;
  }
  if (name.empty()) {
    std::cerr << "error: squero app name required (e.g. `paperboat squero " << sub << " squero-studio-om`)\n";
    return 2;
  }
  if (sub == "start" || sub == "stop" || sub == "restart") {
    const auto app = find_squero(name);
    if (!app) {
      std::cerr << "error: unknown squero app \"" << name << "\" (see `paperboat squero list`)\n";
      return 1;
    }
    if (app->kind == "library") {
      std::cerr << "error: " << app->name << " is a library, not a runnable squero app\n";
      return 1;
    }
    auto rest = without(std::vector<std::string_view>(args.begin() + 1, args.end()), name);
    if (sub == "start") return start_squero(*app, std::move(rest));
    if (sub == "stop") return stop_squero(*app, rest);
    if (const int rc = stop_squero(*app, rest); rc != 0) return rc;
    rest.emplace_back("--daemon");
    return start_squero(*app, std::move(rest));
  }
  if (sub == "versions") {
    const auto versions = tk::list_app_versions(name, {}, true);
    for (const auto& v : versions) std::cout << v << '\n';
    if (versions.empty()) std::cerr << "no release tags for \"" << name << "\"; install takes main (\"dev\")\n";
    return 0;
  }
  if (sub == "path") {
    const auto out = tk::app_output(name);
    if (out.empty()) {
      std::cerr << "paperboat squero: \"" << name << "\" is not installed (paperboat squero install " << name << ")\n";
      return 1;
    }
    std::cout << out.string() << '\n';
    return 0;
  }
  const auto log = [](std::string_view level, std::string_view text) {
    (level == "error" ? std::cerr : std::cout) << "[" << level << "] " << text << '\n';
  };
  tk::ToolkitResult res;
  if (sub == "install" || sub == "add" || sub == "update") res = tk::install_app(name, version, {}, log, force);
  else if (sub == "uninstall" || sub == "remove") res = tk::uninstall_app(name, {}, log);
  else {
    std::cerr << "error: unknown squero subcommand: " << sub << '\n';
    return 2;
  }
  if (!res.ok) std::cerr << "paperboat squero: " << res.message << '\n';
  return res.ok ? 0 : 1;
}

// The build directory of the running binary (engine/build/dev, engine/build, ...).
fs::path running_build_dir(const fs::path& root) {
  fs::path p = platform::exe_path();
  for (p = p.parent_path(); !p.empty() && p != p.root_path() && p.has_parent_path(); p = p.parent_path())
    if (fs::is_regular_file(p / "CMakeCache.txt")) return p;
  return root / "engine" / "build";
}

// paperboat update [--check] [--no-build] [--channel release|beta|dev|source]: update paperboat
// itself, then the apps `pkg` installed and the toolkits, each along the channel it is on.
// paperboat itself: a managed install (under $PAPERBOAT_HOME) self-updates in C++ from GitHub Releases
// or rebuilds its source checkout; a development checkout pulls (fast-forward only) with the sibling
// checkouts of the apps in apps.toml and rebuilds what changed.
int cmd_update(const std::vector<std::string_view>& args) {
  bool check_only = false;
  bool build = true;
  std::string channel;
  for (std::size_t i = 0; i < args.size(); ++i) {
    const auto a = args[i];
    if (a == "--check") check_only = true;
    else if (a == "--no-build") build = false;
    else if (a == "--channel" && i + 1 < args.size() &&
             (args[i + 1] == "release" || args[i + 1] == "beta" || args[i + 1] == "dev" ||
              args[i + 1] == "source" || args[i + 1] == "main")) {
      channel = std::string(args[++i]);
      if (channel == "main") channel = "dev";
    } else {
      std::cerr << "usage: paperboat update [--check] [--no-build] [--channel release|beta|dev]\n";
      return 2;
    }
  }
  const fs::path root = tk::find_repo_root();
  if (root.empty()) {
    std::cerr << "paperboat update: needs a git checkout of paperboat (no toolkits.toml found from here)\n";
    return 1;
  }
  const auto log = [](std::string_view level, std::string_view text) {
    (level == "error" ? std::cerr : std::cout) << "  " << text << '\n';
  };
  const auto say = [](const std::string& name, const std::string& text) {
    std::cout << std::left << std::setw(19) << name << ' ' << text << '\n';
  };
  int failed = 0;
  bool pulled = false;

  // Fetch one checkout and fast-forward it; `changed` gets the paths the pull touched.
  const auto sync = [&](const std::string& name, const fs::path& dir, std::vector<std::string>& changed) {
    const auto st = tk::check_checkout(dir);
    if (!st.error.empty()) {
      say(name, "skipped: " + st.error);
      ++failed;
    } else if (st.behind == 0) {
      say(name, "up to date (" + st.upstream + ")");
    } else {
      say(name, std::to_string(st.behind) + " commit(s) behind " + st.upstream);
      for (const auto& subject : st.incoming) std::cout << "    " << subject << '\n';
      if (check_only) return;
      if (const auto r = tk::pull_checkout(dir, &changed); !r.ok) {
        say(name, "not updated: " + r.message);
        ++failed;
      } else {
        pulled = true;
      }
    }
  };
  // A build step with its output kept quiet; the tail of it is shown when it fails.
  const auto step = [&](const std::string& label, const std::vector<std::string>& cmd, const fs::path& cwd) {
    std::cout << "  $ " << label << '\n';
    std::string out;
    if (tk::run_command(cmd, cwd, {}, nullptr, &out) == 0) return;
    ++failed;
    std::size_t from = out.size();
    for (int lines = 0; from > 0 && lines < 12; ++lines) from = out.rfind('\n', from - 1) == std::string::npos ? 0 : out.rfind('\n', from - 1);
    std::cerr << "  \"" << label << "\" failed:\n" << out.substr(from) << '\n';
  };
  const auto touched = [](const std::vector<std::string>& paths, std::string_view prefix, std::string_view suffix = {}) {
    return std::ranges::any_of(paths, [&](const std::string& p) {
      return p.starts_with(prefix) && (suffix.empty() || p.ends_with(suffix));
    });
  };

  // 1. this repository, then what it builds on
  std::vector<std::string> changed;
  const fs::path exe = platform::exe_path();
  const bool managed = tk::is_managed_install(exe) || tk::current_self_install().managed;
  const bool checkout = !managed && fs::exists(root / ".git");
  if (managed || (!channel.empty() && !checkout)) {
    std::cout << "paperboat\n";
    tk::SelfInstallOptions self_opts;
    self_opts.channel = channel;
    self_opts.check_only = check_only;
    self_opts.rebuild_toolkits = true;
    const auto self_res = tk::install_self(self_opts, log);
    if (!self_res.ok) {
      std::cerr << "  " << self_res.message << '\n';
      ++failed;
    } else if (self_res.changed) {
      pulled = true;
    } else if (!check_only && !self_res.message.empty()) {
      say("paperboat", self_res.message);
    }
  } else if (!channel.empty()) {
    say("paperboat", "a development checkout: switch with git (git switch dev, git checkout v<version>)");
    ++failed;
  } else if (checkout) {
    sync("paperboat", root, changed);
  } else {  // a package unpacked by hand (or an older .deb, .rpm): nothing here updates it
    say("paperboat", std::string(tui::kVersion) + ", installed from a package; move to a per-user install that");
    std::cout << std::string(20, ' ') << "updates itself: paperboat update --channel release\n";
  }
  for (const auto& app : tk::list_apps(root)) {  // after the pull, so a new apps.toml counts
    const fs::path dir = root.parent_path() / app.name;
    if (!checkout || !fs::exists(dir / ".git")) continue;  // not checked out here: `pkg` handles the installed copy
    std::vector<std::string> app_changed;
    sync(app.name, dir, app_changed);
    if (build && !app_changed.empty() && !app.build.empty()) {
      std::cout << "  building " << app.name << '\n';
      if (const auto r = tk::build_app(app.name, dir, root, log); !r.ok) {
        std::cerr << r.message << '\n';
        ++failed;
      }
    }
  }

  // 2. rebuild this repository's own binaries and console
  if (build && !changed.empty()) {
    const bool deps = touched(changed, "package", ".json") || touched(changed, "apps/", "package.json") ||
                      touched(changed, "apps/", "package-lock.json");
    if (deps) step("npm ci", {"npm", "ci"}, root);
    if (deps || touched(changed, "apps/cli/")) step("npm run build:cli", {"npm", "run", "build:cli"}, root);
    step("cmake --build", {platform::cmake_command(running_build_dir(root)), "--build", running_build_dir(root).string(), "--parallel"}, root);
  }

  // 3. apps installed by `paperboat squero`
  for (const auto& app : tk::list_apps(root)) {
    if (!app.installed) continue;
    if (!tk::app_outdated(app.name, root)) {
      say(app.name, "installed " + app.version + ", up to date");
      continue;
    }
    say(app.name, "installed " + app.version + ", newer available");
    if (check_only) continue;
    if (const auto r = tk::install_app(app.name, {}, root, log); !r.ok) {
      std::cerr << "paperboat update: " << r.message << '\n';
      ++failed;
    } else {
      pulled = true;
    }
  }

  // 4. toolkits: each one that moved on, rebuilt into the engine
  // ponytail: one engine build per updated toolkit; batch them if several update at once often.
  for (const auto& t : tk::list_toolkits(root)) {
    if (!t.installed || t.builtin) continue;
    if (!tk::toolkit_outdated(t, root)) {
      say(t.name + " (toolkit)", (t.version.empty() ? "installed" : t.version) + ", up to date");
      continue;
    }
    say(t.name + " (toolkit)", (t.version.empty() ? "installed" : t.version) + ", newer available");
    if (check_only) continue;
    const tk::HostBuild host{.source_dir = {}, .build_dir = {}, .skip_rebuild = !build};
    if (const auto r = tk::install_toolkit(t.name, {}, root, host, log); !r.ok) {
      std::cerr << "paperboat update: " << r.message << '\n';
      ++failed;
    } else {
      pulled = true;
    }
  }

  if (pulled) std::cout << "updated; restart running stations and servers to use it\n";
  return failed ? 1 : 0;
}

int cmd_use(const std::vector<std::string_view>& args) {
  bool list_only = false;
  bool json_out = false;
  std::string target;
  for (auto a : args) {
    if (a == "--list" || a == "-l") list_only = true;
    else if (a == "--json") json_out = true;
    else if (a.starts_with("-")) {
      std::cerr << "usage: paperboat use [<version> | --list] [--json]\n";
      return 2;
    } else if (target.empty()) {
      target = std::string(a);
    } else {
      std::cerr << "usage: paperboat use [<version> | --list] [--json]\n";
      return 2;
    }
  }
  if (list_only || target.empty()) {
    const auto versions = tk::list_installed_versions();
    if (json_out) {
      json arr = json::array();
      for (const auto& v : versions) {
        arr.push_back({{"version", v.version}, {"root", v.root.string()}, {"binary", v.binary.string()},
                       {"active", v.active}, {"source", v.is_source}});
      }
      std::cout << arr.dump(2) << '\n';
      return 0;
    }
    if (versions.empty()) {
      std::cout << "no managed paperboat versions installed under " << tk::self_dir().string() << '\n';
      return 0;
    }
    for (const auto& v : versions) {
      std::cout << (v.active ? "* " : "  ") << std::left << std::setw(18) << v.version << v.root.string() << '\n';
    }
    return 0;
  }

  const auto log = [](std::string_view level, std::string_view text) {
    (level == "error" || level == "warn" ? std::cerr : std::cout) << text << '\n';
  };
  const auto res = tk::use_self_version(target, log);
  if (!res.ok) {
    std::cerr << "paperboat use: " << res.message << '\n';
    return 1;
  }
  std::cout << res.message << '\n';
  return 0;
}

json step_json(const core::CheckStep& s) {
  return {{"name", s.name}, {"ok", s.ok}, {"skipped", s.skipped}, {"message", s.message}, {"duration", s.duration_seconds}};
}

// One line of `--json-stream`: an event object, flushed so a reader sees it at once.
void emit(json event) {
  std::cout << event.dump() << std::endl;
}

int cmd_check(const std::vector<std::string_view>& args) {
  std::string path;
  bool fast = false;
  bool json_out = false;
  bool stream = false;

  for (auto a : args) {
    if (a == "--fast") fast = true;
    else if (a == "--json") json_out = true;
    else if (a == "--json-stream") stream = true;
    else if (!a.starts_with("-") && path.empty()) path = std::string(a);
  }

  core::CheckProgress progress;
  if (stream) {
    progress = [](const core::CheckStep& step, bool done) {
      json e = step_json(step);
      e["event"] = done ? "step" : "step-start";
      emit(std::move(e));
    };
  }
  auto res = core::StationManager::check_station(path, fast, progress);
  if (json_out || stream) {
    json steps_json = json::array();
    for (const auto& s : res.steps) steps_json.push_back(step_json(s));
    json doc = {
        {"ok", res.ok},
        {"name", res.name},
        {"version", res.version},
        {"language", res.language},
        {"domain", res.domain},
        {"engine", res.engine},
        {"blocks", res.block_count},
        {"objects", res.object_count},
        {"has_starter_graph", res.has_starter_graph},
        {"has_starter_station", res.has_starter_station},
        {"steps", steps_json},
        {"errors", res.errors},
        {"warnings", res.warnings},
        {"missing_toolkits", res.missing_toolkits},
    };
    if (!res.solver.empty()) doc["solver"] = res.solver;
    if (stream) {
      doc["event"] = "result";
      emit(std::move(doc));
    } else {
      std::cout << doc.dump(2) << '\n';
    }
    return res.ok ? 0 : 1;
  }

  std::cout << "station \"" << (res.name.empty() ? res.domain : res.name)
            << "\" (" << (res.version.empty() ? "0.1.0" : res.version)
            << ", " << (res.language.empty() ? "unknown" : res.language);
  if (!res.solver.empty()) {
    std::cout << ", solver: " << res.solver;
  }
  std::cout << "):\n";

  for (const auto& step : res.steps) {
    if (step.skipped) {
      std::cout << "  [--] " << step.name << ": " << step.message << '\n';
    } else if (step.ok) {
      std::cout << "  [ok] " << step.name << ": " << step.message;
      if (step.duration_seconds > 0.001) {
        std::cout << " (" << std::fixed << std::setprecision(2) << step.duration_seconds << "s)";
      }
      std::cout << '\n';
    } else {
      std::cout << "  [FAIL] " << step.name << ": " << step.message << '\n';
    }
  }

  for (const auto& w : res.warnings) {
    std::cout << "  warning: " << w << '\n';
  }

  if (res.ok) {
    std::cout << "[ok] station verification passed ("
              << (fast ? "fast check" : "all steps") << ")\n";
    return 0;
  } else {
    std::cerr << "[failed] station verification failed:\n";
    for (const auto& e : res.errors) {
      std::cerr << "  error: " << e << '\n';
    }
    return 1;
  }
}

core::PackProgress progress_events() {
  return [](int files, int total, uint64_t bytes) {
    emit({{"event", "progress"}, {"files", files}, {"total", total}, {"bytes", bytes}});
  };
}

int cmd_pack(const std::vector<std::string_view>& args) {
  std::string path;
  std::string out_path;

  bool stream = false;
  bool bundle_deps = false;
  for (std::size_t i = 0; i < args.size(); ++i) {
    auto a = args[i];
    if (a == "--out" && i + 1 < args.size()) {
      out_path = std::string(args[++i]);
    } else if (a == "--json-stream") {
      stream = true;
    } else if (a == "--bundle-deps") {
      bundle_deps = true;
    } else if (!a.starts_with("-") && path.empty()) {
      path = std::string(a);
    }
  }

  if (stream) {
    auto res = core::StationManager::pack_station(path, out_path, /*fast=*/true, progress_events(), bundle_deps);
    emit({{"event", "result"}, {"ok", res.ok}, {"package", res.package_path.string()}, {"name", res.name},
          {"version", res.version}, {"files", res.file_count}, {"bytes", res.total_bytes}, {"sha256", res.sha256},
          {"deps", res.deps}, {"errors", res.errors}});
    return res.ok ? 0 : 1;
  }

  std::cout << "==> Packing station " << (path.empty() ? "." : path) << "…\n";
  auto res = core::StationManager::pack_station(path, out_path, /*fast=*/true, {}, bundle_deps);
  if (!res.ok) {
    std::cerr << "[failed] packing error:\n";
    for (const auto& e : res.errors) {
      std::cerr << "  " << e << '\n';
    }
    return 1;
  }

  double kb = static_cast<double>(res.total_bytes) / 1024.0;
  std::cout << "[ok] package created: " << res.package_path.filename().string()
            << " (" << res.file_count << " files, "
            << std::fixed << std::setprecision(1) << kb << " KB)\n";
  if (!res.sha256.empty()) {
    std::cout << "     sha256: " << res.sha256 << '\n';
  }
  if (res.deps == "lockfile") {
    std::cout << "     dependencies: lockfile only, environments not bundled (--bundle-deps adds them)\n";
  } else if (res.deps == "bundled") {
    std::cout << "     dependencies: bundled (wheels/ or .julia/) for an offline `paperboat deps install`\n";
  }
  return 0;
}

int cmd_unpack(const std::vector<std::string_view>& args) {
  std::string archive;
  std::string dest_dir;

  bool stream = false;
  for (std::size_t i = 0; i < args.size(); ++i) {
    auto a = args[i];
    if (a == "--dir" && i + 1 < args.size()) {
      dest_dir = std::string(args[++i]);
    } else if (a == "--json-stream") {
      stream = true;
    } else if (!a.starts_with("-") && archive.empty()) {
      archive = std::string(a);
    }
  }

  if (archive.empty()) {
    std::cerr << "error: package archive path required (e.g. `paperboat unpack my-station-0.1.0.pst`)\n";
    return 2;
  }

  if (stream) {
    auto res = core::StationManager::unpack_station(archive, dest_dir, /*verify=*/true, progress_events());
    emit({{"event", "result"}, {"ok", res.ok}, {"dir", res.destination_dir.string()}, {"name", res.name},
          {"version", res.version}, {"files", res.file_count}, {"errors", res.errors}});
    return res.ok ? 0 : 1;
  }

  std::cout << "==> Unpacking package " << archive << "…\n";
  auto res = core::StationManager::unpack_station(archive, dest_dir, /*verify=*/true);
  if (!res.ok) {
    std::cerr << "[failed] unpack error:\n";
    for (const auto& e : res.errors) {
      std::cerr << "  " << e << '\n';
    }
    return 1;
  }

  std::cout << "[ok] package extracted to " << res.destination_dir.string()
            << " (" << res.file_count << " files verified)\n";
  std::cout << "[ok] station " << res.name << " v" << res.version << " is ready to run\n";
  return 0;
}

int cmd_commands(const std::vector<std::string_view>& args);
int cmd_top(const std::vector<std::string_view>&);
int cmd_launcher(const std::vector<std::string_view>& args);

// What a command's free argument names, for completion: a station, a toolkit, something
// running (name or port), a .pst file, or nothing.
struct CommandSpec {
  std::string_view name;
  Command run;
  std::string_view summary;
  std::vector<std::string_view> aliases = {};
  std::vector<std::string_view> subcommands = {};
  std::vector<std::string_view> flags = {};
  std::string_view arg = {};
};

// The subcommands the command line, the basic prompt and Paperboat CLI share (`commands --json`).
const std::vector<CommandSpec>& command_table() {
  static const std::vector<CommandSpec> table = {
      {"start", cmd_start, "Start Paperboat, or a station (start [station])", {}, {},
       {"--port", "--host", "--daemon", "--no-build", "--clean", "--time", "--verbose", "--var", "--version"}, "station"},
      {"stop", cmd_stop, "Stop Paperboat or a station (stop [station])", {}, {}, {"--all", "--port"},
       "station"},
      {"restart", cmd_restart, "Restart Paperboat or a station", {}, {}, {"--port"}, "station"},
      {"run", cmd_run, "Build and run a station (or .pst) in the foreground", {}, {},
       {"--port", "--run", "--no-build", "--clean", "--time", "--verbose", "--var", "--record"}, "station"},
      {"open", cmd_open, "Open a saved Station's flow (.psf)", {}, {},
       {"--run", "--port", "--no-build", "--record"}, "psf"},
      {"new", paperboat::cli::cmd_new, "Scaffold a new station that passes check (C++, Python or Julia)", {}, {},
       {"--cpp", "--python", "--dir"}},
      {"deps", cmd_deps, "Create a station's isolated environment and install its dependencies", {},
       {"install"}, {"--force"}, "station"},
#if defined(PAPERBOAT_HAS_OPTIMIZATION) || defined(PAPERBOAT_HAS_OPTIMIZE_CMD)
      {"optimize", cmd_optimize, "Solve a fmincon-shaped problem JSON (LP, QP or NLP)", {}, {},
       {"--json", "--grid"}, "problem"},
#endif
      {"build", cmd_build, "Compile a C++ station", {}, {}, {"--clean"}, "station"},
      {"rebuild", cmd_rebuild, "Clean and compile a C++ station", {}, {}, {}, "station"},
      {"stations", cmd_stations, "List the stations you can run", {}, {}, {"--json"}},
      {"list", cmd_list, "List what is running (stations, paperboat, squero)", {"ps"}, {}, {"--json"}},
      {"status", cmd_status, "What each station is doing: building (stage), starting, failed, running", {}, {}, {"--json"}, "station|port"},
      {"web", cmd_web, "Paperboat web UI: start, stop, restart, build", {},
       {"start", "stop", "restart", "build"}, {"--port", "--host", "--daemon"}},
      {"examples", cmd_examples, "Run all example stations, or fetch them", {}, {"start", "stop", "status", "fetch"}, {"--dir"}},
      {"toolkit", cmd_toolkit, "Manage optional toolkits", {}, {"list", "install", "update", "uninstall", "versions"},
       {"--json", "--all", "--no-build", "--version"}, "toolkit"},
      {"check", cmd_check, "Verify a station (manifest, catalog, smoke, golden)", {}, {},
       {"--fast", "--json", "--json-stream"}, "station"},
      {"pack", cmd_pack, "Package a station as .pst", {}, {}, {"--out", "--bundle-deps", "--json-stream"}, "station"},
      {"unpack", cmd_unpack, "Unpack and verify a .pst", {}, {}, {"--dir", "--json-stream"}, "pst"},
      {"update", cmd_update, "Pull this repository and its app checkouts, rebuild", {}, {},
       {"--check", "--no-build", "--channel"}},
      {"use", cmd_use, "List or switch installed paperboat runtime versions", {}, {},
       {"--list", "--json"}, "version"},
      {"squero", cmd_squero, "Manage and run Squero apps from apps.toml", {},
       {"list", "install", "update", "uninstall", "versions", "path", "start", "stop", "restart"},
       {"--json", "--all", "--version", "--force", "--port", "--daemon"}},
      {"launcher", cmd_launcher, "Open the Paperboat Launcher desktop app", {"gui"}},
      {"top", cmd_top, "Process overview (Paperboat CLI)"},
      {"commands", cmd_commands, "The command table", {}, {}, {"--json"}},
  };
  return table;
}

Command find_command(std::string_view name) {
  for (const auto& c : command_table()) {
    if (c.name == name || std::ranges::find(c.aliases, name) != c.aliases.end()) return c.run;
  }
  return nullptr;
}

int cmd_commands(const std::vector<std::string_view>& args) {
  const bool json_out = std::ranges::find(args, std::string_view("--json")) != args.end();
  json arr = json::array();
  for (const auto& c : command_table()) {
    if (!json_out) {
      std::cout << std::left << std::setw(10) << c.name << c.summary << '\n';
      continue;
    }
    const auto strings = [](const std::vector<std::string_view>& v) {
      return std::vector<std::string>(v.begin(), v.end());
    };
    arr.push_back({{"name", c.name}, {"summary", c.summary}, {"aliases", strings(c.aliases)},
                   {"subcommands", strings(c.subcommands)}, {"flags", strings(c.flags)}, {"arg", c.arg}});
  }
  if (json_out) std::cout << arr.dump(2) << '\n';
  return 0;
}

int cmd_top(const std::vector<std::string_view>&) {
  launch_console({"top"});
  std::cerr << "paperboat top needs Paperboat CLI on a terminal (npm run build:cli); `paperboat list` "
               "shows the same stations\n";
  return 2;
}

int cmd_launcher(const std::vector<std::string_view>& args) {
  std::error_code ec;
  const fs::path exe = platform::exe_path();
  const fs::path root = tk::find_repo_root();
  std::vector<std::string> extra;
  for (auto a : args) extra.emplace_back(a);

  std::vector<fs::path> electron_bins;
#ifdef _WIN32
  electron_bins.push_back(exe.parent_path() / "Paperboat Launcher.exe");
  if (const char* local = std::getenv("LOCALAPPDATA"); local && *local) {
    electron_bins.push_back(fs::path(local) / "Programs" / "Paperboat Launcher" / "Paperboat Launcher.exe");
  }
  electron_bins.push_back("C:\\Program Files\\Paperboat Launcher\\Paperboat Launcher.exe");
#elif defined(__APPLE__)
  electron_bins.push_back("/Applications/Paperboat Launcher.app/Contents/MacOS/Paperboat Launcher");
#else
  electron_bins.push_back("/opt/Paperboat Launcher/paperboat-launcher");
#endif
  for (const auto& eb : electron_bins) {
    if (fs::is_regular_file(eb, ec)) {
      std::vector<std::string> argv = {eb.string()};
      argv.insert(argv.end(), extra.begin(), extra.end());
      if (core::ProcessRunner::run_detached(argv, {}, {{"PAPERBOAT_BIN", exe.string()}}) > 0) return 0;
    }
  }
  if (!root.empty()) {
    const fs::path dev_app = root / "apps" / "launcher";
#ifdef _WIN32
    const fs::path dev_electron = dev_app / "node_modules" / ".bin" / "electron.cmd";
#else
    const fs::path dev_electron = dev_app / "node_modules" / ".bin" / "electron";
#endif
    if (fs::is_regular_file(dev_electron, ec) && fs::is_regular_file(dev_app / "dist" / "index.html", ec)) {
      std::vector<std::string> argv = {dev_electron.string(), dev_app.string()};
      argv.insert(argv.end(), extra.begin(), extra.end());
      if (core::ProcessRunner::run_detached(argv, dev_app, {{"PAPERBOAT_BIN", exe.string()}}) > 0) return 0;
    }
  }
  std::cerr << "paperboat launcher: Paperboat Launcher desktop app is not installed\n"
               "  install the Paperboat Launcher package (.rpm, .deb, .dmg, .msi), or in a checkout run:\n"
               "  npm run electron -w @paperboat/launcher\n";
  return 1;
}

// The console (apps/cli, Ink) takes over on a terminal: it replaces this process (POSIX) or
// runs as its child, this one exiting with its code (Windows). Returns only when it can't: not
// a terminal, PAPERBOAT_NO_CONSOLE set, not built, or no `node` on PATH. It is the checkout's
// apps/cli/dist/main.js, else the bundle a release installs at share/paperboat/cli/main.js.
bool launch_console(const std::vector<std::string>& args) {
  if (!platform::is_tty(0) || !platform::is_tty(1) || std::getenv("PAPERBOAT_NO_CONSOLE")) return false;
  std::error_code ec;
  const fs::path exe = platform::exe_path();
  fs::path script;
  if (const char* env = std::getenv("PAPERBOAT_CONSOLE"); env && *env) {
    script = env;
  } else {
    // engine/build/tools/paperboat in a checkout, else the checkout this is run from.
    for (const fs::path& root : {exe.parent_path() / ".." / ".." / "..", tk::find_repo_root()}) {
      if (root.empty() || !fs::is_directory(root / "apps" / "cli")) continue;
      script = fs::weakly_canonical(root / "apps" / "cli" / "dist" / "main.js", ec);
      if (!fs::is_regular_file(script)) {
        std::cerr << "note: Paperboat CLI isn't built (npm install && npm run build:cli); using the basic prompt\n";
        return false;
      }
      break;
    }
    if (script.empty()) script = exe.parent_path().parent_path() / "share" / "paperboat" / "cli" / "main.js";
  }
  if (!fs::is_regular_file(script)) return false;

  std::vector<std::string> owned = {"node", script.string()};
  owned.insert(owned.end(), args.begin(), args.end());
#ifdef _WIN32
  _putenv_s("PAPERBOAT_BIN", exe.string().c_str());
  // no exec on Windows: node runs in this console as a child, and its exit code is ours.
  // _spawnvp joins argv with spaces unquoted, so each is quoted, or a script under
  // "C:\Users\Jane Doe" reached node as "C:\Users\Jane" (and ran whatever file has that name).
  for (auto& a : owned) a = core::quote_command_arg(a);
  std::vector<const char*> argv;
  for (auto& a : owned) argv.push_back(a.c_str());
  argv.push_back(nullptr);
  const intptr_t code = _spawnvp(_P_WAIT, "node", argv.data());
  if (code == -1) {
    std::cerr << "note: `node` not found on PATH; using the basic prompt\n";
    return false;
  }
  std::exit(static_cast<int>(code));
#else
  setenv("PAPERBOAT_BIN", exe.c_str(), 1);
  std::vector<char*> argv;
  for (auto& a : owned) argv.push_back(a.data());
  argv.push_back(nullptr);
  execvp("node", argv.data());
  std::cerr << "note: `node` not found on PATH; using the basic prompt\n";
  return false;
#endif
}

void print_interactive_help() {
  std::cout << "Interactive commands:\n";
  for (const auto& c : command_table()) {
    std::string names(c.name);
    for (const auto alias : c.aliases) names += ", " + std::string(alias);
    std::cout << "  " << std::left << std::setw(18) << names << c.summary << '\n';
  }
  std::cout << "  " << std::left << std::setw(18) << "clear" << "Clear the screen and redraw the banner\n"
            << "  " << std::setw(18) << "help" << "This list (`help <anything>` for the full manual)\n"
            << "  " << std::setw(18) << "exit, quit" << "Leave the prompt\n";
}

/**
 * The scratchpad is the default station: built from `engine/scratchpad` in a checkout, or launched
 * from the installed `paperboat-scratchpad` binary beside `paperboat` in a package / desktop app.
 */
void start_scratchpad() {
  const fs::path root = tk::find_repo_root();
  if (core::StationManager::is_port_listening(8765)) return;
  const fs::path wb_dir = (!root.empty() && fs::is_directory(root / "engine" / "scratchpad"))
                              ? (root / "engine" / "scratchpad")
                              : fs::path{};
  if (!wb_dir.empty()) {
    std::string err;
    if (!core::StationManager::ensure_built(wb_dir, false, false, &err)) return;
  }
  const fs::path bin = core::StationManager::scratchpad_binary(root);
  if (bin.empty()) return;
  const fs::path cwd = wb_dir.empty() ? bin.parent_path() : wb_dir;
  const fs::path log_path = platform::shared_tmp_dir() / "station-8765.log";
  const int pid = core::ProcessRunner::run_detached({bin.string(), "--port", "8765"}, cwd, {}, log_path);
  if (pid <= 0) return;
  core::RunningStation rb;
  rb.port = 8765;
  rb.pid = pid;
  rb.engine = "scratchpad";
  rb.domain = "scratchpad";
  rb.cwd = cwd;
  rb.station_dir = wb_dir;
  rb.executable = bin.string();
  rb.ws_url = "ws://localhost:8765";
  rb.started_at = std::chrono::duration_cast<std::chrono::seconds>(std::chrono::system_clock::now().time_since_epoch()).count();
  core::StationManager::register_running_station(rb);
  std::cout << "  \033[32m●\033[0m scratchpad running on ws://localhost:8765 (PID " << pid << ")\n\n";
}

int run_interactive_prompt() {
  tui::render_banner(true);
  start_scratchpad();
  std::cout << "Interactive prompt. Type 'help' for commands, or 'exit' to quit.\n\n";

  std::string line;
  while (true) {
    if (platform::is_tty(0)) {
      std::cout << "\033[1;38;2;74;144;226mpaperboat\033[0m> " << std::flush;
    }
    if (!std::getline(std::cin, line)) {
      std::cout << '\n';
      break;
    }

    auto tokens = tui::parse_command_line(line);
    if (tokens.empty()) continue;

    const std::string& cmd = tokens[0];
    if (cmd == "exit" || cmd == "quit" || cmd == "q") {
      break;
    }
    if (cmd == "clear" || cmd == "cls") {
      if (platform::is_tty(1)) std::cout << "\033[2J\033[H";
      tui::render_banner(false);
      continue;
    }
    if (cmd == "help" || cmd == "--help" || cmd == "-h") {
      if (tokens.size() == 1) {
        print_interactive_help();
      } else {
        print_help();
      }
      continue;
    }

    std::vector<std::string_view> sv_tokens;
    sv_tokens.reserve(tokens.size());
    for (const auto& t : tokens) sv_tokens.emplace_back(t);

    std::vector<std::string_view> rest(sv_tokens.begin() + 1, sv_tokens.end());
    if (const Command command = find_command(cmd)) command(rest);
    else {
      std::cerr << "unknown command: " << cmd << ". Type 'help' for available commands.\n";
    }
  }
  return 0;
}

}  // namespace

namespace {

// The one-file download (pb#358, pb#355): a standalone paperboat with nothing installed around it
// (no checkout, no share/paperboat beside it). It installs the runtime of its own version directly
// in C++ ($PAPERBOAT_HOME/self/<version>, linked in $PAPERBOAT_BIN), then hands the command over.
// $PAPERBOAT_ARCHIVE installs from a local release archive instead of downloading (offline, CI).
std::optional<int> bootstrap(int argc, char** argv) {
  if (!tk::find_repo_root().empty()) return std::nullopt;  // a checkout or an installed paperboat
  std::cout << "paperboat " << tui::kVersion << ": first run, installing paperboat for this user…\n";
  const char* archive = std::getenv("PAPERBOAT_ARCHIVE");

  tk::SelfInstallOptions opts;
  opts.channel = "release";
  if (archive && *archive) opts.archive = archive;
  else opts.version = tui::kVersion;
  opts.rebuild_toolkits = true;

  const auto log = [](std::string_view level, std::string_view text) {
    (level == "error" || level == "warn" ? std::cerr : std::cout) << text << '\n';
  };
  const auto res = tk::install_self(opts, log);
  if (!res.ok) {
    std::cerr << "paperboat: " << res.message << '\n';
    std::cerr << "paperboat: the install failed; this binary is unchanged, run it again to retry\n";
    return 1;
  }

#ifdef _WIN32
  std::cout << "paperboat is installed: open a new terminal and run `paperboat` (this downloaded file can be deleted)\n";
  if (argc < 2) return 0;
  std::vector<std::string> owned = {core::quote_command_arg(res.binary.string())};
  for (int i = 1; i < argc; ++i) owned.push_back(core::quote_command_arg(argv[i]));
  std::vector<const char*> c_argv;
  c_argv.reserve(owned.size() + 1);
  for (const auto& s : owned) c_argv.push_back(s.c_str());
  c_argv.push_back(nullptr);
  const intptr_t rc = _spawnv(_P_WAIT, res.binary.string().c_str(), c_argv.data());
  if (rc == -1) {
    std::cerr << "paperboat: cannot run " << res.binary.string() << '\n';
    return 1;
  }
  return static_cast<int>(rc);
#else
  const fs::path installed = tk::active_link_path();
  std::cout << "paperboat is installed: run `paperboat` from now on (this downloaded file can be deleted)\n" << std::flush;
  if (argc < 2) return 0;
  std::string link_str = installed.string();
  argv[0] = link_str.data();
  ::execv(installed.c_str(), argv);  // the command you gave, by the installed paperboat
  std::cerr << "paperboat: cannot run " << installed.string() << '\n';
  return 1;
#endif
}

}  // namespace

int main(int argc, char** argv) {
  // Piped (the launcher, CI), stdout is block-buffered: a minute-long install would show nothing
  // until it ends. Each line goes out as it is written (Windows has no line buffering: unbuffered).
#ifdef _WIN32
  std::setvbuf(stdout, nullptr, _IONBF, 0);
#else
  std::setvbuf(stdout, nullptr, _IOLBF, 0);
#endif
  core::StationManager::set_registry_extension(add_optional_packages);
  if (argc >= 2 && (std::string_view(argv[1]) == "--version" || std::string_view(argv[1]) == "-v" ||
                    std::string_view(argv[1]) == "--help" || std::string_view(argv[1]) == "-h")) {
    // answered by this binary, installed or not
  } else if (const auto rc = bootstrap(argc, argv)) {
    return *rc;
  }
  if (argc < 2) {
    launch_console({});
    return run_interactive_prompt();
  }

  std::vector<std::string_view> args(argv + 1, argv + argc);
  std::string_view cmd = args[0];
  std::vector<std::string_view> rest(args.begin() + 1, args.end());

  if (cmd == "interactive" || cmd == "repl") {
    return run_interactive_prompt();
  }
  if (cmd == "--help" || cmd == "-h" || cmd == "help") {
    print_help();
    return 0;
  }
  if (cmd == "--version" || cmd == "-v" || cmd == "version") {
    std::cout << "paperboat " << tui::kVersion << "\n";
    return 0;
  }

  if (const Command command = find_command(cmd)) return command(rest);

  std::cerr << "paperboat: unknown command \"" << cmd << "\"\n";
  std::cerr << "Run 'paperboat --help' for usage.\n";
  return 2;
}
