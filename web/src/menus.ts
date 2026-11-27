// The one command registry (REBRAND "Menu bar"): the menu bar, Ctrl K and the shortcuts all read this list,
// so a label, a key and why an item can't run never drift apart. An item that can't run stays, greyed, and
// says why. Pure: the app passes what it shows and what it can do.
import type { Command, Theme } from "@paperboatlab/ui";

export type Mode = "navigator" | "commander" | "lookout";
export type Page = "station" | "flow" | "board";
/** What can hide: the Variables card (r), and the pages where they are drawers (st, fl in Lookout; bd in Commander). */
export type Pane = "r" | "st" | "fl" | "bd";

export const MODES: Mode[] = ["navigator", "commander", "lookout"];
export const PAGES: Page[] = ["station", "flow", "board"];
export const NAME: Record<Mode | Page, string> = {
  navigator: "Navigator", commander: "Commander", lookout: "Lookout", station: "Station", flow: "Flow", board: "Board",
};
export const MENUS: { id: string; label: string }[] = [
  { id: "file", label: "File" }, { id: "edit", label: "Edit" }, { id: "view", label: "View" }, { id: "run", label: "Run" }, { id: "help", label: "Help" },
];
/** The panes each mode can hide, in screen order. */
export const PANES: Record<Mode, Pane[]> = { navigator: ["r"], commander: ["bd", "r"], lookout: ["st", "fl", "r"] };
export const NO_STATION = "This station has no Station page";
const LATER = "Not in v0.1 yet";
const NOTHING = "Select blocks on the Flow first";
const RUNNING = "A run is in progress";

export type View = {
  mode: Mode;
  page: Page;
  /** The station has a Station page (hello.station.visible). */
  station: boolean;
  hidden: (p: Pane) => boolean;
  console: boolean;
  theme: Theme;
  running: boolean;
  /** Why Run can't start now; "" when it can. */
  whyNot: string;
  /** The Flow canvas: what its Edit items can do now, and why the flow can't be edited ("" when it can).
   *  `picked`: something is picked on it, so Ctrl / comments it out there (the canvas's key) instead of opening the shortcuts. */
  flow: { lock: string; undo: boolean; redo: boolean; copy: boolean; paste: boolean; arrange: boolean; picked: boolean };
  /** The Board is being arranged (its instruments moved and sized, decorations and tabs edited). */
  board: boolean;
};
export type Do = {
  setMode: (m: Mode) => void;
  go: (p: Page) => void;
  toggle: (p: Pane) => void;
  console: () => void;
  setTheme: (t: Theme) => void;
  search: () => void;
  run: () => void;
  cancel: () => void;
  /** Choose a station: the page opens on the one picked. */
  station: () => void;
  /** Run settings…; absent without a station. */
  runSettings?: () => void;
  /** Toolkits…; absent without a station. */
  toolkits?: () => void;
  /** Manage runtimes…: the Launcher's Runtimes page. */
  runtimes: () => void;
  report: () => void;
  about: () => void;
  /** Settings on its Shortcuts page. */
  shortcuts: () => void;
  /** The Flow canvas's edits; their keys are the canvas's own (they leave a field's text alone). */
  undo: () => void;
  redo: () => void;
  cut: () => void;
  copy: () => void;
  paste: () => void;
  all: () => void;
  arrange: () => void;
  arrangeBoard: () => void;
};

const later = (id: string, label: string, menu: string, group: string, shortcut?: string): Command =>
  ({ id, label, menu, group, shortcut, enabled: false, why: LATER, run: () => {} });

/**
 * The File menu as the kit's `fileMenu` makes it (the same items in every app), as Simplicial runs it: while a run is in
 * progress nothing opens or closes.
 */
export function fileItems(items: Command[], running: boolean): Command[] {
  const busy = new Set(["file.new", "file.open", "file.openFolder", "file.recent", "file.connect", "file.close", "file.closeWorkspace"]);
  return items.map((c) => (running && busy.has(c.id) ? { ...c, enabled: false, why: RUNNING } : c));
}

