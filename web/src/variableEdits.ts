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
