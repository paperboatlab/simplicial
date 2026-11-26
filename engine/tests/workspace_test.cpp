// The workspace and the store every app shares under $PAPERBOAT_HOME (workspace.hpp).
#include <cstdlib>
#include <filesystem>
#include <fstream>

#include <catch2/catch_test_macros.hpp>

#include "paperboat/core/workspace.hpp"

namespace fs = std::filesystem;
namespace ws = paperboat::core::workspace;
using nlohmann::json;

TEST_CASE("$PAPERBOAT_HOME, else $XDG_DATA_HOME/paperboat, else ~/.local/share/paperboat") {
  const char* keep = std::getenv("PAPERBOAT_HOME");
  const std::string kept = keep ? keep : "";
  setenv("PAPERBOAT_HOME", "/tmp/pb-home", 1);
  CHECK(ws::home() == fs::path("/tmp/pb-home"));
  unsetenv("PAPERBOAT_HOME");
  setenv("XDG_DATA_HOME", "/tmp/xdg", 1);
  CHECK(ws::home() == fs::path("/tmp/xdg/paperboat"));
  unsetenv("XDG_DATA_HOME");
  CHECK(ws::home() == fs::path(std::getenv("HOME")) / ".local" / "share" / "paperboat");
  if (keep) setenv("PAPERBOAT_HOME", kept.c_str(), 1);
}

TEST_CASE("recent.json: newest first, one per kind and path, 40 at most, written whole") {
  const fs::path home = fs::temp_directory_path() / "pb_ws_recent";
  fs::remove_all(home);
  setenv("PAPERBOAT_HOME", home.c_str(), 1);
  CHECK(ws::recent() == json{{"version", 1}, {"recent", json::array()}});  // no file yet
  ws::remember("folder", "/p/tank-level");
  ws::remember("file", "/hubs/lab/a.psf", "h1");
  ws::remember("folder", "/p/tank-level");  // again: it moves up, once
  auto list = ws::recent()["recent"];
  REQUIRE(list.size() == 2);
  CHECK(list[0]["path"] == "/p/tank-level");
  CHECK(list[0]["app"] == "simplicial");
  CHECK(list[1] == json{{"kind", "file"}, {"path", "/hubs/lab/a.psf"}, {"hub", "h1"}, {"app", "simplicial"}, {"at", list[1]["at"]}});
  ws::remember("file", "/p/tank-level");  // another kind, the same path: its own entry
  CHECK(ws::recent()["recent"].size() == 3);
  for (int i = 0; i < 50; ++i) ws::remember("file", "/f/" + std::to_string(i) + ".psf");
  list = ws::recent()["recent"];
  CHECK(list.size() == ws::kRecentMax);
  CHECK(list[0]["path"] == "/f/49.psf");
  int files = 0;
  for (const auto& e : fs::directory_iterator(home)) files += e.path().extension() == ".tmp" ? 100 : 1;
  CHECK(files == 1);  // recent.json, no temp file left
  std::ofstream(home / "recent.json") << "{\"recent\": [{\"kind\": \"nope\", \"path\": \"/x\", \"at\": 1}, {\"kind\": \"hub\", \"path\": \"/h\", \"at\": 2}]";
  CHECK(ws::recent()["recent"].empty());  // broken: an empty list
  std::ofstream(home / "recent.json") << "{\"recent\": [{\"kind\": \"nope\", \"path\": \"/x\", \"at\": 1}, {\"kind\": \"hub\", \"path\": \"/h\", \"at\": 2}]}";
  CHECK(ws::recent()["recent"].size() == 1);  // an entry it can't read is left out
  ws::forget();
  CHECK(ws::recent()["recent"].empty());
  fs::remove_all(home);
}

TEST_CASE("settings.json: the theme, its other keys kept") {
  const fs::path home = fs::temp_directory_path() / "pb_ws_settings";
  fs::remove_all(home);
  setenv("PAPERBOAT_HOME", home.c_str(), 1);
  CHECK(ws::settings()["theme"] == "system");
  fs::create_directories(home);
  std::ofstream(home / "settings.json") << R"({"version": 1, "theme": "light", "launcher": {"tray": true}})";
  CHECK(ws::settings()["theme"] == "light");
  CHECK(ws::set_theme("dark"));
  CHECK_FALSE(ws::set_theme("blue"));
  const json doc = ws::read(home / "settings.json");
  CHECK(doc["theme"] == "dark");
  CHECK(doc["launcher"]["tray"] == true);
  fs::remove_all(home);
}

TEST_CASE("a folder in a hub is the hub; any other is itself; a typed path") {
  const fs::path dir = fs::temp_directory_path() / "pb_ws_place";
  fs::remove_all(dir);
  fs::create_directories(dir / "lab" / "flows");
  fs::create_directories(dir / "lab-2");
  const json hubs = json::array({{{"id", "h1"}, {"name", "tank-lab"}, {"path", (dir / "lab").string()}}});
  const auto lab = fs::weakly_canonical(dir / "lab").string();
  CHECK(ws::place_of(dir / "lab" / "flows", hubs) == json{{"kind", "hub"}, {"root", lab}, {"name", "tank-lab"}, {"hub", "h1"}});
  CHECK(ws::place_of(dir / "lab", hubs)["hub"] == "h1");
  CHECK(ws::place_of(dir / "lab-2", hubs) == json{{"kind", "folder"}, {"root", fs::weakly_canonical(dir / "lab-2").string()}, {"name", "lab-2"}});
  CHECK(ws::typed("~/p/x.psf") == fs::path(std::getenv("HOME")) / "p" / "x.psf");
  CHECK(ws::typed("/a/../b") == fs::path("/b"));
  CHECK(ws::typed("~") == fs::path(std::getenv("HOME")));  // no trailing /: the page shows it as ~
  CHECK(ws::typed("relative/x").empty());
  fs::remove_all(dir);
}
