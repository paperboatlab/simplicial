// The workspace and its files (plans/2026-11-26_11-05_one_file_workflow.md): a folder on this computer or a hub
// (paperboat#16), what the page's server works in, switched at runtime (/__paperboat/workspace). The hubs come from
// `paperboat hub list --json` (Malachite's command: no Malachite, no hub); a workspace's tree and its .psf files from
// /__paperboat/hub/files and /hub/file, by `hub=<id>` or `folder=<absolute path>` (engine/core/src/serve.cpp). The
// store every Paperboat app shares (recent.json, settings.json under $PAPERBOAT_HOME) is read and written there too.
import type { RecentStore, SharedSettings, Workspace } from "@paperboatlab/ui/workspace";
import type { FileEntry } from "@paperboatlab/ui/files";
import { PLACE_NAMES, type Hub, type HubPlace } from "@paperboatlab/ui/hub";
import type { Example, Scale, Theme } from "@paperboatlab/ui";
import type { StationFlow, StationFlow0 } from "./protocol.ts";
import { parseFlow } from "./project.ts";

export { parseFlow };

/** What File › Open shows: flows and stations. Save as writes the first. */
export const TYPES = ["psf", "pst"] as const;
/** Where files are read and written: a hub (its id) or a folder on this computer (its absolute path). */
export type Root = { hub: string; folder?: undefined } | { folder: string; hub?: undefined };
/** The file open now: a path in its hub or folder, or only a name (a download: it has no place to save back to). */
export type OpenedFile = { hub?: string; folder?: string; path: string };
/** A workspace's or a file's root; none for a download. */
export const rootOf = (w: { kind?: string; hub?: string; folder?: string; root?: string } | null | undefined): Root | undefined =>
  !w ? undefined : w.hub ? { hub: w.hub } : w.folder ? { folder: w.folder } : w.kind === "folder" && w.root ? { folder: w.root } : undefined;
const key = (r: Root) => r.hub ?? `folder:${r.folder}`;

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
/** A row as the server gives it: a .pst's `station`, a .psf's `station`, its `parent` (the path of its .pst; null: its
 *  station is found nowhere) and `warn` (why), which the kit's picker reads (`byParent`). */
export type Row = { path: string; kind: "file" | "folder"; station?: EntryStation; parent?: string | null; warn?: string };
export type HubEntry = FileEntry & { station?: EntryStation };

/** The server's rows (in tree order) as the kit's FileTree takes them, the station fields kept, a .pst's version its badge. */
export const toEntries = (rows: readonly Row[]): HubEntry[] =>
  rows.map(({ path, kind, ...rest }) => ({
    path, kind, name: path.slice(path.lastIndexOf("/") + 1), depth: path.split("/").length - 1, ...rest,
    ...(path.endsWith(".pst") && rest.station?.version ? { badge: rest.station.version } : {}),  // a station's version beside it
  }));


/** The file's name in the bar and Save as: "a/b/pendulum.psf" → "pendulum". */
export const stem = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.psf$/i, "");

