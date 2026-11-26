import assert from "node:assert/strict";
import { test } from "node:test";
import { findBlocks, groupsOf, kindWord } from "../src/flow/librarySearch.ts";
import type { BlockDef } from "../src/protocol.ts";

const def = (type: string, label: string, group: string, more: Partial<BlockDef> = {}): BlockDef =>
  ({ type, label, group, kind: "function", inputs: [{ id: "u" }], outputs: [{ id: "y" }], params: [], ...more }) as BlockDef;
const gain = def("gain", "Gain", "math", { description: "Multiplies by k" });
const rad = def("rad_to_deg", "Rad to Deg", "math");
const sine = def("sine", "Sine wave", "signal", { description: "A sine of the run's time" });
const start = def("start", "Start", "step", { inputs: [], outputs: [{ id: "next", type: "step" } as never] });
const qp = def("qp", "QP", "optimization");

test("the built-in packages come in their order, other groups after by name", () => {
  assert.deepEqual(groupsOf([qp, start, sine, gain]), ["signal", "math", "step", "optimization"]);
});

test("names first, then a word of the name, then descriptions and ports", () => {
  const all = [sine, gain, rad, start];
  assert.deepEqual(findBlocks(all, "g").map((b) => b.type), ["gain", "rad_to_deg", "sine"]);  // the name, inside a name, the group
  assert.deepEqual(findBlocks(all, "deg").map((b) => b.type), ["rad_to_deg"]);
  assert.deepEqual(findBlocks(all, "sine").map((b) => b.type), ["sine"]);
  assert.deepEqual(findBlocks(all, "time").map((b) => b.type), ["sine"]);
  assert.deepEqual(findBlocks(all, "next").map((b) => b.type), ["start"]);
  assert.equal(findBlocks(all, "  ").length, 4);
  assert.deepEqual(findBlocks(all, "zzz"), []);
});

test("a block with step ports is a step block", () => {
  assert.equal(kindWord(start), "step");
  assert.equal(kindWord(gain), "function");
});
