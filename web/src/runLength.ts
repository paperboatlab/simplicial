// A run's length in the dock: seconds, or ∞ (0, the engine's "until cancelled").
/** A run length as the dock shows it: ∞ for 0 (runs until cancelled). */
export const lengthText = (d: number) => (d === 0 ? "∞" : String(d));
/** A typed run length: seconds, or ∞ / inf for no end (0). undefined when it isn't one. */
export function parseLength(text: string): number | undefined {
  const t = text.trim();
  if (/^(∞|inf(inity)?)$/i.test(t)) return 0;
  const d = Number(t);
  return t && Number.isFinite(d) && d >= 0 ? d : undefined;
}

