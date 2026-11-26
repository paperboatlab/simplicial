// Simplicial's page (agent-docs/rebrand/apps/simplicial): the bar (lockup, menus, the project's name, the view
// mode, the Console, Panels and theme keys), the page rail in Navigator, the three pages laid out by the view
// mode, the Variables card, the run dock, the Console window and the floating search. The parts are the kit's
// (@paperboatlab/ui); the station speaks paperboat/0 (engine.ts). Until a station says hello: the splash, and
// once the first try finds none, Choose a station over it (StationPicker.tsx).
// The Flow canvas (flow/FlowEditor.tsx) edits the nodes and wires held here: a run sends them, undo steps them. The
// Board (board/Board.tsx) shows an instrument for each monitor block among them, laid out by the user's layout (kept
// per station in the browser) or the station's.
// Background news (the station lost and back, a run's fault) comes as toasts (news.ts), kept by the bar's
// Notifications key.
// File › Open… and Save as… go through the kit's OpenFile and SaveFile when Malachite knows hubs (hubs.ts), else straight
// to the system's: the file decides the hub, and the bar then shows the hub's selector and the file's path in it.
import {
  About, AppMark, ConsoleWindow, Dialog, Dock, Icon, Key, MenuBar, Notifications, PageRail, Panel, PanelsKey, Search, Segmented, Spinner, Splash, Tabs, ThemePicker,
  Toasts, ago, isEnabled, readStored, typeLine, typing, ownKeys, useShortcuts, useTheme, useToasts, valueText, writeStored,
  type Credit, type PaneRect, type SearchItem, type Theme,
} from "@paperboatlab/ui";
import { useUndo } from "@paperboatlab/ui/canvas";
import { HubSelector, OpenFile, SaveFile, type Hub } from "@paperboatlab/ui/hub";
import { useEdgesState, useNodesState, useReactFlow, type FitViewOptions } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Board } from "./board/Board.tsx";
import { loadSaved, save } from "./board/boardLayout.ts";
import { useBoardWiring } from "./board/boardWiring.ts";
import { sceneOf, useEngine } from "./engine.ts";
import { lengthText, parseLength } from "./runLength.ts";
import { useNews } from "./news.ts";
import { StationPicker, useStations } from "./StationPicker.tsx";
import { renameRef } from "./variableEdits.ts";
import { Variables } from "./Variables.tsx";
import { StationPage } from "./station/StationPage.tsx";
import { openStation, remember } from "./stations.ts";
import { useCanvasSync } from "./flow/canvasSync.ts";
import { OnBlocks, RunStates, Vars } from "./flow/flowContexts.ts";
import { FlowEditor, type FlowControls } from "./flow/FlowEditor.tsx";
import { toFlow, toGraph } from "./flow/flowGraph.ts";
import { canArrangeFlow } from "./flow/flowLayout.ts";
import { isBlock, type FlowNode, type Wire } from "./flow/flowModel.ts";
import { isPortType } from "./flow/portBlocks.ts";
import { MENUS, MODES, NO_STATION, PAGES, PANES, registry, type Mode, type Page, type Pane } from "./menus.ts";
import { applyOverrides, buildProject, diff, mergeOverrides, relPath, stationOf, upgrade, type Misfit } from "./project.ts";
import { useProject } from "./projectSession.ts";
import {
  findStation, listed, listHub, listHubs, parseFlow, readFlow, startStation, stationLog, stationStatus, stem, TYPES, writeFlow,
  type Finding, type OpenedFile, type Place, type Status, type Which,
} from "./hubs.ts";
import { apartNote, fromSearch, lookedList, movedNote, named, startOf, toSearch, versionNote } from "./stationLink.ts";
import type { BoardLayout, RunSettings, StationFlow, StationFlow0, StationRef } from "./protocol.ts";

