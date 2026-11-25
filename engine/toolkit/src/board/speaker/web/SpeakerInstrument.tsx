import { Instrument } from "@paperboatlab/ui/plot";
import type { InstrumentProps } from "@paperboat/host";
import { useEffect, useRef, useState } from "react";

/**
 * Plays a PCM vector through Web Audio. The station sends one control step's samples per signal
 * message; the instrument queues them back to back. Browsers start an AudioContext suspended, so the
 * screen shows a Sound on key until it is pressed.
 */
export function SpeakerInstrument({ name, latest, state, params }: InstrumentProps) {
  const context = useRef<AudioContext | null>(null);
  const nextTime = useRef(0);
  const [enabled, setEnabled] = useState(false);
  const rate = typeof params?.rate === "number" && params.rate > 0 ? params.rate : 44100;
  const volume = typeof params?.volume === "number" ? params.volume : 0.8;
  const live = state.run?.status === "running";

  useEffect(() => () => { void context.current?.close(); context.current = null; }, []);
  const enable = async () => {
    context.current ??= new AudioContext({ sampleRate: rate });
    await context.current.resume();
    setEnabled(context.current.state === "running");
  };
  useEffect(() => {
    const ctx = context.current;
    if (!ctx || ctx.state !== "running" || !live || !Array.isArray(latest) || latest.length === 0) return;
    const buffer = ctx.createBuffer(1, latest.length, rate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < latest.length; i++) {
      const value = Number(latest[i]);
      channel[i] = Number.isFinite(value) ? Math.max(-1, Math.min(1, value * volume)) : 0;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const now = ctx.currentTime;
    if (nextTime.current < now || nextTime.current > now + 0.5) nextTime.current = now + 0.03;
    source.start(nextTime.current);
    nextTime.current += buffer.duration;
  }, [latest, live, rate, volume]);

  return (
    <Instrument name={name} detail="speaker" value={Array.isArray(latest) ? `${latest.length} samples` : "waiting"} idle={!live} className="speaker-instrument">
      <span className="speaker-face">
        <button type="button" aria-pressed={enabled} onClick={enable}>{enabled ? "Sound on" : "Sound off: press for sound"}</button>
        <span className={`speaker-bars${enabled && live ? " on" : ""}`} aria-hidden="true">
          {Array.from({ length: 18 }, (_, i) => <i key={i} style={{ height: `${30 + ((i * 7) % 10) * 7}%` }} />)}
        </span>
      </span>
    </Instrument>
  );
}
