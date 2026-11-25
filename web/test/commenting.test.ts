import assert from "node:assert/strict";
import { test } from "node:test";
import { fromGraph, toGraph } from "../src/flow/flowGraph.ts";
import { commentedOutIds } from "../src/flow/flowWires.ts";
import type { BlockDef, Graph } from "../src/protocol.ts";

const gain: BlockDef = { type: "gain", label: "Gain", kind: "function", inputs: [{ id: "u", type: "signal" }], outputs: [{ id: "y", type: "signal" }], params: [{ id: "k", type: "number", default: 1 }] };

test("commented, its mode and the note go to the engine as the graph names them, and come back", () => {
  const graph: Graph = {
    nodes: [
      { id: "g1", type: "gain", commented: true, comment_mode: "out", comment: "Gain tuning" },
      { id: "g2", type: "gain", commented: true, comment_mode: "through" },
      { id: "g3", type: "gain" },
    ],
    edges: [{ from: ["g1", "y"], to: ["g2", "u"] }],
  };
  const { nodes, edges } = fromGraph(graph, [gain]);
  const back = toGraph(nodes, edges);
  assert.deepEqual(back.nodes.map((n) => [n.id, n.commented, n.comment_mode, n.comment]), [
    ["g1", true, "out", "Gain tuning"],
    ["g2", true, "through", undefined],
    ["g3", undefined, undefined, undefined],
  ]);
  assert.deepEqual([...commentedOutIds(nodes)], ["g1"], "a bypassed block passes its input on: its wires stay");
});
