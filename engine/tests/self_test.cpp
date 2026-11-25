#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>

#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>
#include <unistd.h>

#include "paperboat/core/process.hpp"
#include "paperboat/toolkit/apps.hpp"
#include "paperboat/toolkit/installer.hpp"
#include "paperboat/toolkit/self.hpp"

namespace fs = std::filesystem;
namespace core = paperboat::core;
namespace tk = paperboat::toolkit;
using Catch::Matchers::ContainsSubstring;

namespace {

struct EnvGuard {
  std::vector<std::pair<std::string, std::string>> saved;
  void set(const char* k, const std::string& v) {
    const char* old = std::getenv(k);
    saved.emplace_back(k, old ? old : "");
    setenv(k, v.c_str(), 1);
  }
  ~EnvGuard() {
    for (auto it = saved.rbegin(); it != saved.rend(); ++it) {
      if (it->second.empty()) unsetenv(it->first.c_str());
      else setenv(it->first.c_str(), it->second.c_str(), 1);
    }
  }
};

// Build a minimal valid release .tar.gz archive (`paperboat-<ver>-Linux-x86_64.tar.gz`) containing a
// runnable `bin/paperboat` and `share/paperboat/toolkits.toml`.
fs::path make_release_archive(const fs::path& dir, std::string_view version, const fs::path& cli_bin) {
  const std::string top = "paperboat-" + std::string(version) + "-Linux-x86_64";
  const fs::path root = dir / "stage" / top;
  fs::create_directories(root / "bin");
  fs::create_directories(root / "share" / "paperboat");
  std::ofstream(root / "share" / "paperboat" / "toolkits.toml") << "toolkits = []\n";
  std::ofstream(root / "share" / "paperboat" / "apps.toml") << "apps = []\n";
  if (!cli_bin.empty() && fs::is_regular_file(cli_bin)) {
    fs::copy_file(cli_bin, root / "bin" / "paperboat", fs::copy_options::overwrite_existing);
  } else {
    std::ofstream out(root / "bin" / "paperboat");
    out << "#!/bin/sh\necho \"paperboat " << version << "\"\n";
  }
  fs::permissions(root / "bin" / "paperboat",
                  fs::perms::owner_read | fs::perms::owner_write | fs::perms::owner_exec,
                  fs::perm_options::replace);

  const fs::path archive = dir / (top + ".tar.gz");
  const int rc = tk::run_command({"tar", "-czf", archive.string(), "-C", (dir / "stage").string(), top});
  REQUIRE(rc == 0);
  return archive;
}

}  // namespace

TEST_CASE("self: archive version parsing, channels, and home/bin paths") {
  CHECK(tk::parse_archive_version("paperboat-0.1.5-Linux-x86_64.tar.gz") == "0.1.5");
  CHECK(tk::parse_archive_version("/tmp/paperboat-0.1.0-alpha.2-Darwin-arm64.tar.gz") == "0.1.0-alpha.2");
  CHECK(tk::parse_archive_version("paperboat-0.2.0-Windows-AMD64.zip") == "0.2.0");
  CHECK(tk::parse_archive_version("not-a-release.tar.gz").empty());
  CHECK(tk::parse_archive_version("paperboat-0.1.5.tar.gz").empty());

  CHECK(tk::normalize_channel("release") == "release");
  CHECK(tk::normalize_channel("beta") == "beta");
  CHECK(tk::normalize_channel("dev") == "dev");
  CHECK(tk::normalize_channel("main") == "dev");
  CHECK(tk::normalize_channel("source") == "source");
  CHECK(tk::normalize_channel("nightly").empty());

  const std::string asset = tk::self_asset_name("v0.1.5");
  CHECK(asset.starts_with("paperboat-0.1.5-"));

  EnvGuard env;
  env.set("PAPERBOAT_HOME", "/tmp/pb-self-home");
  env.set("PAPERBOAT_BIN", "/tmp/pb-self-bin");
  CHECK(tk::paperboat_home() == "/tmp/pb-self-home");
  CHECK(tk::apps_dir() == "/tmp/pb-self-home/apps");
  CHECK(tk::self_dir() == "/tmp/pb-self-home/self");
  CHECK(tk::paperboat_bin_dir() == "/tmp/pb-self-bin");
  CHECK(tk::is_managed_install("/tmp/pb-self-home/self/0.1.5/bin/paperboat"));
  CHECK_FALSE(tk::is_managed_install("/usr/local/bin/paperboat"));
}

