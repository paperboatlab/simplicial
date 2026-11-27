// Run › Run settings… (legacy's Solver settings, #196): how the next run goes, on the kit's Dialog with Settings' rows:
// its length, speed and clock step, the solver every block and station object whose own is auto integrates with, and
// that solver's options. A change applies as made, to the next run (speed: to this one too, as the run dock's); the
// flow keeps only what differs from the station's defaults (runSettings.ts), in its file.
import { Dialog, Key, NumberField, SettingRow, SettingsSection } from "@paperboatlab/ui";
import type { RunSettings } from "./protocol.ts";
import { changed, ENGINE, OPTION, READS, SOLVERS, solverOf, solversOf, type Solver, type SolverOption } from "./runSettings.ts";

export const SPEEDS = [0.25, 0.5, 1, 2, 4, 0];
/** A row's hint, and the station's value when the flow's differs. */
const hint = (text: string, mine: number | undefined, its: number | undefined, unit = "") =>
  mine === undefined || its === undefined || mine === its ? text : `${text} (the station's: ${its}${unit})`;

export function RunSettingsDialog({ defaults, value, onChange, onClose, name }: {
  /** The station's (hello.run). */
  defaults: RunSettings;
  /** The flow's own: what differs from `defaults`. */
  value: RunSettings;
  onChange: (v: RunSettings) => void;
  onClose: () => void;
  /** The station's name, beside the title. */
  name?: string;
}) {
  const set = (change: RunSettings) => onChange(changed({ ...value, ...change }, defaults));
  const solver = solverOf(value, defaults);
  const clock = defaults.mode !== "once";
  const duration = value.duration ?? defaults.duration ?? 10, speed = value.speed ?? defaults.speed ?? 1, dt = value.dt ?? defaults.dt ?? ENGINE.dt;
  const opt = (k: SolverOption) => value.solver_options?.[k] ?? defaults.solver_options?.[k] ?? ENGINE[k];
  const setOpt = (k: SolverOption, v: number) => set({ solver_options: { ...value.solver_options, [k]: v } });
  const own = Object.keys(value).length > 0;
  return (
    <Dialog title="Run settings" tags={[name]} className="run-settings" wide onClose={onClose}
      actions={<>
        <span title={own ? "Back to the station's defaults" : "Nothing differs from the station's"}>
          <Key kind="quiet" disabled={!own} onClick={() => onChange({})}>Reset to the station's</Key>
        </span>
        <span className="grow" />
        <Key onClick={onClose}>Close</Key>
      </>}>
      <p className="settings-note">For the next run; the flow keeps what differs from its station in its file.</p>
      {clock && (
        <SettingsSection title="Time">
          <SettingRow label="Length" hint={hint("0 runs until cancelled", value.duration, defaults.duration, " s")}>
            <NumberField className="well" aria-label="Run length, s" value={duration} valid={(v) => v >= 0} onChange={(v) => set({ duration: v })} /><small className="unit">s</small>
          </SettingRow>
          <SettingRow label="Speed" hint={hint("Times real time; during a run it changes the run at once", value.speed, defaults.speed ?? 1, "×")}>
            <select className="well" aria-label="Speed" value={speed} onChange={(e) => set({ speed: Number(e.target.value) })}>
              {SPEEDS.map((x) => <option key={x} value={x}>{x === 0 ? "as fast as it can" : `${x}×`}</option>)}
            </select><small className="unit" />
          </SettingRow>
          <SettingRow label="Clock step" hint={hint("How often blocks run and monitors sample", value.dt, defaults.dt ?? ENGINE.dt, " s")}>
            <NumberField className="well" aria-label="Clock step, s" value={dt} valid={(v) => v > 0} onChange={(v) => set({ dt: v })} /><small className="unit">s</small>
          </SettingRow>
        </SettingsSection>
      )}
      <SettingsSection title="Solver">
        <SettingRow label="Solver" hint={SOLVERS.find(([s]) => s === solver)?.[2]}>
          <select className="well" aria-label="Solver" value={solver} onChange={(e) => set({ solver: e.target.value as Solver })}>
            {solversOf(defaults).map((s) => <option key={s} value={s}>{SOLVERS.find(([x]) => x === s)![1]}</option>)}
          </select><small className="unit" />
        </SettingRow>
        {READS[solver].map((k) => {
          const o = OPTION[k];
          return (
            <SettingRow key={k} label={o.label} hint={hint(`${o.hint}${o.zero ? `; 0: ${o.zero}` : ""}`, value.solver_options?.[k], defaults.solver_options?.[k] ?? ENGINE[k], o.unit ? ` ${o.unit}` : "")}>
              <NumberField className="well" aria-label={o.label} value={opt(k)} valid={o.valid} onChange={(v) => setOpt(k, v)} /><small className="unit">{o.unit}</small>
            </SettingRow>
          );
        })}
        {READS[solver].length === 0 && <p className="settings-note">{SOLVERS.find(([s]) => s === solver)![1]} has no options of its own.</p>}
      </SettingsSection>
    </Dialog>
  );
}
