import assert from "node:assert/strict";
import { test } from "node:test";
import type { Graph } from "../src/protocol.ts";
import { addRecent, buildProject, parseFlow, PROJECT_VERSION, RECENT_MAX, type Stored } from "../src/project.ts";

const flow: Graph = {
  nodes: [
    { id: "gain-1", type: "gain", params: { k: 2 }, pos: [10, 20] },
    { id: "sum-1", type: "sum", pos: [200, 20] },
  ],
  edges: [{ from: ["gain-1", "y"], to: ["sum-1", "a"] }],
};

const stringify = (p: unknown) => JSON.stringify(p, null, 2);
const ok = (text: string) => parseFlow(text);
const bad = (data: unknown) => {
  try {
    parseFlow(typeof data === "string" ? data : JSON.stringify(data));
  } catch (e) {
    return (e as Error).message;
  }
  assert.fail("expected an error");
};

test("a flow file is built from its parts and leaves out what is empty", () => {
  const p = buildProject({ station: "cart-pole", flow, station_objects: null, variables: [], run: {} });
  assert.deepEqual(Object.keys(p), ["paperboat", "station", "flow"]);
  assert.equal(p.paperboat, PROJECT_VERSION);
  const full = buildProject({
    station: "cart-pole",
    flow,
    station_objects: { objects: [{ id: "cart-1", type: "cartpole" }] },
    variables: [{ name: "L", type: "number", value: 1 }],
    board: { instruments: [] } as never,
    run: { duration: 5 },
  });
  assert.deepEqual(Object.keys(full), ["paperboat", "station", "flow", "station_objects", "variables", "board", "run"]);
});

test("what is written is read back unchanged", () => {
  const p = buildProject({ station: "b", flow, variables: [{ name: "x", type: "boolean", value: true }], run: { speed: 2 } });
  assert.deepEqual(ok(stringify(p)), p);
});

test("the run's solver and its options round-trip (#196)", () => {
  const run = { solver: "rk45" as const, solver_options: { rtol: 1e-8, max_step: 0.001 } };
  const p = buildProject({ station: "b", flow, variables: [], run });
  assert.deepEqual(ok(stringify(p)).run, run);
  assert.match(bad({ paperboat: PROJECT_VERSION, station: "b", flow, run: { solver_options: { rtol: "tight" } } }), /run\.solver_options\.rtol/);
});

test("flow node rotation and mirror are validated and preserved", () => {
  const rotatedFlow = {
    nodes: [{ id: "n1", type: "t", rotation: 90 as const, mirror: true, params: {} }],
    edges: [],
  };
  const p = buildProject({ station: "b", flow: rotatedFlow });
  const read = ok(stringify(p));
  assert.equal(read.flow.nodes[0].rotation, 90);
  assert.equal(read.flow.nodes[0].mirror, true);

  const base = { paperboat: 0, station: "b" };
  assert.match(bad({ ...base, flow: { nodes: [{ id: "a", type: "t", rotation: 45 }], edges: [] } }), /rotation must be 0, 90, 180, or 270/);
  assert.match(bad({ ...base, flow: { nodes: [{ id: "a", type: "t", mirror: "yes" }], edges: [] } }), /mirror must be a boolean/);
});

test("the sheet's flow type (#9) is kept, and checked", () => {
  const read = ok(stringify(buildProject({ station: "b", flow: { ...flow, flow: "step" } })));
  assert.equal(read.flow.flow, "step");
  assert.equal(ok(stringify(buildProject({ station: "b", flow }))).flow.flow, undefined); // not chosen
  assert.match(bad({ paperboat: 0, station: "b", flow: { ...flow, flow: "liquid" } }), /flow\.flow must be one of signal, step, state, model/);
});

test("a file that is not JSON, or not a project, says so", () => {
  assert.match(bad("{nope"), /not JSON/);
  assert.match(bad([1, 2]), /no "paperboat" version/);
  assert.match(bad({ flow }), /no "paperboat" version/);
});

test("a newer format is refused and says which", () => {
  const e = bad({ paperboat: PROJECT_VERSION + 1, station: "b", flow });
  assert.match(e, /flow format 1/);
  assert.match(e, /newer Simplicial/);
  assert.match(bad({ paperboat: "0", station: "b", flow }), /whole number/);
  assert.match(bad({ paperboat: -1, station: "b", flow }), /whole number/);
});

test("the station and the flow are required", () => {
  assert.match(bad({ paperboat: 0, flow }), /which station/);
  assert.match(bad({ paperboat: 0, station: "b" }), /flow must be an object/);
  assert.match(bad({ paperboat: 0, station: "b", flow: { nodes: [] } }), /flow\.edges/);
});

test("damage is named by where it is", () => {
  const base = { paperboat: 0, station: "b" };
  assert.match(bad({ ...base, flow: { nodes: [{ id: "a" }], edges: [] } }), /flow\.nodes\[0\] needs an id and a type/);
  assert.match(bad({ ...base, flow: { nodes: [], edges: [{ from: ["a"], to: ["b", "c"] }] } }), /flow\.edges\[0\]/);
  assert.match(bad({ ...base, flow: { nodes: [{ id: "a", type: "t", pos: [1] }], edges: [] } }), /pos must be two numbers/);
  assert.match(bad({ ...base, flow: { nodes: [], edges: [], groups: [{ id: "g", kind: "weird", nodes: [] }] } }), /flow\.groups\[0\]/);
  assert.match(bad({ ...base, flow, station_objects: { objects: [{ id: "x" }] } }), /station_objects\.objects\[0\]/);
  assert.match(bad({ ...base, flow, variables: [{ name: "x", type: "color" }] }), /variables\[0\]/);
  assert.match(bad({ ...base, flow, board: {} }), /board\.instruments/);
  assert.match(bad({ ...base, flow, run: { duration: "long" } }), /run\.duration/);
  assert.match(bad({ ...base, flow, run: { duration: "long" } }), /^it is damaged: /);
});

test("recent projects: newest first, one per file, at most five", () => {
  const entry = (name: string, at: number): Stored => ({ name, savedAt: at, project: buildProject({ station: "b", flow }) });
  let list: Stored[] = [];
  for (let i = 0; i < 7; i++) list = addRecent(list, entry(`p${i}`, i));
  assert.equal(list.length, RECENT_MAX);
  assert.deepEqual(list.map((s) => s.name), ["p6", "p5", "p4", "p3", "p2"]);
  const again = addRecent(list, entry("p4", 99));
  assert.deepEqual(again.map((s) => s.name), ["p4", "p6", "p5", "p3", "p2"]);
  assert.equal(again[0].savedAt, 99, "the newer copy replaces the older");
  const inHub = addRecent(again, { ...entry("p4", 100), hub: "lab" });
  assert.deepEqual(inHub.slice(0, 2).map((s) => [s.hub, s.name]), [["lab", "p4"], [undefined, "p4"]], "the same path in a hub is another file");
});

test("recent projects: a huge project doesn't push out the one just saved", () => {
  const big = (name: string): Stored => ({
    name,
    savedAt: 1,
    project: buildProject({ station: "b", flow: { nodes: [{ id: "a", type: "t", params: { text: "x".repeat(1_400_000) } }], edges: [] } }),
  });
  const list = addRecent(addRecent([], big("one")), big("two"));
  assert.deepEqual(list.map((s) => s.name), ["two"], "the older one makes way: the list stays under the cap");
});
