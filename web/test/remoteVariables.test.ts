// Live variables (Julix's session; Squero MX before it) are not part of the flow: a session restored before the field
// existed, or a variables.remote message without a list, must leave an empty list — the
// Variables sheet maps over it on every render.

import assert from "node:assert/strict";
import { test } from "node:test";
import { initial, reduce } from "../src/engine.ts";
import { bindable, liveOf, liveRows, sourceLabel } from "../src/variableEdits.ts";

test("a variables.remote message replaces the live variables", () => {
  const state = reduce(initial, {
    type: "variables.remote",
    source: "julix",
    variables: [{ name: "k", type: "number", value: 2 }],
  });
  assert.deepEqual(state.remoteVariables, [{ name: "k", type: "number", value: 2 }]);
});

test("a variables.remote message without a list clears them", () => {
  const withRemote = reduce(initial, {
    type: "variables.remote",
    source: "julix",
    variables: [{ name: "k", type: "number", value: 2 }],
  });
  const state = reduce(withRemote, { type: "variables.remote", source: "mx" } as never);
  assert.deepEqual(state.remoteVariables, []);
});

test("a stateless reset restores an empty list", () => {
  assert.deepEqual(reduce(initial, { type: "reset" }).remoteVariables, []);
});

test("variables.remote keeps who sent them", () => {
  const state = reduce(initial, { type: "variables.remote", source: "julix", variables: [{ name: "m", type: "number", value: 1.5 }] });
  assert.equal(state.remoteSource, "julix");
});

test("live variables sit under the flow's own: a name the flow has is the flow's", () => {
  const own = [{ name: "k", type: "number" as const, value: 2 }];
  const live = [{ name: "k", type: "number" as const, value: 99 }, { name: "m", type: "number" as const, value: 1.5 },
    { name: "big", type: "matrix" as const, note: "too large to share live" }];
  assert.deepEqual(liveRows(own, live).map((r) => [r.v.name, r.shadowed]), [["k", true], ["m", false], ["big", false]]);
  assert.deepEqual(bindable(own, live).map((v) => v.name), ["k", "m"]);  // big has no value: nothing to bind
  assert.equal(sourceLabel("julix"), "Julix");
});

test("Julix's variables from the page's server: kept across a new station, and under the station's own", () => {
  const k = { name: "k", type: "number" as const, value: 2.5 };
  const s = reduce(initial, { type: "variables.page", source: "julix", variables: [k] });
  assert.deepEqual(s.pageVariables, [k]);
  assert.equal(s.pageSource, "julix");
  assert.deepEqual(reduce(s, { type: "reset" }).pageVariables, [k], "another station: the page's server still has them");
  // the station's list first (what a run uses), then what only the page's server has
  const q = { name: "q", type: "number" as const, value: 1 };
  assert.deepEqual(liveOf([{ ...k, value: 3 }], [k, q]), [{ ...k, value: 3 }, q]);
  assert.deepEqual(liveOf([], [k]), [k]);
});
