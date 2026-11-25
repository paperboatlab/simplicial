// Grouping on the Flow canvas: a subsystem, story or frame round the selected blocks and groups of
// the open level, and what the group boxes on it can do (rename, ungroup, show how busy they are).

import { useContext, useMemo, type Dispatch, type SetStateAction } from "react";
import type { Connection } from "@xyflow/react";
import { descendants, frameAround, GHOST_IN, isFrame, isLevel, ordered, withoutFrame, type GroupData } from "./groups.ts";
import { RunStates } from "./flowContexts.ts";
import { connect, freeId, hasStepPorts, isBlock, portsOf, type FlowNode, type Wire } from "./flowModel.ts";
import { isPortBlock, OUTER, PORT_IN, PORT_OUT, placePortBlock, withoutPortBlocks, withPortBlocks } from "./portBlocks.ts";
import type { BlockDef } from "../protocol.ts";

/** `shownIds`: the nodes on the open level, as the canvas shows them. */
export function useFlowGroups(
  nodes: FlowNode[],
  edges: Wire[],
  blocks: BlockDef[],
  shownIds: Set<string>,
  setNodes: Dispatch<SetStateAction<FlowNode[]>>,
  setEdges: Dispatch<SetStateAction<Wire[]>>,
) {
  // Grouping: a subsystem, story or frame round the selected blocks and groups of this
  // level, which must sit in the same place (not some in a frame and some out). A story
  // holds signal blocks only: it is itself the step. A frame holds blocks only.
  const choosable = (ns: FlowNode[], shownIds: Set<string>) => ns.filter((n) => n.selected && shownIds.has(n.id));
  const runStates = useContext(RunStates);
  // In and Out, from the engine's group package (absent on a station older than it).
  const portDefs = useMemo(() => {
    const [portIn, portOut] = [PORT_IN, PORT_OUT].map((t) => blocks.find((b) => b.type === t));
    return portIn && portOut ? { in: portIn, out: portOut } : undefined;
  }, [blocks]);
  const actions = useMemo(
    () => ({
      update: (id: string, change: Partial<GroupData>) =>
        setNodes((ns) => ns.map((n) => (n.id === id && isFrame(n) ? { ...n, data: { ...n.data, ...change } } : n))),
      // Its blocks back one level up; its In and Out blocks go, the wires through them joined.
      ungroup: (id: string) => {
        const ports = new Set(nodes.filter((n) => n.parentId === id && isPortBlock(n)).map((n) => n.id));
        const loose = edges.filter((w) => w.source !== id && w.target !== id); // a story's step wires go
        const r = withoutPortBlocks(withoutFrame(nodes, id), loose, ports);
        setNodes(r.nodes);
        setEdges(r.wires);
      },
      // A wire dropped on a subsystem's dashed + port: an In (or Out) block inside it, wired.
      addPort: (c: Connection, type: string) => {
        const into = c.targetHandle === GHOST_IN;
        if (!portDefs) return;
        const block = placePortBlock(into ? portDefs.in : portDefs.out, nodes, into ? c.target : c.source);
        setNodes([...nodes, block]);
        setEdges((ws) => connect(ws, into ? { ...c, target: block.id, targetHandle: OUTER } : { ...c, source: block.id, sourceHandle: OUTER }, type));
      },
    }),
    [nodes, edges, portDefs, setNodes, setEdges],
  );
  // A group is as busy as its busiest block: failed, else running.
  const inside = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const n of nodes) if (isLevel(n)) m.set(n.id, descendants(n.id, nodes));
    return m;
  }, [nodes]);
  const stateOf = (id: string) => {
    const all = [id, ...(inside.get(id) ?? [])];
    return all.some((x) => runStates.failed.has(x)) ? ("failed" as const) : all.some((x) => runStates.active.has(x)) ? ("running" as const) : undefined;
  };
  const picked = choosable(nodes, shownIds);
  const sameParent = picked.length > 0 && picked.every((n) => n.parentId === picked[0].parentId);
  const canGroup = sameParent;
  const canFrame = sameParent && picked.every(isBlock);
  const canStory = canFrame && picked.every((n) => isBlock(n) && !hasStepPorts(portsOf(n)));
  // A subsystem or story round wired blocks: an In or Out block where each wire crosses its edge.
  const group = (kind: GroupData["kind"]) => {
    const ids = new Set(picked.map((n) => n.id));
    const chosen = nodes.filter((n) => ids.has(n.id));
    if (chosen.length === 0) return;
    const host = chosen[0].parentId ? nodes.find((n) => n.id === chosen[0].parentId) : undefined;
    const inFrame = !!host && isFrame(host) && host.data.kind === "visual";
    const { frame, children } = frameAround(freeId(kind === "visual" ? "frame" : kind, nodes), kind, chosen, { inFrame });
    const moved = new Map(children.map((c) => [c.id, c]));
    const next = ordered([...nodes.map((n) => moved.get(n.id) ?? n), { ...frame, selected: kind !== "visual" }]);
    if (kind === "visual" || !portDefs) return setNodes(next);
    const r = withPortBlocks(next, edges, frame.id, portDefs);
    setNodes(r.nodes);
    setEdges(r.wires);
  };
  return { actions, stateOf, canGroup, canFrame, canStory, group };
}
