import { Switch } from "@paperboatlab/ui";
import { Instrument } from "@paperboatlab/ui/plot";
import type { InstrumentProps } from "@paperboat/host";
import { useRef } from "react";

/**
 * A Switch: a control the user flips during a run. It shows only what the engine sends (no local
 * guess), its `initial` state before the first sample, and is inert while no run is going. Toggle
 * mode is the kit's switch; momentary mode a hold key, so the two never share a press.
 */
export function SwitchInstrument({ name, latest, state, send, params }: InstrumentProps) {
  const momentary = params?.mode === "momentary";
  const initialOn = params?.initial === undefined ? true : !!params.initial;
  const live = !!send && state.run?.status === "running";
  const on = live && typeof latest === "number" ? latest > 0.5 : initialOn;
  const held = useRef(false);
  const input = (down: boolean) => send?.({ type: "input", key: name, down });
  // The engine latches a press until its next pass, so a flip is a press and a release.
  const flip = () => { if (live) { input(true); input(false); } };
  const release = () => { if (held.current) { held.current = false; input(false); } };
  return (
    <Instrument name={name} detail={momentary ? "hold" : "switch"} value={on ? "on (1)" : "off (0)"} idle={!live} className="switch-instrument">
      <span className="switch-face" inert={!live} title={live ? undefined : "Flips during a run"}>
        {momentary ? (
          <button type="button" className={`hold${on ? " on" : ""}`} title="Hold to switch on"
            onPointerDown={(e) => { e.stopPropagation(); if (!live) return; e.currentTarget.setPointerCapture(e.pointerId); held.current = true; input(true); }}
            onPointerUp={release} onPointerCancel={release}>
            hold
          </button>
        ) : (
          <>
            <Switch label={`${name}: ${on ? "on" : "off"}`} checked={on} onChange={flip} />
            <b>{on ? "on" : "off"}</b>
          </>
        )}
      </span>
    </Instrument>
  );
}
