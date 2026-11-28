// Julia and Python stations out of process (remote.cpp): a runtime's definitions read into the
// engine's, and, where paperboatd is installed, each test station run headless through it.

#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_floating_point.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>

#include <chrono>
#include <cmath>
#include <csignal>
#include <map>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <regex>
#include <string>
#include <thread>
#include <unistd.h>
#include <vector>

#include <nlohmann/json.hpp>

#include "paperboat/core/process.hpp"
#include "paperboat/core/remote.hpp"
#include "paperboat/toolkit/platform.hpp"

using Catch::Matchers::ContainsSubstring;
using Catch::Matchers::WithinAbs;
using nlohmann::json;
namespace core = paperboat::core;
namespace fs = std::filesystem;

TEST_CASE("a runtime's definition reads into the engine's in each shorthand") {
  const auto def = core::remote_block_def("scale", nlohmann::ordered_json::parse(R"({
    "label": "Scale", "kind": "function", "description": "times a gain",
    "inputs": ["u", {"id": "w", "type": "vector", "dimension": 3}],
    "outputs": ["y"],
    "params": {"gain": 2, "on": true, "name": "x", "mode": {"default": "fast", "type": "enum", "options": ["slow", "fast"]}}
  })"));
  CHECK(def.type == "scale");
  CHECK(def.label == "Scale");
  REQUIRE(def.inputs.size() == 2);
  CHECK(def.inputs[1].type == "vector");
  CHECK(def.inputs[1].dimension == 3u);
  REQUIRE(def.params.size() == 4);
  CHECK(def.params[0].id == "gain");  // in the order given
  CHECK(def.params[0].default_value == 2.0);
  CHECK(def.params[1].type == "boolean");
  CHECK(def.params[2].type == "text");
  CHECK(def.params[2].default_text == "x");
  CHECK(def.params[3].type == "enum");
  CHECK(def.params[3].default_text == "fast");

  // Julia's Dict has no order: params as [id, default] pairs or {id, ...} objects.
  const auto pairs = core::remote_block_def("p", nlohmann::ordered_json::parse(R"({"params": [["b", 1.0], {"id": "a", "default": 3}]})"));
  REQUIRE(pairs.params.size() == 2);
  CHECK(pairs.params[0].id == "b");
  CHECK(pairs.params[1].default_value == 3.0);
  CHECK(pairs.label == "p");

  const auto object = core::remote_object_def("mass", nlohmann::ordered_json::parse(R"({
    "base": "model", "props": {"m": 1}, "links": ["wall"], "block": {"inputs": ["f"], "outputs": ["x"]}
  })"));
  CHECK(object.props.size() == 1);
  CHECK(object.links == std::vector<std::string>{"wall"});
  REQUIRE(object.block);
  CHECK(object.block->type == "mass");
  CHECK(object.block->kind == paperboat::toolkit::Kind::Probe);

  CHECK_THROWS_WITH(core::remote_block_def("bad", nlohmann::ordered_json::parse(R"({"kind": "sink"})")), ContainsSubstring("bad: kind"));
  CHECK_THROWS_WITH(core::remote_block_def("bad", nlohmann::ordered_json::parse(R"({"inputs": [3]})")), ContainsSubstring("bad: inputs"));
  CHECK_THROWS_WITH(core::remote_block_def("bad", nlohmann::ordered_json::parse(R"({"params": [3]})")), ContainsSubstring("bad: params"));
}

namespace {

fs::path daemon() {
  if (const char* d = std::getenv("PAPERBOATD"); d && *d) return d;
  for (const char* dir : {"/usr/bin", "/usr/local/bin"})
    if (fs::is_regular_file(fs::path(dir) / "paperboatd")) return fs::path(dir) / "paperboatd";
  return {};
}

// <build>/tests/paperboat_tests -> <build>/tools/simplicial-engine
fs::path engine() { return paperboat::platform::exe_path().parent_path().parent_path() / "tools" / "simplicial-engine"; }

fs::path fixtures() { return fs::path(__FILE__).parent_path() / "remote-stations"; }

}  // namespace

