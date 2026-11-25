#include "paperboat/toolkit/self.hpp"

#include <algorithm>
#include <array>
#include <cctype>
#include <cstdlib>
#include <fstream>
#include <optional>
#include <sstream>
#include <utility>

#include <nlohmann/json.hpp>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#else
#include <sys/utsname.h>
#include <unistd.h>
#endif

#include "paperboat/toolkit/platform.hpp"
#include "paperboat/toolkit/update.hpp"

namespace paperboat::toolkit {
namespace {

using nlohmann::json;
namespace fs = std::filesystem;

#ifdef _WIN32
constexpr const char* kExeName = "paperboat.exe";
constexpr char kPathSep = ';';
#else
constexpr const char* kExeName = "paperboat";
constexpr char kPathSep = ':';
#endif

std::string trimmed(std::string s) {
  while (!s.empty() && std::isspace(static_cast<unsigned char>(s.back()))) s.pop_back();
  std::size_t i = 0;
  while (i < s.size() && std::isspace(static_cast<unsigned char>(s[i]))) ++i;
  return s.substr(i);
}

std::string read_text(const fs::path& p) {
  std::ifstream in(p);
  if (!in) return {};
  std::ostringstream ss;
  ss << in.rdbuf();
  return ss.str();
}

bool write_text(const fs::path& p, std::string_view content) {
  std::error_code ec;
  fs::create_directories(p.parent_path(), ec);
  std::ofstream out(p, std::ios::binary);
  out << content;
  return static_cast<bool>(out);
}

void log_msg(const ToolkitLog& log, std::string_view level, std::string_view text) {
  if (log) log(level, text);
}

bool has_tool(const std::string& name) {
  std::error_code ec;
  auto runnable = [&](const fs::path& p) {
    if (!fs::is_regular_file(p, ec)) return false;
#ifdef _WIN32
    return true;
#else
    return access(p.c_str(), X_OK) == 0;
#endif
  };
#ifdef _WIN32
  const std::vector<std::string> exts = {"", ".exe", ".cmd", ".bat"};
#else
  const std::vector<std::string> exts = {""};
#endif
  const char* path_env = std::getenv("PATH");
  std::istringstream dirs(path_env ? path_env : "");
  for (std::string dir; std::getline(dirs, dir, kPathSep);) {
    if (dir.empty()) continue;
    for (const auto& ext : exts) {
      if (runnable(fs::path(dir) / (name + ext))) return true;
    }
  }
  return false;
}

bool path_contains_dir(std::string_view path_list, const fs::path& dir) {
  std::error_code ec;
  const fs::path want = fs::weakly_canonical(dir, ec);
  std::istringstream dirs{std::string(path_list)};
  for (std::string item; std::getline(dirs, item, kPathSep);) {
    if (item.empty()) continue;
#ifdef _WIN32
    std::string a = fs::path(item).lexically_normal().string();
    std::string b = dir.lexically_normal().string();
    std::ranges::transform(a, a.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    std::ranges::transform(b, b.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    if (a == b) return true;
#endif
    if (fs::equivalent(fs::path(item), dir, ec) ||
        (!want.empty() && fs::weakly_canonical(fs::path(item), ec) == want)) {
      return true;
    }
  }
  return false;
}

std::string github_repo() {
  if (const char* v = std::getenv("PAPERBOAT_REPO"); v && *v) return v;
  return "paperboatlab/paperboat";
}

std::string releases_api_base() {
  if (const char* v = std::getenv("PAPERBOAT_RELEASES_API"); v && *v) return v;
  return "https://api.github.com/repos/" + github_repo();
}

std::string release_download_base() {
  if (const char* v = std::getenv("PAPERBOAT_DOWNLOAD_URL"); v && *v) return v;
  return "https://github.com/" + github_repo() + "/releases/download";
}

bool fetch_text(const std::string& url, std::string& out, std::string& error) {
  out.clear();
#ifdef _WIN32
  if (has_tool("curl.exe")) {
    if (run_command({"curl.exe", "-fsSL", url}, {}, {}, nullptr, &out) == 0) return true;
  }
  if (has_tool("powershell")) {
    const std::string ps = "$ProgressPreference='SilentlyContinue'; (Invoke-WebRequest -Uri '" + url +
                           "' -UseBasicParsing).Content";
    if (run_command({"powershell", "-NoProfile", "-Command", ps}, {}, {}, nullptr, &out) == 0) return true;
  }
  error = "cannot fetch " + url + " (curl.exe or powershell failed)";
  return false;
#else
  if (has_tool("curl")) {
    if (run_command({"curl", "-fsSL", url}, {}, {}, nullptr, &out) == 0) return true;
  } else if (has_tool("wget")) {
    if (run_command({"wget", "-qO-", url}, {}, {}, nullptr, &out) == 0) return true;
  } else {
    error = "needs curl (or wget) to fetch " + url;
    return false;
  }
  error = "cannot fetch " + url + " (offline or rate limited)";
  return false;
#endif
}

bool download_file(const std::string& url, const fs::path& dest, std::string& error) {
  std::string out;
#ifdef _WIN32
  if (has_tool("curl.exe")) {
    if (run_command({"curl.exe", "-fsSL", "-o", dest.string(), url}, {}, {}, nullptr, &out) == 0) return true;
  }
  if (has_tool("powershell")) {
    const std::string ps = "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '" + url +
                           "' -OutFile '" + dest.string() + "'";
    if (run_command({"powershell", "-NoProfile", "-Command", ps}, {}, {}, nullptr, &out) == 0) return true;
  }
  error = "cannot download " + url + (out.empty() ? "" : ": " + trimmed(out));
  return false;
#else
  if (has_tool("curl")) {
    if (run_command({"curl", "-fsSL", "-o", dest.string(), url}, {}, {}, nullptr, &out) == 0) return true;
  } else if (has_tool("wget")) {
    if (run_command({"wget", "-qO", dest.string(), url}, {}, {}, nullptr, &out) == 0) return true;
  } else {
    error = "needs curl (or wget) to download " + url;
    return false;
  }
  error = "cannot download " + url + (out.empty() ? "" : ": " + trimmed(out));
  return false;
#endif
}

std::string tag_from_release_json(std::string_view text, bool array_mode) {
  try {
    const json doc = json::parse(text);
    std::string tag;
    if (array_mode) {
      if (doc.is_array() && !doc.empty() && doc[0].is_object()) tag = doc[0].value("tag_name", "");
    } else if (doc.is_object()) {
      tag = doc.value("tag_name", "");
    }
    if (!tag.empty() && tag.front() == 'v') tag.erase(0, 1);
    return tag;
  } catch (...) {
    return {};
  }
}

std::string query_release_version(std::string_view channel, std::string& error) {
  const std::string base = releases_api_base();
  std::string body;
  if (channel != "beta") {
    if (fetch_text(base + "/releases/latest", body, error)) {
      if (std::string v = tag_from_release_json(body, false); !v.empty()) return v;
    }
  }
  std::string err2;
  if (fetch_text(base + "/releases?per_page=1", body, err2)) {
    if (std::string v = tag_from_release_json(body, true); !v.empty()) return v;
  }
  if (error.empty()) error = err2;
  if (error.empty()) error = "cannot read the releases of " + github_repo() + " (offline, or rate limited)";
  return {};
}

// Stage and unpack a .tar.gz or .zip into `dest_dir`, stripping a single top-level wrapper folder.
bool extract_archive_into(const fs::path& archive, const fs::path& dest_dir, std::string& error) {
  std::error_code ec;
  if (!fs::is_regular_file(archive, ec)) {
    error = "archive not found: " + archive.string();
    return false;
  }
  const fs::path parent = dest_dir.parent_path();
  fs::create_directories(parent, ec);
  const fs::path stage = parent / (".tmp-" + std::to_string(platform::current_pid()));
  fs::remove_all(stage, ec);
  const fs::path unpacked = stage / "x";
  fs::create_directories(unpacked, ec);
  if (ec) {
    error = "cannot create staging directory " + unpacked.string() + ": " + ec.message();
    return false;
  }

  auto cleanup = [&] {
    std::error_code rm;
    fs::remove_all(stage, rm);
  };

  std::string cmd_out;
  bool extracted = false;
#ifdef _WIN32
  if (has_tool("tar.exe") || has_tool("tar")) {
    extracted = run_command({"tar", "-xf", archive.string(), "-C", unpacked.string()}, {}, {}, nullptr, &cmd_out) == 0;
  }
  if (!extracted && has_tool("powershell")) {
    const std::string ps = "$ProgressPreference='SilentlyContinue'; Expand-Archive -LiteralPath '" +
                           archive.string() + "' -DestinationPath '" + unpacked.string() + "' -Force";
    extracted = run_command({"powershell", "-NoProfile", "-Command", ps}, {}, {}, nullptr, &cmd_out) == 0;
  }
#else
  if (archive.extension() == ".zip") {
    if (has_tool("unzip")) {
      extracted = run_command({"unzip", "-q", archive.string(), "-d", unpacked.string()}, {}, {}, nullptr, &cmd_out) == 0;
    } else if (has_tool("tar")) {
      extracted = run_command({"tar", "-xf", archive.string(), "-C", unpacked.string()}, {}, {}, nullptr, &cmd_out) == 0;
    }
  } else {
    extracted = run_command({"tar", "-xzf", archive.string(), "-C", unpacked.string()}, {}, {}, nullptr, &cmd_out) == 0;
  }
#endif
  if (!extracted) {
    cleanup();
    error = "failed to extract " + archive.string() + (cmd_out.empty() ? "" : ": " + trimmed(cmd_out));
    return false;
  }

  // cpack archives have one top-level folder (`paperboat-<ver>-<OS>-<arch>/bin/...`).
  fs::path src_root = unpacked;
  if (!fs::is_regular_file(src_root / "bin" / kExeName, ec)) {
    std::vector<fs::path> entries;
    for (const auto& entry : fs::directory_iterator(unpacked, ec)) entries.push_back(entry.path());
    if (entries.size() == 1 && fs::is_directory(entries[0], ec)) src_root = entries[0];
  }
  if (!fs::is_regular_file(src_root / "bin" / kExeName, ec)) {
    cleanup();
    error = "archive does not contain bin/" + std::string(kExeName) + ": " + archive.string();
    return false;
  }

  const fs::path prev = parent / (".prev-" + dest_dir.filename().string());
  fs::remove_all(prev, ec);
  if (fs::exists(dest_dir, ec)) {
    fs::rename(dest_dir, prev, ec);
    if (ec) {
      cleanup();
      error = "cannot replace existing install at " + dest_dir.string() + ": " + ec.message();
      return false;
    }
  }

  fs::rename(src_root, dest_dir, ec);
  if (ec) {
    ec.clear();
    fs::copy(src_root, dest_dir, fs::copy_options::recursive | fs::copy_options::copy_symlinks, ec);
  }
  if (ec) {
    fs::remove_all(dest_dir, ec);
    if (fs::exists(prev, ec)) fs::rename(prev, dest_dir, ec);
    cleanup();
    error = "failed to place unpacked runtime into " + dest_dir.string();
    return false;
  }

#ifndef _WIN32
  fs::permissions(dest_dir / "bin" / kExeName,
                  fs::perms::owner_read | fs::perms::owner_write | fs::perms::owner_exec |
                      fs::perms::group_read | fs::perms::group_exec |
                      fs::perms::others_read | fs::perms::others_exec,
                  fs::perm_options::add, ec);
#endif
  fs::remove_all(prev, ec);
  cleanup();
  return true;
}

#ifdef _WIN32
void ensure_user_path_windows(const fs::path& bin_dir, const ToolkitLog& log) {
  HKEY key = nullptr;
  if (RegOpenKeyExW(HKEY_CURRENT_USER, L"Environment", 0, KEY_READ | KEY_WRITE, &key) != ERROR_SUCCESS) return;
  DWORD type = 0;
  DWORD bytes = 0;
  std::wstring current;
  if (RegQueryValueExW(key, L"Path", nullptr, &type, nullptr, &bytes) == ERROR_SUCCESS && bytes > 0) {
    current.resize(bytes / sizeof(wchar_t));
    if (RegQueryValueExW(key, L"Path", nullptr, &type, reinterpret_cast<LPBYTE>(current.data()), &bytes) == ERROR_SUCCESS) {
      while (!current.empty() && current.back() == L'\0') current.pop_back();
    } else {
      current.clear();
    }
  }
  const std::string cur_utf8 = fs::path(current).string();
  if (!path_contains_dir(cur_utf8, bin_dir)) {
    const std::wstring entry = bin_dir.wstring();
    const std::wstring updated = current.empty() ? entry : entry + L";" + current;
    const DWORD reg_type = (type == REG_EXPAND_SZ) ? REG_EXPAND_SZ : REG_SZ;
    const DWORD out_bytes = static_cast<DWORD>((updated.size() + 1) * sizeof(wchar_t));
    if (RegSetValueExW(key, L"Path", 0, reg_type, reinterpret_cast<const BYTE*>(updated.c_str()), out_bytes) ==
        ERROR_SUCCESS) {
      SendMessageTimeoutW(HWND_BROADCAST, WM_SETTINGCHANGE, 0, reinterpret_cast<LPARAM>(L"Environment"),
                          SMTO_ABORTIFHUNG, 2000, nullptr);
      log_msg(log, "info", "added " + bin_dir.string() + " to your PATH (open a new terminal)");
    }
  }
  RegCloseKey(key);
}
#endif

bool link_self_binary(const fs::path& target_bin, std::string_view channel, const ToolkitLog& log, std::string& error) {
  std::error_code ec;
  const fs::path bin = paperboat_bin_dir();
  const fs::path link = active_link_path();
  fs::create_directories(bin, ec);
  if (ec) {
    error = "cannot create " + bin.string() + ": " + ec.message();
    return false;
  }

#ifdef _WIN32
  if (!write_text(link, "@\"" + target_bin.string() + "\" %*\r\n")) {
    error = "cannot write shim " + link.string();
    return false;
  }
  ensure_user_path_windows(bin, log);
#else
  const fs::path tmp_link = bin / (".paperboat.link." + std::to_string(platform::current_pid()));
  fs::remove(tmp_link, ec);
  ec.clear();
  fs::create_symlink(target_bin, tmp_link, ec);
  if (ec) {
    error = "cannot create symlink " + link.string() + " -> " + target_bin.string() + ": " + ec.message();
    return false;
  }
  fs::rename(tmp_link, link, ec);
  if (ec) {
    fs::remove(tmp_link, ec);
    ec.clear();
    fs::remove(link, ec);
    ec.clear();
    fs::create_symlink(target_bin, link, ec);
    if (ec) {
      error = "cannot update symlink " + link.string() + ": " + ec.message();
      return false;
    }
  }
#endif

  if (!channel.empty()) write_text(channel_file(), channel);
  log_msg(log, "info", "paperboat -> " + target_bin.string());
#ifndef _WIN32
  const char* path_env = std::getenv("PATH");
  if (!path_env || !path_contains_dir(path_env, bin)) {
    log_msg(log, "info", "add " + bin.string() + " to PATH: export PATH=\"" + bin.string() + ":$PATH\"");
  }
#endif
  return true;
}

void rebuild_installed_toolkits(const fs::path& binary, std::string_view version, const ToolkitLog& log) {
  std::error_code ec;
  const fs::path tk_root = paperboat_home() / "toolkits";
  if (!fs::is_directory(tk_root, ec)) return;
  bool any = false;
  for (const auto& entry : fs::directory_iterator(tk_root, ec)) {
    if (entry.is_directory(ec) && fs::is_regular_file(entry.path() / "lib" / "paperboat-toolkit.cmake", ec)) {
      any = true;
      break;
    }
  }
  if (!any) return;

  log_msg(log, "info", "rebuilding the installed toolkits for " + std::string(version) + "...");
  // Run outside any checkout cwd so find_repo_root() resolves the installed prefix's share/paperboat.
  const fs::path neutral_cwd = fs::temp_directory_path(ec);
  if (run_command({binary.string(), "toolkit", "update", "--all"}, neutral_cwd, log) != 0) {
    log_msg(log, "warn", "some toolkits did not rebuild: run `paperboat toolkit update --all`");
  }
}

bool git_cmd(const fs::path& dir, std::vector<std::string> args, std::string& out, const ToolkitLog& log = {}) {
  args.insert(args.begin(), {"git", "-C", dir.string()});
  out.clear();
  return run_command(args, {}, log, nullptr, &out) == 0;
}

SelfInstallResult install_from_source(std::string_view mode, std::string_view want_version, bool check_only,
                                      const ToolkitLog& log) {
  SelfInstallResult res;
  res.channel = std::string(mode);
  const fs::path src = source_checkout_dir();
  const fs::path bin_target = src / "bin" / kExeName;
  const SelfStatus cur = current_self_install();

  if (check_only) {
    res.ok = true;
    res.version = mode == "dev" ? "dev" : std::string(want_version);
    if (mode == "dev" && cur.channel == "dev") {
      const CheckoutStatus st = check_checkout(src, log);
      if (st.error.empty()) {
        log_msg(log, "info", "dev: " + std::to_string(st.behind) + " commit(s) behind " + st.upstream);
      } else {
        log_msg(log, "warn", "dev: " + st.error);
      }
    } else {
      log_msg(log, "info", "available: " + res.version + " (" + res.channel + ")");
    }
    return res;
  }

  for (const char* tool : {"git", "cmake", "npm"}) {
    if (!has_tool(tool)) {
      res.message = std::string("building from source requires ") + tool;
      return res;
    }
  }

  std::error_code ec;
  const std::string repo_url = "https://github.com/" + github_repo() + ".git";
  if (!fs::is_directory(src / ".git", ec)) {
    fs::create_directories(src.parent_path(), ec);
    std::string out;
    if (run_command({"git", "clone", "-q", repo_url, src.string()}, {}, log, nullptr, &out) != 0) {
      res.message = "cannot clone " + repo_url + (out.empty() ? "" : ": " + trimmed(out));
      return res;
    }
  }

  std::string dirty;
  if (git_cmd(src, {"status", "--porcelain", "--untracked-files=no"}, dirty) && !trimmed(dirty).empty()) {
    res.message = src.string() + " has local changes; commit or stash them first";
    return res;
  }

  std::string before, after, out;
  git_cmd(src, {"rev-parse", "HEAD"}, before);
  if (!git_cmd(src, {"fetch", "-q", "--tags", "origin"}, out, log)) {
    res.message = "git fetch failed in " + src.string();
    return res;
  }

  if (mode == "dev") {
    std::string head_ref;
    std::string branch = "dev";
    if (git_cmd(src, {"symbolic-ref", "--short", "refs/remotes/origin/HEAD"}, head_ref)) {
      head_ref = trimmed(head_ref);
      if (head_ref.starts_with("origin/")) head_ref.erase(0, 7);
      if (!head_ref.empty()) branch = head_ref;
    }
    if (!git_cmd(src, {"-c", "advice.detachedHead=false", "checkout", "-q", branch}, out, log) ||
        !git_cmd(src, {"merge", "-q", "--ff-only", "origin/" + branch}, out, log)) {
      res.message = "cannot update branch " + branch + " in " + src.string();
      return res;
    }
  } else {
    if (!git_cmd(src, {"-c", "advice.detachedHead=false", "checkout", "-q", "v" + std::string(want_version)}, out, log)) {
      res.message = "cannot checkout tag v" + std::string(want_version) + " in " + src.string();
      return res;
    }
  }
  git_cmd(src, {"rev-parse", "HEAD"}, after);

  if (trimmed(before) == trimmed(after) && fs::is_regular_file(bin_target, ec) && cur.channel == mode) {
    res.ok = true;
    res.version = cur.installed_version.empty() ? std::string(mode) : cur.installed_version;
    res.install_dir = src;
    res.binary = bin_target;
    res.message = "paperboat " + res.version + " is up to date";
    return res;
  }

  log_msg(log, "info", "building paperboat " + std::string(want_version.empty() ? mode : want_version) + " from source in " + src.string() + "...");

  const fs::path shared = src.parent_path() / "paperboat-shared";
  const std::string shared_url = "https://github.com/paperboatlab/paperboat-shared.git";
  if (fs::is_directory(shared / ".git", ec)) {
    if (!git_cmd(shared, {"pull", "-q", "--ff-only"}, out, log)) {
      res.message = "cannot update " + shared.string();
      return res;
    }
  } else {
    if (run_command({"git", "clone", "-q", shared_url, shared.string()}, {}, log, nullptr, &out) != 0) {
      res.message = "cannot clone " + shared_url;
      return res;
    }
  }

  if (run_command({"npm", "ci", "--no-audit", "--no-fund"}, shared, log) != 0 ||
      run_command({"npm", "ci", "--no-audit", "--no-fund"}, src, log) != 0 ||
      run_command({"npm", "run", "build"}, src, log) != 0) {
    res.message = "frontend build failed in " + src.string();
    return res;
  }

  std::vector<std::string> cfg = {"cmake", "-S", "engine", "-B", "engine/build", "-DCMAKE_BUILD_TYPE=Release"};
  if (!fs::is_regular_file(src / "engine" / "build" / "CMakeCache.txt", ec) && has_tool("ninja")) {
    cfg.insert(cfg.end(), {"-G", "Ninja"});
  }
  if (run_command(cfg, src, log) != 0 ||
      run_command({"cmake", "--build", "engine/build", "--parallel"}, src, log) != 0) {
    res.message = "C++ engine build failed in " + src.string();
    return res;
  }

  std::string link_err;
  if (!link_self_binary(bin_target, mode, log, link_err)) {
    res.message = link_err;
    return res;
  }

  res.ok = true;
  res.changed = true;
  res.version = mode == "dev" ? "dev" : std::string(want_version);
  res.install_dir = src;
  res.binary = bin_target;
  res.message = "installed paperboat " + res.version + " (source)";
  return res;
}

}  // namespace

fs::path paperboat_home() {
  if (const char* v = std::getenv("PAPERBOAT_HOME"); v && *v) return fs::path(v);
#ifdef _WIN32
  if (const char* v = std::getenv("LOCALAPPDATA"); v && *v) return fs::path(v) / "paperboat";
#endif
  if (const char* v = std::getenv("XDG_DATA_HOME"); v && *v) return fs::path(v) / "paperboat";
  const fs::path home = platform::home_dir();
  return (home.empty() ? fs::path(".") : home) / ".local" / "share" / "paperboat";
}

fs::path paperboat_bin_dir() {
  if (const char* v = std::getenv("PAPERBOAT_BIN"); v && *v) return fs::path(v);
#ifdef _WIN32
  return paperboat_home() / "bin";
#else
  const fs::path home = platform::home_dir();
  return (home.empty() ? fs::path(".") : home) / ".local" / "bin";
#endif
}

fs::path self_dir() { return paperboat_home() / "self"; }
fs::path source_checkout_dir() { return paperboat_home() / "src" / "paperboat"; }
fs::path channel_file() { return paperboat_home() / "channel"; }
fs::path active_link_path() {
#ifdef _WIN32
  return paperboat_bin_dir() / "paperboat.cmd";
#else
  return paperboat_bin_dir() / "paperboat";
#endif
}

bool is_managed_install(const fs::path& exe) {
  if (exe.empty()) return false;
  const fs::path rel = exe.lexically_relative(paperboat_home());
  return !rel.empty() && *rel.begin() != "..";
}

std::string normalize_channel(std::string_view channel) {
  if (channel == "main") return "dev";
  if (channel == "release" || channel == "beta" || channel == "dev" || channel == "source") {
    return std::string(channel);
  }
  return {};
}

std::string self_asset_name(std::string_view version) {
  std::string v(version);
  if (!v.empty() && v.front() == 'v') v.erase(0, 1);
#ifdef _WIN32
#if defined(_M_ARM64) || defined(__aarch64__)
  constexpr const char* arch = "ARM64";
#else
  constexpr const char* arch = "AMD64";
#endif
  return "paperboat-" + v + "-Windows-" + arch + ".zip";
#else
  std::string sys = "Linux";
  std::string mach = "x86_64";
  struct utsname u{};
  if (uname(&u) == 0) {
    sys = u.sysname;
    mach = u.machine;
  }
  return "paperboat-" + v + "-" + sys + "-" + mach + ".tar.gz";
#endif
}

std::string parse_archive_version(const fs::path& archive_path) {
  std::string name = archive_path.filename().string();
  if (!name.starts_with("paperboat-")) return {};
  if (name.ends_with(".tar.gz")) name.resize(name.size() - 7);
  else if (name.ends_with(".zip")) name.resize(name.size() - 4);
  else return {};
  name.erase(0, 10);  // "paperboat-"

  const auto arch_dash = name.rfind('-');
  if (arch_dash == std::string::npos) return {};
  const auto os_dash = name.rfind('-', arch_dash - 1);
  if (os_dash == std::string::npos || os_dash == 0) return {};
  return name.substr(0, os_dash);
}

SelfStatus current_self_install() {
  SelfStatus st;
  std::error_code ec;
  const fs::path link = active_link_path();
  const std::string saved_chan = normalize_channel(trimmed(read_text(channel_file())));

#ifdef _WIN32
  if (fs::is_regular_file(link, ec)) {
    const std::string cmd_text = read_text(link);
    const fs::path sdir = self_dir();
    const auto pos = cmd_text.find("self\\");
    if (pos != std::string::npos) {
      const auto end = cmd_text.find("\\bin\\", pos + 5);
      if (end != std::string::npos) {
        st.installed_version = cmd_text.substr(pos + 5, end - (pos + 5));
        st.active_target = sdir / st.installed_version / "bin" / kExeName;
        st.channel = saved_chan.empty() ? "release" : saved_chan;
        st.managed = true;
      }
    }
  }
#else
  if (fs::is_symlink(link, ec)) {
    fs::path target = fs::read_symlink(link, ec);
    if (!ec) {
      if (target.is_relative()) target = (link.parent_path() / target).lexically_normal();
      st.active_target = target;
      const fs::path src = source_checkout_dir();
      const fs::path rel_src = target.lexically_relative(src);
      if (!rel_src.empty() && *rel_src.begin() != "..") {
        st.managed = true;
        std::string out;
        if (git_cmd(src, {"symbolic-ref", "-q", "HEAD"}, out)) {
          st.channel = "dev";
          if (git_cmd(src, {"rev-parse", "--short", "HEAD"}, out)) st.installed_version = "dev@" + trimmed(out);
        } else {
          st.channel = "source";
          if (git_cmd(src, {"describe", "--tags", "--exact-match"}, out)) {
            std::string t = trimmed(out);
            if (!t.empty() && t.front() == 'v') t.erase(0, 1);
            st.installed_version = std::move(t);
          }
        }
      } else {
        const fs::path rel_self = target.lexically_relative(self_dir());
        if (!rel_self.empty() && *rel_self.begin() != "..") {
          st.managed = true;
          st.installed_version = rel_self.begin()->string();
          st.channel = saved_chan.empty() ? "release" : saved_chan;
        }
      }
    }
  }
#endif
  if (!st.managed && is_managed_install(platform::exe_path())) {
    st.managed = true;
    if (st.channel.empty()) st.channel = saved_chan.empty() ? "release" : saved_chan;
  }
  return st;
}

std::vector<InstalledSelfVersion> list_installed_versions() {
  std::vector<InstalledSelfVersion> out;
  std::error_code ec;
  const SelfStatus cur = current_self_install();
  const fs::path cur_canon = cur.active_target.empty() ? fs::path{} : fs::weakly_canonical(cur.active_target, ec);

  const fs::path sdir = self_dir();
  if (fs::is_directory(sdir, ec)) {
    for (const auto& entry : fs::directory_iterator(sdir, ec)) {
      if (!entry.is_directory(ec)) continue;
      const std::string name = entry.path().filename().string();
      if (name.starts_with('.')) continue;
      const fs::path bin = entry.path() / "bin" / kExeName;
      if (!fs::is_regular_file(bin, ec)) continue;
      const bool active = !cur_canon.empty() && fs::weakly_canonical(bin, ec) == cur_canon;
      out.push_back({name, entry.path(), bin, active, false});
    }
  }

  std::ranges::sort(out, [](const InstalledSelfVersion& a, const InstalledSelfVersion& b) {
    const auto va = parse_version(a.version);
    const auto vb = parse_version(b.version);
    if (va && vb && *va != *vb) return *va > *vb;
    if (static_cast<bool>(va) != static_cast<bool>(vb)) return static_cast<bool>(va);
    return a.version > b.version;
  });

  const fs::path src = source_checkout_dir();
  const fs::path src_bin = src / "bin" / kExeName;
  if (fs::is_regular_file(src_bin, ec)) {
    const bool active = !cur_canon.empty() && fs::weakly_canonical(src_bin, ec) == cur_canon;
    out.push_back({"dev", src, src_bin, active, true});
  }
  return out;
}

SelfInstallResult install_self(const SelfInstallOptions& opts, const ToolkitLog& log) {
  SelfInstallResult res;
  const SelfStatus cur = current_self_install();

  std::string mode = normalize_channel(opts.channel);
  if (!opts.channel.empty() && mode.empty()) {
    res.message = "unknown channel \"" + opts.channel + "\" (expected release, beta, dev, or source)";
    return res;
  }
  if (!opts.archive.empty()) {
    if (mode.empty()) mode = cur.channel.empty() ? "release" : cur.channel;
  } else if (mode.empty()) {
    mode = cur.channel.empty() ? "release" : cur.channel;
  }
  res.channel = mode;

  std::string want(opts.version);
  if (!want.empty() && want.front() == 'v') want.erase(0, 1);

  if (mode == "dev") {
    return install_from_source(mode, want, opts.check_only, log);
  }

  if (!opts.archive.empty()) {
    if (want.empty()) want = parse_archive_version(opts.archive);
    if (want.empty()) {
      res.message = "cannot determine version from archive filename: " + opts.archive.filename().string();
      return res;
    }
  } else if (want.empty()) {
    std::string api_err;
    want = query_release_version(mode, api_err);
    if (want.empty()) {
      res.message = api_err;
      return res;
    }
  }
  res.version = want;

  if (opts.check_only) {
    res.ok = true;
    log_msg(log, "info", "installed: " + (cur.installed_version.empty() ? std::string("nothing") : cur.installed_version) +
                             " (" + (cur.channel.empty() ? std::string("no channel") : cur.channel) + ")");
    log_msg(log, "info", "available: " + want + " (" + mode + ")");
    return res;
  }

  if (mode == "source") {
    return install_from_source(mode, want, false, log);
  }

  const fs::path dest = self_dir() / want;
  const fs::path dest_bin = dest / "bin" / kExeName;
  std::error_code ec;

  if (opts.archive.empty() && cur.channel == mode && cur.installed_version == want &&
      fs::is_regular_file(dest_bin, ec)) {
    res.ok = true;
    res.install_dir = dest;
    res.binary = dest_bin;
    res.message = "paperboat " + want + " is up to date";
    return res;
  }

  const std::string asset = self_asset_name(want);
  log_msg(log, "info", "installing " + (opts.archive.empty() ? asset : opts.archive.string()) + "...");

  fs::path archive_to_unpack = opts.archive;
  fs::path downloaded_tmp;
  if (archive_to_unpack.empty()) {
    const fs::path dl_dir = self_dir() / (".dl-" + std::to_string(platform::current_pid()));
    fs::create_directories(dl_dir, ec);
    downloaded_tmp = dl_dir / asset;
    const std::string url = release_download_base() + "/v" + want + "/" + asset;
    std::string dl_err;
    if (!download_file(url, downloaded_tmp, dl_err)) {
      fs::remove_all(dl_dir, ec);
      res.message = dl_err + " (no " + asset + " in release v" + want + ")";
      return res;
    }
    archive_to_unpack = downloaded_tmp;
  }

  std::string unpack_err;
  const bool unpacked = extract_archive_into(archive_to_unpack, dest, unpack_err);
  if (!downloaded_tmp.empty()) fs::remove_all(downloaded_tmp.parent_path(), ec);
  if (!unpacked) {
    res.message = unpack_err;
    return res;
  }

  std::string link_err;
  if (!link_self_binary(dest_bin, mode, log, link_err)) {
    res.message = link_err;
    return res;
  }

  if (opts.rebuild_toolkits) rebuild_installed_toolkits(dest_bin, want, log);

  res.ok = true;
  res.changed = true;
  res.install_dir = dest;
  res.binary = dest_bin;
  res.message = "installed paperboat " + want;
  return res;
}

SelfInstallResult use_self_version(std::string_view version_or_range, const ToolkitLog& log, bool rebuild_toolkits) {
  SelfInstallResult res;
  std::string target(version_or_range);
  if (!target.empty() && target.front() == 'v') target.erase(0, 1);
  if (target.empty()) {
    res.message = "version required (e.g. `paperboat use 0.1.5`)";
    return res;
  }

  const auto installed = list_installed_versions();
  const InstalledSelfVersion* match = nullptr;
  for (const auto& item : installed) {
    if (item.version == target) {
      match = &item;
      break;
    }
  }
  if (!match && valid_version_range(target)) {
    for (const auto& item : installed) {
      if (!item.is_source && version_in_range(item.version, target)) {
        match = &item;  // list_installed_versions is newest first
        break;
      }
    }
  }

  if (!match) {
    if (parse_version(target)) {
      SelfInstallOptions opts;
      opts.version = target;
      opts.channel = parse_version(target)->prerelease.empty() ? "release" : "beta";
      opts.rebuild_toolkits = rebuild_toolkits;
      return install_self(opts, log);
    }
    res.message = "paperboat " + target + " is not installed (run `paperboat use` to list installed versions)";
    return res;
  }

  const SelfStatus cur = current_self_install();
  std::string chan = match->is_source ? "dev"
                     : (parse_version(match->version) && !parse_version(match->version)->prerelease.empty()) ? "beta"
                     : "release";
  if (match->active) {
    res.ok = true;
    res.version = match->version;
    res.channel = cur.channel.empty() ? chan : cur.channel;
    res.install_dir = match->root;
    res.binary = match->binary;
    res.message = "paperboat " + match->version + " is already active";
    return res;
  }

  std::string link_err;
  if (!link_self_binary(match->binary, chan, log, link_err)) {
    res.message = link_err;
    return res;
  }

  if (rebuild_toolkits) rebuild_installed_toolkits(match->binary, match->version, log);

  res.ok = true;
  res.changed = true;
  res.version = match->version;
  res.channel = chan;
  res.install_dir = match->root;
  res.binary = match->binary;
  res.message = "switched paperboat to " + match->version;
  return res;
}

}  // namespace paperboat::toolkit
