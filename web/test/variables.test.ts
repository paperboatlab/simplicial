import assert from "node:assert/strict";
import { test } from "node:test";
import { newVariable, renameRef, withVariable } from "../src/variableEdits.ts";
import type { Variables } from "../src/protocol.ts";

test("a new variable takes a free name; a rename follows into formulas and bound params", () => {
  const list: Variables = [{ name: "x", type: "number", value: 1 }, { name: "k", type: "number", expr: "x * 2" }];
  assert.equal(newVariable(list).name, "x_2");
  assert.deepEqual(newVariable([]), { name: "x", type: "number", value: 0 });
  const renamed = withVariable(list, "x", { name: "mass", type: "number", value: 1 });
  assert.deepEqual(renamed.map((v) => v.name), ["mass", "k"]);
  assert.equal(renamed[1].expr, "mass * 2");
  assert.deepEqual(renameRef({ var: "x" }, "x", "mass"), { var: "mass" });
  assert.deepEqual(renameRef({ expr: "x + 1" }, "x", "mass"), { expr: "mass + 1" });
  assert.equal(renameRef(3, "x", "mass"), 3);
});
