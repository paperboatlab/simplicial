// The hubs the page's File › Open lists (hubs.hpp), with a stand-in `paperboat hub list --json`.
#include <filesystem>
#include <fstream>

#include <catch2/catch_test_macros.hpp>

#include "paperboat/core/hubs.hpp"
#include "paperboat/core/process.hpp"

namespace fs = std::filesystem;
namespace hubs = paperboat::core::hubs;

namespace {

void write(const fs::path& p, const std::string& text = "{}") {
  fs::create_directories(p.parent_path());
  std::ofstream(p) << text;
}

}  // namespace

TEST_CASE("a hub's tree: folders first, no dot entries or node_modules") {
  const fs::path root = fs::temp_directory_path() / "pb_hubs_tree";
  fs::remove_all(root);
  write(root / "b.psf");
  write(root / "a" / "x.pst");
  write(root / "a" / "notes.md");
  write(root / ".malachite" / "hub.toml");
  write(root / "node_modules" / "k.psf");
  const auto got = hubs::files(root);
  REQUIRE(got == nlohmann::json::parse(R"([
    {"path": "a", "kind": "folder"}, {"path": "a/notes.md", "kind": "file"}, {"path": "a/x.pst", "kind": "file"},
    {"path": "b.psf", "kind": "file"}])"));
  fs::remove_all(root);
}

TEST_CASE("a path in a hub stays in it and out of .malachite") {
  const fs::path root = fs::temp_directory_path() / "pb_hubs_inside";
  fs::remove_all(root);
  write(root / "flows" / "a.psf");
  CHECK(hubs::inside(root, "flows/a.psf") == fs::weakly_canonical(root / "flows" / "a.psf"));
  CHECK(hubs::inside(root, "new.psf"));  // a file Save as makes
  CHECK_FALSE(hubs::inside(root, ""));
  CHECK_FALSE(hubs::inside(root, "../a.psf"));
  CHECK_FALSE(hubs::inside(root, "flows/../../a.psf"));
  CHECK_FALSE(hubs::inside(root, "/etc/passwd"));
  CHECK_FALSE(hubs::inside(root, ".malachite/hub.toml"));
  fs::create_directory_symlink(fs::temp_directory_path(), root / "out");
  CHECK_FALSE(hubs::inside(root, "out/a.psf"));  // a link out of the hub
  fs::remove_all(root);
}

TEST_CASE("the hubs come from paperboat hub list --json; none without it") {
  const fs::path dir = fs::temp_directory_path() / "pb_hubs_list";
  fs::remove_all(dir);
  write(dir / "lab" / "p" / "one.psf");
  write(dir / "lab" / "two.psf");
  write(dir / "lab" / "st.pst");
  const fs::path cli = dir / "paperboat";
  write(cli, "#!/bin/sh\n[ \"$1 $2 $3\" = \"hub list --json\" ] || exit 2\ncat <<'EOF'\n"
             "[{\"id\": \"h1\", \"name\": \"lab\", \"path\": \"" + (dir / "lab").string() + "\", \"place\": \"local\", \"shown\": \"~/lab\","
             " \"conflicts\": [\"a (conflicted copy).psf\"]},\n"
             " {\"id\": \"h2\", \"name\": \"gone\", \"path\": \"/nowhere/gone\", \"place\": \"dropbox\", \"shown\": \"/nowhere/gone\", \"missing\": true},\n"
             " {\"name\": \"no id\"}]\nEOF\n");
  fs::permissions(cli, fs::perms::owner_all);
  const auto got = hubs::list(cli.string());
  REQUIRE(got.size() == 2);
  CHECK(got[0] == nlohmann::json{{"id", "h1"}, {"name", "lab"}, {"place", "local"}, {"path", "~/lab"}, {"psf", 2}, {"pst", 1}, {"conflicts", 1}});
  CHECK(got[1]["missing"] == true);
  CHECK(got[1]["place"] == "dropbox");
  CHECK(hubs::list((dir / "no-such-paperboat").string()).empty());  // no Malachite, no hub
  write(cli, "#!/bin/sh\necho 'malachite: not installed' >&2\nexit 1\n");
  CHECK(hubs::list(cli.string()).empty());
  fs::remove_all(dir);
}

