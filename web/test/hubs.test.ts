// File › Open and Save as through the hubs: what the page's server says, as the kit's picker takes it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { holds, listExamples, openExample, parseFlow, stem, toEntries, toHub } from "../src/hubs.ts";

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
  // the fields the nested picker reads ride along
  const [flowRow] = toEntries([{ path: "f/a.psf", kind: "file", station: { name: "rig" }, parent: null, warn: "rig not found" }]);
  assert.equal(flowRow.parent, null);
  assert.equal(flowRow.warn, "rig not found");
  const [pst] = toEntries([{ path: "s/rig.pst", kind: "file", station: { name: "rig", version: "0.2.0" } }]);
  assert.equal(pst.badge, "0.2.0", "a station shows its version");
});

test("a flow file opens; anything else says why", () => {
  const f = parseFlow(JSON.stringify({ paperboat: 0, station: "pendulum", flow: { nodes: [], edges: [] } }));
  assert.equal(f.station, "pendulum");  // format 0
  assert.throws(() => parseFlow("nope"), /not JSON/);
  assert.throws(() => parseFlow("{}"), /isn't a flow file/);
  assert.throws(() => parseFlow(JSON.stringify({ paperboat: 2, station: { name: "x" }, flow: {} })), /newer Simplicial/);
  assert.throws(() => parseFlow(JSON.stringify({ paperboat: 0, station: "x" })), /flow must be an object/);
  assert.equal(stem("projects/pendulum/pendulum.psf"), "pendulum");
});

test("Open example: the server's list (none when it fails), and open posts the id from the page", async () => {
  const real = globalThis.fetch;
  const asked: [string, RequestInit | undefined][] = [];
  const ex = { id: "simplicial/09-modular-synth-cpp", app: "simplicial", kind: "simplicial", name: "09 Modular Synth", description: "", path: "/x" };
  try {
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      asked.push([url, init]);
      return url.includes("open") ? new Response("simplicial is not installed\n", { status: 502 }) : Response.json([ex]);
    }) as typeof fetch;
    assert.deepEqual(await listExamples(), [ex]);
    await assert.rejects(openExample(ex.id), /simplicial is not installed/);
    assert.equal(asked[1][0], "/__paperboat/example/open?id=simplicial%2F09-modular-synth-cpp");
    assert.equal(asked[1][1]?.method, "POST");
    assert.equal((asked[1][1]?.headers as Record<string, string>)["X-Paperboat-Page"], "1");
    globalThis.fetch = (async () => { throw new Error("no server"); }) as typeof fetch;
    assert.deepEqual(await listExamples(), []);
  } finally {
    globalThis.fetch = real;
  }
});
