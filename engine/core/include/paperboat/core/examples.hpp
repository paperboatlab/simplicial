#pragma once

// Paperboat's examples are read-only (paperboat#75, #85): `paperboat example open` opens one where it is (its
// paperboat-examples checkout, $PAPERBOAT_EXAMPLES_DIR or the CLI's copy of it), and nothing Simplicial does may
// write there. The platform says so (paperboat/docs/apps.md): the server it starts for an example has
// PAPERBOAT_EXAMPLE=<id>, and every entry of `paperboat example list --json` has `root`, the folder the examples are
// in. paperboatd holds a runtime to it (a lease with `readonly`: remote.cpp).

#include <filesystem>
#include <optional>
#include <string>
#include <vector>

namespace paperboat::core::examples {

// An example, as `paperboat example list --json` lists it.
struct Example {
  std::string id, name;
  std::filesystem::path path;
};

// Where examples are on this computer: the `root` of each entry of `paperboat example list --json` ($PAPERBOAT_BIN,
// else `paperboat`). A paperboat before 0.2.0-beta.9 gives none: then $PAPERBOAT_EXAMPLES_DIR and the CLI's copy
// ($PAPERBOAT_HOME/cache/examples), those that are there. The list is read at most every few seconds.
std::vector<std::filesystem::path> roots();

// The example this process was opened as: PAPERBOAT_EXAMPLE=<id>, its folder from the list (or `folder`, the one the
// server was started on, given once by serve_files). Empty without the variable.
std::optional<Example> opened();
void opened_at(const std::filesystem::path& folder);

// The example `path` (a file or a folder, there or not) is in: opened()'s, else the list's entry whose folder holds it.
// Empty for one only the fallback below knows (no id), and for anything else.
std::optional<Example> of(const std::filesystem::path& path);

// True when `path` is in an example: in opened()'s folder or under one of roots(), or, for a paperboat that gives no
// `root`, under a paperboat-examples checkout found by its own markers (a `golden.py` at its top beside
// `<group>/<example>/example.toml`), as that CLI's sibling checkout is. A copy (`paperboat example copy`) is not one.
bool inside(const std::filesystem::path& path);

// Where an example's station builds and keeps what a run leaves, instead of its own folder:
// $PAPERBOAT_HOME/cache/simplicial/examples/<its folder's name>-<a hash of its path>.
std::filesystem::path scratch(const std::filesystem::path& station_dir);

// A C++ station's build folder: <station>/build, or scratch(<station>)/build for an example.
std::filesystem::path build_dir(const std::filesystem::path& station_dir);

}  // namespace paperboat::core::examples
