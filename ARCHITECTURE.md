# Architecture

The plan: `plans/2026-11-25_01-15_simplicial_v0_1.md` in the workspace; the platform it sits on:
`plans/2026-11-24_15-00_container_first_platform.md` (pb#438). This page is the map.

## 1. Overview

Simplicial is one C++20 process, the engine, and a page. A station (a `descriptor.toml` and its
domain code) runs on the engine, which speaks `paperboat/0` (JSON over WebSocket, plain HTTP on the
same port) to the page. The page holds no domain knowledge: blocks, station objects, starter graphs
and the scene arrive over the protocol (`hello`, `catalog`, `scene`, `graph.load`, `station.load`,
`variables.load`). On `graph.run` the engine resolves variables, builds the station objects, compiles
the graph and runs it on a worker thread, streaming `signal` samples and `scene.patch` updates back,
and every run leaves a record.

The engine and the protocol come from paperboat-legacy (`dev` at 2a6b48c) minus its in-process
language hosts (`engine/host`, libjulia, and the nanobind Python module). Julia and Python stations
come back out of process over `paperboat-runtime/0` (#7).

## 2. Codemap

- `engine/toolkit/`: `paperboat::toolkit`, the SDK (`Block`, `Step`, `StationObject`, `Model`,
  value types), the descriptor loader, variables and expressions, the solvers (RK*, SUNDIALS cvode and
  ida behind `PAPERBOAT_WITH_SUNDIALS`), the plugin loader, the toolkit and app installers, and the
  built-in toolkits in `src/<package>/` (one folder per block, each with its `web/` instruments).
  Optional toolkits install into `engine/toolkit/<name>/` and are picked up at configure time.
- `engine/core/`: `paperboat::core`, the graph compiler (`graph.cpp`: sort, loops), the run loop and
  executors, the cache, the record, the `paperboat/0` session and server (`session.cpp`, `serve.cpp`),
  `ProcessRunner` and the `StationManager`.
- `engine/tools/`: the `paperboat` CLI, `paperboat-catalog`, `paperboat-toolkit` and `paperboat new`.
- `engine/scratchpad/`: the scratchpad station (the built-in toolkits, no domain).
- `engine/tests/`: the Catch2 suite (`paperboat_tests`, run by `ctest`), its fixtures and the SDK test
  station.
- `protocol/`: `schema/paperboat-0.schema.json` (the source of truth for every message) and
  `record-0.schema.json`; `gen_ts.py` writes `web/src/protocol.ts` from it (`--check` fails when stale);
  `smoke_test.py` and `golden.py`, the conformance checks for any station.
- `web/` (coming in M1): the page, React on `@paperboatlab/ui`. Today only `web/src/protocol.ts`.

## 3. Invariants

1. **No domain knowledge in the page.** Everything domain-specific arrives over the protocol.
2. **Equipment vs. procedure.** Equipment and initial conditions belong to `StationObject`s (`props`);
   a flow acts on one only through its linked block.
3. **Loops are not errors.** Non-feedthrough blocks emit their state before the signal pass and take
   their inputs after it; any other cycle is an algebraic loop, which `prepare_graph` groups and tears,
   never rejects.
4. **One engine.** Every framework capability (protocol, descriptors, variables, expressions, sorting,
   vector lifting, pacing) is implemented once in C++. An out-of-process adapter implements only
   `Block`, `Step`, `StationObject`, `Model` and `DomainState`.
5. **Dependencies point one way.** `engine/toolkit` never depends on `engine/core` or networking; only
   `engine/core/src/serve.cpp` touches WebSockets; `Run` and `Executor` emit through the `Emit`
   callback; core and toolkit never name an example station or an external simulation tool.
6. **Variables are resolved before construction.** `{"var"}`/`{"expr"}` references are resolved before
   any `Block` or `StationObject` exists; `Context::set_variable` is buffered and committed at the end of
   the pass.
7. **Threads.** The session handles messages on the socket thread and runs each `Run` on a
   `std::jthread` with a `std::stop_token`; keys and live variables are latched between steps; `Handle`
   payloads are immutable shared pointers.
8. **A toolkit is one folder.** `toolkit.toml` plus one folder per block holding its code, icon and
   `web/`; removing the folder leaves everything else building.
9. **Every run leaves a record**, and a block reports only through its `Context`, never its own file.
10. **Station environments are isolated.** A station never inherits the host's `PYTHONPATH`,
    `JULIA_*` and the like; its environment is built from station-owned paths only.
11. **The schema is the source of truth.** `protocol/schema/paperboat-0.schema.json` defines every
    message; `web/src/protocol.ts` is generated from it, never edited.
