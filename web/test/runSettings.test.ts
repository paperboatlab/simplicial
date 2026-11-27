// Run settings: a flow keeps only what differs from its station's; the solvers are the engine's.
import assert from "node:assert/strict";
import { test } from "node:test";
import { changed, READS, runLine, solverOf, solversOf } from "../src/runSettings.ts";
import { registry, type Do, type View } from "../src/menus.ts";

const station = { mode: "clock" as const, duration: 10, dt: 0.01, speed: 1, solver: "rk4" as const, solvers: ["rk4", "rk45", "euler"], solver_options: { rtol: 1e-6 } };

test("a flow keeps only what differs from the station's", () => {
  assert.deepEqual(changed({ duration: 10, speed: 2, solver: "rk4" }, station), { speed: 2 });
  assert.deepEqual(changed({ solver_options: { rtol: 1e-6, atol: 1e-8 } }, station), { solver_options: { atol: 1e-8 } });
  assert.deepEqual(changed({ solver_options: { rtol: 1e-6 } }, station), {});  // an empty solver_options goes
  assert.deepEqual(changed({ duration: undefined, solvers: ["x"] }, station), {});
});

test("the solvers are the ones the station announced, the flow's if it has it", () => {
  assert.deepEqual(solversOf(station), ["rk4", "rk45", "euler"]);
  assert.equal(solversOf({}).length, 7);
  assert.equal(solverOf({ solver: "rk45" }, station), "rk45");
  assert.equal(solverOf({ solver: "cvode" }, station), "rk4");  // not in this engine: the station's
  assert.equal(solverOf({}, { solvers: ["euler"] }), "euler");
  assert.deepEqual(READS.discrete, []);
});

test("the run defaults in words", () => {
  assert.equal(runLine(station), "10 s · step 0.01 s · 1× · RK4");
  assert.equal(runLine({ duration: 0, speed: 0 }), "until cancelled · as fast as it can");
  assert.equal(runLine({ mode: "once" }), "evaluated once");
  assert.equal(runLine({}), "the engine's");
});

test("Run settings… opens, and says why it can't without a station", () => {
  const view = { mode: "navigator", page: "flow", station: true, hidden: () => false, console: false, theme: "system", running: false, whyNot: "",
    flow: { lock: "", undo: false, redo: false, copy: false, paste: false, arrange: false, picked: false }, board: false } as View;
  let opened = 0;
  const act = new Proxy({} as Do, { get: (_, k) => (k === "runSettings" ? () => opened++ : () => {}) });
  const c = registry(view, act).find((x) => x.id === "run.settings")!;
  assert.notEqual(c.enabled, false);
  c.run();
  assert.equal(opened, 1);
  const none = registry(view, new Proxy({} as Do, { get: (_, k) => (k === "runSettings" ? undefined : () => {}) })).find((x) => x.id === "run.settings")!;
  assert.equal(none.enabled, false);
  assert.match(none.why ?? "", /No station/);
  assert.equal(registry(view, new Proxy({} as Do, { get: () => undefined })).find((x) => x.id === "run.toolkits")!.enabled, false);  // Toolkits… likewise
});