TEST_CASE("the examples come from paperboat example list; none without it; open says why it can't") {
  const fs::path dir = fs::temp_directory_path() / "pb_hubs_examples";
  fs::remove_all(dir);
  const fs::path cli = dir / "paperboat";
  write(cli, "#!/bin/sh\n"
             "if [ \"$*\" = \"example list --app simplicial --json\" ]; then cat <<'EOF'\n"
             "[{\"id\": \"simplicial/09-modular-synth-cpp\", \"app\": \"simplicial\", \"kind\": \"simplicial\", \"name\": \"09 Modular Synth\","
             " \"description\": \"A synth\", \"path\": \"/x/09\"}, {\"name\": \"no id\"}]\nEOF\n"
             "elif [ \"$*\" = \"example open simplicial/09-modular-synth-cpp --json\" ]; then\n"
             "  echo '{\"id\": \"simplicial/09-modular-synth-cpp\", \"path\": \"/home/me/09\", \"session\": \"s1\"}'\n"
             "elif [ \"$*\" = \"example open simplicial/09-modular-synth-cpp --to /home/me/work --json\" ]; then\n"
             "  echo '{\"id\": \"simplicial/09-modular-synth-cpp\", \"path\": \"/x/09\", \"session\": \"s2\"}'\n"
             "elif [ \"$*\" = \"example copy simplicial/09-modular-synth-cpp --to /home/me/my work --open --json\" ]; then\n"
             "  echo '{\"id\": \"simplicial/09-modular-synth-cpp\", \"path\": \"/home/me/my work/09\", \"session\": \"s3\"}'\n"
             "elif [ \"$2\" = copy ]; then echo '{\"error\": \"/home/me/09 is there already; copy it to another folder\"}'; exit 2\n"
             "elif [ \"$2\" = open ]; then echo '{\"error\": \"no example simplicial/nope\"}'; exit 2\n"
             "else exit 1; fi\n");
  fs::permissions(cli, fs::perms::owner_all);
  const auto got = hubs::examples(cli.string());
  REQUIRE(got.size() == 1);
  CHECK(got[0]["name"] == "09 Modular Synth");
  CHECK(hubs::open_example(cli.string(), "simplicial/09-modular-synth-cpp") ==
        nlohmann::json{{"id", "simplicial/09-modular-synth-cpp"}, {"path", "/home/me/09"}, {"session", "s1"}});
  CHECK(hubs::open_example(cli.string(), "simplicial/nope") == nlohmann::json{{"error", "no example simplicial/nope"}});
  CHECK(hubs::open_example(cli.string(), "--help").contains("error"));  // never a flag for the CLI
  CHECK(hubs::open_example(cli.string(), "simplicial/09-modular-synth-cpp", "/home/me/work")["session"] == "s2");
  CHECK(hubs::copy_example(cli.string(), "simplicial/09-modular-synth-cpp", "/home/me/my work") ==
        nlohmann::json{{"id", "simplicial/09-modular-synth-cpp"}, {"path", "/home/me/my work/09"}, {"session", "s3"}});
  CHECK(hubs::copy_example(cli.string(), "simplicial/09-modular-synth-cpp", "/home/me") ==
        nlohmann::json{{"error", "/home/me/09 is there already; copy it to another folder"}});
  // a bad folder never reaches the CLI: the guard's words, not the fake's
  for (const std::string bad : {"", "-rf", "--to=/x", "relative/dir"}) {
    const auto r = hubs::copy_example(cli.string(), "simplicial/09-modular-synth-cpp", bad);
    CHECK((r["error"] == "no folder" || r["error"] == bad + " is not an absolute folder"));
  }
  CHECK(hubs::open_example(cli.string(), "simplicial/09-modular-synth-cpp", "-x") == nlohmann::json{{"error", "-x is not an absolute folder"}});
  CHECK(hubs::copy_example(cli.string(), "--help", "/home/me").contains("error"));
  CHECK(hubs::examples((dir / "no-such-paperboat").string()).empty());  // no Paperboat, no examples
  CHECK(hubs::open_example((dir / "no-such-paperboat").string(), "simplicial/09-modular-synth-cpp").contains("error"));
  write(cli, "#!/bin/sh\necho 'not json'\n");
  CHECK(hubs::examples(cli.string()).empty());
  fs::remove_all(dir);
}

namespace {

// A .pst as `paperboat pack` makes one: a zip with station.toml at its root.
void pack(const fs::path& pst, const std::string& name, const std::string& version) {
  fs::create_directories(pst.parent_path());
  const auto r = paperboat::core::ProcessRunner::run_sync(
      {"python3", "-c", "import sys, zipfile\nwith zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED) as z:\n"
                        " z.writestr('station.toml', '[station]\\nformat = 0\\nname = \"' + sys.argv[2] + '\"\\nversion = \"' + sys.argv[3] + '\"\\n')",
       pst.string(), name, version});
  REQUIRE(r.ok());
}

void station_folder(const fs::path& dir, const std::string& name, const std::string& version) {
  write(dir / "station.toml", "[station]\nformat = 0\nname = \"" + name + "\"\nversion = \"" + version + "\"\n");
}

}  // namespace

TEST_CASE("versions compare part by part") {
  CHECK(hubs::newer("0.10.0", "0.9.2"));
  CHECK(hubs::newer("1.0", "0.9.9"));
  CHECK(hubs::newer("0.2.1", "0.2"));
  CHECK_FALSE(hubs::newer("0.2.0", "0.2.0"));
  CHECK_FALSE(hubs::newer("0.1.9", "0.2.0"));
}