/** What the address asks for (stationLink.ts): the station, a flow to open on it (`?open=`), or the flow without one. */
const OPENING = fromSearch(location.search);
const WITHOUT = !!OPENING.nostation;
/** The station: ?station=ws://host:port, else the page's own host (the engine serves the page and the socket on one port). */
const URL_ = WITHOUT ? "" : OPENING.station ?? (location.host ? `ws://${location.host}` : "ws://localhost:51301");
const PORT = Number(/:(\d+)/.exec(URL_.replace(/^wss?:\/\//, ""))?.[1] ?? 0);
/** A flow from this computer, kept for the page on its station (it can't be read again from there). */
const STASH = "simplicial.opening";
const ISSUES = "https://github.com/paperboatlab/simplicial/issues/new";
const SPEEDS = [0.25, 0.5, 1, 2, 4, 0];
/** What Simplicial ships beyond the kit: the engine's libraries (engine/CMakeLists.txt; licences from their own files). */
const CREDITS: Credit[] = [
  ["nlohmann/json", "the station's JSON", "MIT", "https://github.com/nlohmann/json"],
  ["toml++", "the station's TOML files", "MIT", "https://github.com/marzer/tomlplusplus"],
  ["IXWebSocket", "the station's socket", "BSD-3-Clause", "https://github.com/machinezone/IXWebSocket"],
  ["SUNDIALS (CVODE, IDA)", "the implicit solvers", "BSD-3-Clause", "https://github.com/LLNL/sundials"],
  ["Boost.Math", "special functions and distributions", "BSL-1.0", "https://github.com/boostorg/math"],
  ["Eigen", "matrix blocks", "MPL-2.0", "https://eigen.tuxfamily.org"],
  ["pocketfft", "the FFT", "BSD-3-Clause", "https://github.com/mreineck/pocketfft"],
];

const isTheme = (v: unknown): v is Theme => v === "light" || v === "dark" || v === "system";
const isMode = (v: unknown): v is Mode => MODES.includes(v as Mode);
const isPage = (v: unknown): v is Page => PAGES.includes(v as Page);
const isHidden = (v: unknown): v is Record<Mode, Pane[]> => !!v && typeof v === "object" && MODES.every((m) => Array.isArray((v as Record<string, unknown>)[m]));
const HIDDEN: Record<Mode, Pane[]> = { navigator: [], commander: [], lookout: ["fl", "r"] };

/** The window's sketch for the Panels key's previews (64 × 44), per mode; without a station, its area goes. */
function sketch(mode: Mode, station: boolean): Record<string, PaneRect> {
  const s: Record<Mode, Record<string, PaneRect>> = {
    navigator: { n: [4, 4, 6, 36], p: [12, 4, 34, 36], r: [48, 4, 12, 36] },
    commander: { st: [4, 4, 18, 22], fl: [24, 4, 22, 22], bd: [4, 28, 42, 12], r: [48, 4, 12, 36] },
    lookout: { st: [4, 4, 11, 36], bd: [17, 4, 22, 36], fl: [41, 4, 10, 36], r: [53, 4, 7, 36] },
  };
  const out = { ...s[mode] };
  if (!station) {
    delete out.st;
    if (mode === "commander") out.fl = [4, 4, 42, 22];
    if (mode === "lookout") out.bd = [4, 4, 35, 36];
  }
  return out;
}
const PANE_NAME: Record<Pane, [string, string?]> = { r: ["Variables", "Ctrl Alt B"], st: ["Station"], fl: ["Flow"], bd: ["Board", "Ctrl J"] };
/** The Flow fitted with room round it; in Navigator the run dock and the minimap float over its foot. */
const FIT: FitViewOptions = { padding: { top: "32px", left: "32px", right: "32px", bottom: "56px" }, maxZoom: 1.2 };  // clear of the canvas tools
const FIT_DOCK: FitViewOptions = { padding: { top: "32px", left: "32px", right: "32px", bottom: "128px" }, maxZoom: 1.2 };  // clear of the dock and the minimap
const LOCKED = "A run is in progress: cancel it to edit the flow";
const fmt = (v: unknown) => (typeof v === "number" ? String(Number(v.toPrecision(4))).replace("-", "−") : String(v));

/** How long and how fast the next run goes, beside Run (legacy RunOptions): the station's defaults until changed; ∞ (0 s) runs until cancelled. */
function RunOptions({ defaults, value, onChange }: { defaults: RunSettings; value: RunSettings; onChange: (v: RunSettings) => void }) {
  const duration = value.duration ?? defaults.duration ?? 10, speed = value.speed ?? defaults.speed ?? 1;
  const [draft, setDraft] = useState(lengthText(duration));
  useEffect(() => setDraft(lengthText(duration)), [duration]);
  const finite = useRef(duration || defaults.duration || 10); // what ∞ goes back to
  if (duration > 0) finite.current = duration;
  const set = (change: RunSettings) => {
    const next = { ...value, ...change };
    for (const k of ["duration", "speed"] as const) if (next[k] === defaults[k]) delete next[k];  // only what changed goes with the run
    onChange(next);
  };
  const commit = () => { const d = parseLength(draft); if (d !== undefined) set({ duration: d }); else setDraft(lengthText(duration)); };
  return (
    <span className="run-options" title="The next run's length and speed (the station's defaults until changed; ∞ runs until cancelled)">
      <i className="sep" />for
      <input aria-label="Run length, s (∞: until cancelled)" value={draft} size={4} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />s
      <Key size="sm" kind="quiet" className="run-forever" aria-pressed={duration === 0} aria-label="Run until cancelled"
        title={duration === 0 ? `Back to ${finite.current} s` : "Run until cancelled (∞)"} onClick={() => set({ duration: duration === 0 ? finite.current : 0 })}>∞</Key>
      <label>at</label>
      <select aria-label="Speed" value={speed} title="Times real time; during a run, it changes the run at once" onChange={(e) => set({ speed: Number(e.target.value) })}>
        {SPEEDS.map((x) => <option key={x} value={x}>{x === 0 ? "max" : `${x}×`}</option>)}
      </select>
    </span>
  );
}

export function App() {
  const { state, send, log, open: openFlow } = useEngine(URL_);
  const notes = useToasts();
  useNews(state, notes.show);
  const [theme, setTheme] = useState<Theme>(() => readStored("paperboat.theme", isTheme) ?? "system");
  useTheme(theme);
  useEffect(() => writeStored("paperboat.theme", theme), [theme]);
  const [mode, setMode] = useState<Mode>(() => readStored("simplicial.mode", isMode) ?? "navigator");
  const [page, setPage] = useState<Page>(() => readStored("simplicial.page", isPage) ?? "flow");
  const [hidden, setHidden] = useState<Record<Mode, Pane[]>>(() => readStored("simplicial.hidden", isHidden) ?? HIDDEN);
  useEffect(() => writeStored("simplicial.mode", mode), [mode]);
  useEffect(() => writeStored("simplicial.page", page), [page]);
  useEffect(() => writeStored("simplicial.hidden", hidden), [hidden]);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [search, setSearch] = useState<null | { at?: { x: number; y: number } }>(null);
  const [sview, setSview] = useState<"3d" | "graph">("3d");
  const [floor, setFloor] = useState<boolean | null>(null); // the user's grid choice wins over the station's view.grid
  const [tab, setTab] = useState("");
  const [runSettings, setRunSettings] = useState<RunSettings>({});
  const [booted, setBooted] = useState(WITHOUT);   // the splash has handed over (at once without a station)
  const [retrying, setRetrying] = useState(false);  // the first try found no station
  useEffect(() => { if (state.connection === "closed") setRetrying(true); }, [state.connection]);
  useEffect(() => { if (state.engine) remember(URL_); }, [state.engine]);
  const [about, setAbout] = useState(false);
  const [picker, setPicker] = useState(false);   // Choose a station, from File; over the splash while none answers
  const [still, setStill] = useState(true);       // nothing moves at start-up: the saved layout is simply there
  const conKey = useRef<HTMLButtonElement>(null);
  const flowBody = useRef<HTMLDivElement>(null);
  const mouse = useRef<{ x: number; y: number } | null>(null);

  const running = state.run?.status === "running";
  const lock = running ? LOCKED : WITHOUT ? "No station: open the flow on its station to edit and run it" : "";
  // The Flow canvas: its blocks and wires (what a run sends), the level open on it, undo, and what its menus do.
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Wire>([]);
  const [level, setLevel] = useState<string | null>(null);
  const flow = useRef<FlowControls | null>(null);
  const { fitView } = useReactFlow();
  const fit = mode === "navigator" ? FIT_DOCK : FIT;
  const fitFlow = useCallback(() => void fitView(fit), [fitView, fit]);
  useCanvasSync(state, nodes, edges, setNodes, setEdges, fitFlow);
  const history = useUndo(nodes, edges, setNodes, setEdges, state.loaded, !lock);
  // The Board: its instruments are the monitor blocks; its layout the user's for this station, else the station's.
  const { monitors, taps, tap } = useBoardWiring(nodes, edges, setNodes, setEdges, log);
  const [saved, setSaved] = useState<BoardLayout | undefined>();
  useEffect(() => setSaved(state.engine ? loadSaved(state.engine) : undefined), [state.engine]);
  const saveBoard = (next: BoardLayout | undefined) => { setSaved(next); save(state.engine, next); };
  const layout = saved ?? state.board;
  const [arranging, setArranging] = useState(false);

  // The flow file: open from a hub or this computer, saved back where it came from. The file decides the hub. A flow
  // is a child of its station (format 1, project.ts): it opens on it, found by its path, else by name (E1–E9 below).
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [file, setFile] = useState<OpenedFile | null>(null);
  const [filePick, setFilePick] = useState<"open" | "save" | "find" | null>(null);
  const finding = useRef<{ doc: StationFlow | StationFlow0; at: OpenedFile } | null>(null);  // what Find the station… is for
  const sysOpen = useRef<HTMLInputElement>(null);
  const hub = file?.hub ? hubs.find((h) => h.id === file.hub) : undefined;
  const fileName = file ? file.path.slice(file.path.lastIndexOf("/") + 1) : "";
  // The window's station as found (its place, version, sha256; `hub` when it is in one) and the header the file gets.
  const [home, setHome] = useState<(Place & { hub?: string }) | null>(null);
  const [ref, setRef] = useState<StationRef>({ name: "" });
  // The open flow's changes that don't fit its station (E4, E9): kept in the file, shown nowhere, until removed.
  const [kept, setKept] = useState<Misfit[]>([]);
  const [review, setReview] = useState(false);
  const changes = useMemo(() => diff(state.starter, { station: state.station, variables: state.variables }), [state.starter, state.station, state.variables]);
  const changedVars = useMemo(() => new Set(Object.keys(changes.overrides.variables ?? {})), [changes]);
  const flowFile = (station = ref): StationFlow => buildProject({
    station: { ...station, name: station.name || state.engine }, flow: toFlow(nodes, edges, state.loaded?.flow),
    overrides: kept.reduce((o, m) => mergeOverrides(o, m.part), changes.overrides), variables: changes.own, board: saved, run: runSettings,
  });
  /** Put a flow file in place on this station: its overrides applied to the starter (what doesn't fit kept apart), the
   *  canvas, the Board and the run settings. Without a station (?nostation), only what the file itself holds. */
  const load = (doc: StationFlow | StationFlow0, at: OpenedFile | null, label = state.engine): Misfit[] => {
    let misfits: Misfit[] = [];
    if (WITHOUT) {
      openFlow({ flow: doc.flow, station: doc.paperboat === 0 ? doc.station_objects ?? null : null, variables: doc.variables ?? [] });
    } else {
      const f = doc.paperboat === 0 ? upgrade(doc, state.starter) : doc;
      const r = applyOverrides(state.starter, f.overrides, state.objects.length ? state.objects : null, label);
      openFlow({ flow: f.flow, station: r.station, variables: [...r.variables, ...(f.variables ?? [])] });
      misfits = r.misfits;
    }
    setKept(misfits);
    setRunSettings(doc.run ?? {});
    saveBoard(doc.board);
    setFile(at);
    return misfits;
  };
  // Whether the project is saved, a word before unsaved work is replaced, Open recent, and unsaved work kept for a reload.
  // (its station by name only: where the station is found is not an edit; a move is marked changed on open, E2)
  const project = useProject(state.engine, () => flowFile({ name: state.engine }), [nodes, edges, state.loaded, changes, kept, saved, runSettings], file?.path ?? "Untitled",
    (s) => void load(s.project, s.name === "Untitled" ? null : { hub: s.hub, path: s.name }));
  const failed = (title: string, err: unknown) => notes.show({ title, detail: err instanceof Error ? err.message : String(err), state: "failed" });
  // The window's station, found once it says hello (by name; in the hub it was started from, if any): its version for the file.
  useEffect(() => {
    if (!state.engine) return;
    const hubId = OPENING.start?.hub;
    findStation({ hub: hubId, name: state.engine }).then((f) => {
      if (!("found" in f)) return;
      setHome((h) => h ?? { ...f.found, ...(hubId && (f.found.where === "path" || f.found.where === "workspace") ? { hub: hubId } : {}) });
      setRef((r) => (r.name ? r : { name: f.found.name, ...(f.found.version ? { version: f.found.version } : {}), ...(f.found.sha256 ? { sha256: f.found.sha256 } : {}) }));
    }, () => {});
  }, [state.engine]);

  /** Open a flow file read from `at`: on this window's station when it is the flow's (`use`: whatever it names), else after
   *  a word: Can't find it (E1), or Open it on its station (E5). */
  const take = async (doc: StationFlow | StationFlow0, at: OpenedFile, inHub?: Hub, use = false) => {
    const made = stationOf(doc);
    const name = at.path.slice(at.path.lastIndexOf("/") + 1);
    if (WITHOUT) return void (load(doc, at), notes.show({ title: `Opened ${name} without a station`, detail: "Its blocks are unknown and nothing runs" }));
    const mine = use || made.name === state.engine;
    let f: Finding | null = null;
    try {
      f = await findStation(at.hub ? { hub: at.hub, ...(use ? { name: state.engine } : { path: at.path }) } : { name: mine ? state.engine : made.name, version: made.version });
    } catch { /* the page has no server of its own: by name, as before */ }
    if (!mine) {
      if (!f || !("found" in f)) return cantFind(doc, at, f, inHub);
      return otherStation(doc, at, f.found);
    }
    const place = f && "found" in f ? f.found : null;
    project.ask("Open this flow?", "Open", () => {
      const misfits = load(doc, at, place ? named(place) : state.engine);
      const inThisHub = place && at.hub && (place.where === "path" || place.where === "workspace");
      if (place) {
        setHome({ ...place, ...(inThisHub ? { hub: at.hub } : {}) });
        setRef({ name: place.name, ...(place.version ? { version: place.version } : {}), ...(place.sha256 ? { sha256: place.sha256 } : {}),
          ...(inThisHub ? { path: relPath(at.path, place.path) } : {}) });
      }
      const moved = place ? movedNote(stem(at.path), made, place) : null;
      project.opened({ name: at.path, hub: at.hub, project: doc }, !!moved || use);
      notes.show(moved ?? { title: `Opened ${name}`, detail: [inHub && `Simplicial now works in ${inHub.name}`, doc.paperboat === 0 && "an older flow file: Save writes it in the new format"].filter(Boolean).join(" · ") || undefined, state: "done" });
      const v = place && versionNote(stem(at.path), made, place, misfits);
      if (v) notes.show(v);
      window.history.replaceState(null, "", `?${toSearch({ station: OPENING.station, nostation: WITHOUT }, location.search)}`);
    });
  };
  /** Open the page on another station (started first when it isn't running), the flow to open on it in the address. */
  const switchTo = async (to: Place | Which, open: OpenedFile | null, doc: StationFlow | StationFlow0 | null, o: { use?: boolean; tab?: Window | null } = {}) => {
    const start = "where" in to ? startOf(to, open?.hub) : to;
    try {
      const port = "where" in to && to.port ? to.port : (await startStation(start!)).port;
      if (open && !open.hub && doc) sessionStorage.setItem(STASH, JSON.stringify(doc));
      const search = toSearch({ station: `ws://localhost:${port}`, open: open ?? undefined, use: o.use, start: start ?? undefined }, location.search);
      if (o.tab) o.tab.location.href = `${location.pathname}?${search}`;
      else location.search = search;
    } catch (e) {
      o.tab?.close();
      failed(`Can't start ${"name" in to && to.name ? to.name : "the station"}`, e);
    }
  };
  /** Open the flow without a station: read only, its blocks lost blocks, nothing runs. */
  const without = (doc: StationFlow | StationFlow0, at: OpenedFile) => {
    if (!at.hub) sessionStorage.setItem(STASH, JSON.stringify(doc));
    location.search = toSearch({ open: at, nostation: true }, location.search);
  };
  // E1: no station found anywhere it looked.
  const cantFind = (doc: StationFlow | StationFlow0, at: OpenedFile, f: Finding | null, inHub?: Hub) => {
    const made = stationOf(doc), name = at.path.slice(at.path.lastIndexOf("/") + 1);
    project.tell({
      title: `Can't find ${named(made)}`,
      text: [`${name} is a flow on ${made.name}${made.path ? `, and points to ${made.path}, which isn't there` : ""}. No station called ${made.name} is anywhere else Simplicial looked:`],
      looked: f && "missing" in f ? lookedList(f, inHub?.name) : undefined,
      actions: [
        ...(at.hub ? [{ label: "Find the station…", primary: true, run: () => { finding.current = { doc, at }; setFilePick("find"); } }] : []),
        { label: "Open without a station", run: () => without(doc, at) },
        { label: "Cancel" },
      ],
    });
  };
  // E5: the flow's station isn't this window's.
  const otherStation = (doc: StationFlow | StationFlow0, at: OpenedFile, place: Place) => {
    const it = stem(at.path);
    project.tell({
      title: `Open ${it} on ${place.name}?`,
      text: [`This window works on ${state.engine}. Switch it to ${place.name}, or open ${it} in a new window and keep ${state.engine} here.`],
      actions: [
        { label: "Switch", primary: true, run: () => project.ask("Switch the station?", "Switch", () => void switchTo(place, at, doc)) },
        { label: "New window", run: () => void switchTo(place, at, doc, { tab: window.open("", "_blank") }) },
        { label: "Cancel" },
      ],
    });
  };
  /** Find the station… (E1's): a .pst picked in the hub; another station's name asks first, then the flow opens on it. */
  const foundIt = (h: Hub, path: string) => {
    setFilePick(null);
    const it = finding.current;
    const st = listed.get(`${h.id}:${path}`)?.station;
    if (!it || !st) return void notes.show({ title: `Can't use ${path}`, detail: "Simplicial can't read its station.toml", state: "failed" });
    const go = () => (st.name === state.engine ? void take(it.doc, it.at, undefined, true) : void switchTo({ hub: h.id, path }, it.at, it.doc, { use: true }));
    const made = stationOf(it.doc);
    if (st.name === made.name) return go();
    project.tell({ title: `This is ${st.name}, not ${made.name}`, text: [`Open ${stem(it.at.path)} on ${named(st)}? Its changes that don't fit ${st.name} are kept in the file.`],
      actions: [{ label: "Use it", primary: true, run: go }, { label: "Cancel" }] });
  };

  /** File › New project: the station's starter again, no file. */
  const newProject = () => project.ask("Start a new project?", "New project", () => {
    load(buildProject({ station: ref, flow: state.starter.graph ?? { nodes: [], edges: [] } }), null);
    setRef((r) => ({ name: r.name || state.engine, ...(r.version ? { version: r.version } : {}), ...(r.sha256 ? { sha256: r.sha256 } : {}) }));
    project.opened();
  });
  /** File › Open recent: a hub's file read again (it may have changed), else the copy kept when it was last opened or saved. */
  const openRecent = async (i: number) => {
    const r = project.recent[i];
    if (!r?.hub) return r && take(r.project, { path: r.name });
    const known = await listHubs();
    setHubs(known);
    readFlow(r.hub, r.name).then((psf) => take(psf, { hub: r.hub, path: r.name }, known.find((h) => h.id === r.hub)), (e) => failed(`Can't open ${r.name}`, e));
  };
  /** This computer's Save as: the browser's download, named after the file; its station by name only (no path). */
  const download = () => {
    const a = document.createElement("a");
    const { path: _path, ...station } = ref;
    const psf = flowFile(station);
    a.href = URL.createObjectURL(new Blob([JSON.stringify(psf, null, 2)], { type: "application/json" }));
    a.download = `${file ? stem(file.path) : state.engine || "flow"}.psf`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setFile({ path: a.download });
    setRef(station);
    project.saved({ name: a.download, project: psf });
  };
  // No Malachite, or no hubs: straight to the system's picker.
  const openFile = async () => {
    const known = await listHubs();
    setHubs(known);
    if (known.length) setFilePick("open"); else sysOpen.current?.click();
  };
  const saveFileAs = async () => {
    const known = await listHubs();
    setHubs(known);
    if (known.length) setFilePick("save"); else download();
  };
  /** Write the flow to `path` in the hub: its station's path from there (the hub's station of its name), else by name (E8). */
  const writeIn = async (h: Hub | string, path: string) => {
    const hubId = typeof h === "string" ? h : h.id;
    let f: Finding | null = null;
    try { f = await findStation({ hub: hubId, name: state.engine, version: ref.version }); } catch { /* by name */ }
    const place = f && "found" in f && (f.found.where === "path" || f.found.where === "workspace") ? f.found : null;
    const { path: _path, ...rest } = ref;
    const station: StationRef = place
      ? { name: place.name, ...(place.version ? { version: place.version } : {}), ...(place.sha256 ? { sha256: place.sha256 } : {}), path: relPath(path, place.path) }
      : rest;
    const psf = flowFile(station);
    await writeFlow(h, path, psf);
    setRef(station);
    project.saved({ name: path, hub: hubId, project: psf });
    if (place) setHome({ ...place, hub: hubId });
    const apart = !place && home?.hub && home.hub !== hubId ? hubs.find((x) => x.id === home.hub)?.name : undefined;
    return apart ? apartNote(stem(path), state.engine, apart, typeof h === "string" ? h : h.name) : null;
  };
  const saveFile = () => {
    if (!file?.hub) return void saveFileAs();
    writeIn(file.hub, file.path).then((apart) => notes.show(apart ?? { title: `Saved ${fileName}`, state: "done" }), (e) => failed(`Can't save ${fileName}`, e));
  };
  /** Picking a .pst opens its station on its starter (a new flow); a .psf opens on its station. */
  const openFromHub = (h: Hub, path: string) => {
    setFilePick(null);
    if (path.endsWith(".pst")) {
      const st = listed.get(`${h.id}:${path}`)?.station;
      if (st?.name === state.engine) return newProject();
      return project.tell({
        title: `Open ${st ? st.name : path.slice(path.lastIndexOf("/") + 1)}?`,
        text: [`This window works on ${state.engine}. Switch it to ${st?.name ?? "that station"} (a new flow on its starter), or open it in a new window.`],
        actions: [
          { label: "Switch", primary: true, run: () => project.ask("Switch the station?", "Switch", () => void switchTo({ hub: h.id, path }, null, null)) },
          { label: "New window", run: () => void switchTo({ hub: h.id, path }, null, null, { tab: window.open("", "_blank") }) },
          { label: "Cancel" },
        ],
      });
    }
    readFlow(h, path).then((psf) => take(psf, { hub: h.id, path }, h), (e) => failed(`Can't open ${path}`, e));
  };
  const saveInHub = (h: Hub, path: string) => {
    setFilePick(null);
    writeIn(h, path).then((apart) => {
      setFile({ hub: h.id, path });
      notes.show(apart ?? { title: `Saved ${path.slice(path.lastIndexOf("/") + 1)}`, detail: `Simplicial now works in ${h.name}`, state: "done" });
    }, (e) => failed(`Can't save ${path}`, e));
  };
  // ?open=<hub>:<path>: the flow to open once the station has said hello (it survives a station switch), or without one.
  const opening = useRef(false);
  useEffect(() => {
    const o = OPENING.open;
    if (!o || opening.current || !(WITHOUT || (booted && state.engine))) return;
    opening.current = true;
    const t = window.setTimeout(async () => {  // the starter settles first (variables.load, station.load)
      try {
        if (!o.hub) {
          const kept = sessionStorage.getItem(STASH);
          if (kept) await take(parseFlow(kept), { path: o.path }, undefined, OPENING.use);
          return;
        }
        const known = await listHubs();
        setHubs(known);
        await take(await readFlow(o.hub, o.path), { hub: o.hub, path: o.path }, known.find((h) => h.id === o.hub), OPENING.use);
      } catch (e) { failed(`Can't open ${o.path}`, e); }
    }, WITHOUT ? 0 : 400);
    return () => window.clearTimeout(t);
  }, [booted, state.engine]); // eslint-disable-line react-hooks/exhaustive-deps -- once
  // E6: while the window waits for its station, what the station's start says (`/__paperboat/status`): failed, and why.
  const [startFailed, setStartFailed] = useState<Status | null>(null);
  useEffect(() => {
    if (booted || WITHOUT || !PORT) return;
    const t = window.setInterval(() => void stationStatus().then((all) => {
      const s = all.find((x) => x.port === PORT);
      setStartFailed(s?.state === "failed" ? s : null);
    }, () => {}), 1000);
    return () => window.clearInterval(t);
  }, [booted]);
  const showLog = () => {
    setConsoleOpen(true);
    if (PORT) void stationLog(PORT).then((text) => { for (const line of text.split("\n").filter(Boolean).slice(-200)) log("info", line); }, () => {});
  };
  const runStates = useMemo(() => ({
    active: new Set(state.active), failed: new Set(state.failed), queued: new Set(state.queued), cached: new Set(state.cached), progress: state.progress,
  }), [state.active, state.failed, state.queued, state.cached, state.progress]);
  // A plate drawn `when` its block's latest value is on (a lit Lamp).
  const onKey = Object.entries(state.latest).filter(([, v]) => (typeof v === "number" ? v > 0.5 : false)).map(([k]) => k).join("\n");
  const onBlocks = useMemo(() => new Set(onKey ? onKey.split("\n") : []), [onKey]);

  useEffect(() => {
    if (!booted) return;
    const f = requestAnimationFrame(() => requestAnimationFrame(() => setStill(false)));
    return () => cancelAnimationFrame(f);
  }, [booted]);
  const projectName = file ? stem(file.path) : state.engine;
  useEffect(() => { document.title = projectName ? `${project.dirty ? "● " : ""}${projectName} · Simplicial` : "Simplicial"; }, [projectName, project.dirty]);
  useEffect(() => { if (state.stationView.view === "graph") setSview("graph"); }, [state.stationView.view]);

  const station = state.stationView.visible !== false;
  const shownPage: Page = !station && page === "station" ? "flow" : page;
  const pages = station ? PAGES : PAGES.filter((p) => p !== "station");
  const hid = (p: Pane) => hidden[mode].includes(p);
  const toggle = (p: Pane, show = hid(p)) => setHidden((h) => ({ ...h, [mode]: show ? h[mode].filter((x) => x !== p) : [...h[mode], p] }));
  const go = (p: Page) => { if (p === "station" && !station) return; setMode("navigator"); setPage(p); };

  const missing = nodes.some((n) => isBlock(n) && n.data.missing);
  const whyNot = running ? "A run is in progress" : state.connection !== "open" ? "Not connected to a station"
    : !nodes.length ? "The flow is empty: add a block (/)" : missing ? "A block this station doesn't have is on the flow: replace or delete it" : "";
  /** Arrange the Board, in view: its page in Navigator, its drawer open in Commander. */
  const arrangeBoard = () => {
    if (!arranging && mode === "navigator") setPage("board");
    if (!arranging && mode === "commander" && hid("bd")) toggle("bd", true);
    setArranging((a) => !a);
  };
  const run = () => {
    if (whyNot) return;
    if (mode === "commander" && hid("bd")) toggle("bd", true);  // a run is watched on the Board
    send({
      type: "graph.run", graph: toGraph(nodes, edges, state.loaded?.flow), ...(state.station ? { station: state.station } : {}),
      ...(Object.keys(runSettings).length ? { settings: runSettings } : {}), variables: state.variables,
    });
  };
  const cancel = () => send({ type: "run.cancel" });
  const errors = state.logs.filter((l) => l.level === "error").length;

  const picked = nodes.some((n) => n.selected && !(isBlock(n) && n.data.def.linked));
  const commands = registry(
    {
      mode, page: shownPage, station, hidden: hid, console: consoleOpen, theme, running, whyNot,
      flow: { lock, undo: history.canUndo, redo: history.canRedo, copy: picked, paste: !!flow.current?.canPaste(), arrange: canArrangeFlow(nodes, level) },
      board: arranging, unsaved: state.engine ? "" : "Not connected to a station", recent: project.recent.map((r) => ({ name: r.name, when: ago(r.savedAt, Date.now()) })),
      misfits: kept.length,
    },
    {
      setMode, go, toggle, console: () => setConsoleOpen((o) => !o), setTheme, search: () => setSearch((s) => (s ? null : {})),
      run, cancel, station: () => setPicker(true), newProject, open: () => void openFile(), openRecent: (i) => void openRecent(i), save: saveFile, saveAs: () => void saveFileAs(), review: () => setReview(true), report: () => window.open(ISSUES, "_blank", "noopener"), about: () => setAbout(true),
      undo: history.undo, redo: history.redo, cut: () => flow.current?.cut(), copy: () => flow.current?.copy(), paste: () => flow.current?.paste(),
      all: () => { go("flow"); flow.current?.selectAll(); }, arrange: () => void flow.current?.arrange(), arrangeBoard,
    },
  );
  useShortcuts(booted ? commands : []);

  /** Quick add at a point: the cursor over the Flow, else a third down its middle; only where the Flow is in view. */
  const quickAdd = (at?: { x: number; y: number }) => {
    const r = flowBody.current?.getBoundingClientRect();
    if (!r || !flowInView || lock) return;
    setSearch({ at: at ?? mouse.current ?? { x: r.left + r.width / 2 - 200, y: r.top + r.height / 3 } });
  };
  const flowInView = (mode !== "navigator" || shownPage === "flow") && !(mode === "lookout" && hid("fl"));
  // Esc cancels a run (once nothing floats: menus, the Console and the search take Esc first); / is quick add
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!booted || typing(e.target) || ownKeys(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Escape" && running) { e.preventDefault(); cancel(); }
      else if (e.key === "/" && !search) { e.preventDefault(); quickAdd(); }
    };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  });

  // Ctrl K: the registry's commands, the catalog's blocks and the variables; quick add: the blocks alone, by toolkit
  const blocks = useMemo(() => state.blocks.filter((b) => !b.linked).sort((a, b) => (a.group ?? "").localeCompare(b.group ?? "")), [state.blocks]);
  const blockItems: SearchItem[] = blocks.map((b) => ({
    id: `b:${b.type}`, label: b.label, detail: `${b.kind} · ${b.group ?? b.type}`, group: b.group ?? "Blocks", scope: "Blocks", icon: b.kind === "monitor" ? "a-board" : "a-flow",
    run: () => { if (search?.at) flow.current?.place(b, search.at); },
  }));
  // Ctrl K also lists the stations that answer: pick one to open the page on it.
  const stations = useStations(!!search && !search.at, 0, URL_).found;
  const searchItems: SearchItem[] = search?.at ? blockItems : [
    ...commands.filter((c) => !c.quiet).sort((a, b) => Number(!isEnabled(a)) - Number(!isEnabled(b))).map((c): SearchItem => ({  // what can't run goes last
      id: c.id, label: c.label, group: "Commands", scope: "Commands", icon: c.id.startsWith("view.") && PAGES.includes(c.id.slice(5) as Page) ? "go" : "command",
      detail: MENUS.find((m) => m.id === c.menu)?.label, shortcut: c.shortcut, disabled: !isEnabled(c), why: c.why, run: c.run,
    })),
    ...blockItems.map((b) => ({ ...b, group: "Blocks" })),
    ...stations.map((f): SearchItem => ({
      id: `s:${f.url}`, label: `Station: ${f.name}`, group: "Stations", scope: "Stations", icon: "go",
      detail: f.url === URL_ ? `${f.url} · open now` : f.url, disabled: f.url === URL_, why: "The page is on this station", run: () => openStation(f.url),
    })),
    ...state.variables.map((v): SearchItem => ({
      id: `v:${v.name}`, label: v.name, group: "Variables", scope: "Variables", icon: "a-variables",
      detail: [v.expr ? `ƒ ${v.expr}` : fmt(v.value ?? state.varValues[v.name] ?? ""), v.unit, v.group].filter(Boolean).join(" · "),
      run: () => toggle("r", true),
    })),
  ];

  // the Board's tabs (the layout's; a strip only with two or more) and its latest readouts (the hidden drawer's head)
  const tabs = [...new Set(layout?.tabs ?? [])];
  const readouts = Object.keys(monitors).flatMap((k) => {
    const v = state.latest[k], m = monitors[k];
    return typeof v === "number" && m.inputs?.length === 1 ? [[k, v, m.sources?.[m.inputs[0]]?.unit] as const] : [];  // one input: one reading
  }).slice(0, 4);
  const duration = Number(runSettings.duration ?? state.runDefaults.duration ?? 0);
  const elapsed = !state.run ? "" : duration > 0 ? `${(state.run.progress * duration).toFixed(1)} / ${duration} s` : `${(state.run.simTime ?? 0).toFixed(1)} s / ∞`;
  const status = state.run?.status;
  const statusText = status === "running" ? <><Spinner size={12} />running {elapsed}</>
    : status === "failed" ? (state.failed.length ? `${state.failed[0]} failed` : "failed")
    : status === "done" ? `done · ${elapsed}` : status;

  const dock = (
    <Dock canRun={!whyNot} whyNot={whyNot} running={running} status={status} statusText={statusText} onRun={run} onCancel={cancel}
      optionsSlot={state.runDefaults.mode === "clock" && (
        <RunOptions defaults={state.runDefaults} value={runSettings} onChange={(next) => {
          const speed = (s: RunSettings) => s.speed ?? state.runDefaults.speed ?? 1;
          if (running && speed(next) !== speed(runSettings)) send({ type: "run.speed", speed: speed(next) });  // the run takes it at once
          setRunSettings(next);
        }} />
      )} />
  );
  const [hoverVar, setHoverVar] = useState<string | null>(null); // the Variables row the pointer is on: its blocks are marked
  const vars = useMemo(() => ({
    list: state.variables, values: state.varValues, show: () => toggle("r", true), hover: hoverVar,
    hints: state.variables.map((v) => ({ name: v.name, type: typeLine(v), value: valueText(v.expr ? state.varValues[v.name] : v.value ?? state.varValues[v.name], v.type) })),
  }), [state.variables, state.varValues, hoverVar]); // eslint-disable-line react-hooks/exhaustive-deps
  /** The Console's block: picked on the canvas, on its level, in view. */
  const pick = (id: string) => {
    const n = nodes.find((x) => x.id === id);
    if (!n) return;
    setNodes((ns) => ns.map((x) => (x.id === id ? { ...x, selected: true } : x.selected ? { ...x, selected: false } : x)));
    setLevel(n.parentId && nodes.some((g) => g.id === n.parentId && g.type === "frame" && (g as FlowNode & { type: "frame" }).data.kind !== "visual") ? n.parentId : null);
    window.setTimeout(() => void fitView({ nodes: [{ id }], duration: 300, maxZoom: 1.2, padding: 0.6 }), 520);  // once the page has slid in
  };
  const drawer = (p: Pane, on: boolean) => (on ? { hidden: hid(p), onHidden: (h: boolean) => toggle(p, !h) } : {});
  const inert = (p: Page) => mode === "navigator" && p !== shownPage;
  const blockCount = nodes.filter((n) => isBlock(n) && !isPortType(n.data.def.type)).length;
  const objects = state.station?.objects.length ?? Object.keys(state.entities).length;
  const gridOn = floor ?? (state.view.mode !== "3d" || state.view.grid !== false);

  return (
    <div className={`win frame${still ? " still" : ""}${station ? "" : " nost"}${(["st", "fl", "bd"] as Pane[]).map((p) => (hid(p) ? ` hide-${p}` : "")).join("")}`} data-mode={mode}>
      <header className="bar">
        <span className="lk"><AppMark app="simplicial" size={26} idle paused={!booted} label="Simplicial" /><span className="wm">Simplicial</span></span>
        {booted && <>
          <MenuBar commands={commands} menus={MENUS} groupTitles={{ theme: "Theme", recent: "Open recent" }} />
          {hub && <HubSelector hub={hub} hubs={hubs} app="Simplicial" onSwitch={() => setFilePick("open")} onDisconnect={() => setFile(null)}
            onNew={() => notes.show({ title: "New hubs are made in Malachite", detail: "or with paperboat hub new <name>" })} />}
          <span className="proj" title={[file ? (hub ? `${hub.name}/${file.path}` : file.path) : "", state.engine, project.dirty ? "changes not saved" : ""].filter(Boolean).join(" · ")}>
            {file ? <>{file.path.includes("/") && `${file.path.slice(0, file.path.lastIndexOf("/"))}/`}<u>{fileName}</u></> : state.engine}
            {project.dirty && <i className="dirty" />}
          </span>
          <span className="bend">
            <span className="modes" title="View mode (Alt M steps through them)">
              <Segmented label="View mode" value={mode} onChange={setMode} options={[
                { value: "navigator", label: "Navigator", hint: "One page at a time" },
                { value: "commander", label: "Commander", hint: "Station and Flow side by side, the Board under them" },
                { value: "lookout", label: "Lookout", hint: "The Board fills the window; Station and Flow at its sides" },
              ]} />
            </span>
            <button ref={conKey} type="button" className="key round bar-key" aria-label="Console (Ctrl `)" title="Console (Ctrl `)" aria-pressed={consoleOpen} onClick={() => setConsoleOpen((o) => !o)}>
              <Icon name="a-console" />{errors > 0 && <b className="badge bad">{errors}</b>}
            </button>
            <Notifications {...notes} />
            <PanelsKey layout={sketch(mode, station)} onToggle={(id) => toggle(id as Pane)}
              panels={PANES[mode].filter((p) => station || p !== "st").map((p) => ({ id: p, label: PANE_NAME[p][0], keys: PANE_NAME[p][1], shown: !hid(p) }))} />
            <span className="lsep" />
            <ThemePicker theme={theme} onChange={setTheme} />
          </span>
        </>}
      </header>

      {!booted ? (
        <>
          <Splash app="simplicial" ready={!!state.engine} onReady={() => setBooted(true)} onLog={showLog} failed={!!startFailed}
            onRetry={OPENING.start ? () => void switchTo(OPENING.start!, OPENING.open ?? null, null, { use: OPENING.use }) : undefined}
            say={startFailed ? `${startFailed.name} didn't start` : retrying ? "Waiting for the station" : "Connecting to the station"}
            detail={startFailed ? startFailed.error ?? "see the log" : retrying ? `${URL_} · retrying` : URL_} />
          {startFailed && OPENING.open && (
            <div className="splash-more"><Key kind="quiet" onClick={() => { location.search = toSearch({ open: OPENING.open, nostation: true }, location.search); }}>Open without a station</Key></div>
          )}
        </>
      ) : <>
        <PageRail label="Pages" page={shownPage} onPage={(p) => go(p as Page)} aside={mode !== "navigator"} pages={[
          { id: "station", label: "Station", icon: "a-station", keys: "Alt 1", why: station ? undefined : NO_STATION },
          { id: "flow", label: "Flow", icon: "a-flow", keys: "Alt 2" },
          { id: "board", label: "Board", icon: "a-board", keys: "Alt 3", count: running ? "live" : undefined },
        ]} />
        <div className="main">
          <div className="pages bay">
            <div className="pcol" style={{ "--i": pages.indexOf(shownPage) } as CSSProperties}>
              {station && (
                <div className="pg pg-station" inert={inert("station")}>
                  <Panel name="Station" side="left" width={380} icon="a-station" count={objects} {...drawer("st", mode === "lookout")}
                    head={<small className="sum">{`${state.engine} · ${objects} ${objects === 1 ? "object" : "objects"}`}</small>}
                    tools={<>
                      {sview === "3d" && <Key size="sm" kind="quiet" aria-pressed={gridOn} title="The floor grid" onClick={() => setFloor(!gridOn)}>Grid</Key>}
                      <Segmented size="sm" label="Station view" value={sview} onChange={setSview} options={[{ value: "3d", label: "3D" }, { value: "graph", label: "Graph" }]} />
                    </>}>
                    <Vars.Provider value={vars}>
                    <StationPage station={state.station} defs={state.objects} scene={sceneOf(state)} view={state.view} grid={gridOn} mode={sview}
                      locked={running} onChange={(station) => send({ type: "station.set", station })} onBlock={(id) => { go("flow"); pick(id); }}
                      starter={state.starter.station} changed={changes.overrides.objects} name={state.engine} />
                    </Vars.Provider>
                  </Panel>
                </div>
              )}
              <div className="pg pg-flow" inert={inert("flow")}>
                <Panel name="Flow" side="right" width={480} icon="a-flow" count={blockCount} {...drawer("fl", mode === "lookout")}
                  head={<small className="sum">{`${blockCount} ${blockCount === 1 ? "block" : "blocks"} · ${edges.length} ${edges.length === 1 ? "wire" : "wires"}`}</small>}
                  tools={<>
                    <span title={lock || "Arrange the blocks along their wires"}>
                      <Key size="sm" kind="quiet" disabled={!!lock || !canArrangeFlow(nodes, level)} onClick={() => flow.current?.arrange()}>Arrange</Key>
                    </span>
                    <span title={lock || "Add a block (/ or double-click the canvas)"}>
                      <Key size="sm" kind="quiet" icon="add" shortcut="/" disabled={!!lock}
                        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setSearch({ at: { x: r.right - 400, y: r.bottom + 6 } }); }}>Add block</Key>
                    </span>
                  </>}>
                  <div ref={flowBody} className="page-body"
                    onPointerMove={(e) => (mouse.current = { x: e.clientX, y: e.clientY })} onPointerLeave={() => (mouse.current = null)}>
                    <RunStates.Provider value={runStates}>
                    <OnBlocks.Provider value={onBlocks}>
                    <Vars.Provider value={vars}>
                      <FlowEditor blocks={state.blocks} connectors={state.connectors} nodes={nodes} edges={edges} setNodes={setNodes} setEdges={setEdges}
                        onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} active={booted && flowInView} minimap={mode === "navigator" && shownPage === "flow"}
                        level={level} setLevel={setLevel} lock={lock} controls={flow} onQuickAdd={quickAdd} fit={fit} />
                    </Vars.Provider>
                    </OnBlocks.Provider>
                    </RunStates.Provider>
                  </div>
                </Panel>
              </div>
              <div className="pg pg-board" inert={inert("board")}>
                <Panel name="Board" side="bottom" {...drawer("bd", mode === "commander")}
                  head={<>
                    {tabs.length > 1 && !(mode === "commander" && hid("bd")) && <Tabs label="Board tabs" value={tab || tabs[0]} onChange={setTab} tabs={tabs.map((t) => ({ value: t, label: t }))} />}
                    {mode === "commander" && hid("bd") && readouts.length > 0 && (
                      <span className="bread">{readouts.map(([k, v, u]) => <span key={k}>{k} <b>{fmt(v)}</b>{u && <small>{u}</small>}</span>)}</span>
                    )}
                  </>}
                  tools={<Key size="sm" kind="quiet" aria-pressed={arranging} title={arranging ? "Done arranging" : "Move and size the instruments, add decorations and tabs"} onClick={arrangeBoard}>
                    {arranging ? "Done" : "Arrange"}
                  </Key>}>
                  <Board state={state} send={send} monitors={monitors} layout={layout} custom={!!saved} onSave={saveBoard} arrange={arranging}
                    tab={tab} onTab={setTab} onBlock={(id) => { go("flow"); pick(id); }} taps={taps} onTap={tap} dock={mode !== "commander"} />
                </Panel>
                {mode === "lookout" && dock}
              </div>
            </div>
            {mode !== "lookout" && dock}
          </div>
          <Variables hidden={hid("r")} onHidden={(h) => toggle("r", !h)} list={state.variables} values={state.varValues} error={state.varError} locked={running}
              onHover={setHoverVar} onChange={(variables) => send({ type: "variables.set", variables })}
              starter={state.starter.variables} changed={changedVars} station={state.engine}
              onRename={(from, to) => setNodes((ns) => ns.map((n) => (isBlock(n) && Object.values(n.data.params).some((p) => JSON.stringify(p).includes(from))
                ? { ...n, data: { ...n.data, params: Object.fromEntries(Object.entries(n.data.params).map(([k, p]) => [k, renameRef(p, from, to)])) } } : n)))} />
        </div>
      </>}

      {(picker || (!booted && retrying && !startFailed && !OPENING.start)) && <StationPicker current={URL_} wait={!booted} onClose={() => setPicker(false)} />}
      {about && <About app="simplicial" role="Visual flow, station and block-diagram simulation" version={__VERSION__}
        info={[state.engine ? `engine ${state.version ?? "?"} · protocol paperboat/0 · station ${state.engine}` : "no station", __COMMIT__ && `commit ${__COMMIT__}`].filter(Boolean).join(" · ")}
        repo="paperboatlab/simplicial" credits={CREDITS} onClose={() => setAbout(false)} />}
      {consoleOpen && <ConsoleWindow logs={state.logs} errors={errors} onClose={() => setConsoleOpen(false)} triggerRef={conKey}
        onBlock={booted ? (id) => { setConsoleOpen(false); go("flow"); pick(id); } : undefined} />}
      {search && <Search items={searchItems} at={search.at} action={search.at ? "add here" : "run"} onClose={() => setSearch(null)}
        scopes={search.at ? [] : ["All", "Commands", "Blocks", "Variables", "Stations"]}
        placeholder={search.at ? "Add a block here" : "Search commands, blocks, variables and stations"} />}
      {filePick === "find" && <OpenFile what="its station" types={["pst"]} hubs={hubs.filter((h) => h.id === finding.current?.at.hub)} list={listHub} onOpen={foundIt}
        onComputer={() => notes.show({ title: "A station on this computer starts from its own command", detail: "paperboat start <file.pst>, then open the flow on it" })}
        onClose={() => setFilePick(null)} />}
      {filePick === "open" && <OpenFile what="a flow or a station" types={TYPES} hubs={hubs} list={listHub} onOpen={openFromHub}
        onComputer={() => sysOpen.current?.click()} onClose={() => setFilePick(null)} />}
      {filePick === "save" && <SaveFile what="the flow" types={TYPES} hubs={hubs} list={listHub} name={file ? stem(file.path) : state.engine}
        onSave={saveInHub} onComputer={download} onClose={() => setFilePick(null)} />}
      <input ref={sysOpen} type="file" accept=".psf" hidden onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (f) f.text().then((t) => take(parseFlow(t), { path: f.name })).catch((err: unknown) => failed(`Can't open ${f.name}`, err));
      }} />
      {project.notice && (() => {
        const n = project.notice, choose = (run?: () => void) => { project.close(); run?.(); };
        return (
          <Dialog title={n.title} wait onClose={() => choose(n.actions.at(-1)?.run)}
            actions={n.actions.map((a) => <Key key={a.label} kind={a.primary ? "primary" : undefined} onClick={() => choose(a.run)}>{a.label}</Key>)}>
            {n.text.map((t) => <p key={t}>{t}</p>)}
            {n.looked && <ul className="looked">{n.looked.map(([w, what]) => <li key={w}><Icon name="error" /><code>{w}</code><span>{what}</span></li>)}</ul>}
          </Dialog>
        );
      })()}
      {review && <Review misfits={kept} station={home ? named(home) : state.engine} file={file ? stem(file.path) : "this flow"}
        onApply={(keep) => { setKept(keep); setReview(false); }} onClose={() => setReview(false)} />}
      <Toasts toasts={notes.toasts} onDismiss={notes.dismiss} />
    </div>
  );
}


