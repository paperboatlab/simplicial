#pragma once

// Paperboat's examples are read-only (paperboat#75): `paperboat example open` opens one where it is (its
// paperboat-examples checkout, or the CLI's copy of it), and nothing Simplicial does may write there. The platform
// tells only the page that a window is an example (its URL); the engine knows an example by where it is.

#include <filesystem>
#include <vector>

namespace paperboat::core::examples {

// Where paperboat-examples is on this computer, as the CLI looks: $PAPERBOAT_EXAMPLES_DIR and the CLI's copy
// ($PAPERBOAT_HOME/cache/examples), those that are there.
std::vector<std::filesystem::path> roots();

// True when `path` (a file or a folder, there or not) is in an example: under one of roots(), or under a
// paperboat-examples checkout found by its own markers (a `golden.py` at its top beside `<group>/<example>/
// example.toml`), as the CLI's sibling checkout is. A copy of an example (`paperboat example copy`) is not one.
bool inside(const std::filesystem::path& path);

// Where an example's station builds and keeps what a run leaves, instead of its own folder:
// $PAPERBOAT_HOME/cache/simplicial/examples/<its folder's name>-<a hash of its path>.
std::filesystem::path scratch(const std::filesystem::path& station_dir);

// A C++ station's build folder: <station>/build, or scratch(<station>)/build for an example.
std::filesystem::path build_dir(const std::filesystem::path& station_dir);

}  // namespace paperboat::core::examples
