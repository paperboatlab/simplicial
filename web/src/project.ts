// Projects (from legacy's project.ts): everything a user made, as one JSON file (`name.psf`). Pure functions: building
// the file, reading and checking one, naming it, and the small lists the browser keeps (recent projects and the
// autosave). The shape is `StationFlow` in protocol.ts, generated from the schema; a file's `ui` part is not read.
import { readStored as read, writeStored as write } from "@paperboatlab/ui";
import type { BoardLayout, FlowType, Graph, RunSettings, Station, StationFlow, Variables } from "./protocol.ts";

/** The format version this app writes and reads. A newer file is refused. */
export const PROJECT_VERSION = 0;

type Parts = {
  station: string;
  flow: Graph;
  station_objects?: Station | null;
  variables?: Variables;
  board?: BoardLayout;
  run?: RunSettings;
};

/** The flow file for these parts: empty/absent parts are left out, so the file stays small and readable. */
export function buildProject({ station, flow, station_objects, variables, board, run }: Parts): StationFlow {
  return {
    paperboat: PROJECT_VERSION,
    station,
    flow,
    ...(station_objects ? { station_objects } : {}),
    ...(variables && variables.length > 0 ? { variables } : {}),
    ...(board ? { board } : {}),
    ...(run && Object.keys(run).length > 0 ? { run } : {}),
  };
}

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

/** A flow file's text as a project, or an error that says why not (for "Can't open x: …"); reading changes nothing. */
export function parseFlow(text: string): StationFlow {
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
  if (!isText(data.station)) throw new Error("it doesn't say which station it was made on");
  const problem = flowProblem(data.flow) ?? partsProblem(data);
  if (problem) throw new Error(`it is damaged: ${problem}`);
  return data as unknown as StationFlow;
}

// ---- What the browser keeps: recent projects (their content, so they can be reopened) and the autosave ----

/** A project kept in this browser: its file's path (in `hub`, if it is in one, else a name on this computer), when, and what it held. */
export type Stored = { name: string; hub?: string; savedAt: number; project: StationFlow };

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
