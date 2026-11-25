// The Board's host (`@paperboat/host`): what the page hands a toolkit's web part, the instrument registry and
// the props every instrument gets. A toolkit's `web/index.tsx` exports `register(host)`; the build bundles every
// built-in one (scripts/build.ts, `toolkit-web`) and the page calls it once (toolkits.ts). The page names no
// instrument kind: a monitor block's `instrument` picks the renderer, and a kind nothing registered falls back
// to its raw value (Board.tsx).
import type { ComponentType } from "react";
import type { Entity as StageEntity } from "@paperboatlab/ui/stage";
import type { EngineState } from "../engine.ts";
import type { ClientMsg, InstrumentSettings, ParamValue } from "../protocol.ts";
import type { Size } from "./boardLayout.ts";

export type { Channel } from "../traces.ts";
export type { InstrumentSettings, ParamValue } from "../protocol.ts";
export type { Size } from "./boardLayout.ts";

/** An output a monitor can be wired to ("+ tap"): an id the host understands, and what to show. */
export type TapPort = { id: string; label: string; unit?: string };
/** What is wired into each of a monitor's inputs: the output's name ("plant.θ") and unit. */
export type Sources = Record<string, { label: string; unit?: string }>;

/**
 * What every Board instrument gets: its monitor, the latest value and the live engine state
 * (`state.traces` holds the history of every monitor's signals), and the host's services for it:
 * its cell's size, what feeds its inputs, its own saved settings, and wiring a tap in.
 */
export interface InstrumentProps {
  name: string;
  /** The block's `instrument`, e.g. "graph", "display". */
  kind: string;
  latest: unknown;
  /** Nothing received yet: draw the idle frame (dashed), so it can be placed before the first run. */
  idle: boolean;
  /** A vector value as "id: value unit" text, when latest is an array. */
  vector?: string;
  state: EngineState;
  /** The Station's scene as the kit's stage draws it (at the replay playhead when replaying): a 3D view's entities. */
  scene: Record<string, StageEntity>;
  send?: (m: ClientMsg) => void;
  params?: Record<string, ParamValue>;
  /** The size of its cell. */
  size: Size;
  /** The ids of the monitor's inputs, and what is wired into each. */
  inputs: string[];
  sources: Sources;
  /** The instrument's own settings, kept in the Board layout; `onSettings(undefined)` drops them. */
  settings?: InstrumentSettings;
  onSettings?: (next: InstrumentSettings | undefined) => void;
  /** Every block output that carries numbers, and wiring one into this monitor's first free input. */
  taps: readonly TapPort[];
  onTap?: (id: string) => void;
}

export type InstrumentRenderer = ComponentType<InstrumentProps>;

/** What the toolkit that provides an instrument says about its place on the Board. */
export interface InstrumentMeta {
  /** The size it opens at: a readout is a card, a plot is read at a glance, a picture is studied. Default normal. */
  size?: Size;
  /** Where it goes in the automatic order, lowest first (readouts 0, pictures 1, plots 2). Default 2. */
  order?: number;
  /** It may take any span of cells, up to the grid's columns each way: Arrange shows a grip to drag (a plot, a picture). */
  resizable?: boolean;
}

const renderers = new Map<string, { renderer: InstrumentRenderer; meta: InstrumentMeta }>();

/** Render monitors whose block says `instrument = kind` with this component; a later call replaces it. */
export function registerInstrument(kind: string, renderer: InstrumentRenderer, meta: InstrumentMeta = {}): void {
  renderers.set(kind, { renderer, meta });
}

/** What the instrument for `kind` said about its size and order (empty when nothing registered it). */
export const instrumentMeta = (kind: string): InstrumentMeta => renderers.get(kind)?.meta ?? {};

/** The renderer for an instrument kind, or undefined when nothing registered it. */
export const instrumentFor = (kind: string): InstrumentRenderer | undefined => renderers.get(kind)?.renderer;

/** What the page hands a toolkit's `web/index.ts(x)`: the registries it may extend. */
export interface ToolkitWebHost {
  registerInstrument: typeof registerInstrument;
}

export const toolkitWebHost: ToolkitWebHost = { registerInstrument };

/** A vector's components as "x: 1.0000 m, v: 2.0000 m/s", with the labels the station gave them. */
export function vectorText(latest: unknown, components?: { id: string; unit?: string }[]): string | undefined {
  if (!Array.isArray(latest)) return undefined;
  return latest
    .map((v, i) => {
      const c = components?.[i];
      return `${c?.id ?? String(i)}: ${typeof v === "number" ? v.toFixed(4) : String(v)}${c?.unit ? ` ${c.unit}` : ""}`;
    })
    .join(", ");
}
