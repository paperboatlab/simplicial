import assert from "node:assert/strict";
import { test } from "node:test";
import { news } from "../src/news.ts";

const open = { connection: "open" as const, engine: "cartpole", run: null, failed: [] };
const running = { ...open, run: { id: "r1", progress: 0.5, status: "running" as const } };

test("the first hello says nothing: the splash showed it", () => {
  assert.deepEqual(news({ ...open, connection: "connecting", engine: "" }, open), []);
});

test("losing the station is working until it is back", () => {
  assert.deepEqual(news(open, { ...open, connection: "closed" }).map((n) => [n.about, n.state]), [["station", "working"]]);
  assert.deepEqual(news({ ...open, connection: "connecting" }, open).map((n) => [n.about, n.state]), [["station", "done"]]);
  assert.deepEqual(news({ ...open, connection: "connecting" }, { ...open, connection: "closed" }), []);  // a retry that missed
});

test("a run that ends in a fault names the block; done and cancelled say nothing", () => {
  const [n] = news(running, { ...running, run: { ...running.run, status: "failed" }, failed: ["pid"] });
  assert.equal(n.state, "failed");
  assert.match(n.detail!, /^pid failed · see the Console/);
  assert.deepEqual(news(running, { ...running, run: { ...running.run, status: "done" } }), []);
  assert.deepEqual(news(running, { ...running, run: { ...running.run, status: "cancelled" } }), []);
});

test("a run lost with the station fails as well; a saved failed run opened does not", () => {
  const lost = news(running, { ...running, connection: "closed", run: { ...running.run, status: "failed" } });
  assert.deepEqual(lost.map((n) => n.about), ["station", "run"]);
  assert.match(lost[1].detail!, /went away/);
  assert.deepEqual(news(open, { ...open, run: { id: "record", progress: 1, status: "failed" } }), []);
});
