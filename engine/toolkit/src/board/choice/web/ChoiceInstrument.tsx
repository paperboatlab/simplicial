import { Instrument } from "@paperboatlab/ui/plot";
import type { InstrumentProps } from "@paperboat/host";
import { useMemo } from "react";

/**
 * A pick-one control: one key per option. It sends the same `input` messages a Key block sees, tagged
 * with this node and the option's index; the Choice block latches the index. It shows only what the
 * engine sends, so a Board with no run stays at the descriptor's initial choice.
 */
export function ChoiceInstrument({ name, latest, state, send, params }: InstrumentProps) {
  const options = useMemo(() => (typeof params?.options === "string" ? params.options : "").split(/[,;\n]/).map((o) => o.trim()).filter(Boolean), [params?.options]);
  const live = !!send && state.run?.status === "running";
  const index = typeof latest === "number" ? latest : 0;
  const choose = (i: number) => {
    if (!live) return;
    send?.({ type: "input", key: `${name}:${i}`, down: true });
    send?.({ type: "input", key: `${name}:${i}`, down: false });
  };
  return (
    <Instrument name={name} detail="choice" value={options[Math.max(0, Math.min(index, options.length - 1))] ?? "–"} idle={!live} className="choice-instrument">
      <span className="choice-options" role="radiogroup" aria-label={name} inert={!live}>
        {options.map((o, i) => (
          <button key={o} type="button" role="radio" aria-checked={i === index} onClick={(e) => { e.stopPropagation(); choose(i); }}>{o}</button>
        ))}
      </span>
    </Instrument>
  );
}
