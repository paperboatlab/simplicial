// Projects (from legacy's project.ts): a flow file (`name.psf`), format 1 (plans/2026-11-26_12-55_psf_pst_rework.md): a
// child of one station, holding only what differs from the station's starter (its overrides, the flow's own variables,
// the flow, the Board, the run), pointing to the station by name, version, sha256 and a path relative to the file. Pure
// functions: the diff from the starter and applying it back (what no longer fits kept apart, like a lost block), building
// a file, reading and checking one (format 0, full copies, still reads), and the small lists the browser keeps (recent
// projects and the autosave). The shapes are `StationFlow`/`StationFlow0` in protocol.ts, generated from the schema.
import { readStored as read, writeStored as write } from "@paperboatlab/ui";
import type {
  BoardLayout, FlowType, Graph, ObjectDef, ObjectOverride, Overrides, RunSettings, Station, StationFlow, StationFlow0, StationObject, StationRef, Variable, Variables,
} from "./protocol.ts";

/** The format version this app writes and reads (and 0, read and written as 1). A newer file is refused. */
export const PROJECT_VERSION = 1;

/** What the station started with (the first variables.load and station.load): what overrides are against. */
export type Starter = { station: Station | null; variables: Variables };
/** The station's objects and every variable as the page holds them now. */
export type Now = { station: Station | null; variables: Variables };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const keysOf = (...os: (object | undefined)[]) => [...new Set(os.flatMap((o) => Object.keys(o ?? {})))];

/** What `now` changed of the starter: its overrides (equal or empty parts left out) and the flow's own variables. */
export function diff(starter: Starter, now: Now): { overrides: Overrides; own: Variables } {
  const names = new Set(starter.variables.map((v) => v.name));
  const variables: NonNullable<Overrides["variables"]> = {};
  for (const sv of starter.variables) {
    const cur = now.variables.find((v) => v.name === sv.name);
    if (!cur || same(sv, cur)) continue;  // a station variable can't be removed: it comes back
    const changed = keysOf(sv, cur).filter((k) => !same(sv[k as keyof Variable], cur[k as keyof Variable]));
    variables[sv.name] = changed.length === 1 && changed[0] === "value" && cur.value !== undefined
      ? cur.value
      : Object.fromEntries(changed.map((k) => [k, cur[k as keyof Variable] ?? null]));
  }
  const overrides: Overrides = {};
  if (Object.keys(variables).length) overrides.variables = variables;
  const base = starter.station?.objects ?? [];
  const objs = now.station?.objects ?? [];
  if (starter.station && now.station) {
    const ids = new Set(base.map((o) => o.id));
    const objects: Record<string, ObjectOverride> = {};
    for (const o of base) {
      const cur = objs.find((x) => x.id === o.id);
      if (!cur) continue;
      const props = Object.fromEntries(keysOf(o.props, cur.props).filter((k) => cur.props?.[k] !== undefined && !same(o.props?.[k], cur.props[k])).map((k) => [k, cur.props![k]]));
      const links = Object.fromEntries(keysOf(o.links, cur.links).filter((k) => !same(o.links?.[k], cur.links?.[k])).map((k) => [k, cur.links?.[k] ?? null]));
      const one: ObjectOverride = {
        ...(Object.keys(props).length ? { props } : {}),
        ...(Object.keys(links).length ? { links } : {}),
        ...(cur.pos && !same(o.pos, cur.pos) ? { pos: cur.pos } : {}),
      };
      if (Object.keys(one).length) objects[o.id] = one;
    }
    if (Object.keys(objects).length) overrides.objects = objects;
    const added = objs.filter((o) => !ids.has(o.id));
    if (added.length) overrides.added = added;
    const removed = base.filter((o) => !objs.some((x) => x.id === o.id)).map((o) => o.id);
    if (removed.length) overrides.removed = removed;
  }
  return { overrides, own: now.variables.filter((v) => !names.has(v.name)) };
}