TEST_CASE("a .pst's station is its station.toml, read in the zip") {
  const fs::path dir = fs::temp_directory_path() / "pb_hubs_pst";
  fs::remove_all(dir);
  pack(dir / "cart-pole.pst", "cart-pole", "0.2.0");
  write(dir / "broken.pst", "not a zip");
  station_folder(dir / "dev", "pendulum", "0.3.0");
  const auto got = hubs::stations({dir / "cart-pole.pst", dir / "broken.pst", dir / "dev"});
  REQUIRE(got.size() == 2);
  CHECK(got[0].name == "pendulum");  // folders first: they need no packer
  CHECK(got[0].sha256.empty());
  CHECK(got[1].name == "cart-pole");
  CHECK(got[1].version == "0.2.0");
  CHECK(got[1].sha256.size() == 64);
  fs::remove_all(dir);
}

TEST_CASE("finding a flow's station: its path, the hub, installed, running, by name") {
  const fs::path hub = fs::temp_directory_path() / "pb_hubs_find";
  fs::remove_all(hub);
  pack(hub / "stations" / "cart-pole.pst", "cart-pole", "0.2.0");
  pack(hub / "old" / "cart-pole-0.1.pst", "cart-pole", "0.1.0");
  write(hub / "flows" / "here.psf", R"({"paperboat": 1, "station": {"name": "cart-pole", "version": "0.2.0", "path": "../stations/cart-pole.pst"}, "flow": {"nodes": [], "edges": []}})");
  write(hub / "flows" / "moved.psf", R"({"paperboat": 1, "station": {"name": "cart-pole", "version": "0.1.0", "path": "../cart-pole.pst"}, "flow": {"nodes": [], "edges": []}})");
  write(hub / "old.psf", R"({"paperboat": 0, "station": "cart-pole", "flow": {"nodes": [], "edges": []}})");
  write(hub / "lost.psf", R"({"paperboat": 1, "station": {"name": "pump-rig", "version": "0.1.0"}, "flow": {"nodes": [], "edges": []}})");
  write(hub / "ex.psf", R"({"paperboat": 1, "station": {"name": "thermostat"}, "flow": {"nodes": [], "edges": []}})");
  const hubs::Elsewhere outside{{{"/home/u/.paperboat/stations/thermostat", "thermostat", "0.1.0", "", 0}},
                                {{"/tmp/run/pendulum", "pendulum", "0.4.0", "", 51302}}};

  auto f = hubs::find(hub, "flows/here.psf", "", "", outside);
  CHECK(f["found"]["where"] == "path");
  CHECK(f["found"]["path"] == "stations/cart-pole.pst");
  CHECK(f["found"]["version"] == "0.2.0");
  CHECK(f["found"]["sha256"].get<std::string>().size() == 64);
  f = hubs::find(hub, "flows/moved.psf", "", "", outside);  // not at its path: the hub's, the exact version first
  CHECK(f["found"]["where"] == "workspace");
  CHECK(f["found"]["path"] == "old/cart-pole-0.1.pst");
  CHECK(hubs::find(hub, "old.psf", "", "", outside)["found"]["path"] == "stations/cart-pole.pst");  // format 0: the newest
  CHECK(hubs::find(hub, "ex.psf", "", "", outside)["found"]["where"] == "installed");
  f = hubs::find({}, "", "pendulum", "", outside);
  CHECK(f["found"]["where"] == "running");
  CHECK(f["found"]["port"] == 51302);
  f = hubs::find(hub, "lost.psf", "", "", outside);
  CHECK(f["missing"] == nlohmann::json{{"name", "pump-rig"}, {"version", "0.1.0"}});
  CHECK(f["looked"].size() == 3);  // no path to look at: the hub, installed, running

  // the picker's tree: a station on each .pst, and each flow's parent (null and a warning when found nowhere)
  const auto tree = hubs::entries(hub, outside);
  const auto at = [&](const std::string& p) {
    for (const auto& e : tree) if (e["path"] == p) return e;
    return nlohmann::json();
  };
  CHECK(at("stations/cart-pole.pst")["station"] == nlohmann::json{{"name", "cart-pole"}, {"version", "0.2.0"}});
  CHECK(at("flows/here.psf")["parent"] == "stations/cart-pole.pst");
  CHECK(at("flows/here.psf")["station"]["path"] == "../stations/cart-pole.pst");
  CHECK(at("old.psf")["station"] == nlohmann::json{{"name", "cart-pole"}});
  CHECK(at("lost.psf")["parent"].is_null());
  CHECK(at("lost.psf")["warn"] == "pump-rig 0.1.0 not found");
  CHECK_FALSE(at("ex.psf").contains("parent"));  // found, outside the hub: not nested
  fs::remove_all(hub);
}
