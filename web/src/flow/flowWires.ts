// What the Flow canvas works out about its wires on each change: how many meet at each icon port,
// which dangle from a port its `if` hides, and the routes they take round the blocks.

import { Position, type ReactFlowState } from "@xyflow/react";
import { branchPoints, iconValid, placeIconPorts, routeWires, squareUp, type Obstacle, type RouteInput } from "@paperboatlab/ui/canvas";
import { isBlock, type FlowNode, type Wire } from "./flowModel.ts";

/** Icon ports: wires per port (3 or more draw a junction dot) and ports hidden by their `if`, whose wires stay as missing. */
export function iconWireCounts(nodes: FlowNode[], edges: Wire[]) {
  const count = new Map<string, Record<string, number>>();
  for (const w of edges)
    for (const [node, handle] of [[w.source, w.sourceHandle], [w.target, w.targetHandle]] as const) {
      if (!handle) continue;
      const c = count.get(node) ?? {};
      c[handle] = (c[handle] ?? 0) + 1;
      count.set(node, c);
    }
  const dangling = new Set<string>();
  for (const n of nodes) {
    if (!isBlock(n) || !iconValid(n.data.def.view?.icon)) continue;
    for (const p of placeIconPorts(n.data.def.view!.icon!, n.data.params)) if (p.hidden) dangling.add(`${n.id}:${p.port.id}`);
  }
  return { count, missing: new Set([...dangling].filter((k) => edges.some((w) => `${w.source}:${w.sourceHandle}` === k || `${w.target}:${w.targetHandle}` === k))) };
}

/** Blocks commented out (not bypassed): their wires are drawn faded. */
export const commentedOutIds = (nodes: FlowNode[]) =>
  new Set(nodes.filter(isBlock).filter((n) => n.data.commented && n.data.commentMode !== "through").map((n) => n.id));

/**
 * Where the blocks and their ports are, as one string: React Flow changes its node lookup in place (the
 * same Map), so the routes are worked out again when this changes, not when the lookup does.
 */
export const nodeGeometry = (nodeLookup: ReactFlowState["nodeLookup"]) =>
  [...nodeLookup.values()]
    .map((n) => {
      const { positionAbsolute: at, handleBounds: h } = n.internals;
      const ports = [...(h?.source ?? []), ...(h?.target ?? [])].map((p) => `${p.id}@${p.x},${p.y}`).join(" ");
      return `${n.id}@${at.x},${at.y},${n.measured?.width},${n.measured?.height}[${ports}]`;
    })
    .join(";");

/**
 * Route every wire shown round the blocks, from where React Flow has measured the nodes and their ports;
 * then mark where wires out of one port branch off each other, as drawn (along their saved bends, if any).
 */
export function routeCanvasWires(nodeLookup: ReactFlowState["nodeLookup"], shownEdges: Wire[]) {
  const obstacles: Obstacle[] = [];
  for (const n of nodeLookup.values()) {
    obstacles.push({
      id: n.id,
      x: n.internals.positionAbsolute.x !== undefined ? n.internals.positionAbsolute.x : n.position.x,
      y: n.internals.positionAbsolute.y !== undefined ? n.internals.positionAbsolute.y : n.position.y,
      width: n.measured?.width ?? n.width ?? 190,
      height: n.measured?.height ?? n.height ?? 130,
    });
  }

  const routeInputs: RouteInput[] = [];
  for (const w of shownEdges) {
    const sn = nodeLookup.get(w.source);
    const tn = nodeLookup.get(w.target);
    if (!sn || !tn) continue;

    const sHandles = sn.internals.handleBounds?.source ?? [];
    const sh = sHandles.find((h) => (h.id ?? null) === (w.sourceHandle ?? null)) ?? sHandles[0];

    const tHandles = tn.internals.handleBounds?.target ?? [];
    const th = tHandles.find((h) => (h.id ?? null) === (w.targetHandle ?? null)) ?? tHandles[0];

    const sx = sh ? sn.internals.positionAbsolute.x + sh.x + sh.width / 2 : sn.internals.positionAbsolute.x + (sn.measured?.width ?? 190);
    const sy = sh ? sn.internals.positionAbsolute.y + sh.y + sh.height / 2 : sn.internals.positionAbsolute.y + (sn.measured?.height ?? 130) / 2;

    const tx = th ? tn.internals.positionAbsolute.x + th.x + th.width / 2 : tn.internals.positionAbsolute.x;
    const ty = th ? tn.internals.positionAbsolute.y + th.y + th.height / 2 : tn.internals.positionAbsolute.y + (tn.measured?.height ?? 130) / 2;

    const toSide = (pos?: Position | string): "left" | "right" | "top" | "bottom" => {
      if (pos === Position.Left || pos === "left") return "left";
      if (pos === Position.Top || pos === "top") return "top";
      if (pos === Position.Bottom || pos === "bottom") return "bottom";
      return "right";
    };

    // Whole pixels: a port measured a hair off another (zoom) would put a jog in a straight wire.
    routeInputs.push({
      id: w.id,
      source: w.source,
      sourceHandle: w.sourceHandle,
      target: w.target,
      targetHandle: w.targetHandle,
      sx: Math.round(sx),
      sy: Math.round(sy),
      tx: Math.round(tx),
      ty: Math.round(ty),
      sourcePosition: toSide(sh?.position),
      targetPosition: toSide(th?.position ?? Position.Left),
      step: w.data?.type === "step",
    });
  }
  const routes = routeWires(routeInputs, obstacles);
  const drawn = shownEdges.flatMap((w) => {
    const r = routes.get(w.id);
    if (!r) return [];
    const points = w.data?.points ? squareUp(r.points[0], w.data.points, r.points[r.points.length - 1]) : r.points;
    return [{ id: w.id, from: `${w.source}:${w.sourceHandle ?? ""}`, points }];
  });
  for (const [id, at] of branchPoints(drawn)) routes.set(id, { ...routes.get(id)!, branches: at });
  return routes;
}