TEST_CASE("self: install_self, check_only, side-by-side versions, and use_self_version") {
  const fs::path tmp = fs::temp_directory_path() / ("pb_self_test_" + std::to_string(getpid()));
  std::error_code ec;
  fs::remove_all(tmp, ec);
  fs::create_directories(tmp);

  EnvGuard env;
  env.set("PAPERBOAT_HOME", (tmp / "home").string());
  env.set("PAPERBOAT_BIN", (tmp / "bin").string());

  const fs::path a1 = make_release_archive(tmp / "pkg1", "0.1.0", {});
  const fs::path a2 = make_release_archive(tmp / "pkg2", "0.2.0", {});

  // Check-only from archive does not write anything.
  std::string logs;
  const auto log = [&](std::string_view, std::string_view text) { logs += std::string(text) + "\n"; };
  tk::SelfInstallOptions chk_opts;
  chk_opts.channel = "release";
  chk_opts.archive = a1;
  chk_opts.check_only = true;
  chk_opts.rebuild_toolkits = false;
  const auto chk = tk::install_self(chk_opts, log);
  REQUIRE(chk.ok);
  CHECK_FALSE(chk.changed);
  CHECK(chk.version == "0.1.0");
  CHECK_FALSE(fs::exists(tk::active_link_path()));
  CHECK_THAT(logs, ContainsSubstring("available: 0.1.0 (release)"));

  // Install 0.1.0 from archive.
  tk::SelfInstallOptions o1;
  o1.channel = "release";
  o1.archive = a1;
  o1.rebuild_toolkits = false;
  const auto r1 = tk::install_self(o1, log);
  REQUIRE(r1.ok);
  CHECK(r1.changed);
  CHECK(r1.version == "0.1.0");
  CHECK(fs::is_regular_file(tk::self_dir() / "0.1.0" / "bin" / "paperboat"));
  CHECK(fs::is_symlink(tk::active_link_path()));
  CHECK(fs::read_symlink(tk::active_link_path()) == tk::self_dir() / "0.1.0" / "bin" / "paperboat");

  const auto st1 = tk::current_self_install();
  CHECK(st1.managed);
  CHECK(st1.channel == "release");
  CHECK(st1.installed_version == "0.1.0");

  // Re-running with explicit version 0.1.0 reports up to date without re-extracting.
  tk::SelfInstallOptions same_opts;
  same_opts.channel = "release";
  same_opts.version = "0.1.0";
  same_opts.rebuild_toolkits = false;
  const auto same = tk::install_self(same_opts);
  REQUIRE(same.ok);
  CHECK_FALSE(same.changed);
  CHECK_THAT(same.message, ContainsSubstring("up to date"));

  // Install 0.2.0 side by side (beta channel).
  tk::SelfInstallOptions o2;
  o2.channel = "beta";
  o2.archive = a2;
  o2.rebuild_toolkits = false;
  const auto r2 = tk::install_self(o2);
  REQUIRE(r2.ok);
  CHECK(r2.changed);
  CHECK(r2.version == "0.2.0");

  const auto versions = tk::list_installed_versions();
  REQUIRE(versions.size() == 2);
  CHECK(versions[0].version == "0.2.0");
  CHECK(versions[0].active);
  CHECK(versions[1].version == "0.1.0");
  CHECK_FALSE(versions[1].active);

  // Switch back to 0.1.0, then switch by range "0.2".
  const auto sw1 = tk::use_self_version("0.1.0", {}, false);
  REQUIRE(sw1.ok);
  CHECK(sw1.changed);
  CHECK(sw1.version == "0.1.0");
  CHECK(tk::current_self_install().installed_version == "0.1.0");

  const auto sw2 = tk::use_self_version("0.2", {}, false);
  REQUIRE(sw2.ok);
  CHECK(sw2.changed);
  CHECK(sw2.version == "0.2.0");
  CHECK(tk::current_self_install().installed_version == "0.2.0");

  // Unknown non-semver version fails cleanly.
  const auto bad = tk::use_self_version("9.9", {}, false);
  CHECK_FALSE(bad.ok);

  fs::remove_all(tmp, ec);
}

