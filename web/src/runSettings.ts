// A run's settings beside the station's defaults (hello.run), from legacy's SolverDialog and solvers.ts (#196): the
// solvers the engine has, the options each one reads, and what a flow keeps (only what differs from the station's).
// Pure, tested; RunSettingsDialog.tsx draws it.
import type { RunSettings } from "./protocol.ts";

export type Solver = NonNullable<RunSettings["solver"]>;
export type SolverOption = keyof NonNullable<RunSettings["solver_options"]>;

/** Every solver the page knows, in menu order: its name, and what it does. */
export const SOLVERS: [Solver, string, string][] = [
  ["rk4", "RK4", "Fourth order, fixed sub-steps per clock step"],
  ["rk45", "RK45", "Dormand–Prince 4(5): adaptive, steps to meet the tolerances"],
  ["rk2", "RK2", "Heun, second order: cheaper and rougher"],
  ["euler", "Euler", "First order; gains energy on oscillators"],
  ["discrete", "Discrete", "A difference equation per clock step"],
  ["cvode", "CVODE", "SUNDIALS, variable-order BDF for stiff systems"],
  ["ida", "IDA", "SUNDIALS, BDF on the residual x′ − f(x), as for DAEs"],
];

/** The engine's own defaults (solve::Options), for a station that announces none. */
export const ENGINE: Required<NonNullable<RunSettings["solver_options"]>> & { dt: number } = {
  rtol: 1e-6, atol: 1e-9, min_step: 0, max_step: 0, max_steps: 100000, sub_steps: 1, dt: 0.01,
};

const ADAPTIVE: SolverOption[] = ["rtol", "atol", "max_step", "min_step", "max_steps"];
const FIXED: SolverOption[] = ["sub_steps"];
/** The options each solver reads (the clock step is every solver's). */
export const READS: Record<Solver, SolverOption[]> = { rk4: FIXED, rk2: FIXED, euler: FIXED, rk45: ADAPTIVE, cvode: ADAPTIVE, ida: ADAPTIVE, discrete: [] };

/** An option in words: its label, unit, hint, what 0 means, whether it is whole, and which values it takes. */
export const OPTION: Record<SolverOption, { label: string; unit?: string; hint: string; zero?: string; whole?: boolean; valid: (v: number) => boolean }> = {
  rtol: { label: "Relative tolerance", hint: "Error allowed per step, relative to each value", valid: (v) => v > 0 },
  atol: { label: "Absolute tolerance", hint: "Error allowed near zero", valid: (v) => v >= 0 },
  max_step: { label: "Max step", unit: "s", hint: "The largest internal step", zero: "the clock step", valid: (v) => v >= 0 },
  min_step: { label: "Min step", unit: "s", hint: "It gives up below this", zero: "automatic", valid: (v) => v >= 0 },
  max_steps: { label: "Max sub-steps", hint: "Per clock step, before it gives up", whole: true, valid: (v) => Number.isInteger(v) && v >= 1 },
  sub_steps: { label: "Sub-steps", hint: "Internal steps of dt / n per clock step, for blocks with state", whole: true, valid: (v) => Number.isInteger(v) && v >= 1 && v <= 10000 },
};

/** The solvers the station announced (hello.run.solvers), in menu order; all of them when it said nothing. */
export const solversOf = (defaults: RunSettings): Solver[] =>
  SOLVERS.map(([s]) => s).filter((s) => !defaults.solvers || defaults.solvers.includes(s));

/** The solver a run uses: the flow's, else the station's, else the first the engine has. */
export function solverOf(value: RunSettings, defaults: RunSettings): Solver {
  const have = solversOf(defaults);
  const asked = value.solver ?? defaults.solver ?? "rk4";
  return have.includes(asked) ? asked : (have[0] ?? "rk4");
}

/** What a flow keeps: only what differs from the station's defaults (an empty solver_options goes too). */
export function changed(value: RunSettings, defaults: RunSettings): RunSettings {
  const out: RunSettings = {};
  for (const [k, v] of Object.entries(value) as [keyof RunSettings, unknown][]) {
    if (k === "solver_options" || k === "solvers" || v === undefined || v === defaults[k]) continue;
    (out as Record<string, unknown>)[k] = v;
  }
  const given = value.solver_options ?? {}, base = defaults.solver_options ?? {};
  const options = Object.fromEntries(Object.entries(given).filter(([k, v]) => v !== undefined && v !== (base as Record<string, unknown>)[k]));
  if (Object.keys(options).length) out.solver_options = options;
  return out;
}

/** A station's run defaults in words: "10 s · step 0.01 s · 1× · RK4". */
export const runLine = (r: RunSettings) => r.mode === "once" ? "evaluated once" : [
  r.duration === undefined ? "" : r.duration > 0 ? `${r.duration} s` : "until cancelled",
  r.dt === undefined ? "" : `step ${r.dt} s`,
  r.speed === undefined ? "" : r.speed > 0 ? `${r.speed}×` : "as fast as it can",
  SOLVERS.find(([s]) => s === r.solver)?.[1] ?? "",
].filter(Boolean).join(" · ") || "the engine's";