export function registry(v: View, a: Do): Command[] {
  const nav = v.mode === "navigator";
  // A Flow edit: greyed with why while a run is in progress, else while it has nothing to act on.
  const edit = (id: string, label: string, group: string, shortcut: string, can: boolean, why: string, run: () => void): Command =>
    ({ id, label, menu: "edit", group, shortcut, enabled: !v.flow.lock && can, why: v.flow.lock || why, run });
  const drawer = (p: Pane, label: string, shortcut?: string, chord?: Command["chord"]): Command =>
    ({ id: `view.${p}`, label, menu: "view", group: "panels", shortcut, chord, checked: !v.hidden(p), run: () => a.toggle(p) });
  return [
    edit("edit.undo", "Undo", "undo", "Ctrl Z", v.flow.undo, "Nothing to undo", a.undo),
    edit("edit.redo", "Redo", "undo", "Ctrl Shift Z", v.flow.redo, "Nothing to redo", a.redo),
    edit("edit.cut", "Cut", "clip", "Ctrl X", v.flow.copy, NOTHING, a.cut),
    { id: "edit.copy", label: "Copy", menu: "edit", group: "clip", shortcut: "Ctrl C", enabled: v.flow.copy, why: NOTHING, run: a.copy },
    edit("edit.paste", "Paste", "clip", "Ctrl V", v.flow.paste, "Nothing copied yet", a.paste),
    { id: "edit.all", label: "Select all", menu: "edit", group: "clip", shortcut: "Ctrl A", run: a.all },
    later("edit.find", "Find…", "edit", "find", "Ctrl F"),

    ...MODES.map((m): Command => ({ id: `view.${m}`, label: NAME[m], menu: "view", group: "mode", checked: v.mode === m, run: () => a.setMode(m) })),
    // a key only: not in the bar (no such menu), but in Ctrl K
    { id: "view.next", label: "Next view mode", menu: "keys", group: "mode", shortcut: "Alt M", chord: { key: "m", alt: true },
      run: () => a.setMode(MODES[(MODES.indexOf(v.mode) + 1) % MODES.length]) },
    ...PAGES.map((p, i): Command => ({
      id: `view.${p}`, label: NAME[p], menu: "view", group: "page", shortcut: `Alt ${i + 1}`, chord: { key: String(i + 1), alt: true },
      checked: nav && v.page === p, enabled: p !== "station" || v.station, why: NO_STATION, run: () => a.go(p),
    })),
    drawer("r", "Variables", "Ctrl Alt B", { key: "b", ctrl: true, alt: true }),
    ...(v.mode === "commander" ? [drawer("bd", "Board drawer", "Ctrl J", { key: "j", ctrl: true })] : []),
    ...(v.mode === "lookout" ? [
      ...(v.station ? [drawer("st", "Station drawer")] : []),
      drawer("fl", "Flow drawer"),
    ] : []),
    { id: "view.console", label: "Console", menu: "view", group: "panels", shortcut: "Ctrl `", chord: { key: "`", ctrl: true }, checked: v.console, run: a.console },
    ...(["light", "dark", "system"] as Theme[]).map((t): Command => ({
      id: `view.theme.${t}`, label: t[0].toUpperCase() + t.slice(1), menu: "view", group: "theme", checked: v.theme === t, run: () => a.setTheme(t),
    })),
    { id: "view.arrange", label: "Arrange blocks", menu: "view", group: "flow", enabled: !v.flow.lock && v.flow.arrange, why: v.flow.lock || "Nothing on this level to arrange", run: a.arrange },
    { id: "view.board.arrange", label: "Arrange the Board", menu: "view", group: "flow", checked: v.board, run: a.arrangeBoard },
    { id: "view.search", label: "Command search…", menu: "view", group: "search", shortcut: "Ctrl K", chord: { key: "k", ctrl: true }, quiet: true, run: a.search },

    { id: "run.run", label: "Run", menu: "run", group: "run", shortcut: "Ctrl R", chord: { key: "r", ctrl: true }, enabled: !v.whyNot, why: v.whyNot, run: a.run },
    { id: "run.cancel", label: "Cancel", menu: "run", group: "run", shortcut: "Esc", enabled: v.running, why: "Nothing is running", run: a.cancel },
    { id: "run.settings", label: "Run settings…", menu: "run", group: "flow", enabled: !!a.runSettings, why: "No station: open the flow on its station", run: () => a.runSettings?.() },
    { id: "run.station", label: "Choose a station…", menu: "run", group: "station", run: a.station },
    { id: "run.toolkits", label: "Toolkits…", menu: "run", group: "station", enabled: !!a.toolkits, why: "No station: toolkits install into the engine that serves one", run: () => a.toolkits?.() },
    { id: "run.runtimes", label: "Manage runtimes…", menu: "run", group: "station", icon: "a-runtimes", run: a.runtimes },
    later("run.export", "Export station…", "run", "station"),

    later("help.docs", "Docs", "help", "docs", "F1"),
    { id: "help.keys", label: "Keyboard shortcuts", menu: "help", group: "docs", shortcut: "Ctrl /",
      chord: v.flow.picked ? undefined : { key: "/", ctrl: true }, run: a.shortcuts },
    { id: "help.report", label: "Report an issue…", menu: "help", group: "docs", run: a.report },
    { id: "help.about", label: "About Simplicial", menu: "help", group: "about", run: a.about },
  ];
}
