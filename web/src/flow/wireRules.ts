// Which wires may join which ports on the Flow canvas, and what type a new wire takes. Made
// afresh from the canvas's nodes on each render, like the canvas's other handlers.

import type { Connection, IsValidConnection } from "@xyflow/react";
import { connectError, netWireType, wireMismatch } from "@paperboatlab/ui/canvas";
import { GHOST_IN, GHOST_OUT, splitHandle, STORY_DEF } from "./groups.ts";
import type { BlockDef, Connectors } from "../protocol.ts";
import { isBlock, portDef, portsOf, portType, wireEnd, type FlowNode, type Wire } from "./flowModel.ts";

/** `portBlocks`: the catalog has In and Out, so a subsystem's dashed + port can add one. */
export function wireRules(nodes: FlowNode[], connectors: Connectors, portBlocks = true) {
  const defOf = (id: string): BlockDef | undefined => {
    const n = nodes.find((x) => x.id === id);
    if (!n) return undefined;
    if (isBlock(n)) return portsOf(n);
    return n.data.kind === "story" ? STORY_DEF : undefined;
  };
  // A wire drawn to a collapsed group's port is a wire to the block inside it.
  const real = (c: Connection): Connection => {
    const s = c.sourceHandle ? splitHandle(c.sourceHandle) : null;
    const t = c.targetHandle ? splitHandle(c.targetHandle) : null;
    return {
      source: s ? s[0] : c.source,
      sourceHandle: s ? s[1] : c.sourceHandle,
      target: t ? t[0] : c.target,
      targetHandle: t ? t[1] : c.targetHandle,
    };
  };
  const wireType = (c: Connection | Wire) => {
    const end = wireEnd(defOf(c.source), c.sourceHandle, "outputs", connectors);
    return end && end.kind === "acausal" ? netWireType(connectors[end.cls]) : (portType(defOf(c.source), c.sourceHandle, "outputs") ?? "signal");
  };

  // A wire joins ports of one type (signal to signal, step to step; any to anything but a
  // step), in one unit when both ends have one (#4). The engine checks again.
  const isValidConnection: IsValidConnection<Wire> = (shown) => {
    const c = real(shown as Connection);
    return c.source !== c.target && !refusal(c);
  };
  // Why a wire may not join, in words (null if it may): icon connectors by §4, plain ports by type and unit.
  const refusal = (c: Connection): string | null => {
    const [a, b] = [defOf(c.source), defOf(c.target)];
    // A subsystem's dashed + port takes any wire but a step: it becomes an In or Out block of that wire.
    if (c.targetHandle === GHOST_IN || c.sourceHandle === GHOST_OUT) {
      const [other, handle, side] = c.targetHandle === GHOST_IN ? [a, c.sourceHandle, "outputs" as const] : [b, c.targetHandle, "inputs" as const];
      const end = portDef(other, handle, side);
      if (!portBlocks) return "this station has no In and Out blocks (the engine's group package)";
      return !end ? "that port is not there" : end.type === "step" ? "a step wire joins a story's in and next, not a new port" : null;
    }
    const [ea, eb] = [wireEnd(a, c.sourceHandle, "outputs", connectors), wireEnd(b, c.targetHandle, "inputs", connectors)];
    if (!ea || !eb) return "that port is not there";
    const bad = connectError(ea, eb);
    if (bad) return bad;
    const from = portDef(a, c.sourceHandle, "outputs");
    const to = portDef(b, c.targetHandle, "inputs");
    return from && to ? wireMismatch(from, to) : null;
  };
  return { defOf, real, wireType, isValidConnection, refusal };
}
