import assert from "node:assert/strict";
import { test } from "node:test";
import type { Graph, ObjectDef, Overrides, StationFlow0 } from "../src/protocol.ts";
import {
  applyOverrides, besidePath, buildProject, diff, mergeOverrides, parseFlow, PROJECT_VERSION, relPath, upgrade, type Now, type Starter,
} from "../src/project.ts";

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
  const p = buildProject({ station: { name: "cart-pole" }, flow, overrides: {}, variables: [], run: {} });
  assert.deepEqual(Object.keys(p), ["paperboat", "station", "flow"]);
  assert.equal(p.paperboat, PROJECT_VERSION);
  const full = buildProject({
    station: { name: "cart-pole", version: "0.2.0", path: "../cart-pole.pst" },
    flow,
    overrides: { variables: { L: 2 } },
    variables: [{ name: "gain", type: "number", value: 1 }],
    board: { instruments: [] } as never,
    run: { duration: 5 },
  });
  assert.deepEqual(Object.keys(full), ["paperboat", "station", "overrides", "variables", "flow", "board", "run"]);
});

test("what is written is read back unchanged", () => {
  const p = buildProject({ station: { name: "b" }, flow, variables: [{ name: "x", type: "boolean", value: true }], run: { speed: 2 } });
  assert.deepEqual(ok(stringify(p)), p);
});

test("the run's solver and its options round-trip (#196)", () => {
  const run = { solver: "rk45" as const, solver_options: { rtol: 1e-8, max_step: 0.001 } };
  const p = buildProject({ station: { name: "b" }, flow, variables: [], run });
  assert.deepEqual(ok(stringify(p)).run, run);
  assert.match(bad({ paperboat: PROJECT_VERSION, station: { name: "b" }, flow, run: { solver_options: { rtol: "tight" } } }), /run\.solver_options\.rtol/);
});

test("flow node rotation and mirror are validated and preserved", () => {
  const rotatedFlow = {
    nodes: [{ id: "n1", type: "t", rotation: 90 as const, mirror: true, params: {} }],
    edges: [],
  };
  const p = buildProject({ station: { name: "b" }, flow: rotatedFlow });
  const read = ok(stringify(p));
  assert.equal(read.flow.nodes[0].rotation, 90);
  assert.equal(read.flow.nodes[0].mirror, true);

  const base = { paperboat: 0, station: "b" };
  assert.match(bad({ ...base, flow: { nodes: [{ id: "a", type: "t", rotation: 45 }], edges: [] } }), /rotation must be 0, 90, 180, or 270/);
  assert.match(bad({ ...base, flow: { nodes: [{ id: "a", type: "t", mirror: "yes" }], edges: [] } }), /mirror must be a boolean/);
});

test("the sheet's flow type (#9) is kept, and checked", () => {
  const read = ok(stringify(buildProject({ station: { name: "b" }, flow: { ...flow, flow: "step" } })));
  assert.equal(read.flow.flow, "step");
  assert.equal(ok(stringify(buildProject({ station: { name: "b" }, flow }))).flow.flow, undefined); // not chosen
  assert.match(bad({ paperboat: 0, station: "b", flow: { ...flow, flow: "liquid" } }), /flow\.flow must be one of signal, step, state, model/);
});

test("a file that is not JSON, or not a project, says so", () => {
  assert.match(bad("{nope"), /not JSON/);
  assert.match(bad([1, 2]), /no "paperboat" version/);
  assert.match(bad({ flow }), /no "paperboat" version/);
});

test("a newer format is refused and says which", () => {
  const e = bad({ paperboat: PROJECT_VERSION + 1, station: "b", flow });
  assert.match(e, /flow format 2/);
  assert.match(e, /newer Simplicial/);
  assert.match(bad({ paperboat: "0", station: "b", flow }), /whole number/);
  assert.match(bad({ paperboat: -1, station: "b", flow }), /whole number/);
});

