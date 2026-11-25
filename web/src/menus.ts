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
  report: () => void;
};

const later = (id: string, label: string, menu: string, group: string, shortcut?: string): Command =>
  ({ id, label, menu, group, shortcut, enabled: false, why: LATER, run: () => {} });

export function registry(v: View, a: Do): Command[] {
  const nav = v.mode === "navigator";
  const drawer = (p: Pane, label: string, shortcut?: string, chord?: Command["chord"]): Command =>
    ({ id: `view.${p}`, label, menu: "view", group: "panels", shortcut, chord, checked: !v.hidden(p), run: () => a.toggle(p) });
  return [
    later("file.new", "New project…", "file", "open", "Ctrl N"),
    later("file.open", "Open…", "file", "open", "Ctrl O"),
    later("file.save", "Save", "file", "save", "Ctrl S"),
    later("file.saveas", "Save as…", "file", "save", "Ctrl Shift S"),
    later("file.export", "Export station…", "file", "station"),
    later("file.settings", "Settings…", "file", "settings", "Ctrl ,"),

    later("edit.undo", "Undo", "edit", "undo", "Ctrl Z"),
    later("edit.redo", "Redo", "edit", "undo", "Ctrl Shift Z"),
    later("edit.cut", "Cut", "edit", "clip", "Ctrl X"),
    later("edit.copy", "Copy", "edit", "clip", "Ctrl C"),
    later("edit.paste", "Paste", "edit", "clip", "Ctrl V"),
    later("edit.all", "Select all", "edit", "clip", "Ctrl A"),
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
    { id: "view.search", label: "Command search…", menu: "view", group: "search", shortcut: "Ctrl K", chord: { key: "k", ctrl: true }, quiet: true, run: a.search },

    { id: "run.run", label: "Run", menu: "run", group: "run", shortcut: "Ctrl R", chord: { key: "r", ctrl: true }, enabled: !v.whyNot, why: v.whyNot, run: a.run },
    { id: "run.cancel", label: "Cancel", menu: "run", group: "run", shortcut: "Esc", enabled: v.running, why: "Nothing is running", run: a.cancel },
    later("run.arrange", "Arrange blocks", "run", "flow"),
    later("run.settings", "Run settings…", "run", "flow"),

    later("help.docs", "Docs", "help", "docs", "F1"),
    later("help.keys", "Keyboard shortcuts", "help", "docs", "Ctrl /"),
    { id: "help.report", label: "Report an issue…", menu: "help", group: "docs", run: a.report },
    later("help.about", "About Simplicial", "help", "about"),
  ];
}
