#pragma once

// The one file workflow (plans/2026-11-26_11-05_one_file_workflow.md, "The contract every app follows"): what the
// page works in (a folder on this computer or a hub, switched at runtime), and the store every Paperboat app shares
// under $PAPERBOAT_HOME: `recent.json` (folders, hubs and files opened, newest first) and `settings.json` (the theme and the interface scale).

#include <filesystem>
#include <string>

#include <nlohmann/json.hpp>

namespace paperboat::core::workspace {

// $PAPERBOAT_HOME, else %LOCALAPPDATA%/paperboat (Windows), else $XDG_DATA_HOME/paperboat, else
// ~/.local/share/paperboat: as paperboat/src/lib/paths.cpp.
std::filesystem::path home();

// A file as JSON; null when it is missing or isn't JSON.
nlohmann::json read(const std::filesystem::path& file);
// Written whole to a temp file beside it, then renamed (another app never reads half of it); false when it can't be.
bool write(const std::filesystem::path& file, const nlohmann::json& doc);

constexpr int kRecentMax = 40;
// recent.json as read: {version: 1, recent: [{kind: "folder" | "hub" | "file", path, hub?, app?, at}]}.
nlohmann::json recent();
// `path` (absolute) put first, as opened by Simplicial now; an older entry of the same kind and path goes, 40 at
// most. `hub`: the hub's id (a hub, or a file in one).
void remember(const std::string& kind, const std::filesystem::path& path, const std::string& hub = "");
// Clear recent.
void forget();

// settings.json as read: {version: 1, theme: "light" | "dark" | "system", scale: 0.75 | 1 | 1.25} ("system", 1 when unset).
nlohmann::json settings();
// The theme and the interface scale every app starts in ({theme?, scale?}); false, and nothing written, on a
// value not among them. The file's other keys stay.
bool save_settings(const nlohmann::json& change);

// The workspace a folder is: the hub whose folder holds it (`hubs` as hubs::known gives them), else the folder
// itself: {kind: "folder" | "hub", root, name, hub?}.
nlohmann::json place_of(const std::filesystem::path& dir, const nlohmann::json& hubs);

// A path as typed: ~ and ~/… are the home folder; empty when it isn't absolute.
std::filesystem::path typed(const std::string& path);

}  // namespace paperboat::core::workspace
