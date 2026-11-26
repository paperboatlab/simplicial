// What editing the Variables card does to the list (Variables.tsx): pure, so it is tested.
import { freeName, renameInFormula } from "@paperboatlab/ui/canvas";
import type { Variable, Variables } from "./protocol.ts";

export { renameRef } from "@paperboatlab/ui/canvas";

/** A list with one variable changed: a rename also rewrites the formulas that use it. */
export function withVariable(list: Variables, name: string, next: Variable): Variables {
  return list.map((v) => (v.name === name ? next : next.name !== name && v.expr ? { ...v, expr: renameInFormula(v.expr, name, next.name) } : v));
}

/** A new number variable, named so no other one has its name. */
export const newVariable = (list: Variables): Variable => ({ name: freeName("x", list), type: "number", value: 0 });

/** Another app's live variables (Julix's session) under the flow's own, as Simulink takes the base workspace under the
 *  model's: a name the flow has is the flow's, so the live one is `shadowed` (greyed in the card, never used). */
export function liveRows(own: Variables, live: Variables): { v: Variable; shadowed: boolean }[] {
  const mine = new Set(own.map((v) => v.name));
  return live.map((v) => ({ v, shadowed: mine.has(v.name) }));
}

/** What a param can be bound to: the flow's variables, then the live ones they don't hide and that carry a value. */
export function bindable(own: Variables, live: Variables): Variables {
  return [...own, ...liveRows(own, live).filter(({ v, shadowed }) => !shadowed && v.value !== undefined).map(({ v }) => v)];
}

/** The app a live source names ("julix" → "Julix"). */
export const sourceLabel = (source: string) => (source ? source[0].toUpperCase() + source.slice(1) : "another app");
