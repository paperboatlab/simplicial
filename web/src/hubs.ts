// The hubs (paperboat#16) for File › Open and Save as. The page's server knows them from `paperboat hub list
// --json` (Malachite's command: no Malachite, no hub), lists a hub's files and reads and writes its .psf files
// (engine/core/src/serve.cpp, /__paperboat/hub…). The file decides the hub: one opened from a hub puts
// Simplicial in it.
import type { FileEntry } from "@paperboatlab/ui/files";
import { PLACE_NAMES, type Hub, type HubPlace } from "@paperboatlab/ui/hub";
import type { StationFlow, StationFlow0 } from "./protocol.ts";
import { parseFlow } from "./project.ts";

export { parseFlow };

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

/** A station as a hub entry names it: a .pst's or station folder's station.toml, a .psf's header. */
export type EntryStation = { name: string; version?: string; path?: string };
/** A hub row as the server gives it: a .pst's `station`, a .psf's `station`, its `parent` (the hub path of its .pst; null:
 *  its station is found nowhere) and `warn` (why): what the kit's nested picker reads; the flat one passes them by. */
export type Row = { path: string; kind: "file" | "folder"; station?: EntryStation; parent?: string | null; warn?: string };
export type HubEntry = FileEntry & Omit<Row, "path" | "kind">;

/** The server's rows (in tree order) as the kit's FileTree takes them, the station fields kept. */
export const toEntries = (rows: readonly Row[]): HubEntry[] =>
  rows.map(({ path, kind, ...rest }) => ({ path, kind, name: path.slice(path.lastIndexOf("/") + 1), depth: path.split("/").length - 1, ...rest }));


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

/** The hub's rows by path, as last listed: what a picked .pst is. */
export const listed = new Map<string, HubEntry>();
export const listHub = async (hub: Hub): Promise<HubEntry[]> => {
  const rows = toEntries(await (await ask(`/__paperboat/hub/files${q(hub)}`)).json());
  for (const r of rows) listed.set(`${hub.id}:${r.path}`, r);
  return rows;
};
export const readFlow = async (hub: Hub | string, path: string): Promise<StationFlow | StationFlow0> =>
  parseFlow(await (await ask(`/__paperboat/hub/file${q(hub, path)}`)).text());
export const writeFlow = async (hub: Hub | string, path: string, flow: StationFlow) =>
  void (await ask(`/__paperboat/hub/file${q(hub, path)}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Paperboat-Page": "1" }, body: JSON.stringify(flow, null, 2) }));

// ---- A flow's station (station/find, station/start): plans/2026-11-26_12-55_psf_pst_rework.md ----

/** Where a station was found: by the flow's path, in the hub, installed, running; `path` is in the hub for the first two. */
export type Place = { where: "path" | "workspace" | "installed" | "running"; path: string; name: string; version?: string; sha256?: string; port?: number };
export type Finding = { found: Place } | { missing: { name: string; version?: string }; looked: { where: Place["where"]; at?: string }[] };
/** What to find or start: a flow (or a .pst, a station folder) in a hub, or a station by name. */
export type Which = { hub?: string; path?: string; name?: string; version?: string };

const params = (w: Which) => `?${new URLSearchParams(Object.entries(w).filter((e): e is [string, string] => !!e[1]))}`;

/** The station a flow (or a name) resolves to. */
export const findStation = async (w: Which): Promise<Finding> => (await ask(`/__paperboat/station/find${params(w)}`)).json();
/** Start a station (a .pst or folder in a hub, or an installed one by name): its port, once it is on its way. */
export const startStation = async (w: Which): Promise<{ port: number; url: string }> =>
  (await ask(`/__paperboat/station/start${params(w)}`, { method: "POST", headers: { "X-Paperboat-Page": "1" } })).json();
/** What the start of the station on `port` wrote (its build). */
export const stationLog = async (port: number): Promise<string> => (await ask(`/__paperboat/station/log?port=${port}`)).text();
/** What the wait screen polls: each station starting or running. */
export type Status = { name: string; state: "building" | "starting" | "failed" | "running"; stage?: string; port: number; error?: string };
export const stationStatus = async (): Promise<Status[]> => ((await (await ask("/__paperboat/status")).json()) as { stations?: Status[] }).stations ?? [];
