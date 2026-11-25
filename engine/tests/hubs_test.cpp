// The hubs the page's File › Open lists (hubs.hpp), with a stand-in `paperboat hub list --json`.
#include <filesystem>
#include <fstream>

#include <catch2/catch_test_macros.hpp>

#include "paperboat/core/hubs.hpp"

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
