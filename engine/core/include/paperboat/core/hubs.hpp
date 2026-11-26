#pragma once

// The hubs this machine knows (paperboat#16), for the page's File › Open and Save as. No Malachite, no hub:
// they come from `paperboat hub list --json`, Malachite's command; without it there are none. The page server
// (serve_files) lists a hub's files and reads and writes its .psf files through here.

#include <filesystem>
#include <optional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

namespace paperboat::core::hubs {

// `<cli> hub list --json` as it answers (each hub's id, name, path, place, shown, missing, conflicts), run with
// no shell and a timeout; [] when the command is missing, fails or says something else.
nlohmann::json known(const std::string& cli);

// The known hubs as the page's picker shows them: {id, name, place, path (as the user reads it), missing?,
// conflicts? (how many), psf, pst (how many of Simplicial's files it holds)}.
nlohmann::json list(const std::string& cli);

// A hub's folders and files in tree order, folders first: [{path, kind: "folder" | "file"}], paths hub-relative
// with `/`. Dot entries (`.malachite/` among them) and node_modules never.
nlohmann::json files(const std::filesystem::path& root);

// `rel` (hub-relative, `/`) as a path inside the hub `root`; nothing when it is empty, leaves the hub (`..`, a
// link out) or goes through a dot entry (`.malachite/`).
std::optional<std::filesystem::path> inside(const std::filesystem::path& root, const std::string& rel);

// A station on disk: a .pst or a station folder, its station.toml's name and version (read in the zip for a .pst),
// and a .pst's sha256 (a folder, a station under development, has none). `port`: a running one's.
struct StationInfo {
  std::filesystem::path at;
  std::string name;
  std::string version;
  std::string sha256;
  int port = 0;
};

// The stations at these paths (.pst files, station folders): the .pst read in one call of the packer
// (scripts/package_station.py info); one that can't be read is left out.
std::vector<StationInfo> stations(const std::vector<std::filesystem::path>& at);

// Where a flow's station may be outside its hub: the installed ones (the user's stations, the examples) and the
// running ones (their `hello` name and port).
struct Elsewhere {
  std::vector<StationInfo> installed;
  std::vector<StationInfo> running;
};
// This computer's.
Elsewhere elsewhere();

// A hub's files as files() gives them, with Simplicial's stations on them: a .pst's and a station folder's
// `station` {name, version}; a .psf's `station` {name, version?, path?} (its header), its `parent` (the hub
// path of the .pst or folder it resolves to; null when its station is found nowhere, absent when it is found
// outside the hub) and, when null, `warn` ("pump-rig 0.1.0 not found").
nlohmann::json entries(const std::filesystem::path& root, const Elsewhere& outside);

// Finding a flow's station (plans/2026-11-26_12-55_psf_pst_rework.md): the flow's `path` (relative to `psf`, in
// the hub `root`), the hub, the installed stations, the running ones, by name (the exact version first, then the
// newest). `root` may be empty (no hub), and `psf` too (by name only). {found: {where: "path" | "workspace" |
// "installed" | "running", path, name, version, sha256?, port?}} or {missing: {name, version?}, looked: [...]}.
nlohmann::json find(const std::filesystem::path& root, const std::string& psf, const std::string& name,
                    const std::string& version, const Elsewhere& outside);

// Whether version `a` is newer than `b`, part by part ("0.10.0" > "0.9.2").
bool newer(const std::string& a, const std::string& b);

}  // namespace paperboat::core::hubs