// Needs paperboatd and a runtime it can start (podman, docker or the language on PATH): skipped
// without the daemon (CI has none). A daemon of its own, in a short folder (a socket's path has a limit).
TEST_CASE("a Julia and a Python station run out of process and leave no runtime behind", "[remote]") {
  const fs::path paperboatd = daemon();
  if (paperboatd.empty()) SKIP("no paperboatd: install Paperboat or set PAPERBOATD");
  const fs::path home = fs::path("/tmp") / ("pbrt-" + std::to_string(getpid()));
  fs::remove_all(home);
  fs::create_directories(home / "run");
  const std::vector<std::pair<std::string, std::string>> env = {
      {"PAPERBOAT_RUNTIME_DIR", (home / "run").string()}, {"PAPERBOAT_HOME", (home / "home").string()}, {"PAPERBOATD", paperboatd.string()}};
  // Started here, so it ends here: the engine finds its socket and starts none of its own.
  const fs::path socket = home / "run" / "control.sock";
  const int daemon_pid = core::ProcessRunner::run_detached({paperboatd.string(), "--socket", socket.string()}, home, env, home / "paperboatd.log");
  REQUIRE(daemon_pid > 0);
  struct Stop {  // however the test ends: the daemon stops every runtime it started
    int pid;
    fs::path home;
    ~Stop() {
      core::ProcessRunner::kill_pid(pid, SIGTERM, 10000);
      fs::remove_all(home);
    }
  } stop{daemon_pid, home};
  for (int i = 0; i < 200 && !fs::exists(socket); ++i) std::this_thread::sleep_for(std::chrono::milliseconds(100));

  for (const char* language : {"python", "julia"}) {
    DYNAMIC_SECTION(language) {
      const auto run = core::ProcessRunner::run_sync({engine().string(), "host", (fixtures() / language).string(), "--run"}, fixtures(), env,
                                                     std::chrono::minutes(10));
      INFO(run.stderr_text);
      REQUIRE(run.exit_code == 0);
      std::map<std::string, double> last;
      std::string status;
      for (std::size_t at = 0; at < run.stdout_text.size();) {
        const std::size_t end = std::min(run.stdout_text.find('\n', at), run.stdout_text.size());
        const json m = json::parse(run.stdout_text.substr(at, end - at), nullptr, false);
        at = end + 1;
        if (!m.is_object()) continue;
        if (m.value("type", "") == "signal" && m["v"].is_number()) last[m["node"]] = m["v"];
        if (m.value("type", "") == "run.finished") status = m.value("status", "");
      }
      CHECK(status == "done");
      CHECK_THAT(last["result"], WithinAbs(6.0, 1e-9));              // a block: 2 × 3
      CHECK_THAT(last["plot"], WithinAbs(std::cos(2.0 * 1.0), 1e-3));  // a model: cos(2t), k = 4, at t = 1 s

      // The runtime ends with the station: shutdown, then the container goes (--rm).
      std::smatch found;
      const std::string err = run.stderr_text;
      if (std::regex_search(err, found, std::regex(R"( on (podman|docker) \(([^)]+)\))"))) {
        const std::string backend = found[1], instance = found[2];
        const auto listed = [&](bool all) {
          std::vector<std::string> ps = {backend, "ps", "-q", "--filter", "name=^" + instance + "$"};
          if (all) ps.insert(ps.begin() + 2, "-a");
          return !core::ProcessRunner::run_sync(ps).stdout_text.empty();
        };
        bool kept = true;
        for (int i = 0; i < 100 && kept; ++i) {
          kept = listed(true);
          if (kept) std::this_thread::sleep_for(std::chrono::milliseconds(100));
        }
        // the station ends its runtime (release with stop, paperboat#66); an older paperboatd keeps it warm
        if (kept) WARN(instance << " is still there: this paperboatd keeps a released runtime warm for its idle timeout");
        else SUCCEED("the runtime and its container are gone");
      }
    }
  }
}