/** The station's variables, read-only in v0.1: by group, the value in a well (a formula's, with ƒ and its expression), the unit. */

/** E4's review: each change that doesn't fit the station, kept (in the file, unused) or removed. */
function Review({ misfits, station, file, onApply, onClose }: {
  misfits: Misfit[]; station: string; file: string; onApply: (keep: Misfit[]) => void; onClose: () => void;
}) {
  const [gone, setGone] = useState<Set<string>>(new Set());
  const n = misfits.length;
  return (
    <Dialog title={`${n} ${n === 1 ? "change doesn't" : "changes don't"} fit ${station}`} onClose={onClose}
      actions={<><span className="grow" /><Key kind="primary" onClick={() => onApply(misfits.filter((m) => !gone.has(m.key)))}>Apply</Key><Key onClick={onClose}>Cancel</Key></>}>
      <p>These changes in {file} have no place in {station}: a kept one stays in the file, unused, until a version has it again.</p>
      <div>
        {misfits.map((m) => (
          <div key={m.key} className="fit">
            <code>{m.key}</code>
            <small>{m.why}</small>
            <Segmented size="sm" label={`${m.key}: keep or remove`} value={gone.has(m.key) ? "remove" : "keep"}
              onChange={(v) => setGone((g) => { const x = new Set(g); if (v === "remove") x.add(m.key); else x.delete(m.key); return x; })}
              options={[{ value: "keep", label: "Keep" }, { value: "remove", label: "Remove" }]} />
          </div>
        ))}
      </div>
    </Dialog>
  );
}
