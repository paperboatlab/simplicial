import { Instrument } from "@paperboatlab/ui/plot";
import type { Channel, InstrumentProps } from "@paperboat/host";

const W = 300, H = 100;
const fmt = (v: number, digits: number) => v.toFixed(digits).replace("-", "−");

/**
 * A Graph: the glance. One trace (or one per component of a vector), drawn to the screen's edges with no axes,
 * and the latest value at the caption's end; the Scope is the one to study.
 */
export function GraphInstrument({ name, state, idle, inputs, sources }: InstrumentProps) {
  const channels = state.traces.channels(name);
  const source = sources[inputs[0] ?? "in"];
  // x runs from the least x of the samples: time, a list's index, or a point's x.
  let tMin = Infinity, tMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  for (const c of channels)
    for (let i = 0; i < c.buf.n; i++) {
      tMin = Math.min(tMin, c.buf.t[i]);
      tMax = Math.max(tMax, c.buf.t[i]);
      vMin = Math.min(vMin, c.buf.v[i]);
      vMax = Math.max(vMax, c.buf.v[i]);
    }
  const span = vMax - vMin || 1, width = tMax - tMin || 1;
  const points = (c: Channel) => {
    let out = "";
    for (let i = 0; i < c.buf.n; i++) out += `${(((c.buf.t[i] - tMin) / width) * W).toFixed(1)},${(H - 6 - ((c.buf.v[i] - vMin) / span) * (H - 12)).toFixed(1)} `;
    return out;
  };
  const last = channels.map((c) => c.buf.last);
  const unit = channels.length === 1 ? channels[0].unit ?? source?.unit : undefined;
  const value = last[0] === undefined ? (idle ? "–" : undefined)
    : channels.length === 1 ? `${fmt(last[0], 3)}${unit ? ` ${unit}` : ""}`
    : channels.map((c, i) => `${c.label} ${fmt(last[i] ?? NaN, 2)}`).join("  ");
  return (
    <Instrument name={name} detail={source?.label} value={value} idle={idle} className="graph">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        {channels.map((c, i) => (
          <polyline key={c.id} className={`trace trace-${i % 8}`} points={points(c)} fill="none" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
    </Instrument>
  );
}