namespace {

// paperboatd's version (`paperboatd --version`: "paperboatd 0.2.0-beta.9") as {major, minor, patch, beta}; a release
// is beta 1000. Empty when it says none.
std::vector<int> daemon_version(const fs::path& paperboatd) {
  const auto r = core::ProcessRunner::run_sync({paperboatd.string(), "--version"});
  std::smatch m;
  if (!std::regex_search(r.stdout_text, m, std::regex(R"((\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?)"))) return {};
  return {std::stoi(m[1]), std::stoi(m[2]), std::stoi(m[3]), m[4].matched ? std::stoi(m[4]) : 1000};
}

void write_file(const fs::path& p, const std::string& text) {
  fs::create_directories(p.parent_path());
  std::ofstream(p, std::ios::binary) << text;
}

std::string read_file(const fs::path& p) {
  std::ifstream in(p, std::ios::binary);
  return {std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>()};
}

// Every file under `dir` and what it holds.
std::map<std::string, std::string> snapshot(const fs::path& dir) {
  std::map<std::string, std::string> out;
  for (const auto& e : fs::recursive_directory_iterator(dir))
    out[e.path().lexically_relative(dir).generic_string() + (e.is_directory() ? "/" : "")] = e.is_regular_file() ? read_file(e.path()) : "";
  return out;
}

}  // namespace

