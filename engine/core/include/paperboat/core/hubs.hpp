#pragma once

// The hubs this machine knows (paperboat#16), for the page's File › Open and Save as. No Malachite, no hub:
// they come from `paperboat hub list --json`, Malachite's command; without it there are none. The page server
// (serve_files) lists a hub's files and reads and writes its .psf files through here.

#include <filesystem>
#include <optional>
#include <string>

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

}  // namespace paperboat::core::hubs
