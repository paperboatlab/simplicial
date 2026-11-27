// Paperboat's examples are read-only (examples.hpp, paperboat#75): where one is, what stays out of Recent and the hubs,
// and a C++ example's build, which goes to the user's scratch and leaves the example as it was.
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <map>
#include <sstream>
#include <string>

#include <catch2/catch_test_macros.hpp>

#include "paperboat/core/examples.hpp"
#include "paperboat/core/hubs.hpp"
#include "paperboat/core/process.hpp"
#include "paperboat/core/station_manager.hpp"
#include "paperboat/core/workspace.hpp"

namespace fs = std::filesystem;
namespace ex = paperboat::core::examples;
namespace ws = paperboat::core::workspace;
using nlohmann::json;

namespace {

void write(const fs::path& p, const std::string& text) {
  fs::create_directories(p.parent_path());
  std::ofstream(p, std::ios::binary) << text;
}

// Every file under `dir` and what it holds: the same before and after means nothing was written there.
std::map<std::string, std::string> snapshot(const fs::path& dir) {
  std::map<std::string, std::string> out;
  for (const auto& e : fs::recursive_directory_iterator(dir)) {
    const std::string rel = e.path().lexically_relative(dir).generic_string();
    if (!e.is_regular_file()) {
      out[rel + "/"] = "";
      continue;
    }
    std::ifstream in(e.path(), std::ios::binary);
    std::stringstream s;
    s << in.rdbuf();
    out[rel] = s.str();
  }
  return out;
}

// $PAPERBOAT_HOME and $PAPERBOAT_EXAMPLES_DIR for one test, put back after.
struct Env {
  std::string home, examples;
  bool had_home, had_examples;
  Env() {
    const char* h = std::getenv("PAPERBOAT_HOME");
    const char* e = std::getenv("PAPERBOAT_EXAMPLES_DIR");
    had_home = h, had_examples = e;
    home = h ? h : "", examples = e ? e : "";
    unsetenv("PAPERBOAT_EXAMPLES_DIR");
  }
  ~Env() {
    if (had_home) setenv("PAPERBOAT_HOME", home.c_str(), 1);
    else unsetenv("PAPERBOAT_HOME");
    if (had_examples) setenv("PAPERBOAT_EXAMPLES_DIR", examples.c_str(), 1);
    else unsetenv("PAPERBOAT_EXAMPLES_DIR");
  }
};

// A paperboat-examples checkout as the CLI's sibling one is: golden.py at its top, <group>/<example>/example.toml.
fs::path checkout(const fs::path& at) {
  write(at / "golden.py", "# the golden harness\n");
  write(at / "simplicial" / "00-tiny" / "example.toml", "kind = \"simplicial\"\napp = \"simplicial\"\nname = \"00 Tiny\"\n");
  write(at / "hubs" / "lab" / "example.toml", "kind = \"hub\"\napp = \"malachite\"\nname = \"Lab\"\n");
  return at;
}

}  // namespace

TEST_CASE("an example is in $PAPERBOAT_EXAMPLES_DIR, the CLI's cache or a checkout; its copy is the user's") {
  Env keep;
  const fs::path dir = fs::temp_directory_path() / "pb_examples_where";
  fs::remove_all(dir);
  setenv("PAPERBOAT_HOME", (dir / "home").c_str(), 1);
  fs::create_directories(dir / "mine");

  // a checkout beside the CLI's (found by its markers), its examples, a hub, a file not there yet, the top itself
  const fs::path repo = checkout(dir / "paperboat-examples");
  CHECK(ex::inside(repo / "simplicial" / "00-tiny"));
  CHECK(ex::inside(repo / "simplicial" / "00-tiny" / "flows" / "new.psf"));
  CHECK(ex::inside(repo / "hubs" / "lab"));
  CHECK(ex::inside(repo));
  CHECK(ex::inside(repo / "simplicial" / ".." / "simplicial" / "00-tiny"));
  // a copy (`paperboat example copy`: example.toml and all) is the user's, and so is a folder beside the checkout
  fs::copy(repo / "simplicial" / "00-tiny", dir / "mine" / "00-tiny", fs::copy_options::recursive);
  CHECK_FALSE(ex::inside(dir / "mine" / "00-tiny"));
  CHECK_FALSE(ex::inside(dir / "mine" / "00-tiny" / "a.psf"));
  CHECK_FALSE(ex::inside(dir / "mine"));
  CHECK_FALSE(ex::inside({}));
  // golden.py alone isn't a checkout
  write(dir / "other" / "golden.py", "");
  CHECK_FALSE(ex::inside(dir / "other" / "x.psf"));

  // the CLI's copy from GitHub, and $PAPERBOAT_EXAMPLES_DIR: anything in them
  fs::create_directories(dir / "home" / "cache" / "examples" / "simplicial" / "01-x");
  CHECK(ex::inside(dir / "home" / "cache" / "examples" / "simplicial" / "01-x" / "station.toml"));
  fs::create_directories(dir / "elsewhere" / "simplicial" / "02-y");
  CHECK_FALSE(ex::inside(dir / "elsewhere" / "simplicial" / "02-y"));
  setenv("PAPERBOAT_EXAMPLES_DIR", (dir / "elsewhere").c_str(), 1);
  CHECK(ex::inside(dir / "elsewhere" / "simplicial" / "02-y"));
  CHECK(ex::roots().size() == 2);

  // an example's build is in the user's cache, a station's own in its folder
  const fs::path tiny = repo / "simplicial" / "00-tiny";
  CHECK(ex::build_dir(tiny).parent_path().parent_path() == dir / "home" / "cache" / "simplicial" / "examples");
  CHECK(ex::build_dir(tiny).filename() == "build");
  CHECK(ex::build_dir(tiny).parent_path().filename().string().starts_with("00-tiny-"));
  CHECK(ex::build_dir(tiny) == ex::build_dir(tiny / "." ));  // the same folder, the same scratch
  CHECK(ex::build_dir(tiny) != ex::build_dir(dir / "elsewhere" / "simplicial" / "02-y"));
  CHECK(ex::build_dir(dir / "mine" / "00-tiny") == dir / "mine" / "00-tiny" / "build");
  fs::remove_all(dir);
}