// An example's station asks for a read-only lease (paperboat#85): paperboatd (0.2.0-beta.9 or later) holds the runtime
// to it, here on the native backend (Landlock). Its code can write where it may (the lease's work folder, the user's
// cache) but not into the example, by absolute path: the runtime says why, and the example stays byte for byte as it
// was (git status clean). Its copy, the user's, is written as before. Needs paperboatd (PAPERBOATD) and python3.
TEST_CASE("an example's station can't write into the example, even natively by absolute path", "[remote]") {
  const fs::path paperboatd = daemon();
  if (paperboatd.empty()) SKIP("no paperboatd: install Paperboat or set PAPERBOATD");
  if (daemon_version(paperboatd) < std::vector<int>{0, 2, 0, 9}) SKIP(paperboatd.string() << " is older than 0.2.0-beta.9: no read-only leases");
  if (!core::ProcessRunner::run_sync({"python3", "--version"}).ok()) SKIP("no python3 for the native backend");
  const fs::path home = fs::path("/tmp") / ("pbro-" + std::to_string(getpid()));
  fs::remove_all(home);
  fs::create_directories(home / "run");
  const fs::path root = home / "examples", example = root / "simplicial" / "00-writes", cache = home / "home" / "cache" / "simplicial";
  fs::create_directories(cache);

  // the example: a block that writes where it may, then one that writes into the example by its absolute path
  write_file(example / "station.toml", "[station]\nformat = 0\nname = \"writes\"\nlanguage = \"python\"\nrun = \"station.py\"\n"
                                       "descriptor = \"descriptor.toml\"\n\n[run]\nduration = 0.05\n");
  write_file(example / "descriptor.toml", "domain = \"remote_writes\"\nimport = [\"base\", \"board\"]\n\n[graph]\nnodes = [\n"
                                          "  { id = \"keep\", type = \"keep\" },\n  { id = \"into\", type = \"into\" },\n"
                                          "  { id = \"result\", type = \"display\" },\n]\nedges = [\n"
                                          "  { from = [\"keep\", \"y\"], to = [\"into\", \"u\"] },\n  { from = [\"into\", \"y\"], to = [\"result\", \"in\"] },\n]\n");
  write_file(example / "station.py", "import os\nimport paperboat_runtime as pb\n\nCACHE = " + json(cache.string()).dump() + "\n\n\n"
             "class Keep:\n    def step(self, ctx, inputs):\n"
             "        with open(\"out.txt\", \"w\") as f:  # the working directory\n            f.write(\"work\\n\")\n"
             "        with open(os.path.join(CACHE, \"kept.txt\"), \"w\") as f:\n            f.write(\"cache\\n\")\n"
             "        return {\"y\": 1.0}\n\n\n"
             "class Into:\n    def step(self, ctx, inputs):\n"
             "        here = os.path.dirname(os.path.abspath(__file__))  # the example itself\n"
             "        with open(os.path.join(here, \"written.txt\"), \"w\") as f:\n            f.write(\"into the example\\n\")\n"
             "        return {\"y\": inputs.get(\"u\", 0.0)}\n\n\n"
             "pb.register(\"keep\", Keep, definition={\"label\": \"Keep\", \"outputs\": [\"y\"]})\n"
             "pb.register(\"into\", Into, definition={\"label\": \"Into\", \"inputs\": [\"u\"], \"outputs\": [\"y\"]})\n");
  const fs::path mine = home / "mine" / "00-writes";  // its copy, before the example is run
  fs::create_directories(mine.parent_path());
  fs::copy(example, mine, fs::copy_options::recursive);
  const auto git = [&](std::vector<std::string> a) {
    a.insert(a.begin(), {"git", "-C", root.string(), "-c", "user.name=test", "-c", "user.email=test@localhost"});
    return core::ProcessRunner::run_sync(a);
  };
  const bool tracked = git({"init", "-q"}).ok() && git({"add", "-A"}).ok() && git({"commit", "-qm", "examples"}).ok();
  const auto before = snapshot(root);

  // the platform as `paperboat example open` leaves it: the example's id, and a CLI whose list has its root
  const fs::path cli = home / "paperboat";
  write_file(cli, "#!/bin/sh\n[ \"$1 $2\" = \"example list\" ] || exit 2\ncat <<'EOF'\n" +
                      json::array({{{"id", "simplicial/00-writes"}, {"name", "00 Writes"}, {"app", "simplicial"},
                                    {"path", example.string()}, {"root", root.string()}}}).dump() + "\nEOF\n");
  fs::permissions(cli, fs::perms::owner_all);
  const std::vector<std::pair<std::string, std::string>> env = {
      {"PAPERBOAT_RUNTIME_DIR", (home / "run").string()}, {"PAPERBOAT_HOME", (home / "home").string()},
      {"PAPERBOATD", paperboatd.string()}, {"PAPERBOAT_BIN", cli.string()}};
  auto as_example = env;
  as_example.emplace_back("PAPERBOAT_EXAMPLE", "simplicial/00-writes");

  // a daemon of its own, native only; started here, so it ends here (with every runtime it started)
  const fs::path socket = home / "run" / "control.sock";
  auto daemon_env = env;
  daemon_env.emplace_back("PAPERBOAT_BACKENDS", "native");
  const int daemon_pid = core::ProcessRunner::run_detached({paperboatd.string(), "--socket", socket.string()}, home, daemon_env, home / "paperboatd.log");
  REQUIRE(daemon_pid > 0);
  struct Stop {
    int pid;
    fs::path home;
    ~Stop() {
      core::ProcessRunner::kill_pid(pid, SIGTERM, 10000);
      fs::remove_all(home);
    }
  } stop{daemon_pid, home};
  for (int i = 0; i < 200 && !fs::exists(socket); ++i) std::this_thread::sleep_for(std::chrono::milliseconds(100));

  const auto run = [&](const fs::path& station, const std::vector<std::pair<std::string, std::string>>& e) {
    const auto r = core::ProcessRunner::run_sync({engine().string(), "host", station.string(), "--run"}, home, e, std::chrono::minutes(5));
    std::string status;
    for (std::size_t at = 0; at < r.stdout_text.size();) {
      const std::size_t end = std::min(r.stdout_text.find('\n', at), r.stdout_text.size());
      const json m = json::parse(r.stdout_text.substr(at, end - at), nullptr, false);
      at = end + 1;
      if (m.is_object() && m.value("type", "") == "run.finished") status = m.value("status", "");
    }
    return std::pair{status, r.stdout_text + r.stderr_text};
  };

  const auto [status, said] = run(example, as_example);
  INFO(said);
  if (said.find("cannot keep a read-only project read-only here") != std::string::npos) SKIP("no Landlock here (Linux 5.19+)");
  CHECK(said.find(" on native (") != std::string::npos);
  CHECK(status == "failed");
  CHECK(said.find("written.txt") != std::string::npos);
  CHECK(said.find("is read-only: it is an example; copy it") != std::string::npos);
  CHECK(read_file(cache / "kept.txt") == "cache\n");  // the user's cache is written as ever
  CHECK(snapshot(root) == before);
  if (tracked) CHECK(git({"status", "--porcelain", "--ignored"}).stdout_text.empty());

  // the copy is the user's: no read-only lease, and the same code writes into it
  const auto [copied, copy_said] = run(mine, env);
  INFO(copy_said);
  CHECK(copied == "done");
  CHECK(read_file(mine / "written.txt") == "into the example\n");
  CHECK(snapshot(root) == before);
}
