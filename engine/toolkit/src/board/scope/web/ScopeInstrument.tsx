/**
 * The Scope as a Board instrument (#37): the toolkit's side of it. It turns a scope monitor's channels into what
 * the kit's Scope shows (each named by the output wired into it), keeps its settings in the Board layout, and
 * hands a tap to the host to wire.
 */
import type { Channel, InstrumentProps } from "@paperboat/host";
import { Scope, type ScopeSettings } from "@paperboatlab/ui/scope";

export function ScopeInstrument({ name, state, settings, onSettings, size, sources, inputs, taps, onTap }: InstrumentProps) {
  // A scalar input reads as its source ("plant.θ"); a vector's components as theirs, prefixed with the
  // source when there is more than one input ("m.y.x").
  const raw = state.traces.channels(name);
  const many = new Set(raw.map((c) => c.id.split(".")[0])).size > 1;
  const channels: Channel[] = raw.map((c) => {
    const [input, ...rest] = c.id.split(".");
    const src = sources[input];
    if (!rest.length) return { ...c, label: src?.label ?? input, unit: c.unit ?? src?.unit };
    const component = rest.join(".");
    return { ...c, label: many ? `${src?.label ?? input}.${component}` : component, unit: c.unit ?? src?.unit };
  });
  const wired = inputs.filter((i) => sources[i]).map((i) => sources[i].label);
  return (
    <Scope name={name} channels={channels} version={state.traceVersion} live={state.run?.status === "running"}
      settings={(settings ?? {}) as ScopeSettings} onSettings={onSettings} small={size === "normal" || size === "compact"}
      placeholder={wired.length ? `${wired.join(" · ")}: waits for a run` : `Wire outputs into ${inputs.join(", ") || "its inputs"}, or + tap`}
      taps={taps} onTap={onTap} />
  );
}