/** An override that doesn't fit the station: where (`objects.cart-1.mass`), why, and the override alone (kept or removed). */
export type Misfit = { key: string; why: string; part: Overrides };

/** Two sets of overrides as one (`b` wins on the same value). */
export function mergeOverrides(a: Overrides, b: Overrides): Overrides {
  const out: Overrides = {};
  const variables = { ...a.variables, ...b.variables };
  if (Object.keys(variables).length) out.variables = variables;
  const objects: Record<string, ObjectOverride> = { ...a.objects };
  for (const [id, o] of Object.entries(b.objects ?? {})) {
    const was = objects[id] ?? {};
    const props = { ...was.props, ...o.props }, links = { ...was.links, ...o.links };
    objects[id] = { ...(Object.keys(props).length ? { props } : {}), ...(Object.keys(links).length ? { links } : {}), ...(o.pos ?? was.pos ? { pos: o.pos ?? was.pos } : {}) };
  }
  if (Object.keys(objects).length) out.objects = objects;
  const added = [...(a.added ?? []).filter((x) => !b.added?.some((y) => y.id === x.id)), ...(b.added ?? [])];
  if (added.length) out.added = added;
  const removed = [...new Set([...(a.removed ?? []), ...(b.removed ?? [])])];
  if (removed.length) out.removed = removed;
  return out;
}

/** The starter with `overrides` applied, against the station's object types (`defs`; null: not known, not checked).
 *  What doesn't fit is left out and listed (E4, E9); `label` names the station in the reasons ("tank-rig 0.3.0"). */
export function applyOverrides(starter: Starter, ov: Overrides | undefined, defs: ObjectDef[] | null, label: string): Now & { misfits: Misfit[] } {
  const misfits: Misfit[] = [];
  const variables = starter.variables.map((v) => ({ ...v }));
  for (const [name, x] of Object.entries(ov?.variables ?? {})) {
    const i = variables.findIndex((v) => v.name === name);
    if (i < 0) { misfits.push({ key: `variables.${name}`, why: `${label} has no variable ${name}`, part: { variables: { [name]: x } } }); continue; }
    if (typeof x !== "object") { variables[i] = { ...variables[i], value: x }; continue; }
    const v: Record<string, unknown> = { ...variables[i] };
    for (const [k, val] of Object.entries(x)) if (val === null) delete v[k]; else v[k] = val;
    variables[i] = v as Variable;
  }
  if (!starter.station) {
    for (const [id, o] of Object.entries(ov?.objects ?? {})) misfits.push({ key: `objects.${id}`, why: `${label} has no objects`, part: { objects: { [id]: o } } });
    for (const o of ov?.added ?? []) misfits.push({ key: `added.${o.id}`, why: `${label} has no objects`, part: { added: [o] } });
    return { station: null, variables, misfits };
  }
  const gone = new Set(ov?.removed ?? []);
  const objects: StationObject[] = starter.station.objects.filter((o) => !gone.has(o.id)).map((o) => ({ ...o }));
  for (const [id, o] of Object.entries(ov?.objects ?? {})) {
    const i = objects.findIndex((x) => x.id === id);
    if (i < 0) { misfits.push({ key: `objects.${id}`, why: `no object ${id}`, part: { objects: { [id]: o } } }); continue; }
    const def = defs?.find((d) => d.type === objects[i].type);
    const props = { ...objects[i].props }, links = { ...objects[i].links };
    for (const [k, val] of Object.entries(o.props ?? {})) {
      if (def && !def.props.some((p) => p.id === k)) misfits.push({ key: `objects.${id}.${k}`, why: `${id} has no property ${k}`, part: { objects: { [id]: { props: { [k]: val } } } } });
      else props[k] = val;
    }
    for (const [k, to] of Object.entries(o.links ?? {})) {
      if (def && !def.links.includes(k)) misfits.push({ key: `objects.${id}.${k}`, why: `${id} has no link ${k}`, part: { objects: { [id]: { links: { [k]: to } } } } });
      else if (to === null) delete links[k];
      else links[k] = to;
    }
    objects[i] = { ...objects[i], ...(Object.keys(props).length ? { props } : {}), ...(Object.keys(links).length || objects[i].links ? { links } : {}), ...(o.pos ? { pos: o.pos } : {}) };
  }
  for (const o of ov?.added ?? []) {
    if (objects.some((x) => x.id === o.id)) misfits.push({ key: `added.${o.id}`, why: `${label} has its own ${o.id}`, part: { added: [o] } });
    else if (defs && !defs.some((d) => d.type === o.type)) misfits.push({ key: `added.${o.id}`, why: `${o.id}: ${label} has no ${o.type}`, part: { added: [o] } });
    else objects.push(o);
  }
  return { station: { ...starter.station, objects }, variables, misfits };
}

