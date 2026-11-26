// A flow and its station (plans/2026-11-26_12-55_psf_pst_rework.md): what the page says when it opens a flow on its
// station (E2, E3, E4, E8, the places E1 looked), and the page's address across a station switch (`?open=`). Pure, so
// it is tested; App.tsx does the asking, opening and saving.
import type { Misfit } from "./project.ts";
import type { Finding, Place, Root, Which } from "./hubs.ts";
import type { StationRef } from "./protocol.ts";

/** A station as the messages name it: "cart-pole 0.2.0". */
export const named = (s: { name: string; version?: string }) => (s.version ? `${s.name} ${s.version}` : s.name);
const many = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** A toast's words, and the key it offers (`act`: E2's Save, E3/E4's Review), which App.tsx wires. */
export type Note = { title: string; detail?: string; state?: "done" | "warning"; act?: "save" | "review" };

/** Where E1 looked, as its list: [where, what that is]. */
export function lookedList(f: Extract<Finding, { missing: unknown }>, hub?: string): [string, string][] {
  return f.looked.map((l): [string, string] => l.where === "path" ? [l.at ?? "", "the flow's path"]
    : l.where === "workspace" ? [hub ?? "the hub", "the hub"]
    : l.where === "installed" ? ["installed stations", "yours and the examples"] : ["running stations", "on this computer"]);
}

/** Where a found station is, in words: its hub path, or the kind of place. */
const whereText = (p: Place) => (p.where === "path" || p.where === "workspace" ? p.path : p.where === "installed" ? "the installed stations" : "a running station");

/** E2: the flow opened on its station found elsewhere than its path (null when it was at its path, or it had none). */
export function movedNote(file: string, made: StationRef, at: Place): Note | null {
  if (at.where === "path" || !made.path) return null;
  return { title: `Opened ${file} on ${at.name}`, detail: `Found ${at.name} at ${whereText(at)}; the flow pointed to ${made.path}. Save keeps the new place.`, state: "done", act: "save" };
}

/** E3 and E4: another version, or the same one changed (its sha256), and the changes that don't fit; null when all is well. */
export function versionNote(file: string, made: StationRef, at: { name: string; version?: string; sha256?: string }, misfits: readonly Misfit[]): Note | null {
  const n = misfits.length;
  const fit: Partial<Note> = n ? { detail: `${n === 1 ? "1 of its changes doesn't" : `${n} of its changes don't`} fit.`, act: "review" } : {};
  if (made.version && at.version && made.version !== at.version) return { title: `${at.name} is ${at.version}; ${file} was made on ${made.version}`, state: "warning", ...fit };
  if (made.sha256 && at.sha256 && made.sha256 !== at.sha256) return { title: `${named(at)} changed since ${file} was saved`, state: "warning", ...fit };
  return n ? { title: `${many(n, "change")} in ${file} ${n === 1 ? "doesn't" : "don't"} fit ${named(at)}`, detail: "Kept in the file, unused.", state: "warning", act: "review" } : null;
}

/** E8: saved in another hub than its station's. */
export const apartNote = (file: string, station: string, from: string, to: string): Note =>
  ({ title: `Saved ${file} in ${to}`, detail: `${station} stays in ${from}, so the flow will find it by name next time.`, state: "warning" });

/** What starts a found station: its .pst or folder in the hub or folder, or an installed one by name; nothing when it runs. */
export const startOf = (p: Place, root?: Root): Which | null =>
  p.port ? null : (p.where === "path" || p.where === "workspace") && root ? { ...root, path: p.path } : { name: p.name, version: p.version };

/** The page's address after a station switch: the station, the file to open on it (`<hub>:<path>`; no hub: in the
 *  folder the page's server works in), whether to take it on this station whatever it names (`use`), what started the station. */
export type Opening = { station?: string; open?: { hub?: string; path: string }; use?: boolean; start?: Which; nostation?: boolean };

export function toSearch(o: Opening, now = ""): string {
  const q = new URLSearchParams(now);
  for (const k of ["station", "open", "use", "start", "nostation"]) q.delete(k);
  if (o.station) q.set("station", o.station);
  if (o.open) q.set("open", `${o.open.hub ?? ""}:${o.open.path}`);
  if (o.use) q.set("use", "1");
  if (o.start) q.set("start", JSON.stringify(o.start));
  if (o.nostation) q.set("nostation", "1");
  return q.toString();
}

export function fromSearch(search: string): Opening {
  const q = new URLSearchParams(search);
  const open = q.get("open"), start = q.get("start");
  const i = open?.indexOf(":") ?? -1;
  let which: Which | undefined;
  try { which = start ? (JSON.parse(start) as Which) : undefined; } catch { which = undefined; }
  return {
    ...(q.get("station") ? { station: q.get("station")! } : {}),
    // `<hub>:<path>`; a bare path (another app's `?open=`, Malachite's Open in Simplicial) is in the server's folder
    ...(open ? { open: i >= 0 ? { ...(i > 0 ? { hub: open.slice(0, i) } : {}), path: open.slice(i + 1) } : { path: open } } : {}),
    ...(q.get("use") ? { use: true } : {}),
    ...(which ? { start: which } : {}),
    ...(q.get("nostation") ? { nostation: true } : {}),
  };
}
