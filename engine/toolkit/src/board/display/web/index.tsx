// The display block's instrument: the kit's Display, with the wired output's name and unit. The page bundles this
// file and calls register(host).
import type { InstrumentProps, ToolkitWebHost } from "@paperboat/host";
import { DisplayInstrument } from "@paperboatlab/ui/plot";

function Display({ name, latest, vector, idle, size, inputs, sources }: InstrumentProps) {
  const source = sources[inputs[0] ?? "in"];
  return <DisplayInstrument name={name} detail={source?.label} unit={source?.unit} latest={latest} vector={vector} idle={idle} size={size} />;
}

export function register(host: ToolkitWebHost): void {
  host.registerInstrument("display", Display, { size: "compact", order: 0 });
}