TEST_CASE("an example opened where it is stays out of Recent; its folder says it is one; an example hub is no hub") {
  Env keep;
  const fs::path dir = fs::temp_directory_path() / "pb_examples_recent";
  fs::remove_all(dir);
  setenv("PAPERBOAT_HOME", (dir / "home").c_str(), 1);
  const fs::path repo = checkout(dir / "paperboat-examples"), tiny = repo / "simplicial" / "00-tiny";
  fs::create_directories(dir / "mine");

  ws::remember("folder", tiny);
  ws::remember("file", tiny / "loop.psf");
  ws::remember("hub", repo / "hubs" / "lab", "h_lab");
  ws::remember("folder", dir / "mine");
  auto list = ws::recent()["recent"];
  REQUIRE(list.size() == 1);
  CHECK(list[0]["path"] == (dir / "mine").generic_string());
  // one written before (another app, an older Simplicial) is left out when read
  ws::write(ws::home() / "recent.json", {{"version", 1}, {"recent", json::array({
      {{"kind", "folder"}, {"path", tiny.generic_string()}, {"at", 2}},
      {{"kind", "folder"}, {"path", (dir / "mine").generic_string()}, {"at", 1}}})}});
  list = ws::recent()["recent"];
  REQUIRE(list.size() == 1);
  CHECK(list[0]["path"] == (dir / "mine").generic_string());

  CHECK(ws::place_of(tiny, json::array())["example"] == true);
  CHECK_FALSE(ws::place_of(dir / "mine", json::array()).contains("example"));

  // Malachite's hub list naming an example's hub (as it did for the ones it opened): not one of the user's
  const fs::path cli = dir / "paperboat";
  write(cli, "#!/bin/sh\n[ \"$1 $2 $3\" = \"hub list --json\" ] || exit 2\ncat <<'EOF'\n"
             "[{\"id\": \"h_lab\", \"name\": \"Lab\", \"path\": \"" + (repo / "hubs" / "lab").string() + "\"},\n"
             " {\"id\": \"h_mine\", \"name\": \"mine\", \"path\": \"" + (dir / "mine").string() + "\"}]\nEOF\n");
  fs::permissions(cli, fs::perms::owner_all);
  const json known = paperboat::core::hubs::known(cli.string());
  REQUIRE(known.size() == 1);
  CHECK(known[0]["id"] == "h_mine");
  CHECK(paperboat::core::hubs::list(cli.string()).size() == 1);
  fs::remove_all(dir);
}

TEST_CASE("a C++ example builds in the user's cache: its folder is byte for byte as it was") {
  if (!paperboat::core::ProcessRunner::run_sync({"cmake", "--version"}).ok()) SKIP("no cmake");
  Env keep;
  const fs::path dir = fs::temp_directory_path() / "pb_examples_build";
  fs::remove_all(dir);
  setenv("PAPERBOAT_HOME", (dir / "home").c_str(), 1);
  const fs::path tiny = checkout(dir / "paperboat-examples") / "simplicial" / "00-tiny";
  write(tiny / "CMakeLists.txt", "cmake_minimum_required(VERSION 3.20)\nproject(tiny LANGUAGES CXX)\n"
                                 "add_executable(paperboat-tiny main.cpp)\n");
  write(tiny / "main.cpp", "int main() { return 0; }\n");
  write(tiny / "station.toml", "[station]\nname = \"00-tiny\"\nversion = \"0.1.0\"\nlanguage = \"cpp\"\nrun = \"build/paperboat-tiny\"\n");
  const auto before = snapshot(tiny);

  std::string err;
  REQUIRE(paperboat::core::StationManager::ensure_built(tiny, false, false, &err));
  CHECK(err.empty());
  CHECK(fs::is_regular_file(ex::build_dir(tiny) / "paperboat-tiny"));
  CHECK_FALSE(paperboat::core::StationManager::needs_rebuild(tiny));  // the stamp is in the scratch too
  REQUIRE(paperboat::core::StationManager::ensure_built(tiny, /*clean=*/true, false, &err));  // a clean build, too
  CHECK(snapshot(tiny) == before);
  CHECK_FALSE(fs::exists(tiny / "build"));
  fs::remove_all(dir);
}