/** A format 0 file (full copies) as format 1: its diff from the starter. */
export function upgrade(f: StationFlow0, starter: Starter): StationFlow {
  const { overrides, own } = diff(starter, { station: f.station_objects ?? starter.station, variables: f.variables ?? starter.variables });
  return buildProject({ station: { name: f.station }, flow: f.flow, overrides, variables: own, board: f.board, run: f.run });
}

/** `to` as a path relative to the file `from` (both hub paths, with /): "flows/a.psf", "stations/b.pst" → "../stations/b.pst". */
export function relPath(from: string, to: string): string {
  const a = from.split("/").slice(0, -1), b = to.split("/");
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => ".."), ...b.slice(i)].join("/");
}

/** A path relative to the file `from` as a hub path; "" when it leaves the hub. */
export function besidePath(from: string, rel: string): string {
  const out: string[] = from.split("/").slice(0, -1);
  for (const part of rel.split("/")) {
    if (part === "..") { if (!out.length) return ""; out.pop(); } else if (part && part !== ".") out.push(part);
  }
  return out.join("/");
}

type Parts = {
  station: StationRef;
  flow: Graph;
  overrides?: Overrides;
  variables?: Variables;
  board?: BoardLayout;
  run?: RunSettings;
};

/** The flow file for these parts: empty/absent parts are left out, so the file stays small and readable. */
export function buildProject({ station, flow, overrides, variables, board, run }: Parts): StationFlow {
  return {
    paperboat: PROJECT_VERSION,
    station,
    ...(overrides && Object.keys(overrides).length > 0 ? { overrides } : {}),
    ...(variables && variables.length > 0 ? { variables } : {}),
    flow,
    ...(board ? { board } : {}),
    ...(run && Object.keys(run).length > 0 ? { run } : {}),
  };
}

/** The station a file was made on, in either format. */
export const stationOf = (f: StationFlow | StationFlow0): StationRef => (f.paperboat === 0 ? { name: f.station } : f.station);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const pair = (v: unknown): v is [string, string] => Array.isArray(v) && v.length === 2 && v.every(isText);

const VARIABLE_TYPES = ["number", "boolean", "enum", "text", "file", "matrix"];
const GROUP_KINDS = ["visual", "subsystem", "story"];

/** What a sheet may be (#9; flowTypes.ts). */
const FLOW_TYPES: FlowType[] = ["signal", "step", "state", "model"];

