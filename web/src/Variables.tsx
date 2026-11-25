// The Variables card (rebrand: Julix's `.vrow`, the kit's VariableList): a row per variable, by group, its type line under
// its name and its value at the right. + Variable adds one and opens it; an open row edits its name, type, value or
// formula, unit and tunable, and removes it. A rename follows the variable into other formulas and the Flow's bound
// params. The list is the session's: the page tells the station (variables.set), which checks it and resolves the formulas.
import { Key, NumberField, RemoveKey, Segmented, Switch, VariableGroup, VariableList, VariableRow, typeLine, valueText } from "@paperboatlab/ui";
import { badName, emptyOf } from "@paperboatlab/ui/canvas";
import { useState } from "react";
import type { Variable, Variables as List } from "./protocol.ts";
import { newVariable, withVariable } from "./variableEdits.ts";

const TYPES: Variable["type"][] = ["number", "boolean", "text", "enum", "matrix"];


export function Variables({ list, values, error, locked, onChange, onRename }: {
  list: List;
  /** What the station resolved them to (a formula's value). */
  values: Record<string, unknown>;
  error?: { text: string; at?: string } | null;
  /** A run is going: the list waits for it (a tunable one's value still changes). */
  locked: boolean;
  onChange: (next: List) => void;
  /** A variable renamed: the Flow's params bound to it follow. */
  onRename: (from: string, to: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const groups = new Map<string, List>();
  for (const v of list) groups.set(v.group ?? "", [...(groups.get(v.group ?? "") ?? []), v]);
  const add = () => {
    const v = newVariable(list);
    onChange([...list, v]);
    setOpen(v.name);
  };
  return (
    <>
      <div className="vadd">
        <Key size="sm" kind="quiet" icon="add" disabled={locked} title={locked ? "Wait for the run to end" : "A new variable, to bind to blocks' params"} onClick={add}>Variable</Key>
      </div>
      {!list.length && <p className="vnone">No variables yet: add one, then bind a block's param to it</p>}
      <VariableList>
        {[...groups].map(([g, vs]) => (
          <VariableGroup key={g} title={g || undefined}>
            {vs.map((v) => {
              const shown = v.expr ? values[v.name] : v.value ?? values[v.name];
              return (
                <VariableRow key={v.name} name={v.name} type={typeLine(v)} value={valueText(shown, v.type)} open={open === v.name}
                  off={locked && !v.tunable} why={locked && !v.tunable ? "Not tunable: it changes after the run" : v.note}
                  error={error?.at === v.name ? error.text : undefined} onOpen={() => setOpen(open === v.name ? null : v.name)}>
                  <Editor v={v} list={list} locked={locked && !v.tunable}
                    onChange={(next) => {
                      onChange(withVariable(list, v.name, next));
                      if (next.name !== v.name) { onRename(v.name, next.name); setOpen(next.name); }
                    }}
                    onRemove={() => { onChange(list.filter((x) => x.name !== v.name)); setOpen(null); }} />
                </VariableRow>
              );
            })}
          </VariableGroup>
        ))}
      </VariableList>
      {error && !error.at && <p className="verr">{error.text}</p>}
    </>
  );
}

/** An open row: its name, type, value (or a number's or boolean's formula), unit, tunable; Remove. */
function Editor({ v, list, locked, onChange, onRemove }: { v: Variable; list: List; locked: boolean; onChange: (v: Variable) => void; onRemove: () => void }) {
  const [name, setName] = useState(v.name);
  const nameError = name === v.name ? "" : badName(name, list, v.name);
  const formula = v.expr !== undefined;
  const set = (patch: Partial<Variable>) => onChange({ ...v, ...patch });
  const retype = (type: Variable["type"]) => {
    const { expr: _e, unit: _u, options: _o, tunable: _t, ...rest } = v;
    const options = type === "enum" ? (v.options?.length ? v.options : ["a", "b"]) : undefined;
    onChange({ ...rest, type, value: emptyOf(type, options), ...(options ? { options } : {}) });
  };
  return (
    <div className="vedit" inert={locked}>
      <label>
        <span>name</span>
        <input className="well mono" value={name} aria-invalid={!!nameError} onChange={(e) => setName(e.target.value)}
          onBlur={() => (nameError || name === v.name ? setName(v.name) : set({ name }))}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setName(v.name); e.currentTarget.blur(); } }} />
      </label>
      {nameError && <p className="vedit-why">{nameError}</p>}
      <label>
        <span>type</span>
        <select className="well" value={v.type} onChange={(e) => retype(e.target.value as Variable["type"])}>
          {TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
      </label>
      {(v.type === "number" || v.type === "boolean") && (
        <Segmented label="Value or formula" value={formula ? "formula" : "value"}
          onChange={(m) => (m === "formula" ? set({ expr: String(v.value ?? emptyOf(v.type)), value: undefined, tunable: undefined }) : onChange({ ...v, expr: undefined, value: emptyOf(v.type) }))}
          options={[{ value: "value", label: "value" }, { value: "formula", label: "ƒ formula" }]} />
      )}
      <label>
        <span>{formula ? "ƒ" : "value"}</span>
        {formula ? (
          <input className="well mono" defaultValue={v.expr} key={`f${v.name}`} placeholder="kp / 5" onBlur={(e) => set({ expr: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
        ) : v.type === "number" ? (
          <NumberField className="well mono" value={typeof v.value === "number" ? v.value : 0} onChange={(n) => set({ value: n })} />
        ) : v.type === "boolean" ? (
          <Switch label={`${v.name}: ${v.value ? "on" : "off"}`} checked={!!v.value} onChange={(on) => set({ value: on })} />
        ) : v.type === "enum" ? (
          <select className="well" value={String(v.value ?? "")} onChange={(e) => set({ value: e.target.value })}>
            {(v.options ?? []).map((o) => <option key={o}>{o}</option>)}
          </select>
        ) : (
          <input className="well mono" defaultValue={String(v.value ?? "")} key={`v${v.name}${v.type}`} placeholder={v.type === "matrix" ? "1 0; 0 1" : ""}
            onBlur={(e) => set({ value: e.target.value })} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
        )}
      </label>
      {v.type === "enum" && (
        <label>
          <span>options</span>
          <input className="well mono" defaultValue={(v.options ?? []).join(", ")} key={`o${v.name}`} placeholder="slow, fast"
            onBlur={(e) => {
              const options = e.target.value.split(",").map((o) => o.trim()).filter(Boolean);
              if (options.length) set({ options, value: options.includes(String(v.value)) ? v.value : options[0] });
            }} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
        </label>
      )}
      {v.type === "number" && (
        <label>
          <span>unit</span>
          <input className="well mono" defaultValue={v.unit ?? ""} key={`u${v.name}`} placeholder="m, N, rad"
            onBlur={(e) => set({ unit: e.target.value.trim() || undefined })} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
        </label>
      )}
      <div className="vedit-foot">
        {(v.type === "number" || v.type === "boolean") && !formula && (
          <label className="vedit-check" title="It can change during a run: blocks bound to it take the new value live">
            <input type="checkbox" checked={!!v.tunable} onChange={(e) => set({ tunable: e.target.checked || undefined })} /> tunable
          </label>
        )}
        <span className="grow" />
        <RemoveKey label={`Remove ${v.name}`} onClick={onRemove} />
      </div>
    </div>
  );
}
