// The graph block's instrument: the kit's Graph, fed this monitor's traces. The page bundles this file and calls register(host).
import type { InstrumentProps, ToolkitWebHost } from "@paperboat/host";
import { GraphInstrument } from "@paperboatlab/ui/plot";

function Graph({ name, state, idle, inputs, sources }: InstrumentProps) {
  const source = sources[inputs[0] ?? "in"];
  return <GraphInstrument name={name} detail={source?.label} channels={state.traces.channels(name)} unit={source?.unit} idle={idle} />;
}

export function register(host: ToolkitWebHost): void {
  host.registerInstrument("graph", Graph, { resizable: true });
}
