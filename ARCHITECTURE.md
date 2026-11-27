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
  `ProcessRunner` and the `StationManager`. `hubs.cpp`: the hubs for the page server (`serve_files`):
  `paperboat hub list --json` (no shell, a timeout), a hub's tree (no dot entries) with its stations (a `.pst`'s
  `station.toml`, read in the zip by `scripts/package_station.py info`; a `.psf`'s header and the `.pst` it resolves
  to), a path kept inside its hub, and finding a flow's station (`find`: its path, the hub, installed, running);
  the hub and station routes (`/__paperboat/hub/…`, `/__paperboat/station/find|start|log`) take the workspace as
  `hub=<id>` or `folder=<absolute path>`, answer this computer only, write only `.psf` and start a station only with
  the page's own header. `workspace.cpp`: the one file workflow's server side (plans/2026-11-26_11-05_one_file_workflow.md,
  "The contract every app follows"): `$PAPERBOAT_HOME` (as paperboat's `paths.cpp`), the store every app shares
  (`recent.json`, `settings.json`, written whole to a temp file, then renamed) and the workspace a folder is (the hub
  whose folder holds it, else itself); `serve.cpp` keeps the page server's workspace, switched at runtime
  (`/__paperboat/workspace`), and records each workspace and each flow read or written in Recent.
- `engine/tools/`: the `paperboat` CLI, `paperboat-catalog`, `paperboat-toolkit` and `paperboat new`.
- `bin/simplicial`: what `paperboat app open` runs (`simplicial [<folder>] --port N`: the engine's `web start --host
  127.0.0.1 --folder <folder>`, the page server starting in that workspace) and the `cli` of `commands.toml` (the
  other words go to the engine as typed). It calls the engine by path, never the platform's `paperboat` on PATH:
  `bin/simplicial-engine` in a release, `engine/build/tools/simplicial-engine` in a checkout; `PAPERBOAT_ROOT` is the app's
  folder. A `v*` tag's `release.yml` packs `simplicial-<version>.tar.gz`: bin/ (the engine static, libstdc++ static,
  and `paperboat-scratchpad`), web/dist, protocol/, scripts/, commands.toml, toolkits.toml, icon.png (the kit's, for
  the desktop entry) and an empty engine/toolkit/ (the root's markers).
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
    search and quick add; Settings (`SettingsWindow.tsx`, the kit's `Settings`: General with the theme, Simplicial
    (Station, Runs, Canvas), Hub while in one, Shortcuts; no Editor, there is no editor pane); Run settings…
    (`RunSettingsDialog.tsx` on the kit's `Dialog` and Settings' rows; `runSettings.ts`, pure and tested: the solvers the
    engine announced, the options each reads, and `changed`, what a flow keeps: only what differs from the station's);
    Toolkits… (`Toolkits.tsx`: the kit's `PackageWindow` and `PackagePanel` over `toolkits.status`; `toolkit.install`,
    `toolkit.uninstall`, `toolkit.versions` and `station.restart` are the station's). It holds the Flow's blocks and wires (what `graph.run` sends, `toGraph`), their undo (the
    kit's `useUndo`) and the open level. `app.css` draws only what the kit doesn't.
  - `src/station/`: the Station page. `StationPage.tsx`: the 3D view on the kit's stage (`@paperboatlab/ui/stage`; a click
    picks the object a part belongs to, its properties float over the corner) and the Graph view (objects and joints as the
    kit's cards on React Flow, in their own provider; a wire from a body fills a link slot). `stationEdits.ts` (pure,
    tested) is what an edit does; the page sends `station.set` and keeps the result (`engine.ts`). `sceneOf` gives the
    scene, at the replay playhead when replaying; the Board's view3d instrument draws it too.
  - `src/Variables.tsx`: the Variables card on the kit's `VariableList`: + Variable, an open row edits a variable;
    `variableEdits.ts` (pure, tested) is what an edit does to the list. The page sends the list (`variables.set`) and
    keeps it as the state's (`engine.ts`), since the station doesn't send it back. Under it, Julix's live variables
    (`variables.remote`, kept apart as `remoteVariables`), read-only, never in the flow; `liveRows`/`bindable` say which
    a name the flow has hides, and the binding hints list the rest.
  - `src/hubs.ts`: the workspace and its files, as the page's server gives them: the workspace, switched at runtime
    (`/__paperboat/workspace`: a folder, a hub, a file's folder or hub, nothing), the hubs (`/__paperboat/hubs`, which
    runs `paperboat hub list --json`: no Malachite, no hub), a workspace's tree and its `.psf` files
    (`/__paperboat/hub/files`, `/hub/file`, by `Root`: `hub=` or `folder=`), and the shared Recent and theme. App.tsx
    draws the one file workflow with the kit's `@paperboatlab/ui/workspace` and `/hub`: the Start page in the bay
    while no flow is open, the File menu (`fileMenu`, through `fileItems` in menus.ts), the `WorkspaceWell` after the
    menu bar (no document field in the bar: the Flow's head names the file), `AskOpen`, `ConnectHub`, `TypedPath`,
    `Unsaved`; in a hub, Open and Save as are the kit's `OpenFile` (`byParent`: By station) and `SaveFile`; outside
    one, the Paperboat window's `shell()` dialogs, else a typed path and a download. `WindowKeys` end the bar. An
    opened file is `file.open` in `engine.ts` (its flow, objects and variables; the canvas takes it over edits).
  - `src/project.ts` (pure, tested): the flow file (`StationFlow`, format 1: plans/2026-11-26_12-55_psf_pst_rework.md):
    the diff from the station's starter (`diff`: overridden variables, objects changed, added, removed; the flow's own
    variables) and applying it back (`applyOverrides`: what no longer fits kept apart as `Misfit`s), format 0 read
    (`upgrade`), building one (empty parts left out), checking one (`parseFlow`: what is wrong, and where), and what
    the browser keeps (the unsaved work, per station). `src/projectSession.ts` (`useProject`): whether the project is
    saved (its snapshot against what was last opened or saved, once the canvas settles) and the restore offer after a
    reload. New flow is the station's starter (`starter` in `engine.ts`: the first `graph.load`, `station.load` and
    `variables.load`, before any edit). `src/stationLink.ts` (pure, tested): what opening a flow on its station says
    (E2–E4, E8, where E1 looked; E2's note offers Save, E3/E4's warning Review, as the kit's note keys) and the address across a station switch (`?open=<hub>:<path>`, `start`, `use`,
    `nostation`); App.tsx finds the station (`/__paperboat/station/find`), asks (E1, E5), starts it and reopens the
    window on it, and marks what the flow changed (a dot, Reset to the station's) on the Station page and Variables.
  - `src/StationPicker.tsx`, `src/stations.ts`: finding a station (the recent ones, the open one, the station ports);
    `useStations` feeds the picker and Ctrl K's Stations.
  - `src/flow/`: the Flow canvas on React Flow, ported from legacy's `FlowEditor`. Pure, and tested: `flowModel.ts`
    (blocks, wires, missing and linked blocks), `flowGraph.ts` (canvas ⇄ `Graph`), `groups.ts` (subsystems, stories,
    frames and what each level shows), `portBlocks.ts` (In and Out), `flowLayout.ts` (Arrange, on the kit's graph
    layout), `flowWires.ts` (routing, on the kit's router), `blockEdits.ts`, `portDirection.ts`, `wireRules.ts`, `librarySearch.ts`. Hooks:
    `canvasSync.ts` (graph.load, linked blocks), `flowLevels.ts`, `flowGroups.ts`, `flowClipboard.ts`, `wireDrag.ts`,
    `cardDrop.ts`, `litWires.ts`, `usePortDirections.ts`. Drawn with the kit's faces (`@paperboatlab/ui/canvas`:
    `CompactBlock`, `BlockCard`, `ParamRow`, `CanvasTools`): `FlowEditor.tsx` (the canvas, minimap, breadcrumb, drop
    hint), `Block.tsx` (plate, card, In and Out pills), `Groups.tsx`, `WireEdge.tsx`, `SelectionDialog.tsx`,
    `BlockLibrary.tsx` (Add block: the catalog's blocks as cards by package in the kit's `Dialog`; a click, Enter or a
    drop on the canvas adds one; `/` stays quick add, the kit's `Search` at the cursor);
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
  - `e2e/`: end to end (`npm run e2e`): the scratchpad station and the page server from `engine/build`, the built page in a
    headless Chromium over CDP: open a flow from a folder, edit it, save it, reopen it. Skipped without an engine build, a
    page build or a browser.

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
   the pass. A live client's variables (`variables.set` with a `source`: Julix, plans/2026-11-27_00-15) are the
   server's, not a session's flow: every resolve (the station's show, a run, a tuned list, an analysis) takes the
   flow's own first and `toolkit::with_live` adds the live ones under the names left, so they never reach a flow file.
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
12. **A `.pst` is the station; a `.psf` is its child.** Simplicial never writes a `.pst` (a new version is packed);
    a `.psf` holds only what differs from its station's starter and points to it (name, version, sha256, a path
    relative to itself). An override that no longer fits is kept in the file, never dropped unasked. One station
    per window.