#ifdef PAPERBOAT_TEST_CLI
TEST_CASE("self: standalone CLI bootstraps from PAPERBOAT_ARCHIVE in C++ and switches with use") {
  const fs::path cli = PAPERBOAT_TEST_CLI;
  REQUIRE(fs::is_regular_file(cli));

  const fs::path tmp = fs::temp_directory_path() / ("pb_self_cli_test_" + std::to_string(getpid()));
  std::error_code ec;
  fs::remove_all(tmp, ec);
  fs::create_directories(tmp / "standalone");

  // Copy the CLI outside any checkout so find_repo_root() is empty.
  const fs::path standalone = tmp / "standalone" / "paperboat";
  fs::copy_file(cli, standalone, fs::copy_options::overwrite_existing);

  const fs::path a1 = make_release_archive(tmp / "pkg1", "0.1.0", cli);
  const fs::path a2 = make_release_archive(tmp / "pkg2", "0.2.0", cli);

  const fs::path home_dir = tmp / "home";
  const fs::path bin_dir = tmp / "bin";
  const std::vector<std::pair<std::string, std::string>> env = {
      {"PAPERBOAT_ROOT", ""},
      {"PAPERBOAT_HOME", home_dir.string()},
      {"PAPERBOAT_BIN", bin_dir.string()},
      {"PAPERBOAT_ARCHIVE", a1.string()},
      {"HOME", (tmp / "user").string()},
  };

  // --version answers immediately without bootstrapping.
  const auto ver = core::ProcessRunner::run_sync({standalone.string(), "--version"}, tmp / "standalone", env);
  REQUIRE(ver.ok());
  CHECK_THAT(ver.stdout_text, ContainsSubstring("paperboat"));
  CHECK_FALSE(fs::exists(bin_dir / "paperboat"));

  // Running a real command bootstraps via C++ and forwards the command to the installed binary.
  const auto cmds = core::ProcessRunner::run_sync({standalone.string(), "commands", "--json"}, tmp / "standalone", env);
  REQUIRE(cmds.ok());
  CHECK_THAT(cmds.stdout_text, ContainsSubstring("first run, installing paperboat"));
  CHECK_THAT(cmds.stdout_text, ContainsSubstring("\"use\""));
  CHECK(fs::is_symlink(bin_dir / "paperboat"));
  CHECK(fs::is_regular_file(home_dir / "self" / "0.1.0" / "bin" / "paperboat"));

  // Install 0.2.0, then test `paperboat use --json` and `paperboat use 0.1.0`.
  {
    EnvGuard g;
    g.set("PAPERBOAT_HOME", home_dir.string());
    g.set("PAPERBOAT_BIN", bin_dir.string());
    tk::SelfInstallOptions o2;
    o2.channel = "release";
    o2.archive = a2;
    o2.rebuild_toolkits = false;
    REQUIRE(tk::install_self(o2).ok);
  }

  const auto list_res = core::ProcessRunner::run_sync({(bin_dir / "paperboat").string(), "use", "--json"}, tmp, env);
  REQUIRE(list_res.ok());
  const auto arr = nlohmann::json::parse(list_res.stdout_text);
  REQUIRE(arr.size() == 2);
  CHECK(arr[0]["version"] == "0.2.0");
  CHECK(arr[0]["active"] == true);

  const auto switch_res = core::ProcessRunner::run_sync({(bin_dir / "paperboat").string(), "use", "0.1.0"}, tmp, env);
  REQUIRE(switch_res.ok());
  CHECK_THAT(switch_res.stdout_text, ContainsSubstring("switched paperboat to 0.1.0"));
  CHECK(fs::read_symlink(bin_dir / "paperboat") == home_dir / "self" / "0.1.0" / "bin" / "paperboat");

  fs::remove_all(tmp, ec);
}
#endif
