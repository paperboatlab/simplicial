// The Board's side of the Flow: one instrument per monitor block, what feeds it, and what + tap offers.
import assert from "node:assert/strict";
import { test } from "node:test";
import { monitorsOf, tapsOf } from "../src/board/boardWiring.ts";
import { registerInstrument } from "../src/board/host.ts";
import { makeNode, makeWire } from "../src/flow/flowModel.ts";
import type { BlockDef } from "../src/protocol.ts";

const plant: BlockDef = { type: "plant", label: "Plant", kind: "source", inputs: [], params: [],
  outputs: [{ id: "theta", type: "signal", unit: "rad" }, { id: "go", type: "step" }] };
const display: BlockDef = { type: "display", label: "Display", kind: "monitor", instrument: "display", inputs: [{ id: "in", type: "signal" }], outputs: [], params: [] };
const graph: BlockDef = { ...display, type: "graph", instrument: undefined };

test("every monitor block is an instrument, with its kind, its toolkit's size and what is wired in", () => {
  registerInstrument("display", () => null, { size: "compact", order: 0 });
  const nodes = [makeNode(plant, "cart", 0, 0), makeNode(display, "theta", 300, 0), makeNode(graph, "plot", 300, 200)];
  const edges = [makeWire({ source: "cart", sourceHandle: "theta", target: "theta", targetHandle: "in" }, "signal")];
  const m = monitorsOf(nodes, edges);
  assert.deepEqual(Object.keys(m), ["theta", "plot"]);
  assert.deepEqual(m.theta, { kind: "display", params: {}, size: "compact", order: 0, x: 300, y: 0, inputs: ["in"], sources: { in: { label: "cart.theta", unit: "rad" } } });
  assert.equal(m.plot.kind, "graph", "a monitor that names no instrument is a graph");
  assert.deepEqual(tapsOf(nodes).map((t) => t.label), ["cart.theta"], "a tap offers outputs that carry numbers, not step ports");
});
