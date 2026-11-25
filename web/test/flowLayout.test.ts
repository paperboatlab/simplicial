import assert from "node:assert/strict";
import { test } from "node:test";
import { arrangeFlowNodes, canArrangeFlow, clearWireBends, makeRoom } from "../src/flow/flowLayout.ts";
import { routeWires, scoreWireRoutes, type Obstacle, type RouteInput } from "@paperboatlab/ui/canvas";
import type { FlowNode, Wire } from "../src/flow/flowModel.ts";
import type { GroupNode } from "../src/flow/groups.ts";

function block(id: string, parentId?: string, at = { x: 900, y: 900 }, size = { width: 120, height: 80 }): FlowNode {
  return {
    id,
    type: "block",
    ...(parentId ? { parentId } : {}),
    position: at,
    measured: size,
    data: { def: { type: "gain", label: id, kind: "function", inputs: [{ id: "in", type: "signal" }], outputs: [{ id: "out", type: "signal" }], params: [] }, params: { k: 2 } },
  } as FlowNode;
}

function group(id: string, kind: GroupNode["data"]["kind"], parentId?: string, collapsed = false): GroupNode {
  return {
    id,
    type: "frame",
    ...(parentId ? { parentId } : {}),
    position: { x: 800, y: 700 },
    data: { kind, label: `Label ${id}`, collapsed, seconds: kind === "story" ? 2 : 0, reset: true, size: { w: 210, h: 140 } },
  } as GroupNode;
}

const wire = (source: string, target: string): Wire => ({ id: `${source}-${target}`, source, target, sourceHandle: "out", targetHandle: "in", type: "wire", data: { type: "signal" } });
const byId = (nodes: FlowNode[]) => new Map(nodes.map((n) => [n.id, n]));

function positions(nodes: FlowNode[]) {
  return Object.fromEntries(nodes.map((n) => [n.id, { ...n.position }]));
}

test("a chain reads left to right without changing its wires or block data", () => {
  const nodes = [block("sink"), block("source"), block("middle")];
  const edges = [wire("middle", "sink"), wire("source", "middle")];
  const before = structuredClone({ nodes, edges });
  const next = arrangeFlowNodes(nodes, edges);
  const at = byId(next);
  assert.ok(at.get("source")!.position.x < at.get("middle")!.position.x);
  assert.ok(at.get("middle")!.position.x < at.get("sink")!.position.x);
  assert.deepEqual(edges, before.edges);
  for (const n of next) if (n.type === "block") assert.deepEqual(n.data, before.nodes.find((old) => old.id === n.id)!.data);
  assert.deepEqual(nodes, before.nodes, "the input was not mutated");
});

test("open frames are laid out inside, refitted, then placed as one parent-level unit", () => {
  const frame = group("frame", "visual");
  const nodes = [frame, block("a", "frame"), block("b", "frame"), block("outside")];
  const next = arrangeFlowNodes(nodes, [wire("a", "b"), wire("b", "outside")]);
  const at = byId(next);
  const a = at.get("a")!;
  const b = at.get("b")!;
  const f = at.get("frame")! as GroupNode;
  const outside = at.get("outside")!;
  assert.ok(a.position.x < b.position.x, "frame contents follow their wire");
  assert.ok(a.position.x >= 24 && a.position.y >= 58, "contents clear the frame padding and head");
  assert.ok(f.data.size.w >= b.position.x + (b.measured?.width ?? 0) + 24);
  assert.ok(f.data.size.h >= b.position.y + (b.measured?.height ?? 0) + 24);
  assert.ok(outside.position.x >= f.position.x + f.data.size.w, "the frame and the next block do not overlap");
  assert.equal(f.data.label, "Label frame");
  assert.equal(f.parentId, undefined);
  assert.deepEqual(at.get("a")!.parentId, "frame");
  assert.deepEqual([...at.keys()].sort(), ["a", "b", "frame", "outside"], "no layout-only boundaries were saved");
});

test("subsystems are arranged recursively and arranging a level leaves everything outside it alone", () => {
  const nodes = [
    block("before"),
    group("one", "subsystem"),
    block("a", "one"),
    block("b", "one"),
    group("two", "story"),
    block("x", "two"),
    block("y", "two"),
    block("after"),
  ];
  const edges = [wire("before", "a"), wire("a", "b"), wire("b", "after"), wire("x", "y")];
  const next = arrangeFlowNodes(nodes, edges, "one");
  const at = byId(next);
  const old = byId(nodes);
  for (const id of ["before", "one", "two", "x", "y", "after"]) assert.equal(at.get(id), old.get(id), `${id} is outside the open level`);
  assert.notEqual(at.get("a"), old.get("a"));
  assert.ok(at.get("a")!.position.x < at.get("b")!.position.x);
  assert.equal((at.get("one") as GroupNode).data.seconds, 0);
  assert.equal((at.get("two") as GroupNode).data.seconds, 2);
  assert.equal(canArrangeFlow(nodes, "one"), true);
  assert.equal(canArrangeFlow(nodes, null), true);
});

test("a whole-canvas pass includes closed groups and a second pass is a no-op", () => {
  const nodes = [group("story", "story", undefined, true), block("a", "story"), block("b", "story"), block("sink")];
  const edges = [wire("a", "b"), wire("b", "sink")];
  const once = arrangeFlowNodes(nodes, edges);
  const at = byId(once);
  assert.ok(at.get("a")!.position.x < at.get("b")!.position.x, "the hidden story contents were arranged too");
  assert.equal((at.get("story") as GroupNode).data.reset, true);
  const twice = arrangeFlowNodes(once, edges);
  assert.equal(twice, once, "an idempotent layout returns the original array");
});

