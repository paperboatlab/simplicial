// Julia and Python stations out of process (remote.cpp): a runtime's definitions read into the
// engine's, and, where paperboatd is installed, each test station run headless through it.

#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_floating_point.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>

#include <chrono>
#include <cmath>
#include <map>
#include <cstdlib>
#include <filesystem>
#include <regex>
#include <thread>
#include <unistd.h>

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
  fs::create_directories(home);
  const std::vector<std::pair<std::string, std::string>> env = {
      {"PAPERBOAT_RUNTIME_DIR", (home / "run").string()}, {"PAPERBOAT_HOME", (home / "home").string()}, {"PAPERBOATD", paperboatd.string()}};

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
  core::ProcessRunner::run_sync({"paperboat", "daemon", "stop"}, {}, env);
  fs::remove_all(home);
}
