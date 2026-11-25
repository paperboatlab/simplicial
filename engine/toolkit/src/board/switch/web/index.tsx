// The switch block's instrument: the kit's Switch, sending the same `input` a Key block sees. It shows only what
// the engine latched, its `initial` state before a run. The page bundles this file and calls register(host).
import type { InstrumentProps, ToolkitWebHost } from "@paperboat/host";
import { SwitchInstrument } from "@paperboatlab/ui/plot";

function Switch({ name, latest, state, send, params }: InstrumentProps) {
  const live = !!send && state.run?.status === "running";
  const initialOn = params?.initial === undefined ? true : !!params.initial;
  const on = live && typeof latest === "number" ? latest > 0.5 : initialOn;
  // The engine latches a press until its next pass, so the kit sends a flip as a press and a release.
  return <SwitchInstrument name={name} on={on} live={live} momentary={params?.mode === "momentary"} onInput={(down) => send?.({ type: "input", key: name, down })} />;
}

export function register(host: ToolkitWebHost): void {
  host.registerInstrument("switch", Switch, { size: "compact" });
}
