// What the Flow canvas tells its blocks and wires: shared through context, so a node or an edge
// redraws from it without the canvas passing props through React Flow.

import { createContext } from "react";
import type { Connectors, Variables } from "../protocol.ts";
import type { GroupData } from "./groups.ts";
import type { Point as WirePoint, WireRoute } from "@paperboatlab/ui/canvas";

/** What the last run said about blocks (`node.state`): where a Step flow is, which failed. */
export const RunStates = createContext<{
  active: ReadonlySet<string>;
  failed: ReadonlySet<string>;
  /** Waiting their turn in the run (queued). */
  queued: ReadonlySet<string>;
  /** Reused from an earlier run (cached). */
  cached: ReadonlySet<string>;
  /** How far a block's long step has got (node.progress). */
  progress: Readonly<Record<string, number>>;
}>({
  active: new Set(),
  failed: new Set(),
  queued: new Set(),
  cached: new Set(),
  progress: {},
});

/** What the canvas knows of icon ports: the catalog's connectors, wires per port, ports whose wires dangle (`if` false). */
export const ConnectorsContext = createContext<Connectors>({});
export const IconWires = createContext<{ count: ReadonlyMap<string, Record<string, number>>; missing: ReadonlySet<string> }>({ count: new Map(), missing: new Set() });

/** The wire a dragged card would be inserted into, if any (drawn thicker). */
export const HotWire = createContext<string | null>(null);
/** The blocks whose latest value in the run is on (above 0.5, or true): a compact plate's live icon (a lit Lamp). */
export const OnBlocks = createContext<ReadonlySet<string>>(new Set());
/** The wires to follow (#55): those of the hovered wire, port or block. null: nothing is hovered. */
export const Lit = createContext<ReadonlySet<string> | null>(null);
/** Whole-canvas routed wire geometries computed in one pass. */
export const WireRoutes = createContext<Map<string, WireRoute> | null>(null);
export const CommentedOutContext = createContext<ReadonlySet<string>>(new Set());
/** Save a wire's dragged bends; null when the canvas is locked (wires don't move). */
export const SetBends = createContext<((id: string, bends: WirePoint[]) => void) | null>(null);

/** Why the flow can't be edited now (a run is in progress); "" while it can. */
export const Lock = createContext("");
/** The station's variables and what they come to: a bound param's chip says its value; Show opens the Variables card. */
export const Vars = createContext<{ list: Variables; values: Readonly<Record<string, unknown>>; show: (name: string) => void }>({ list: [], values: {}, show: () => {} });

/** Actions a group offers, provided by the Flow editor. */
export const GroupActions = createContext<{
  update: (id: string, change: Partial<GroupData>) => void;
  ungroup: (id: string) => void;
  /** Open a subsystem or story: show its level. */
  enter: (id: string) => void;
  /** What is happening inside a group: its most urgent block's state. */
  stateOf: (id: string) => "failed" | "running" | undefined;
}>({ update: () => {}, ungroup: () => {}, enter: () => {}, stateOf: () => undefined });
