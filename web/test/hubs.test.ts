// File › Open and Save as through the hubs: what the page's server says, as the kit's picker takes it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { holds, parseFlow, stem, toEntries, toHub } from "../src/hubs.ts";

test("a hub says how many flows and stations it holds; a gone one says so instead", () => {
  assert.equal(holds(3, 1), "3 flows · 1 station");
  assert.equal(holds(1, 0), "1 flow");
  assert.equal(holds(0, 2), "2 stations");
  assert.equal(holds(), "no flows or stations");
  assert.deepEqual(toHub({ id: "h", name: "lab", place: "dropbox", path: "~/Dropbox/lab", psf: 2, conflicts: 1 }),
    { id: "h", name: "lab", place: "dropbox", path: "~/Dropbox/lab", holds: "2 flows", conflicts: 1 });
  const gone = toHub({ id: "g", name: "gone", place: "somewhere-new", path: "/x", missing: true });
  assert.equal(gone.place, "local");
  assert.equal(gone.missing, true);
  assert.equal(gone.holds, undefined);
});

test("the server's rows become the tree's entries", () => {
  assert.deepEqual(toEntries([{ path: "p", kind: "folder" }, { path: "p/a.psf", kind: "file" }]), [
    { path: "p", kind: "folder", name: "p", depth: 0 },
    { path: "p/a.psf", kind: "file", name: "a.psf", depth: 1 },
  ]);
});

test("a flow file opens; anything else says why", () => {
  const f = parseFlow(JSON.stringify({ paperboat: 0, station: "pendulum", flow: { nodes: [], edges: [] } }));
  assert.equal(f.station, "pendulum");
  assert.throws(() => parseFlow("nope"), /not JSON/);
  assert.throws(() => parseFlow("{}"), /isn't a flow file/);
  assert.throws(() => parseFlow(JSON.stringify({ paperboat: 1, station: "x", flow: {} })), /newer Simplicial/);
  assert.throws(() => parseFlow(JSON.stringify({ paperboat: 0, station: "x" })), /no station or flow/);
  assert.equal(stem("projects/pendulum/pendulum.psf"), "pendulum");
});