test("layout does not depend on input ordering and only positions and frame sizes differ", () => {
  const nodes = [group("f", "visual"), block("a", "f"), block("b", "f"), block("c")];
  const edges = [wire("a", "b"), wire("b", "c")];
  const forward = arrangeFlowNodes(nodes, edges);
  const reversed = arrangeFlowNodes([...nodes].reverse(), [...edges].reverse());
  assert.deepEqual(positions(forward), positions([...reversed].reverse()));
  const a = byId(forward);
  const b = byId(reversed);
  for (const [id, n] of a) {
    assert.deepEqual(n.position, b.get(id)!.position);
    assert.equal(n.parentId, b.get(id)!.parentId);
    if (n.type === "block") assert.deepEqual(n.data, b.get(id)!.data);
    else {
      assert.equal(n.data.label, (b.get(id)!.data as GroupNode["data"]).label);
      assert.deepEqual(n.data.size, (b.get(id)!.data as GroupNode["data"]).size);
    }
  }
});

test("empty levels are no-ops", () => {
  const nodes = [group("empty", "subsystem")];
  assert.equal(canArrangeFlow(nodes, "empty"), false);
  assert.equal(arrangeFlowNodes(nodes, [], "empty"), nodes);
});

test("arranging drops the bends dragged for the blocks' old places", () => {
  const bent: Wire = { ...wire("a", "b"), data: { type: "signal", points: [[10, 10], [20, 20]] } };
  const edges = [wire("b", "c"), bent];
  const next = clearWireBends(edges);
  assert.notEqual(next, edges, "a changed list is a new array");
  assert.deepEqual(next[1].data, { type: "signal" }, "the wire routes itself again");
  assert.deepEqual(edges[1].data?.points, [[10, 10], [20, 20]], "the input was not mutated");
  const plain = [wire("a", "b")];
  assert.equal(clearWireBends(plain), plain, "nothing to drop returns the same list");
});

test("makeRoom: a block unfolded in place pushes what it grew over, keeps the rest", () => {
  const nodes = [
    block("self", undefined, { x: 100, y: 100 }, { width: 64, height: 56 }),
    block("right", undefined, { x: 200, y: 100 }), // in its rows: moves right
    block("far", undefined, { x: 400, y: 120 }), // also in its rows: moves with it
    block("below", undefined, { x: 120, y: 200 }), // in its columns: moves down
    block("above", undefined, { x: 100, y: 20 }), // in its columns, above: moves up
    block("away", undefined, { x: 600, y: 600 }), // nowhere near: stays
  ];
  const out = makeRoom(nodes, "self", { x: 100, y: 100, w: 64, h: 56 }, { x: 100, y: 72, w: 176, h: 140 });
  const at = (id: string) => out.find((n) => n.id === id)!.position;
  assert.deepEqual(at("right"), { x: 312, y: 100 });
  assert.deepEqual(at("far"), { x: 512, y: 120 });
  assert.deepEqual(at("below"), { x: 120, y: 256 });
  assert.deepEqual(at("above"), { x: 100, y: -8 });
  assert.deepEqual(at("away"), { x: 600, y: 600 });
  assert.equal(makeRoom(nodes, "self", { x: 0, y: 0, w: 9, h: 9 }, { x: 0, y: 0, w: 9, h: 9 }), nodes);
});

test("arrange keeps bypass wires out from under intermediate blocks and is idempotent", () => {
  // Five-block chain with bypass wires (like Harmonics -> Radial -> Erosion -> Vegetation -> Island):
  // the bypass wires must not pass under intermediate blocks when arranged + routed.
  const nodes = [block("a"), block("b"), block("c"), block("d"), block("e")];
  const edges = [
    wire("a", "b"),
    wire("b", "c"),
    wire("c", "d"),
    wire("d", "e"),
    { ...wire("a", "c"), id: "a-c" },
    { ...wire("b", "d"), id: "b-d" },
    { ...wire("c", "e"), id: "c-e" },
  ];
  const arranged = arrangeFlowNodes(nodes, edges);
  assert.equal(arrangeFlowNodes(arranged, edges), arranged, "Arrange stays idempotent");

  const obstacles: Obstacle[] = arranged.map((n) => ({
    id: n.id,
    x: n.position.x,
    y: n.position.y,
    width: n.measured?.width ?? 120,
    height: n.measured?.height ?? 80,
  }));
  const inputs: RouteInput[] = edges.map((e) => {
    const s = arranged.find((n) => n.id === e.source)!;
    const t = arranged.find((n) => n.id === e.target)!;
    return {
      id: e.id,
      source: e.source,
      sourceHandle: e.sourceHandle,
      target: e.target,
      targetHandle: e.targetHandle,
      sx: s.position.x + (s.measured?.width ?? 120),
      sy: s.position.y + 40,
      tx: t.position.x,
      ty: t.position.y + 40,
      sourcePosition: "right",
      targetPosition: "left",
    };
  });
  const routes = routeWires(inputs, obstacles);
  const score = scoreWireRoutes(routes.values(), inputs, obstacles);
  assert.equal(score.insideBlocks, 0, "no wire segment runs under a block");
  assert.equal(score.collinearOverlaps, 0, "parallel bypass wires do not share collinear segments");
});
