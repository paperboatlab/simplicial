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
  built-in toolkits in `src/<package>/` (one folder per block, each with its `web/` instrument adapter); their home is
  here (the `simplicial-toolkit-base` repository is retired).
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
- `web/`: the page, React on `@paperboatlab/ui` (the kit, pinned by commit in `package.json`), built
  by esbuild (`web/scripts/build.ts`) into `web/dist/`. It connects to `ws://<its own host>` (the engine
  serves the page and the socket on one port), or `?station=ws://host:port`.
  - `src/engine.ts`: the one WebSocket and the reducer over every `ServerMsg` (`useEngine`), from legacy;
    `traces.ts` (each monitor's history, outside React state) and `replay.ts` (a run's scene over time).
  - `src/menus.ts`: the one command registry; the menu bar, Ctrl K and the shortcuts all read it.
  - `src/App.tsx`: the frame. The splash until a station says hello; the bar; the page rail (Navigator
    only); the Station, Flow and Board pages laid out by the view mode (Navigator, Commander, Lookout;
    hidden panes kept per mode); the Variables card; the run dock; the Console window; the floating
    search and quick add. It holds the Flow's blocks and wires (what `graph.run` sends, `toGraph`), their undo (the
    kit's `useUndo`) and the open level. `app.css` draws only what the kit doesn't.
  - `src/flow/`: the Flow canvas on React Flow, ported from legacy's `FlowEditor`. Pure, and tested: `flowModel.ts`
    (blocks, wires, missing and linked blocks), `flowGraph.ts` (canvas ⇄ `Graph`), `groups.ts` (subsystems, stories,
    frames and what each level shows), `portBlocks.ts` (In and Out), `flowLayout.ts` (Arrange, on the kit's graph
    layout), `flowWires.ts` (routing, on the kit's router), `blockEdits.ts`, `portDirection.ts`, `wireRules.ts`. Hooks:
    `canvasSync.ts` (graph.load, linked blocks), `flowLevels.ts`, `flowGroups.ts`, `flowClipboard.ts`, `wireDrag.ts`,
    `cardDrop.ts`, `litWires.ts`, `usePortDirections.ts`. Drawn with the kit's faces (`@paperboatlab/ui/canvas`:
    `CompactBlock`, `BlockCard`, `ParamRow`, `CanvasTools`): `FlowEditor.tsx` (the canvas, minimap, breadcrumb, drop
    hint), `Block.tsx` (plate, card, In and Out pills), `Groups.tsx`, `WireEdge.tsx`, `SelectionDialog.tsx`;
    `flowContexts.ts` is what they share. A run locks the edits (`Lock`). The tests load the kit's TypeScript through
    `web/scripts/kit.ts` (node strips no types under `node_modules`).
  - `src/board/`: the Board, ported from legacy's `Board.tsx`. `boardLayout.ts` (pure, tested: the grid of equal cells,
    S/M/L/XL or, for an instrument its toolkit marks `resizable`, a custom span up to the grid's columns each way, tabs, decorations, `{block}` values in text, the automatic order), `boardWiring.ts` (the monitor blocks
    on the Flow are the instruments: kind, what feeds them, + tap), `Board.tsx` (the grid, Arrange: drag or arrow
    keys, sizes, a resizable instrument's corner grip, decorations, tabs), `host.ts` (the instrument registry and `InstrumentProps`, imported by the
    toolkits as `@paperboat/host`), `toolkits.ts` (calls each toolkit web part's `register(host)`). The user's layout
    is kept per station in the browser, else the station's (`catalog.board`). Every instrument's face is the kit's
    (`@paperboatlab/ui/plot`: graph, display, lamp, switch, choice, speaker in its `Instrument` frame; `/scope`: the
    Scope); only view3d draws its own until the Station's 3D view lands.
  - Toolkit web parts: `engine/toolkit/src/<package>/<block>/web/index.tsx` exports `register(host)` and adapts its
    block to a kit face (reads the block's params and the run, hands the face plain values). The build
    gathers every built-in one into the bundle (`toolkit-web` in `scripts/build.ts`), `tsc` checks them with the page,
    and their `*.test.ts` run with `npm test`; the page names no instrument kind.

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
