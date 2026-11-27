// The one registry: the menu bar, Ctrl K and the shortcuts read it, so what can't run says why everywhere.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileMenu } from "@paperboatlab/ui/workspace";
import { fileItems, MENUS, registry, type Do, type View } from "../src/menus.ts";

const view: View = { mode: "navigator", page: "flow", station: true, hidden: () => false, console: false, theme: "system", running: false, whyNot: "",
  flow: { lock: "", undo: true, redo: false, copy: true, paste: false, arrange: true, picked: false }, board: false };
const calls: string[] = [];
const act = new Proxy({} as Do, { get: (_, k) => (...a: unknown[]) => calls.push(`${String(k)}(${a.join(",")})`) });
const find = (cs: ReturnType<typeof registry>, id: string) => cs.find((c) => c.id === id)!;
const on = (c: { enabled?: boolean | (() => boolean) }) => (typeof c.enabled === "function" ? c.enabled() : c.enabled ?? true);

test("every command sits in a menu of the bar, but the keys-only ones; ids and chords are unique", () => {
  const cs = registry(view, act);
  const menus = new Set(MENUS.map((m) => m.id));
  assert.deepEqual(cs.filter((c) => !menus.has(c.menu)).map((c) => c.id), ["view.next"]);
  assert.equal(new Set(cs.map((c) => c.id)).size, cs.length);
  const chords = cs.filter((c) => c.chord).map((c) => JSON.stringify(c.chord));
  assert.equal(new Set(chords).size, chords.length);
  assert.ok(cs.filter((c) => !on(c)).every((c) => c.why), "what can't run says why");
});

test("Run says why it can't; Cancel only while running", () => {
  const off = registry({ ...view, whyNot: "Not connected to a station" }, act);
  assert.equal(on(find(off, "run.run")), false);
  assert.equal(find(off, "run.run").why, "Not connected to a station");
  assert.equal(on(find(off, "run.cancel")), false);
  assert.equal(on(find(registry({ ...view, running: true, whyNot: "A run is in progress" }, act), "run.cancel")), true);
});

test("no station: its page stays, greyed with why, and Lookout has no Station drawer", () => {
  const cs = registry({ ...view, station: false, mode: "lookout" }, act);
  assert.equal(on(find(cs, "view.station")), false);
  assert.match(find(cs, "view.station").why!, /no Station/);
  assert.equal(cs.some((c) => c.id === "view.st"), false);
  assert.ok(find(cs, "view.fl"));
});

test("the drawers follow the mode; Alt M steps through the modes", () => {
  assert.ok(find(registry({ ...view, mode: "commander" }, act), "view.bd").chord);
  assert.equal(registry(view, act).some((c) => c.id === "view.bd"), false);
  calls.length = 0;
  find(registry({ ...view, mode: "lookout" }, act), "view.next").run();
  assert.deepEqual(calls, ["setMode(navigator)"]);
});

test("the Flow's edits: in the Edit menu with the canvas's keys (no chord: a field keeps its own), greyed with why during a run", () => {
  const cs = registry(view, act);
  assert.equal(find(cs, "edit.undo").shortcut, "Ctrl Z");
  assert.equal(find(cs, "edit.undo").chord, undefined);
  assert.equal(on(find(cs, "edit.redo")), false);
  assert.equal(find(cs, "edit.paste").why, "Nothing copied yet");
  const run = registry({ ...view, flow: { ...view.flow, lock: "A run is in progress" } }, act);
  for (const id of ["edit.undo", "edit.cut", "edit.paste", "view.arrange"]) assert.equal(find(run, id).why, "A run is in progress");
  assert.equal(on(find(run, "edit.copy")), true, "copying changes nothing");
  calls.length = 0;
  find(cs, "view.arrange").run();
  assert.deepEqual(calls, ["arrange()"]);
});

test("a run length: seconds, or ∞ / inf for a run until cancelled", async () => {
  const { parseLength } = await import("../src/runLength.ts");
  assert.equal(parseLength("∞"), 0);
  assert.equal(parseLength(" Inf "), 0);
  assert.equal(parseLength("infinity"), 0);
  assert.equal(parseLength("0"), 0);
  assert.equal(parseLength("12.5"), 12.5);
  assert.equal(parseLength("-1"), undefined);
  assert.equal(parseLength(""), undefined);
  assert.equal(parseLength("abc"), undefined);
});

test("File is the kit's menu: nothing opens or closes while a run is in progress; Settings… opens", () => {
  const no = () => {};
  const kit = fileMenu({ noun: "flow", workspace: null, file: true, hubs: false, recent: [], onNew: no, onOpenFile: no, onOpenFolder: no,
    onSave: no, onSaveAs: no, onCloseFile: no, onCloseWorkspace: no, onSettings: no });
  const idle = fileItems(kit, false);
  assert.deepEqual(idle.map((c) => c.label), ["New flow", "Open file…", "Open folder…", "Open recent", "Save", "Save as…", "Close file", "Close folder", "Settings…"]);
  assert.ok(on(find(idle, "file.open")) && on(find(idle, "file.save")));
  assert.equal(on(find(idle, "file.settings")), true);
  assert.equal(find(idle, "file.openFolder").shortcut, "Ctrl Shift O");
  const running = fileItems(kit, true);
  for (const id of ["file.new", "file.open", "file.openFolder", "file.close"]) assert.equal(on(find(running, id)), false, id);
  assert.equal(find(running, "file.open").why, "A run is in progress");
  assert.equal(on(find(running, "file.save")), true);
  // an example's window (paperboat#75): nothing saves, and the menu says why; the rest stays
  const example = fileItems(kit, false, "An example is read-only: copy it to change it");
  for (const id of ["file.save", "file.saveAs"]) {
    assert.equal(on(find(example, id)), false, id);
    assert.equal(find(example, id).why, "An example is read-only: copy it to change it");
  }
  assert.ok(on(find(example, "file.open")) && on(find(example, "file.new")));
  assert.equal(find(fileItems(kit, true, "read-only"), "file.save").why, "read-only");
  const chords = [...idle, ...registry(view, act)].filter((c) => c.chord).map((c) => JSON.stringify(c.chord));
  assert.equal(new Set(chords).size, chords.length, "no two commands share a key");
});

test("Help › Keyboard shortcuts is Ctrl /, unless something picked on the Flow takes it (Comment out)", () => {
  const keys = find(registry(view, act), "help.keys");
  assert.equal(keys.menu, "help");
  assert.deepEqual(keys.chord, { key: "/", ctrl: true });
  keys.run();
  assert.equal(calls.at(-1), "shortcuts()");
  const picked = find(registry({ ...view, flow: { ...view.flow, picked: true } }, act), "help.keys");
  assert.equal(picked.chord, undefined);
  assert.equal(picked.shortcut, "Ctrl /");
});

test("Choose a station… is in Run", () => {
  assert.equal(find(registry(view, act), "run.station").menu, "run");
});

