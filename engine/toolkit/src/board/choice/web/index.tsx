// The choice block's instrument: the kit's Choice. A pick sends the `input` a Key block sees, tagged with the
// option's index, and the block latches it. The page bundles this file and calls register(host).
import type { InstrumentProps, ToolkitWebHost } from "@paperboat/host";
import { ChoiceInstrument } from "@paperboatlab/ui/plot";
import { useMemo } from "react";

function Choice({ name, latest, state, send, params }: InstrumentProps) {
  const options = useMemo(() => (typeof params?.options === "string" ? params.options : "").split(/[,;\n]/).map((o) => o.trim()).filter(Boolean), [params?.options]);
  const choose = (i: number) => {
    send?.({ type: "input", key: `${name}:${i}`, down: true });
    send?.({ type: "input", key: `${name}:${i}`, down: false });
  };
  return <ChoiceInstrument name={name} options={options} index={typeof latest === "number" ? latest : 0} live={!!send && state.run?.status === "running"} onChoose={choose} />;
}

export function register(host: ToolkitWebHost): void {
  host.registerInstrument("choice", Choice, { size: "normal" });
}
