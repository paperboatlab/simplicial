#pragma once

// Julia and Python stations, out of process (RFC pb#438 §5.6). The station's domain code runs in
// a runtime that paperboatd leases (a container: podman, then docker; native as the fallback) and
// answers over paperboat-runtime/0 in station mode (paperboat/docs/runtime.md). The engine stays
// the station: it loads the descriptor, compiles and runs the graph, serves paperboat/0. Every
// type the domain file registers becomes a normal template whose instance is a Remote adapter
// (block, step, station object, model) that forwards its calls, so the registry,
// compiler and run loop don't know (ARCHITECTURE invariant 4).

#include <filesystem>
#include <string>
#include <string_view>
#include <vector>

#include <nlohmann/json.hpp>

#include "paperboat/toolkit/block.hpp"
#include "paperboat/toolkit/registry.hpp"

namespace paperboat::core {

// The runtime's types as the engine's definitions: a registered type's `definition`
// ({base, label, kind, inputs, outputs, params, ...}, docs/stations.rst) with `name` as its type.
// Throws std::invalid_argument naming the type and the field at fault.
toolkit::BlockDef remote_block_def(const std::string& name, const nlohmann::ordered_json& definition);
toolkit::ObjectDef remote_object_def(const std::string& name, const nlohmann::ordered_json& definition);

// A lease on a runtime in station mode with the domain file loaded: what the Remote adapters call.
// Thread-safe (one request at a time). A runtime that dies fails the call in flight; the next
// instance made starts it again.
class RemoteRuntime {
 public:
  // `runtime`: "julia" or "python"; `project`: the station's folder (mounted read-only);
  // `file`: the domain file, relative to it. Acquires the lease and loads the file (throws
  // std::runtime_error with why not).
  RemoteRuntime(std::string runtime, std::filesystem::path project, std::string file);
  ~RemoteRuntime();  // ends the runtime (shutdown) and releases the lease
  RemoteRuntime(const RemoteRuntime&) = delete;
  RemoteRuntime& operator=(const RemoteRuntime&) = delete;

  // What `load` answered: [{name, definition}].
  const nlohmann::ordered_json& types() const { return types_; }
  // Adds every type to `registry` under `package` (the descriptor's domain).
  void register_types(toolkit::Registry& registry, const std::string& package);

  struct Instance {
    int id = 0;
    int generation = 0;  // which connection made it
  };
  Instance make(const std::string& type, const nlohmann::json& params);
  // method(instance, args...) in the runtime. Runtime notifications meanwhile (log, stream) go to
  // `ctx`'s Console, else stderr. Throws std::runtime_error with the runtime's error.
  nlohmann::json call(const Instance& instance, std::string_view method, nlohmann::json args,
                      const toolkit::Context* ctx = nullptr);
  void drop(const Instance& instance) noexcept;
  // Ends the runtime now (shutdown, release): the signal path of `host_remote_station`.
  void end() noexcept;

 private:
  struct State;
  State* state_;
  nlohmann::ordered_json types_;
};

// `simplicial-engine host <dir> [--port N] [--run] [--catalog] [--psf P] [--var k=v]`: serves the
// Julia or Python station in `dir` (its station.toml: `language`, `run` = the domain file) as a C++
// station serves itself (core::main). `argv` holds the options after the folder; `process` the
// whole command line, which `station.restart` runs again.
int host_remote_station(const std::filesystem::path& dir, int argc, char** argv, std::vector<std::string> process);

}  // namespace paperboat::core
