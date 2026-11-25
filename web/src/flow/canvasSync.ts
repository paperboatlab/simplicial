// The Flow canvas kept in step with the station: what it loads it with, unless the user changed the canvas
// since this same station did; linked blocks that follow station objects; and wires that lost a block or a port.

import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { EngineState } from "../engine.ts";
import { resolveBlocks, syncLinked, withoutLooseWires, type FlowNode, type Wire } from "./flowModel.ts";
import { fromGraph, toGraph } from "./flowGraph.ts";

export function useCanvasSync(
  state: EngineState,
  nodes: FlowNode[],
  edges: Wire[],
  setNodes: Dispatch<SetStateAction<FlowNode[]>>,
  setEdges: Dispatch<SetStateAction<Wire[]>>,
  fitView: () => void,
) {
  // What the canvas was loaded as, and from which station: a station that comes back (restarted,
  // reconnected) doesn't overwrite what the user changed since.
  const canvas = useRef({ engine: "", graph: "" });
  const current = useRef({ nodes, edges });
  current.current = { nodes, edges };

  // Linked blocks follow the station: one per object that spawns one.
  useEffect(() => {
    setNodes((ns) => syncLinked(ns, state.station, state.objects, state.blocks));
  }, [state.station, state.objects, state.blocks, setNodes]);
  // Wires to a block that's gone (its station object was removed), or to a port it no
  // longer has (a magic block switched form), go too.
  useEffect(() => {
    setEdges((es) => withoutLooseWires(nodes, es));
  }, [nodes, setEdges]);

  // The station decides what the canvas opens with (graph.load), unless the user changed
  // the canvas since this same station loaded it: then the canvas stays, checked against the
  // (perhaps new) catalog, so a block that's gone shows as missing instead of vanishing.
  useEffect(() => {
    const now = current.current;
    const edited = now.nodes.length > 0 && canvas.current.engine === state.engine && JSON.stringify(toGraph(now.nodes, now.edges)) !== canvas.current.graph;
    if (edited) {
      setNodes((ns) => resolveBlocks(ns, now.edges, state.blocks));
      return;
    }
    const g = state.loaded ? fromGraph(state.loaded, state.blocks) : { nodes: [], edges: [] };
    setNodes(g.nodes);
    setEdges(g.edges);
    canvas.current = { engine: state.engine, graph: JSON.stringify(toGraph(g.nodes, g.edges)) };
    requestAnimationFrame(() => fitView());
  }, [state.loaded, state.blocks, state.engine, setNodes, setEdges, fitView]);
}