test("the station and the flow are required", () => {
  assert.match(bad({ paperboat: 0, flow }), /which station/);
  assert.match(bad({ paperboat: 0, station: "b" }), /flow must be an object/);
  assert.match(bad({ paperboat: 0, station: "b", flow: { nodes: [] } }), /flow\.edges/);
  assert.match(bad({ paperboat: 1, station: "b", flow }), /which station/);  // format 1 names it in an object
  assert.match(bad({ paperboat: 1, station: { name: "b", path: 3 }, flow }), /station\.path/);
  assert.match(bad({ paperboat: 1, station: { name: "b" }, flow, overrides: { added: [{ id: "x" }] } }), /overrides\.added\[0\]/);
  assert.equal(ok(stringify({ paperboat: 0, station: "b", flow })).paperboat, 0, "format 0 still reads");
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

// ---- format 1: the diff from the station's starter, and applying it back ----

const DEFS: ObjectDef[] = [
  { type: "cart", label: "Cart", role: "body", props: [{ id: "mass", type: "number", default: 1 } as never, { id: "x0", type: "number", default: 0 } as never], links: [] },
  { type: "spring", label: "Spring", role: "joint", props: [{ id: "k", type: "number", default: 10 } as never], links: ["a", "b"] },
];
const starter: Starter = {
  station: { objects: [
    { id: "cart-1", type: "cart", props: { mass: 1 } },
    { id: "cart-2", type: "cart", props: { mass: 1 } },
    { id: "spring-1", type: "spring", links: { a: "cart-1", b: "cart-2" } },
  ] },
  variables: [
    { name: "cylinders", type: "number", value: 4, whole: true },
    { name: "kd", type: "number", expr: "kp / 2" },
  ],
};

test("a flow keeps only what it changed of the station", () => {
  const now: Now = {
    station: { objects: [
      { id: "cart-1", type: "cart", props: { mass: 2.5 }, pos: [10, 20] as [number, number] },
      { id: "spring-1", type: "spring", links: { a: "cart-1" } },
      { id: "probe-1", type: "cart", props: { x0: 1 } },
    ] },
    variables: [
      { name: "cylinders", type: "number" as const, value: 6, whole: true },
      { name: "kd", type: "number" as const, expr: "kp / 3" },
      { name: "gain", type: "number" as const, value: 40 },
    ],
  };
  const { overrides, own } = diff(starter, now);
  assert.deepEqual(overrides, {
    variables: { cylinders: 6, kd: { expr: "kp / 3" } },
    objects: { "cart-1": { props: { mass: 2.5 }, pos: [10, 20] }, "spring-1": { links: { b: null } } },
    added: [{ id: "probe-1", type: "cart", props: { x0: 1 } }],
    removed: ["cart-2"],
  });
  assert.deepEqual(own, [{ name: "gain", type: "number", value: 40 }]);
  // applied to the starter, it gives back what the user had
  const back = applyOverrides(starter, overrides, DEFS, "rig 0.2.0");
  assert.deepEqual(back.misfits, []);
  assert.deepEqual(back.station, now.station);
  assert.deepEqual([...back.variables, ...own], now.variables);
  assert.deepEqual(diff(starter, starter), { overrides: {}, own: [] }, "unchanged: nothing");
});

test("a formula changed to a value is the fields that changed", () => {
  const now = { station: starter.station, variables: [starter.variables[0], { name: "kd", type: "number" as const, value: 3 }] };
  const { overrides } = diff(starter, now);
  assert.deepEqual(overrides.variables, { kd: { expr: null, value: 3 } });
  assert.deepEqual(applyOverrides(starter, overrides, DEFS, "rig").variables[1], { name: "kd", type: "number", value: 3 });
});

test("overrides that no longer fit are left out and say why (E4, E9)", () => {
  const ov = {
    variables: { h_max: 2, cylinders: 6 },
    objects: { "valve-1": { props: { cv: 1 } }, "cart-1": { props: { cv: 3, mass: 2 } }, "spring-1": { links: { c: "cart-1" } } },
    added: [{ id: "probe-1", type: "probe" }, { id: "cart-2", type: "cart" }],
  };
  const r = applyOverrides(starter, ov, DEFS, "tank-rig 0.3.0");
  assert.deepEqual(r.misfits.map((m) => [m.key, m.why]), [
    ["variables.h_max", "tank-rig 0.3.0 has no variable h_max"],
    ["objects.valve-1", "no object valve-1"],
    ["objects.cart-1.cv", "cart-1 has no property cv"],
    ["objects.spring-1.c", "spring-1 has no link c"],
    ["added.probe-1", "probe-1: tank-rig 0.3.0 has no probe"],
    ["added.cart-2", "tank-rig 0.3.0 has its own cart-2"],
  ]);
  assert.equal(r.variables[0].value, 6, "what fits is applied");
  assert.equal(r.station?.objects[0].props?.mass, 2);
  // the kept ones go back into the file with the rest
  const kept = r.misfits.reduce<Overrides>((o, m) => mergeOverrides(o, m.part), {});
  assert.deepEqual(kept.objects?.["cart-1"], { props: { cv: 3 } });
  assert.deepEqual(mergeOverrides({ objects: { "cart-1": { props: { mass: 2 } } } }, kept).objects?.["cart-1"], { props: { mass: 2, cv: 3 } });
  assert.equal(applyOverrides(starter, ov, null, "x").misfits.length, 3, "without the types, only what is missing is checked");
});

test("a format 0 file becomes its diff from the starter", () => {
  const f0: StationFlow0 = {
    paperboat: 0, station: "rig", flow,
    station_objects: { objects: [{ id: "cart-1", type: "cart", props: { mass: 3 } }, starter.station!.objects[1], starter.station!.objects[2]] },
    variables: [...starter.variables, { name: "gain", type: "number", value: 40 }],
    run: { duration: 5 },
  };
  assert.deepEqual(upgrade(f0, starter), {
    paperboat: 1, station: { name: "rig" }, overrides: { objects: { "cart-1": { props: { mass: 3 } } } },
    variables: [{ name: "gain", type: "number", value: 40 }], flow, run: { duration: 5 },
  });
});

test("a station's path is relative to the flow file", () => {
  assert.equal(relPath("flows/a.psf", "stations/b.pst"), "../stations/b.pst");
  assert.equal(relPath("a.psf", "b.pst"), "b.pst");
  assert.equal(relPath("x/y/a.psf", "x/b.pst"), "../b.pst");
  assert.equal(relPath("x/a.psf", "x/s/b.pst"), "s/b.pst");
  assert.equal(besidePath("flows/a.psf", "../stations/b.pst"), "stations/b.pst");
  assert.equal(besidePath("a.psf", "../b.pst"), "", "out of the hub");
});