/** The first thing wrong with the flow, in words, or null. */
function flowProblem(flow: unknown): string | null {
  if (!isObj(flow)) return "flow must be an object";
  if (!Array.isArray(flow.nodes)) return "flow.nodes must be a list";
  if (!Array.isArray(flow.edges)) return "flow.edges must be a list";
  if (flow.flow !== undefined && !FLOW_TYPES.includes(flow.flow as FlowType)) return `flow.flow must be one of ${FLOW_TYPES.join(", ")}`;
  for (const [i, n] of flow.nodes.entries()) {
    if (!isObj(n) || !isText(n.id) || !isText(n.type)) return `flow.nodes[${i}] needs an id and a type`;
    if (n.params !== undefined && !isObj(n.params)) return `flow.nodes[${i}].params must be an object`;
    if (n.pos !== undefined && !(Array.isArray(n.pos) && n.pos.length === 2 && n.pos.every(isNum))) return `flow.nodes[${i}].pos must be two numbers`;
    if (n.rotation !== undefined && ![0, 90, 180, 270].includes(n.rotation as number)) return `flow.nodes[${i}].rotation must be 0, 90, 180, or 270`;
    if (n.mirror !== undefined && typeof n.mirror !== "boolean") return `flow.nodes[${i}].mirror must be a boolean`;
    if (n.commented !== undefined && typeof n.commented !== "boolean") return `flow.nodes[${i}].commented must be a boolean`;
    if (n.comment_mode !== undefined && n.comment_mode !== "out" && n.comment_mode !== "through") return `flow.nodes[${i}].comment_mode must be "out" or "through"`;
    if (n.comment !== undefined && typeof n.comment !== "string") return `flow.nodes[${i}].comment must be a string`;
    if (n.unfolded !== undefined && typeof n.unfolded !== "boolean") return `flow.nodes[${i}].unfolded must be a boolean`;
  }
  for (const [i, e] of flow.edges.entries()) {
    if (!isObj(e) || !pair(e.from) || !pair(e.to)) return `flow.edges[${i}] needs from and to as [block, port]`;
  }
  if (flow.groups !== undefined) {
    if (!Array.isArray(flow.groups)) return "flow.groups must be a list";
    for (const [i, g] of flow.groups.entries()) {
      if (!isObj(g) || !isText(g.id) || !GROUP_KINDS.includes(g.kind as string) || !Array.isArray(g.nodes)) return `flow.groups[${i}] needs an id, a kind and its nodes`;
    }
  }
  return null;
}

/** The first thing wrong with format 1's station and overrides, in words, or null. */
function refProblem(p: Record<string, unknown>): string | null {
  const { station: st, overrides: ov } = p;
  if (!isObj(st) || !isText(st.name)) return "station needs a name";
  for (const k of ["version", "sha256", "path"]) if (st[k] !== undefined && !isText(st[k])) return `station.${k} must be text`;
  if (ov === undefined) return null;
  if (!isObj(ov)) return "overrides must be an object";
  if (ov.variables !== undefined && !isObj(ov.variables)) return "overrides.variables must be an object";
  if (ov.objects !== undefined) {
    if (!isObj(ov.objects)) return "overrides.objects must be an object";
    for (const [id, o] of Object.entries(ov.objects)) {
      if (!isObj(o) || (o.props !== undefined && !isObj(o.props)) || (o.links !== undefined && !isObj(o.links))) return `overrides.objects.${id} must hold props, links or pos`;
    }
  }
  if (ov.added !== undefined) {
    if (!Array.isArray(ov.added)) return "overrides.added must be a list";
    for (const [i, o] of ov.added.entries()) if (!isObj(o) || !isText(o.id) || !isText(o.type)) return `overrides.added[${i}] needs an id and a type`;
  }
  if (ov.removed !== undefined && !(Array.isArray(ov.removed) && ov.removed.every(isText))) return "overrides.removed must be a list of ids";
  return null;
}