async function ask(url: string, init?: RequestInit): Promise<Response> {
  const r = await fetch(url, { cache: "no-store", ...init });
  if (!r.ok) throw new Error((await r.text()).trim() || `${r.status}`);
  return r;
}
const q = (r: Root, path?: string) => `?${new URLSearchParams({ ...(r.hub ? { hub: r.hub } : { folder: r.folder! }), ...(path === undefined ? {} : { path }) })}`;
const page = (body?: unknown): RequestInit =>
  ({ method: "POST", headers: { "Content-Type": "application/json", "X-Paperboat-Page": "1" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

/** The hubs this machine knows; none without Malachite, or when the page has no server of its own. */
export async function listHubs(): Promise<Hub[]> {
  try {
    const list = (await (await ask("/__paperboat/hubs")).json()) as ServedHub[];
    return Array.isArray(list) ? list.map(toHub) : [];
  } catch {
    return [];
  }
}

/** The rows by root and path, as last listed: what a picked .pst is. */
const listed = new Map<string, HubEntry>();
export const listedAt = (r: Root, path: string) => listed.get(`${key(r)}:${path}`);
export const listHub = async (r: Root): Promise<HubEntry[]> => {
  const rows = toEntries(await (await ask(`/__paperboat/hub/files${q(r)}`)).json());
  for (const row of rows) listed.set(`${key(r)}:${row.path}`, row);
  return rows;
};
export const readFlow = async (r: Root, path: string): Promise<StationFlow | StationFlow0> =>
  parseFlow(await (await ask(`/__paperboat/hub/file${q(r, path)}`)).text());
export const writeFlow = async (r: Root, path: string, flow: StationFlow) =>
  void (await ask(`/__paperboat/hub/file${q(r, path)}`, { ...page(), body: JSON.stringify(flow, null, 2) }));
/** Open in Malachite: the CLI opens the hub there. */
export const openInMalachite = async (hub: string) => void (await ask(`/__paperboat/hub/malachite${q({ hub })}`, page()));
/** Manage runtimes…: the CLI opens the Paperboat Launcher on its Runtimes page. */
export const manageRuntimes = async () => void (await ask("/__paperboat/launcher", page()));
/** Paperboat's examples for Simplicial (`paperboat example list`, paperboat#72): Ctrl+K's Open example: <name>. None
 *  without Paperboat, or when the page has no server of its own. */
export async function listExamples(): Promise<Example[]> {
  try {
    const list = (await (await ask("/__paperboat/examples")).json()) as Example[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
/** Open example: the CLI copies it for the user and opens the copy in a new window. */
export const openExample = async (id: string) => void (await ask(`/__paperboat/example/open?${new URLSearchParams({ id })}`, page()));

// ---- The workspace, switched at runtime, and the shared store ----

/** What the page's server works in now, and the home folder (shown as ~). */
export type Served = { workspace: Workspace | null; home?: string; path?: string };
export const getWorkspace = async (): Promise<Served> => (await ask("/__paperboat/workspace")).json();
/** Work in a folder (or the hub that holds it), a hub, the folder or hub of a file (`path`: the file's in it), or nothing. */
export const setWorkspace = async (to: { folder: string } | { hub: string } | { file: string } | Record<string, never>): Promise<Served> =>
  (await ask("/__paperboat/workspace", page(to))).json();
export const getRecent = async (): Promise<RecentStore> => (await ask("/__paperboat/recent")).json();
export const clearRecent = async (): Promise<RecentStore> => (await ask("/__paperboat/recent", page({ clear: true }))).json();
export const getSettings = async (): Promise<SharedSettings> => (await ask("/__paperboat/settings")).json();
export const saveTheme = async (theme: Theme) => void (await ask("/__paperboat/settings", page({ theme })));
export const saveScale = async (scale: Scale) => void (await ask("/__paperboat/settings", page({ scale })));

// ---- A flow's station (station/find, station/start): plans/2026-11-26_12-55_psf_pst_rework.md ----

/** Where a station was found: by the flow's path, in the hub, installed, running; `path` is in the hub for the first two. */
export type Place = { where: "path" | "workspace" | "installed" | "running"; path: string; name: string; version?: string; sha256?: string; port?: number };
export type Finding = { found: Place } | { missing: { name: string; version?: string }; looked: { where: Place["where"]; at?: string }[] };
/** What to find or start: a flow (or a .pst, a station folder) in a hub or folder, or a station by name. */
export type Which = { hub?: string; folder?: string; path?: string; name?: string; version?: string };

const params = (w: Which) => `?${new URLSearchParams(Object.entries(w).filter((e): e is [string, string] => !!e[1]))}`;

/** The station a flow (or a name) resolves to. */
export const findStation = async (w: Which): Promise<Finding> => (await ask(`/__paperboat/station/find${params(w)}`)).json();
/** Start a station (a .pst or folder in a hub, or an installed one by name): its port, once it is on its way. */
export const startStation = async (w: Which): Promise<{ port: number; url: string }> =>
  (await ask(`/__paperboat/station/start${params(w)}`, page())).json();
/** What the start of the station on `port` wrote (its build). */
export const stationLog = async (port: number): Promise<string> => (await ask(`/__paperboat/station/log?port=${port}`)).text();
/** What the wait screen polls: each station starting or running. */
export type Status = { name: string; state: "building" | "starting" | "failed" | "running"; stage?: string; port: number; error?: string };
export const stationStatus = async (): Promise<Status[]> => ((await (await ask("/__paperboat/status")).json()) as { stations?: Status[] }).stations ?? [];
