import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { lampView } from "./lamp.ts";

test("lamp: idle before a run, then on and off from the engine's 1 and 0", () => {
  const idle = lampView(undefined, {});
  assert.equal(idle.idle, true);
  assert.equal(idle.on, false);
  assert.equal(idle.word, "–");

  assert.deepEqual([lampView(1).on, lampView(1).word], [true, "on"]);
  assert.deepEqual([lampView(0).on, lampView(0).word], [false, "off"]);
  assert.equal(lampView(true).on, true); // a boolean reading, if a host sends one
  assert.equal(lampView("1").on, false); // text is no reading
});

test("lamp: a latching lamp says armed and tripped", () => {
  assert.equal(lampView(0, { latch: true }).word, "armed");
  assert.equal(lampView(1, { latch: true }).word, "tripped");
  assert.equal(lampView(1, { latch: 1 }).word, "tripped");
  assert.equal(lampView(1, { latch: 0 }).word, "on");
  assert.equal(lampView(undefined, { latch: true }).word, "–");
});

test("lamp: the condition in the caption, with the block's defaults where a param is unset", () => {
  assert.equal(lampView(0).condition, "> 0.5");
  assert.equal(lampView(0, { op: ">=", threshold: 10 }).condition, "≥ 10");
  assert.equal(lampView(0, { op: "<=", threshold: -2.5 }).condition, "≤ −2.5");
  assert.equal(lampView(0, { op: "!=", threshold: 0 }).condition, "≠ 0");
  assert.equal(lampView(0, { op: "==", threshold: 1 / 3 }).condition, "= 0.3333");
  assert.equal(lampView(0, { threshold: 0.00001 }).condition, "> 1.00e−5");
  assert.equal(lampView(0, { op: "~", threshold: 1 }).condition, "> 1"); // unknown op: the default
  assert.equal(lampView(0, { threshold: { var: "limit" } }).condition, "> limit");
  assert.equal(lampView(0, { threshold: { expr: "2 * limit" } }).condition, "> ƒ 2 * limit");
});

test("lamp: label and tone", () => {
  assert.equal(lampView(1, { label: "  Over 10 mm " }).label, "Over 10 mm");
  assert.equal(lampView(1).label, "");
  assert.equal(lampView(1).tone, "accent");
  assert.equal(lampView(1, { color: "danger" }).tone, "danger");
  assert.equal(lampView(1, { color: "green" }).tone, "accent"); // only the design's two colours
});

test("lamp: registers the kind the C++ block names", () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const index = fs.readFileSync(path.join(dir, "index.tsx"), "utf8");
  assert.match(index, /registerInstrument\("lamp"/);
  const cpp = fs.readFileSync(path.join(dir, "..", "lamp.cpp"), "utf8");
  assert.match(cpp, /\.instrument = "lamp"/);
});
