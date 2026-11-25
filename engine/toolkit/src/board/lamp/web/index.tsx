// The lamp block's instrument: the kit's Lamp, lit as the engine decides (lamp.ts reads the block's params).
// The page bundles this file and calls register(host).
import type { InstrumentProps, ToolkitWebHost } from "@paperboat/host";
import { LampInstrument } from "@paperboatlab/ui/plot";
import { lampView } from "./lamp.ts";

function Lamp({ name, latest, params }: InstrumentProps) {
  const v = lampView(latest, params);
  return (
    <LampInstrument name={v.label || name} detail={`${v.condition}${v.latch ? " · latch" : ""}`} on={v.on} word={v.word}
      idle={v.idle} tone={v.tone} title={v.latch ? "Latches: stays on until the run ends" : undefined} />
  );
}

export function register(host: ToolkitWebHost): void {
  host.registerInstrument("lamp", Lamp, { size: "compact", order: 0 });
}
