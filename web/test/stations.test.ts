import assert from "node:assert/strict";
import { test } from "node:test";
import { candidates, toAddress } from "../src/stations.ts";

test("a typed address becomes a station's ws:// address", () => {
  assert.equal(toAddress("51302"), "ws://localhost:51302");
  assert.equal(toAddress(" lab-pc:51302 "), "ws://lab-pc:51302");
  assert.equal(toAddress("ws://10.0.0.2:51301/"), "ws://10.0.0.2:51301");
  assert.equal(toAddress("https://lab.example:443"), "wss://lab.example:443");
  assert.equal(toAddress("cart pole"), "");
  assert.equal(toAddress(""), "");
});

test("it looks at the recent stations first, then the local ports, each once", () => {
  const c = candidates(["ws://lab-pc:51302", "ws://localhost:51302"]);
  assert.deepEqual(c.slice(0, 3), ["ws://lab-pc:51302", "ws://localhost:51302", "ws://localhost:51301"]);
  assert.equal(c.filter((u) => u === "ws://localhost:51302").length, 1);
  assert.equal(c.at(-1), "ws://localhost:51311");
});
