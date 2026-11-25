import assert from "node:assert/strict";
import { test } from "node:test";
import { PORT_IN, PORT_OUT, OUTER, portBlocksOf, withoutPortBlocks, withPortBlocks } from "../src/flow/portBlocks.ts";
import type { FlowNode, Wire } from "../src/flow/flowModel.ts";
import type { BlockDef } from "../src/protocol.ts";

const node = (id: string, type: string, y = 0, name = "") => ({ id, type: "block", position: { x: 0, y }, data: { def: { type }, params: { name } } });
const wire = (source: string, sourceHandle: string, target: string, targetHandle: string) => ({ id: `${source}.${sourceHandle}>${target}.${targetHandle}`, source, sourceHandle, target, targetHandle });

test("a run gets the wires through In and Out joined, the port blocks gone", () => {
  // src → [In → gain → Out] → dst, and the In also feeds a second block
  const nodes = [node("src", "sine"), node("in", PORT_IN), node("gain", "gain"), node("b", "gain"), node("out", PORT_OUT), node("dst", "scope")];
  const wires = [wire("src", "y", "in", OUTER), wire("in", "y", "gain", "u"), wire("in", "y", "b", "u"), wire("gain", "y", "out", "u"), wire("out", OUTER, "dst", "u")];
  const run = withoutPortBlocks(nodes, wires);
  assert.deepEqual(run.nodes.map((n) => n.id), ["src", "gain", "b", "dst"]);
  assert.deepEqual(run.wires.map((w) => `${w.source}.${w.sourceHandle}>${w.target}.${w.targetHandle}`), ["src.y>gain.u", "src.y>b.u", "gain.y>dst.u"]);
  // Nothing feeding the In: what it fed is unwired.
  assert.deepEqual(withoutPortBlocks(nodes, wires.slice(1)).wires.map((w) => w.target), ["dst"]);
  // Nested: an In fed by another In.
  const nested = withoutPortBlocks([...nodes, node("in2", PORT_IN)], [wire("src", "y", "in2", OUTER), wire("in2", "y", "in", OUTER), wire("in", "y", "gain", "u")]);
  assert.deepEqual(nested.wires.map((w) => `${w.source}>${w.target}`), ["src>gain"]);
  // Only some (ungroup one subsystem): the rest stay.
  assert.deepEqual(withoutPortBlocks(nodes, wires, new Set(["in"])).nodes.map((n) => n.id), ["src", "gain", "b", "out", "dst"]);
});

test("port blocks name the group's ports in the order they stand", () => {
  const ports = portBlocksOf([node("a", PORT_IN, 50), node("b", PORT_IN, 10, "ref"), node("c", PORT_OUT, 0), node("d", PORT_IN, 90)]);
  assert.deepEqual(ports.map((p) => [p.side, p.handle, p.name]), [
    ["outputs", `c::${OUTER}`, "Out 1"],
    ["inputs", `b::${OUTER}`, "ref"],
    ["inputs", `a::${OUTER}`, "In 2"],
    ["inputs", `d::${OUTER}`, "In 3"],
  ]);
});

test("a subsystem made round wired blocks gets an In or Out where each wire crosses, and runs the same", () => {
  // src feeds a and b inside; a feeds dst outside, twice
  const nodes = [node("src", "sine"), node("dst", "scope"), node("dst2", "scope"), { id: "sub", type: "frame", position: { x: 0, y: 0 }, data: { kind: "subsystem" } }, { ...node("a", "gain", 30), parentId: "sub" }, { ...node("b", "gain", 90), parentId: "sub" }] as unknown as FlowNode[];
  const typed = (w: ReturnType<typeof wire>) => ({ ...w, data: { type: "signal" } }) as Wire;
  const wires = [wire("src", "y", "a", "u"), wire("src", "y", "b", "u"), wire("a", "y", "dst", "u"), wire("a", "y", "dst2", "u")].map(typed);
  const def = (type: string, i: string, o: string) => ({ type, label: type, kind: "function", inputs: [{ id: i, type: "any" }], outputs: [{ id: o, type: "any" }], params: [{ id: "name", type: "text", default: "" }] }) as BlockDef;
  const made = withPortBlocks(nodes, wires, "sub", { in: def(PORT_IN, OUTER, "y"), out: def(PORT_OUT, "u", OUTER) });
  const ports = made.nodes.filter((n) => n.parentId === "sub" && n.id !== "a" && n.id !== "b");
  assert.deepEqual(ports.map((n) => (n.data as { def: { type: string } }).def.type), [PORT_IN, PORT_OUT], "one In for src.y, one Out for a.y");
  const run = withoutPortBlocks(made.nodes, made.wires);
  const ends = (ws: Wire[]) => ws.map((w) => `${w.source}.${w.sourceHandle}>${w.target}.${w.targetHandle}`).sort();
  assert.deepEqual(ends(run.wires), ends(wires), "the run sees the same wires as before grouping");
});
