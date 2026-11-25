// The hubs (paperboat#16) for File › Open and Save as. The page's server knows them from `paperboat hub list
// --json` (Malachite's command: no Malachite, no hub), lists a hub's files and reads and writes its .psf files
// (engine/core/src/serve.cpp, /__paperboat/hub…). The file decides the hub: one opened from a hub puts
// Simplicial in it.
import type { FileEntry } from "@paperboatlab/ui/files";
import { PLACE_NAMES, type Hub, type HubPlace } from "@paperboatlab/ui/hub";
import type { StationFlow } from "./protocol.ts";

/** What File › Open shows: flows and stations. Save as writes the first. */
export const TYPES = ["psf", "pst"] as const;
/** The file open now: a path in a hub (`hub` is its id), or a name from this computer. */
export type OpenedFile = { hub?: string; path: string };

/** One hub as the page's server lists it. */
export type ServedHub = { id: string; name: string; place?: string; path: string; missing?: boolean; conflicts?: number; psf?: number; pst?: number };

const many = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** What a hub holds of Simplicial's: "3 flows · 1 station", or "no flows or stations". */
export function holds(psf = 0, pst = 0): string {
  return psf || pst ? [psf && many(psf, "flow"), pst && many(pst, "station")].filter(Boolean).join(" · ") : "no flows or stations";
}

export const toHub = (h: ServedHub): Hub => ({
  id: h.id, name: h.name, path: h.path,
  place: h.place && h.place in PLACE_NAMES ? (h.place as HubPlace) : "local",
  ...(h.missing ? { missing: true } : { holds: holds(h.psf, h.pst) }),
  ...(h.conflicts ? { conflicts: h.conflicts } : {}),
});

/** The server's rows ({path, kind}, in tree order) as the kit's FileTree takes them. */
export const toEntries = (rows: readonly { path: string; kind: "file" | "folder" }[]): FileEntry[] =>
  rows.map((r) => ({ path: r.path, kind: r.kind, name: r.path.slice(r.path.lastIndexOf("/") + 1), depth: r.path.split("/").length - 1 }));

/** A .psf's text as a flow file, or why not, in words. */
export function parseFlow(text: string): StationFlow {
  let f: unknown;
  try { f = JSON.parse(text); } catch { throw new Error("it isn't a flow file (not JSON)"); }
  const o = f as Partial<StationFlow> | null;
  if (!o || typeof o !== "object" || typeof o.paperboat !== "number") throw new Error("it isn't a flow file");
  if (o.paperboat > 0) throw new Error(`it was saved by a newer Simplicial (flow format ${o.paperboat})`);
  if (typeof o.station !== "string" || !o.flow || typeof o.flow !== "object") throw new Error("it isn't a flow file (no station or flow)");
  return o as StationFlow;
}

/** The file's name in the bar and Save as: "a/b/pendulum.psf" → "pendulum". */
export const stem = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.psf$/i, "");

async function ask(url: string, init?: RequestInit): Promise<Response> {
  const r = await fetch(url, { cache: "no-store", ...init });
  if (!r.ok) throw new Error((await r.text()).trim() || `${r.status}`);
  return r;
}
const q = (hub: Hub | string, path?: string) =>
  `?hub=${encodeURIComponent(typeof hub === "string" ? hub : hub.id)}${path === undefined ? "" : `&path=${encodeURIComponent(path)}`}`;

/** The hubs this machine knows; none without Malachite, or when the page has no server of its own. */
export async function listHubs(): Promise<Hub[]> {
  try {
    const list = (await (await ask("/__paperboat/hubs")).json()) as ServedHub[];
    return Array.isArray(list) ? list.map(toHub) : [];
  } catch {
    return [];
  }
}

export const listHub = async (hub: Hub): Promise<FileEntry[]> => toEntries(await (await ask(`/__paperboat/hub/files${q(hub)}`)).json());
export const readFlow = async (hub: Hub | string, path: string) => parseFlow(await (await ask(`/__paperboat/hub/file${q(hub, path)}`)).text());
export const writeFlow = async (hub: Hub | string, path: string, flow: StationFlow) =>
  void (await ask(`/__paperboat/hub/file${q(hub, path)}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Paperboat-Page": "1" }, body: JSON.stringify(flow, null, 2) }));
