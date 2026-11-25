import { Instrument } from "@paperboatlab/ui/plot";
import type { InstrumentProps } from "@paperboat/host";
import { lampView } from "./lamp.ts";

/**
 * A Lamp: lit while its block's condition holds (or, latched, from the first time it did). The
 * engine decides; this shows the latest state as a disc in the accent (or red, for a trip that means
 * danger) and says it in words beside it, so it never relies on colour alone. The caption holds the condition.
 */
export function LampInstrument({ name, latest, params }: InstrumentProps) {
  const v = lampView(latest, params);
  return (
    <Instrument name={v.label || name} detail={`${v.condition}${v.latch ? " · latch" : ""}`} idle={v.idle}
      className={`lamp-instrument${v.on ? " on" : ""} tone-${v.tone}`}>
      <span className="lamp">
        <i aria-hidden="true" />
        <output aria-label={`${name}: ${v.idle ? "no reading yet" : v.word}`} title={v.latch ? "Latches: stays on until the run ends" : undefined}>{v.word}</output>
      </span>
    </Instrument>
  );
}
