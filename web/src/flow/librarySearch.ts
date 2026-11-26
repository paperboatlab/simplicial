// The block library's lookups (BlockLibrary.tsx), pure: the palette groups in their order, a block's kind in
// words, and a search over names first, then descriptions, ports and params.
import type { BlockDef } from "../protocol.ts";
import { hasStepPorts } from "./flowModel.ts";

/** The built-in packages in the order the library lists them; other groups (installed toolkits, domains) follow by name. */
const ORDER = ["base", "signal", "math", "board", "step", "string", "group", "list"];

export const groupOf = (b: BlockDef) => b.group ?? "other";

export function groupsOf(blocks: BlockDef[]): string[] {
  const rank = (g: string) => (ORDER.includes(g) ? ORDER.indexOf(g) : ORDER.length);
  return [...new Set(blocks.map(groupOf))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** What the card's tag says: a step block is "step", else the station's kind. */
export const kindWord = (b: BlockDef) => (hasStepPorts(b) ? "step" : b.kind);

/** Best matches first: the name starting with the query, a word of it, the name containing it, then the rest. */
export function findBlocks(blocks: BlockDef[], query: string): BlockDef[] {
  const q = query.trim().toLowerCase();
  if (!q) return blocks;
  const score = (b: BlockDef) => {
    const name = `${b.label} ${b.type}`.toLowerCase();
    if (name.startsWith(q)) return 0;
    if (name.split(/[\s_-]+/).some((w) => w.startsWith(q))) return 1;
    if (name.includes(q)) return 2;
    const rest = [b.description, b.group, kindWord(b), ...b.inputs.map((p) => p.id), ...b.outputs.map((p) => p.id), ...b.params.map((p) => p.id)];
    return rest.join(" ").toLowerCase().includes(q) ? 3 : -1;
  };
  return blocks.map((b) => [score(b), b] as const).filter(([s]) => s >= 0).sort((a, b) => a[0] - b[0]).map(([, b]) => b);
}
