// The Board's layout (from paperboat-shared test/boardLayout.test.ts): sizes, settings, the automatic order, tabs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { arrange, layoutOf, setSettings } from "../src/board/boardLayout.ts";

test("an instrument's settings live in the layout and survive arrange → layoutOf", () => {
  const monitors = { sc: { kind: "x", size: "large" as const, x: 0, y: 0 }, g: { kind: "y", x: 0, y: 100 } };
  const a = arrange(monitors, undefined, 6);
  assert.equal(a.instruments.find((p) => p.block === "sc")?.size, "large"); // the size its toolkit asked for
  assert.equal(a.instruments.find((p) => p.block === "g")?.size, "normal");
  const saved = setSettings(a, "sc", { mode: "xy", trigger: { source: "a", level: 0.5 } });
  const again = layoutOf(arrange(monitors, saved, 6));
  assert.deepEqual(again.instruments?.find((i) => i.block === "sc")?.settings, { mode: "xy", trigger: { source: "a", level: 0.5 } });
  assert.equal(layoutOf(arrange(monitors, setSettings(arrange(monitors, saved, 6), "sc", {}), 6)).instruments?.find((i) => i.block === "sc")?.settings, undefined);
});

test("a layout saved before settings were generic still opens: its `scope` table is the settings", () => {
  const monitors = { sc: { kind: "x", x: 0, y: 0 } };
  const old = { instruments: [{ block: "sc", scope: { window: 2 } }] } as never;
  assert.deepEqual(layoutOf(arrange(monitors, old, 6)).instruments?.[0].settings, { window: 2 });
});

test("the automatic order follows the `order` each instrument's toolkit gave it", () => {
  const monitors = { plot: { kind: "p", x: 0, y: 0 }, readout: { kind: "r", order: 0, x: 500, y: 0 } };
  assert.deepEqual(arrange(monitors, undefined, 6).instruments.map((p) => p.block), ["readout", "plot"]);
});

test("moving and sizing an instrument: what it lands on makes way, the layout records it", async () => {
  const { moveInstrument, resizeInstrument } = await import("../src/board/boardLayout.ts");
  const monitors = { a: { kind: "g", x: 0, y: 0 }, b: { kind: "g", x: 100, y: 0 } };
  const a = arrange(monitors, undefined, 6);
  assert.deepEqual(a.instruments.map((p) => [p.block, p.col, p.row]), [["a", 0, 0], ["b", 2, 0]]);
  const moved = arrange(monitors, moveInstrument(a, "b", 0, 0), 6); // b takes a's cell; a moves on
  assert.deepEqual(moved.instruments.map((p) => [p.block, p.col, p.row]), [["b", 0, 0], ["a", 2, 0]]);
  const big = arrange(monitors, resizeInstrument(a, "a", "large"), 6);
  assert.deepEqual(big.instruments.find((p) => p.block === "a"), { block: "a", size: "large", col: 0, row: 0, w: 2, h: 2, tab: "" });
});

test("tabs: the first makes two (what is there stays on Main), an empty one goes, the last one leaves one page", async () => {
  const { addTab, moveToTab, removeTab, renameTab, tabIsEmpty } = await import("../src/board/boardLayout.ts");
  const monitors = { a: { kind: "g", x: 0, y: 0 } };
  const two = arrange(monitors, addTab(arrange(monitors, undefined, 6), "Tuning"), 6);
  assert.deepEqual(two.tabs, ["Main", "Tuning"]);
  assert.equal(two.instruments[0].tab, "Main");
  const moved = arrange(monitors, moveToTab(two, "a", "Tuning"), 6);
  assert.equal(moved.instruments[0].tab, "Tuning");
  assert.equal(tabIsEmpty(moved, "Main"), true);
  const renamed = arrange(monitors, renameTab(moved, "Tuning", "Run"), 6);
  assert.deepEqual([renamed.tabs, renamed.instruments[0].tab], [["Main", "Run"], "Run"]);
  const one = arrange(monitors, removeTab(renamed, "Main"), 6);
  assert.deepEqual([one.tabs, one.instruments[0].tab], [[], ""]);
  assert.equal(removeTab(renamed, "Run").tabs?.length, 2, "a tab with something on it stays");
});

test("decorations: a label takes cells, a rule none; on a narrower Board the rules hide and the rest flows", async () => {
  const { addDecoration, removeDecoration, rowsOf } = await import("../src/board/boardLayout.ts");
  const monitors = { a: { kind: "g", x: 0, y: 0 } };
  const a = arrange(monitors, undefined, 6);
  const labelled = arrange(monitors, addDecoration(arrange(monitors, addDecoration(a, "label", ""), 6), "hline", ""), 6);
  assert.deepEqual(labelled.decorations.map((d) => [d.kind, d.col, d.row, d.w, d.h]), [["label", 0, 1, 2, 1], ["hline", 0, 2, 6, 1]]);
  assert.equal(rowsOf(labelled, ""), 3);
  const narrow = arrange(monitors, { columns: 6, instruments: [{ block: "a", at: [4, 0] }], decorations: [{ kind: "label", text: "x", at: [0, 0] }, { kind: "hline", at: [0, 1], span: 6 }] }, 3);
  assert.equal(narrow.narrowed, true);
  assert.deepEqual(narrow.decorations.map((d) => d.hidden), [false, true]);
  assert.deepEqual(narrow.instruments.map((p) => [p.col, p.row]), [[0, 1]], "the instrument follows the label in reading order, under it when it can't fit beside");
  assert.equal(arrange(monitors, removeDecoration(labelled, 0), 6).decorations[0].kind, "hline");
});
