#pragma once

// Self-installation, self-update, channel tracking, and side-by-side runtime version management
// (`paperboat update`, `paperboat use`, and standalone bootstrap) in C++ without install scripts.

#include <filesystem>
#include <string>
#include <string_view>
#include <vector>

#include "paperboat/toolkit/installer.hpp"

namespace paperboat::toolkit {

struct SelfStatus {
  std::string channel;            // release | beta | dev | source (empty if unknown)
  std::string installed_version;  // "0.1.7", "dev@abc1234", or empty
  std::filesystem::path active_target;
  bool managed = false;           // active install or running exe lives under paperboat_home()
};

struct InstalledSelfVersion {
  std::string version;            // e.g. "0.1.7" or "dev"
  std::filesystem::path root;     // <home>/self/<version> or <home>/src/paperboat
  std::filesystem::path binary;   // <root>/bin/paperboat(.exe)
  bool active = false;
  bool is_source = false;
};

struct SelfInstallOptions {
  std::string channel;            // empty: keep current channel (or "release")
  std::string version;            // explicit release version (without or with leading 'v')
  std::filesystem::path archive;  // local .tar.gz / .zip (offline or CI)
  bool check_only = false;
  bool rebuild_toolkits = true;
};

struct SelfInstallResult {
  bool ok = false;
  bool changed = false;
  std::string version;
  std::string channel;
  std::filesystem::path install_dir;
  std::filesystem::path binary;
  std::string message;
};

// User store root: $PAPERBOAT_HOME, else %LOCALAPPDATA%\paperboat (Windows), else
// $XDG_DATA_HOME/paperboat, else ~/.local/share/paperboat.
std::filesystem::path paperboat_home();

// Where the active `paperboat` symlink (POSIX) or `paperboat.cmd` shim (Windows) lives.
std::filesystem::path paperboat_bin_dir();

std::filesystem::path self_dir();
std::filesystem::path source_checkout_dir();
std::filesystem::path channel_file();
std::filesystem::path active_link_path();

// True when `exe` lives inside paperboat_home().
bool is_managed_install(const std::filesystem::path& exe);

// Inspect the active symlink/shim and channel file.
SelfStatus current_self_install();

// List side-by-side versions in self_dir() (newest first) plus source_checkout_dir() if built.
std::vector<InstalledSelfVersion> list_installed_versions();

// Normalize "main" -> "dev"; returns empty for unknown channel names.
std::string normalize_channel(std::string_view channel);

// Platform release asset filename (e.g. "paperboat-0.1.7-Linux-x86_64.tar.gz").
std::string self_asset_name(std::string_view version);

// Extract "<version>" from "paperboat-<version>-<OS>-<arch>.(tar.gz|zip)", or empty if malformed.
std::string parse_archive_version(const std::filesystem::path& archive_path);

// Install, update, or check paperboat itself (release, beta, dev, source, or local archive).
SelfInstallResult install_self(const SelfInstallOptions& opts, const ToolkitLog& log = {});

// Switch the active `paperboat` link/shim to an installed version (or range like "0.1"), installing
// an exact release version first if not yet present locally.
SelfInstallResult use_self_version(std::string_view version_or_range, const ToolkitLog& log = {},
                                   bool rebuild_toolkits = true);

}  // namespace paperboat::toolkit