/** The first thing wrong with the optional parts, in words, or null. */
function partsProblem(p: Record<string, unknown>): string | null {
  const { station_objects, variables, board, run } = p;
  if (station_objects !== undefined) {
    if (!isObj(station_objects) || !Array.isArray(station_objects.objects)) return "station_objects.objects must be a list";
    for (const [i, o] of station_objects.objects.entries()) if (!isObj(o) || !isText(o.id) || !isText(o.type)) return `station_objects.objects[${i}] needs an id and a type`;
  }
  if (variables !== undefined) {
    if (!Array.isArray(variables)) return "variables must be a list";
    for (const [i, v] of variables.entries()) {
      if (!isObj(v) || !isText(v.name) || !VARIABLE_TYPES.includes(v.type as string)) return `variables[${i}] needs a name and a type`;
    }
  }
  if (board !== undefined && !(isObj(board) && Array.isArray(board.instruments))) return "board.instruments must be a list";
  if (run !== undefined) {
    if (!isObj(run)) return "run must be an object";
    for (const k of ["duration", "dt", "speed"]) if (run[k] !== undefined && !isNum(run[k])) return `run.${k} must be a number`;
    const o = run.solver_options;
    if (o !== undefined) {
      if (!isObj(o)) return "run.solver_options must be an object";
      for (const [k, v] of Object.entries(o)) if (!isNum(v)) return `run.solver_options.${k} must be a number`;
    }
  }
  return null;
}

/** A flow file's text as a project (format 1, or 0), or an error that says why not (for "Can't open x: …"); reading changes nothing. */
export function parseFlow(text: string): StationFlow | StationFlow0 {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("it isn't a flow file (not JSON)");
  }
  if (!isObj(data) || data.paperboat === undefined) throw new Error('it isn\'t a flow file (no "paperboat" version)');
  const v = data.paperboat;
  if (!(typeof v === "number" && Number.isInteger(v) && v >= 0)) throw new Error('its "paperboat" version must be a whole number');
  if (v > PROJECT_VERSION) throw new Error(`it was saved by a newer Simplicial (flow format ${v}; this one reads ${PROJECT_VERSION})`);
  if (v === 0 ? !isText(data.station) : !(isObj(data.station) && isText(data.station.name))) throw new Error("it doesn't say which station it was made on");
  const problem = (v === 0 ? null : refProblem(data)) ?? flowProblem(data.flow) ?? partsProblem(data);
  if (problem) throw new Error(`it is damaged: ${problem}`);
  return data as unknown as StationFlow | StationFlow0;
}

// ---- What the browser keeps: recent projects (their content, so they can be reopened) and the autosave ----

/** A project kept in this browser: its file's path (in `hub`, if it is in one, else a name on this computer), when, and what it held. */
export type Stored = { name: string; hub?: string; savedAt: number; project: StationFlow | StationFlow0 };

export const RECENT_MAX = 5;
/** All recent projects together stay under this many characters (localStorage holds about 5 MB). */
export const RECENT_CHARS = 1_500_000;

/** `entry` first, the same file's older entry dropped, the list cut to `RECENT_MAX` and `RECENT_CHARS` (oldest go first). */
export function addRecent(list: Stored[], entry: Stored): Stored[] {
  const out: Stored[] = [];
  let size = 0;
  for (const s of [entry, ...list.filter((x) => x.name !== entry.name || x.hub !== entry.hub)]) {
    const n = JSON.stringify(s).length;
    if (out.length >= RECENT_MAX || (out.length > 0 && size + n > RECENT_CHARS)) break;
    out.push(s);
    size += n;
  }
  return out;
}

const RECENT_KEY = "simplicial.recent";
const autosaveKey = (engine: string) => `simplicial.autosave:${engine}`;

const isStored = (v: unknown): v is Stored => isObj(v) && isText(v.name) && isNum(v.savedAt) && isObj(v.project) && "flow" in v.project;

export const loadRecent = (): Stored[] => {
  const v = read(RECENT_KEY, (x): x is unknown[] => Array.isArray(x));
  return (v ?? []).filter(isStored);
};
export const saveRecent = (list: Stored[]) => (write(RECENT_KEY, list), list);

/** The unsaved work of this station's last session, kept as it happens. */
export const loadAutosave = (engine: string): Stored | undefined => read(autosaveKey(engine), isStored);
export const saveAutosave = (engine: string, s: Stored) => write(autosaveKey(engine), s);
export const clearAutosave = (engine: string) => write(autosaveKey(engine), undefined);
