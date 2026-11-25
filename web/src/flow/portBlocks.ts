// A subsystem's or story's ports as blocks: In and Out, placed, wired and renamed inside it like
// any block (the `group` package of the block browser). Each is a port of the group's block
// outside, named by its `name` (else In 1, Out 2… in the order they stand, top to bottom).
// They are the UI's own: a station never sees them. The graph a run gets has each taken out
// and the wires through it joined end to end, as groups themselves reach stations flat.

import type { BlockDef } from "../protocol.ts";
import { connect, freeId, isBlock, makeNode, type BlockNode, type FlowNode, type Wire } from "./flowModel.ts";

export const PORT_IN = "inport";
export const PORT_OUT = "outport";
/** The port of an In or Out block that faces outside the group: the group's port, not drawn inside. */
export const OUTER = "outer";

export const isPortType = (type: string | undefined) => type === PORT_IN || type === PORT_OUT;

type NodeLike = { id: string; type?: string; data: unknown; position: { y: number } };
type WireLike = { source: string; sourceHandle?: string | null; target: string; targetHandle?: string | null };
const typeOf = (n: NodeLike) => (n.type === "block" ? (n.data as { def?: { type?: string } }).def?.type : undefined);
export const isPortBlock = (n: NodeLike | undefined) => !!n && isPortType(typeOf(n));

/** A port block's name on the group's block: its `name`, else In 1, Out 2… by `index` (1-based). */
export function portBlockName(n: NodeLike, index: number): string {
  const name = String((n.data as { params?: { name?: unknown } }).params?.name ?? "").trim();
  return name || `${typeOf(n) === PORT_IN ? "In" : "Out"} ${index}`;
}

/**
 * The canvas without its In and Out blocks (only those in `only`, if given: a group being
 * ungrouped), each wire through one joined end to end: the source feeding an In's outside (or an Out's inside) now feeds what
 * the block fed. A port block with nothing feeding it leaves what it fed unwired.
 */
export function withoutPortBlocks<N extends NodeLike, W extends WireLike>(nodes: N[], wires: W[], only?: Set<string>): { nodes: N[]; wires: W[] } {
  const through = new Map(nodes.filter((n) => isPortBlock(n) && (!only || only.has(n.id))).map((n) => [n.id, typeOf(n)]));
  if (through.size === 0) return { nodes, wires };
  const key = (node: string, handle: string | null | undefined) => `${node}\u0000${handle ?? ""}`;
  const feeding = new Map(wires.map((w) => [key(w.target, w.targetHandle), w]));
  // Where a wire leaving `node` really starts: back through port blocks to a real block, or nowhere.
  const origin = (w: W): W | undefined => {
    let at: W | undefined = w;
    for (let guard = 0; at && through.has(at.source) && guard < 64; guard++)
      at = feeding.get(key(at.source, through.get(at.source) === PORT_IN ? OUTER : "u"));
    return at;
  };
  return {
    nodes: nodes.filter((n) => !through.has(n.id)),
    wires: wires.flatMap((w) => {
      if (through.has(w.target)) return [];
      const from = origin(w);
      return from ? [{ ...w, source: from.source, sourceHandle: from.sourceHandle }] : [];
    }),
  };
}

/**
 * A group's In and Out blocks as its ports, in the order they stand inside it (top to bottom; a
 * tie, left to right): each with its number among its kind (In 1, In 2… Out 1…) and its name.
 */
export function portBlocksOf<N extends NodeLike & { position: { x?: number } }>(blocks: N[]): { node: N; side: "inputs" | "outputs"; handle: string; index: number; name: string }[] {
  const sorted = [...blocks].sort((a, b) => a.position.y - b.position.y || (a.position.x ?? 0) - (b.position.x ?? 0) || a.id.localeCompare(b.id));
  const count = { [PORT_IN]: 0, [PORT_OUT]: 0 } as Record<string, number>;
  return sorted.map((node) => {
    const type = typeOf(node)!;
    const index = ++count[type];
    return { node, side: type === PORT_IN ? "inputs" : "outputs", handle: `${node.id}::${OUTER}`, index, name: portBlockName(node, index) };
  });
}

/** Every block and group inside group `id`, at any depth. */
export function descendants(id: string, nodes: { id: string; parentId?: string }[]): string[] {
  const kids = new Map<string, string[]>();
  for (const n of nodes) if (n.parentId) kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n.id]);
  const out: string[] = [];
  const walk = (p: string) => (kids.get(p) ?? []).forEach((c) => (out.push(c), walk(c)));
  walk(id);
  return out;
}

/**
 * A new In or Out block (`def`, from the catalog) inside `group`: left of its blocks for an In, right of them
 * for an Out, at height `y` or under the last of its kind.
 */
export function placePortBlock(def: BlockDef, nodes: FlowNode[], group: string, y?: number): BlockNode {
  const type = def.type;
  const side = type === PORT_IN ? "in" : "out";
  const kids = nodes.filter((n) => n.parentId === group);
  const rest = kids.filter((n) => !isPortBlock(n));
  const same = kids.filter((n) => isBlock(n) && n.data.def.type === type);
  const x = side === "in" ? Math.min(...rest.map((n) => n.position.x), 160) - 140 : Math.max(...rest.map((n) => n.position.x + (n.measured?.width ?? 64)), 0) + 80;
  const top = y ?? (same.length ? Math.max(...same.map((n) => n.position.y)) + 80 : Math.min(...rest.map((n) => n.position.y), 60));
  return { ...makeNode(def, freeId(side, nodes), Math.round(x), Math.round(top)), parentId: group };
}

/**
 * A subsystem or story made round wired blocks gets an In for each port outside that feeds in,
 * and an Out for each port inside that feeds out, the wires going through them: its ports are
 * blocks from the start, so they stay when a wire goes, and can be renamed.
 */
export function withPortBlocks(nodes: FlowNode[], wires: Wire[], group: string, defs: { in: BlockDef; out: BlockDef }): { nodes: FlowNode[]; wires: Wire[] } {
  const inside = new Set(descendants(group, nodes));
  const crossing = wires.filter((w) => w.source !== group && w.target !== group && w.data?.type !== "step" && inside.has(w.source) !== inside.has(w.target));
  let ns = nodes;
  let ws = wires.filter((w) => !crossing.includes(w));
  const made = new Map<string, string>(); // a port's source (outside for an In, inside for an Out) → its block
  for (const w of crossing) {
    const into = inside.has(w.target);
    const key = `${w.source}\u0000${w.sourceHandle ?? ""}`;
    const type = w.data?.type ?? "signal";
    let id = made.get(key);
    if (!id) {
      const end = ns.find((n) => n.id === (into ? w.target : w.source));
      const block = placePortBlock(into ? defs.in : defs.out, ns, group, end?.position.y);
      ns = [...ns, block];
      id = block.id;
      made.set(key, id);
      ws = connect(ws, { source: w.source, sourceHandle: w.sourceHandle ?? null, target: id, targetHandle: into ? OUTER : "u" }, type);
    }
    ws = connect(ws, { source: id, sourceHandle: into ? "y" : OUTER, target: w.target, targetHandle: w.targetHandle ?? null }, type);
  }
  return { nodes: ns, wires: ws };
}
