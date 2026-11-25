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
import {
  AppMark, ConsoleWindow, Dock, Icon, Key, MenuBar, Notifications, PageRail, Panel, PanelsKey, Search, Segmented, Spinner, Splash, Tabs, ThemePicker,
  Toasts, isEnabled, readStored, typing, ownKeys, useShortcuts, useTheme, useToasts, writeStored,
  type PaneRect, type SearchItem, type Theme,
} from "@paperboatlab/ui";
import { useUndo } from "@paperboatlab/ui/canvas";
import { useEdgesState, useNodesState, useReactFlow, type FitViewOptions } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Board } from "./board/Board.tsx";
import { loadSaved, save } from "./board/boardLayout.ts";
import { useBoardWiring } from "./board/boardWiring.ts";
import { useEngine } from "./engine.ts";
import { useNews } from "./news.ts";
import { StationPicker } from "./StationPicker.tsx";
import { remember } from "./stations.ts";
import { useCanvasSync } from "./flow/canvasSync.ts";
import { OnBlocks, RunStates, Vars } from "./flow/flowContexts.ts";
import { FlowEditor, type FlowControls } from "./flow/FlowEditor.tsx";
import { toGraph } from "./flow/flowGraph.ts";
import { canArrangeFlow } from "./flow/flowLayout.ts";
import { isBlock, type FlowNode, type Wire } from "./flow/flowModel.ts";
import { isPortType } from "./flow/portBlocks.ts";
import { MENUS, MODES, NO_STATION, PAGES, PANES, registry, type Mode, type Page, type Pane } from "./menus.ts";
import type { BoardLayout, RunSettings } from "./protocol.ts";

/** The station: ?station=ws://host:port, else the page's own host (the engine serves the page and the socket on one port). */
const URL_ = new URLSearchParams(location.search).get("station") ?? (location.host ? `ws://${location.host}` : "ws://localhost:8765");
const ISSUES = "https://github.com/paperboatlab/simplicial/issues/new";
const SPEEDS = [0.25, 0.5, 1, 2, 4, 0];

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

/** How long and how fast the next run goes, beside Run (legacy RunOptions): the station's defaults until changed; 0 s runs until stopped. */
function RunOptions({ defaults, value, onChange }: { defaults: RunSettings; value: RunSettings; onChange: (v: RunSettings) => void }) {
  const duration = value.duration ?? defaults.duration ?? 10, speed = value.speed ?? defaults.speed ?? 1;
  const [draft, setDraft] = useState(String(duration));
  useEffect(() => setDraft(String(duration)), [duration]);
  const set = (change: RunSettings) => {
    const next = { ...value, ...change };
    for (const k of ["duration", "speed"] as const) if (next[k] === defaults[k]) delete next[k];  // only what changed goes with the run
    onChange(next);
  };
  const commit = () => { const d = Number(draft); if (draft.trim() && Number.isFinite(d) && d >= 0) set({ duration: d }); else setDraft(String(duration)); };
  return (
    <span className="run-options" title="The next run's length and speed (the station's defaults until changed; 0 s runs until stopped)">
      <i className="dock-sep" />for
      <input aria-label="Run length, s" value={draft} size={4} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />s
      <label>at</label>
      <select aria-label="Speed" value={speed} title="Times real time; during a run, it changes the run at once" onChange={(e) => set({ speed: Number(e.target.value) })}>
        {SPEEDS.map((x) => <option key={x} value={x}>{x === 0 ? "max" : `${x}×`}</option>)}
      </select>
    </span>
  );
}

