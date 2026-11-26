// What the page says when a flow opens on its station, and its address across a station switch (stationLink.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { apartNote, fromSearch, lookedList, movedNote, startOf, toSearch, versionNote } from "../src/stationLink.ts";

const at = { where: "workspace" as const, path: "stations/cart-pole.pst", name: "cart-pole", version: "0.3.0", sha256: "b" };
const misfit = { key: "variables.h_max", why: "cart-pole 0.3.0 has no variable h_max", part: {} };

test("E2: found elsewhere than its path says where, and that Save keeps it", () => {
  const n = movedNote("level-loop", { name: "cart-pole", path: "../cart-pole.pst" }, at);
  assert.equal(n?.title, "Opened level-loop on cart-pole");
  assert.match(n?.detail ?? "", /at stations\/cart-pole\.pst; the flow pointed to \.\.\/cart-pole\.pst\. Save keeps the new place/);
  assert.equal(movedNote("x", { name: "cart-pole", path: "a.pst" }, { ...at, where: "path" }), null);
  assert.equal(movedNote("x", { name: "cart-pole" }, at), null, "no path to have moved from");
});

test("E3 and E4: another version, a changed station, changes that don't fit", () => {
  assert.equal(versionNote("level-loop", { name: "cart-pole", version: "0.2.0" }, at, [])?.title, "cart-pole is 0.3.0; level-loop was made on 0.2.0");
  assert.equal(versionNote("level-loop", { name: "cart-pole", version: "0.3.0", sha256: "a" }, at, [])?.title, "cart-pole 0.3.0 changed since level-loop was saved");
  assert.equal(versionNote("level-loop", { name: "cart-pole", version: "0.2.0" }, at, [misfit, misfit])?.detail, "2 changes don't fit · File › Review changes…");
  assert.equal(versionNote("x", { name: "cart-pole", version: "0.3.0" }, at, [misfit])?.title, "1 change in x doesn't fit cart-pole 0.3.0");
  assert.equal(versionNote("x", { name: "cart-pole", version: "0.3.0", sha256: "b" }, at, []), null);
  assert.match(apartNote("level-loop", "tank-rig", "tank-lab", "pump-rig").detail ?? "", /tank-rig stays in tank-lab/);
});

test("E1 lists where it looked", () => {
  assert.deepEqual(lookedList({ missing: { name: "x" }, looked: [{ where: "path", at: "../x.pst" }, { where: "workspace" }, { where: "installed" }, { where: "running" }] }, "tank-lab"), [
    ["../x.pst", "the flow's path"], ["tank-lab", "the hub"], ["installed stations", "yours and the examples"], ["running stations", "on this computer"],
  ]);
});

test("what starts a found station", () => {
  assert.deepEqual(startOf(at, "h1"), { hub: "h1", path: "stations/cart-pole.pst" });
  assert.deepEqual(startOf({ ...at, where: "installed", path: "/x" }), { name: "cart-pole", version: "0.3.0" });
  assert.equal(startOf({ ...at, port: 51302 }, "h1"), null, "it runs: nothing to start");
});

test("?open= survives the switch, with what started the station", () => {
  const s = toSearch({ station: "ws://localhost:51303", open: { hub: "h1", path: "flows/a:b.psf" }, start: { hub: "h1", path: "s.pst" } }, "station=ws://old&theme=dark");
  assert.deepEqual(fromSearch(s), { station: "ws://localhost:51303", open: { hub: "h1", path: "flows/a:b.psf" }, start: { hub: "h1", path: "s.pst" } });
  assert.match(s, /theme=dark/);
  assert.deepEqual(fromSearch(toSearch({ open: { path: "a.psf" }, nostation: true, use: true })), { open: { path: "a.psf" }, use: true, nostation: true });
  assert.deepEqual(fromSearch("start=nope"), {});
});
