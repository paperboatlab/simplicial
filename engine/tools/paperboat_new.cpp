// `paperboat new <name> [--cpp | --python] [--dir <path>]`: a minimal station to start from,
// written from the templates embedded in the binary (templates/, new_templates.cmake).

#include "paperboat_new.hpp"

#include <algorithm>
#include <fstream>
#include <iostream>
#include <system_error>
#include <utility>

#include "paperboat/toolkit/installer.hpp"

namespace paperboat::cli {

namespace fs = std::filesystem;

namespace {

void replace_all(std::string& text, std::string_view from, std::string_view to) {
  for (std::size_t at = text.find(from); at != std::string::npos; at = text.find(from, at + to.size())) {
    text.replace(at, from.size(), to);
  }
}

// A path as a POSIX shell word, for the `cd` the command prints.
std::string shell_quote(std::string_view text) {
  std::string out = "'";
  for (const char c : text) {
    if (c == '\'') out += "'\\''";
    else out += c;
  }
  out += "'";
  return out;
}

// The program a C++ station builds: paperboat-<name> (`paperboat build` and `run` look for paperboat-*).
std::string program_name(const std::string& name) {
  return name.starts_with("paperboat-") ? name : "paperboat-" + name;
}

// A CMake project name: the name with '-' as '_'.
std::string identifier(std::string name) {
  std::ranges::replace(name, '-', '_');
  return name;
}

std::string render(std::string_view content, const NewOptions& o) {
  std::string text(content);
  replace_all(text, "@name@", o.name);
  replace_all(text, "@ident@", identifier(o.name));
  replace_all(text, "@target@", program_name(o.name));
  replace_all(text, "@port@", std::to_string(kNewStationPort));
  return text;
}

fs::path output_path(std::string_view path) {
  fs::path p{std::string(path)};
  if (p.filename() == "gitignore") p.replace_filename(".gitignore");  // a dotfile in the station, not in the repo
  return p;
}

}  // namespace

std::string check_station_name(std::string_view name) {
  if (name.empty()) return "a station needs a name";
  if (name.size() > 64) return "the name is longer than 64 characters";
  const auto lower = [](char c) { return c >= 'a' && c <= 'z'; };
  const auto digit = [](char c) { return c >= '0' && c <= '9'; };
  if (!lower(name.front())) return "the name must start with a lowercase letter";
  for (const char c : name) {
    if (!lower(c) && !digit(c) && c != '-' && c != '_') {
      return std::string("the name may hold lowercase letters, digits, '-' and '_', not '") + c + "'";
    }
  }
  return {};
}

NewResult new_station(const NewOptions& options) {
  NewResult res;
  if (std::string why = check_station_name(options.name); !why.empty()) {
    res.error = "invalid station name \"" + options.name + "\": " + why + " (e.g. my-station)";
    return res;
  }
  std::vector<const TemplateFile*> files;
  for (const auto& t : templates()) {
    if (t.language == options.language) files.push_back(&t);
  }
  if (files.empty()) {
    res.error = "unknown language \"" + options.language + "\" (cpp, python or julia)";
    return res;
  }

  std::error_code ec;
  res.dir = fs::absolute(options.dir.empty() ? fs::path(options.name) : options.dir, ec).lexically_normal();
  if (fs::exists(res.dir, ec)) {
    if (!fs::is_directory(res.dir, ec)) {
      res.error = res.dir.string() + " exists and is not a folder";
      return res;
    }
    if (!fs::is_empty(res.dir, ec)) {
      res.error = res.dir.string() + " is not empty: paperboat new never overwrites files (pick another name or --dir)";
      return res;
    }
  }

  for (const TemplateFile* t : files) {
    const fs::path rel = output_path(t->path);
    const fs::path target = res.dir / rel;
    fs::create_directories(target.parent_path(), ec);
    if (ec) {
      res.error = "cannot create " + target.parent_path().string() + ": " + ec.message();
      return res;
    }
    std::ofstream out(target, std::ios::binary);
    out << render(t->content, options);
    if (!out) {
      res.error = "cannot write " + target.string();
      return res;
    }
    res.files.push_back(rel);
  }
  std::ranges::sort(res.files);
  res.ok = true;
  return res;
}

int cmd_new(const std::vector<std::string_view>& args) {
  NewOptions opts;
  std::string where;  // the folder as the user typed it, for `cd`
  bool cpp = false, python = false, julia = false;
  for (std::size_t i = 0; i < args.size(); ++i) {
    const auto a = args[i];
    if (a == "--cpp") {
      cpp = true;
    } else if (a == "--python") {
      python = true;
    } else if (a == "--julia") {
      julia = true;
    } else if (a == "--dir") {
      if (i + 1 >= args.size()) {
        std::cerr << "error: --dir needs a path\n";
        return 2;
      }
      where = std::string(args[++i]);
    } else if (a.starts_with("-")) {
      std::cerr << "error: unknown option " << a << " (paperboat new <name> [--cpp | --python | --julia] [--dir <path>])\n";
      return 2;
    } else if (opts.name.empty()) {
      opts.name = std::string(a);
    } else {
      std::cerr << "error: one name only (got \"" << opts.name << "\" and \"" << a << "\")\n";
      return 2;
    }
  }
  if (static_cast<int>(cpp) + static_cast<int>(python) + static_cast<int>(julia) > 1) {
    std::cerr << "error: pick one of --cpp, --python, --julia\n";
    return 2;
  }
  if (opts.name.empty()) {
    std::cerr << "error: a name is required: paperboat new <name> [--cpp | --python | --julia] [--dir <path>]\n";
    return 2;
  }
  // `paperboat new stations/my-station`: the folder, named after its last part.
  if (where.empty() && opts.name.find_first_of("/\\") != std::string::npos) {
    where = opts.name;
    opts.name = fs::path(opts.name).lexically_normal().filename().string();
    if (opts.name.empty()) opts.name = fs::path(where).lexically_normal().parent_path().filename().string();
  }
  if (where.empty()) where = opts.name;
  opts.language = julia ? "julia" : python ? "python" : "cpp";
  opts.dir = where;

  const NewResult res = new_station(opts);
  if (!res.ok) {
    std::cerr << "error: " << res.error << '\n';
    return 1;
  }

  const bool is_cpp = opts.language == "cpp";
  const bool is_julia = opts.language == "julia";
  const std::string url = "ws://localhost:" + std::to_string(kNewStationPort);
  std::cout << "[ok] created " << (is_cpp ? "C++" : is_julia ? "Julia" : "Python") << " station \"" << opts.name
            << "\" in " << res.dir.string()
            << '\n';
  for (const auto& f : res.files) std::cout << "  " << f.generic_string() << '\n';
  std::cout << "\nNext steps:\n  cd " << shell_quote(where) << '\n';
  if (is_cpp) {
    std::cout << "  paperboat build     compile it (CMake; the first build compiles the engine too)\n";
  } else {
    std::cout << "  (nothing to compile: station." << (is_julia ? "jl" : "py") << " runs in a " << opts.language
              << " runtime from paperboatd;\n   packages: paperboat package add " << opts.language << " <package> --project .)\n";
  }
  std::cout << "  paperboat check     verify it: manifest, catalog, protocol smoke test, golden run\n"
               "  paperboat run       build if needed, serve it on " << url << " and open it in Simplicial\n"
               "Then make it yours: add blocks in domain/ (C++) or station.py / station.jl, use them in\n"
               "descriptor.toml's [graph], and update\n"
               "expected.json to what your starter graph should end with.\n";
  return 0;
}

}  // namespace paperboat::cli
