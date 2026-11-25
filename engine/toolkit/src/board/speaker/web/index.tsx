// The speaker block's instrument: the kit's Speaker, playing each step's PCM vector. The page bundles this file and
// calls register(host).
import type { InstrumentProps, ToolkitWebHost } from "@paperboat/host";
import { SpeakerInstrument } from "@paperboatlab/ui/plot";

function Speaker({ name, latest, state, params }: InstrumentProps) {
  const rate = typeof params?.rate === "number" && params.rate > 0 ? params.rate : undefined;
  const volume = typeof params?.volume === "number" ? params.volume : undefined;
  return <SpeakerInstrument name={name} samples={latest} live={state.run?.status === "running"} rate={rate} volume={volume} />;
}

export function register(host: ToolkitWebHost): void {
  host.registerInstrument("speaker", Speaker, { size: "normal", order: 0 });
}