export function App() {
  const { state, send, log } = useEngine(URL_);
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
  const [tab, setTab] = useState("");
  const [runSettings, setRunSettings] = useState<RunSettings>({});
  const [booted, setBooted] = useState(false);   // the splash has handed over
  const [retrying, setRetrying] = useState(false);  // the first try found no station
  useEffect(() => { if (state.connection === "closed") setRetrying(true); }, [state.connection]);
  useEffect(() => { if (state.engine) remember(URL_); }, [state.engine]);
  const [picker, setPicker] = useState(false);   // Choose a station, from File; over the splash while none answers
  const [still, setStill] = useState(true);       // nothing moves at start-up: the saved layout is simply there
  const conKey = useRef<HTMLButtonElement>(null);
  const flowBody = useRef<HTMLDivElement>(null);
  const mouse = useRef<{ x: number; y: number } | null>(null);

  const running = state.run?.status === "running";
  const lock = running ? LOCKED : "";
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
  useEffect(() => { document.title = state.engine ? `${state.engine} · Simplicial` : "Simplicial"; }, [state.engine]);
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
      board: arranging,
    },
    {
      setMode, go, toggle, console: () => setConsoleOpen((o) => !o), setTheme, search: () => setSearch((s) => (s ? null : {})),
      run, cancel, station: () => setPicker(true), report: () => window.open(ISSUES, "_blank", "noopener"),
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
  const searchItems: SearchItem[] = search?.at ? blockItems : [
    ...commands.filter((c) => !c.quiet).sort((a, b) => Number(!isEnabled(a)) - Number(!isEnabled(b))).map((c): SearchItem => ({  // what can't run goes last
      id: c.id, label: c.label, group: "Commands", scope: "Commands", icon: c.id.startsWith("view.") && PAGES.includes(c.id.slice(5) as Page) ? "go" : "command",
      detail: MENUS.find((m) => m.id === c.menu)?.label, shortcut: c.shortcut, disabled: !isEnabled(c), why: c.why, run: c.run,
    })),
    ...blockItems.map((b) => ({ ...b, group: "Blocks" })),
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
  const elapsed = !state.run ? "" : duration > 0 ? `${(state.run.progress * duration).toFixed(1)} / ${duration} s` : `${(state.run.simTime ?? 0).toFixed(1)} s`;
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
  const vars = useMemo(() => ({ list: state.variables, values: state.varValues, show: () => toggle("r", true) }), [state.variables, state.varValues]); // eslint-disable-line react-hooks/exhaustive-deps
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

  return (
    <div className={`win${still ? " still" : ""}${station ? "" : " nost"}${(["st", "fl", "bd"] as Pane[]).map((p) => (hid(p) ? ` hide-${p}` : "")).join("")}`} data-mode={mode}>
      <header className="bar">
        <span className="lk"><AppMark app="simplicial" size={26} idle paused={!booted} label="Simplicial" /><span className="wm">Simplicial</span></span>
        {booted && <>
          <MenuBar commands={commands} menus={MENUS} groupTitles={{ theme: "Theme" }} />
          <span className="proj" title={Object.keys(runSettings).length ? `${state.engine} · changes not saved` : state.engine}>
            {state.engine}{Object.keys(runSettings).length > 0 && <i className="dirty" />}
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
              <Icon name="a-console" />{errors > 0 && <b className="badge">{errors}</b>}
            </button>
            <PanelsKey layout={sketch(mode, station)} onToggle={(id) => toggle(id as Pane)}
              panels={PANES[mode].filter((p) => station || p !== "st").map((p) => ({ id: p, label: PANE_NAME[p][0], keys: PANE_NAME[p][1], shown: !hid(p) }))} />
            <span className="lsep" />
            <Notifications {...notes} />
            <ThemePicker theme={theme} onChange={setTheme} />
          </span>
        </>}
      </header>

      {!booted ? (
        <Splash app="simplicial" ready={!!state.engine} onReady={() => setBooted(true)} onLog={() => setConsoleOpen(true)}
          say={retrying ? "Waiting for the station" : "Connecting to the station"} detail={retrying ? `${URL_} · retrying` : URL_} />
      ) : <>
        <PageRail label="Pages" page={shownPage} onPage={(p) => go(p as Page)} aside={mode !== "navigator"} pages={[
          { id: "station", label: "Station", icon: "a-station", keys: "Alt 1", why: station ? undefined : NO_STATION },
          { id: "flow", label: "Flow", icon: "a-flow", keys: "Alt 2" },
          { id: "board", label: "Board", icon: "a-board", keys: "Alt 3", count: running ? "live" : undefined },
        ]} />
        <div className="main">
          <div className="pages">
            <div className="pcol" style={{ "--i": pages.indexOf(shownPage) } as CSSProperties}>
              {station && (
                <div className="pg pg-station" inert={inert("station")}>
                  <Panel name="Station" side="left" width={380} icon="a-station" count={objects} {...drawer("st", mode === "lookout")}
                    head={<><small className="sum">{`${state.engine} · ${objects} ${objects === 1 ? "object" : "objects"}`}</small><Tools><Segmented label="Station view" value={sview} onChange={setSview} options={[{ value: "3d", label: "3D" }, { value: "graph", label: "Graph" }]} /></Tools></>} />
                </div>
              )}
              <div className="pg pg-flow" inert={inert("flow")}>
                <Panel name="Flow" side="right" width={480} icon="a-flow" count={blockCount} {...drawer("fl", mode === "lookout")}
                  head={<><small className="sum">{`${blockCount} ${blockCount === 1 ? "block" : "blocks"} · ${edges.length} ${edges.length === 1 ? "wire" : "wires"}`}</small><Tools>
                    <span title={lock || "Arrange the blocks along their wires"}>
                      <Key size="sm" kind="quiet" disabled={!!lock || !canArrangeFlow(nodes, level)} onClick={() => flow.current?.arrange()}>Arrange</Key>
                    </span>
                    <span title={lock || "Add a block (/ or double-click the canvas)"}>
                      <Key size="sm" kind="quiet" icon="add" shortcut="/" disabled={!!lock}
                        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setSearch({ at: { x: r.right - 400, y: r.bottom + 6 } }); }}>Add block</Key>
                    </span>
                  </Tools></>}>
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
                    <Tools>
                      <Key size="sm" kind="quiet" aria-pressed={arranging} title={arranging ? "Done arranging" : "Move and size the instruments, add decorations and tabs"} onClick={arrangeBoard}>
                        {arranging ? "Done" : "Arrange"}
                      </Key>
                    </Tools>
                  </>}>
                  <Board state={state} send={send} monitors={monitors} layout={layout} custom={!!saved} onSave={saveBoard} arrange={arranging}
                    tab={tab} onTab={setTab} onBlock={(id) => { go("flow"); pick(id); }} taps={taps} onTap={tap} dock={mode !== "commander"} />
                </Panel>
                {mode === "lookout" && dock}
              </div>
            </div>
            {mode !== "lookout" && dock}
          </div>
          <Panel name="Variables" side="right" width={312} icon="a-variables" count={state.variables.length} hidden={hid("r")} onHidden={(h) => toggle("r", !h)}>
            <Variables state={state} />
            <div className="vfoot">Shared by the Station and the Flow</div>
          </Panel>
        </div>
      </>}

      {(picker || (!booted && retrying)) && <StationPicker current={URL_} wait={!booted} onClose={() => setPicker(false)} />}
      {consoleOpen && <ConsoleWindow logs={state.logs} errors={errors} onClose={() => setConsoleOpen(false)} triggerRef={conKey}
        onBlock={booted ? (id) => { setConsoleOpen(false); go("flow"); pick(id); } : undefined} />}
      {search && <Search items={searchItems} at={search.at} action={search.at ? "add here" : "run"} onClose={() => setSearch(null)}
        scopes={search.at ? [] : ["All", "Commands", "Blocks", "Variables"]}
        placeholder={search.at ? "Add a block here" : "Search commands, blocks and variables"} />}
      <Toasts toasts={notes.toasts} onDismiss={notes.dismiss} />
    </div>
  );
}

const Tools = ({ children }: { children: ReactNode }) => <span className="tools">{children}</span>;

/** The station's variables, read-only in v0.1: by group, the value in a well (a formula's, with ƒ and its expression), the unit. */
function Variables({ state }: { state: ReturnType<typeof useEngine>["state"] }) {
  const groups = new Map<string, typeof state.variables>();
  for (const v of state.variables) groups.set(v.group ?? "", [...(groups.get(v.group ?? "") ?? []), v]);
  if (!state.variables.length) return <p className="vnone">The station has no variables</p>;
  return (
    <div className="vars">
      {[...groups].map(([g, vs]) => (
        <div key={g}>
          {g && <div className="vg">{g}</div>}
          {vs.map((v) => (
            <div key={v.name} className="vr" title={v.note}>
              <span>{v.name}</span>
              <span className="well">{v.expr && <span className="f">ƒ</span>}{fmt(v.value ?? state.varValues[v.name] ?? "")}</span>
              <span className="u">{v.unit}</span>
              {v.expr && <small>= <code>{v.expr}</code></small>}
            </div>
          ))}
        </div>
      ))}
      {state.varError && <p className="verr">{state.varError.text}</p>}
    </div>
  );
}
