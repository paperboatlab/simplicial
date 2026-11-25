// The Board (legacy Board.tsx, redrawn on the kit): a grid of equal cells, one instrument per monitor block on the
// Flow (which decides what exists), each S, M, L or XL. Decorations belong to the layout: sections, separators,
// labels with live values, the Console. Tabs (the panel's head shows them) each have their own grid. Where things
// sit comes from the user's layout (kept per station in the browser), else the station's (`catalog.board`), else
// the automatic order. While Arrange is on: drag an instrument or decoration to a cell (or move it with the arrow
// keys), pick sizes, add and edit decorations and tabs.
import { Console, Key, RemoveKey, Segmented } from "@paperboatlab/ui";
import { Instrument as Frame } from "@paperboatlab/ui/plot";
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import type { EngineState } from "../engine.ts";
import type { BoardLayout, ClientMsg, ParamValue, Variables } from "../protocol.ts";
import {
  CELLS, DEFAULT_COLUMNS, SIZES, SIZE_LABEL, addDecoration, addTab, arrange as arrangeLayout, editDecoration, formatText, freshTabName,
  moveDecoration, moveInstrument, moveToTab, removeDecoration, removeTab, renameTab, resizeDecoration, resizeInstrument, rowsOf, setSettings,
  tabIsEmpty, type Arranged, type DecoKind, type Monitor, type PlacedDeco, type Size,
} from "./boardLayout.ts";
import { instrumentFor, vectorText, type InstrumentProps, type TapPort } from "./host.ts";
import "./toolkits.ts";

const GAP = 12;      // px between cells
const ROW = 116;     // px, one cell's height
const MIN_CELL = 96; // px: a Board too narrow for the layout's columns gets fewer
const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const ADD: [DecoKind, string, string][] = [
  ["section", "Section", "A titled frame round a group of cells"],
  ["label", "Label", "A heading or a note; {block} in it shows that block's value"],
  ["hline", "Rule —", "A horizontal rule between rows"],
  ["vline", "Rule |", "A vertical rule between columns"],
  ["console", "Console", "What the station logged, in a frame"],
];

/** A monitor's value at the replay playhead, else the latest one the run sent. */
function latestOf(state: EngineState, name: string): unknown {
  if (!state.replay?.active) return state.latest[name];
  const values = state.traces.valuesAt(name, state.replay.time);
  const list = values ? Object.values(values) : [];
  return list.length ? list[list.length - 1] : state.latest[name];
}

/** A kind nothing registered (a toolkit whose web part isn't bundled): its kind and raw latest value. */
function Fallback({ name, kind, latest, idle }: InstrumentProps) {
  return (
    <Frame name={name} detail={kind} idle={idle} className="fallback">
      <output>{latest === undefined ? "–" : typeof latest === "object" ? JSON.stringify(latest) : String(latest)}</output>
    </Frame>
  );
}

type Drag = { kind: "instrument"; id: string; dx: number; dy: number } | { kind: "decoration"; id: number; dx: number; dy: number };

/** Text with `{name}` values in it (a monitor's latest, else a variable's), shown live. */
function Formatted({ text, latest, vars }: { text: string; latest: Record<string, unknown>; vars: Record<string, unknown> }) {
  return (
    <>
      {formatText(text, latest, vars).map((p, i) => typeof p === "string" ? p : (
        <output key={i} className={`deco-val${p.value === "–" ? " idle" : ""}`} title={p.shadowed ? `${p.name}: the block (a variable has this name too)` : p.variable ? `${p.name}: a variable` : p.name}>
          {p.value}
        </output>
      ))}
    </>
  );
}

/** Text edited where it stands: Enter or a click away keeps it, Escape drops the change; a value chip may take the focus. */
function EditText({ value, label, onDone, inputRef }: { value: string; label: string; onDone: (v: string | null) => void; inputRef: React.RefObject<HTMLInputElement | null> }) {
  return (
    <input className="deco-edit" autoFocus aria-label={label} defaultValue={value}
      ref={(el) => { inputRef.current = el; if (el && !el.dataset.ready) { el.dataset.ready = "1"; el.select(); } }}
      onBlur={(e) => { if (!(e.relatedTarget as HTMLElement | null)?.closest(".deco-vars")) onDone(e.currentTarget.value); }}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") onDone(e.currentTarget.value); if (e.key === "Escape") onDone(null); }}
      onDoubleClick={(e) => e.stopPropagation()} />
  );
}

export type BoardProps = {
  state: EngineState;
  send: (m: ClientMsg) => void;
  monitors: Record<string, Monitor>;
  /** The layout drawn: the user's, else the station's. */
  layout: BoardLayout | undefined;
  /** The user's own layout exists (Reset layout goes back to the station's). */
  custom: boolean;
  onSave: (next: BoardLayout | undefined) => void;
  arrange: boolean;
  tab: string;
  onTab: (tab: string) => void;
  onBlock: (id: string) => void;
  taps: readonly TapPort[];
  onTap: (monitor: string, id: string) => void;
  /** Room kept at the foot for the run dock floating over the Board. */
  dock?: boolean;
};

export function Board({ state, send, monitors, layout, custom, onSave: commit, arrange, tab: openTab, onTab, onBlock, taps, onTap, dock }: BoardProps) {
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const watch = new ResizeObserver(() => setWidth(el.clientWidth));
    watch.observe(el);
    setWidth(el.clientWidth);
    return () => watch.disconnect();
  }, []);
  const configured = layout?.columns ?? DEFAULT_COLUMNS;
  const columns = width ? Math.max(1, Math.min(configured, Math.floor((width - 2 * 16 + GAP) / (MIN_CELL + GAP)))) : configured;
  const arranged = useMemo(() => arrangeLayout(monitors, layout, columns), [monitors, layout, columns]);
  const { tabs } = arranged;
  const tab = tabs.length === 0 ? "" : tabs.includes(openTab) ? openTab : tabs[0];
  const placed = arranged.instruments.filter((p) => p.tab === tab);
  const decos = arranged.decorations.filter((d) => d.tab === tab && !d.hidden);
  const canEdit = arrange && !arranged.narrowed; // on a narrowed Board the cells are not the layout's
  const rows = rowsOf(arranged, tab) + (canEdit ? 1 : 0);
  const empty = arranged.instruments.length === 0 && arranged.decorations.length === 0;

  // At a replay playhead, labels show the values at that time; live, the latest.
  const latest = useMemo(() => {
    if (!state.replay?.active) return state.latest as Record<string, unknown>;
    const out: Record<string, unknown> = { ...state.latest };
    for (const name of Object.keys(monitors)) out[name] = latestOf(state, name) ?? out[name];
    return out;
  }, [monitors, state]);
  const vars = useMemo(() => varValues(state.variables, state.varValues), [state.variables, state.varValues]);

  const grid = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [dragging, setDragging] = useState<Drag | null>(null);
  const [target, setTarget] = useState<{ col: number; row: number } | null>(null);
  const [picked, setPicked] = useState<number | null>(null);   // the decoration selected
  const [editing, setEditing] = useState<number | null>(null); // the decoration whose text is edited
  const [sizing, setSizing] = useState<{ index: number; w: number; h: number } | null>(null);
  const sizingNow = useRef(sizing);
  const editor = useRef<HTMLInputElement | null>(null);

  const cellAt = (e: { clientX: number; clientY: number }) => {
    const r = grid.current!.getBoundingClientRect();
    const inner = r.width - 32;
    return { col: Math.floor(((e.clientX - r.left - 16) * columns) / (inner + GAP)), row: Math.floor((e.clientY - r.top - 16) / (ROW + GAP)) };
  };
  const sizeOf = (d: Drag) => (d.kind === "instrument" ? placed.find((q) => q.block === d.id) : decos.find((q) => q.index === d.id));
  const landing = (e: { clientX: number; clientY: number }) => {
    const d = drag.current, it = d && sizeOf(d);
    if (!d || !it) return null;
    const c = cellAt(e);
    return { col: Math.min(Math.max(0, c.col - d.dx), columns - it.w), row: Math.max(0, c.row - d.dy) };
  };
  const stop = () => { drag.current = null; setDragging(null); setTarget(null); };
  const moveTo = (d: Drag, col: number, row: number) => commit(d.kind === "instrument" ? moveInstrument(arranged, d.id, col, row) : moveDecoration(arranged, d.id, col, row));
  const startDrag = (e: DragEvent, d: { kind: Drag["kind"]; id: string | number; col: number; row: number }) => {
    const c = cellAt(e);
    drag.current = { kind: d.kind, id: d.id, dx: Math.max(0, c.col - d.col), dy: Math.max(0, c.row - d.row) } as Drag;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(d.id));
    setDragging(drag.current);
  };
  const arrow = (e: KeyboardEvent, d: Drag, at: { col: number; row: number; w: number }) => {
    const step = ARROWS[e.key];
    if (!step || e.target !== e.currentTarget) return;
    e.preventDefault();
    moveTo(d, Math.min(Math.max(0, at.col + step[0]), columns - at.w), Math.max(0, at.row + step[1]));
  };
  const dragged = dragging ? sizeOf(dragging) : undefined;
  const textual = (d: PlacedDeco | undefined) => d !== undefined && (d.kind === "label" || d.kind === "section");
  const decoKey = (e: KeyboardEvent, d: PlacedDeco) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); commit(removeDecoration(arranged, d.index)); setPicked(null); }
    else if (e.key === "Enter" && textual(d)) { e.preventDefault(); setEditing(d.index); }
    else arrow(e, { kind: "decoration", id: d.index, dx: 0, dy: 0 }, d);
  };
  const finishText = (d: PlacedDeco, v: string | null) => {
    setEditing(null);
    if (v !== null && v !== d.text) commit(editDecoration(arranged, d.index, { text: v }));
  };
  const sizePoint = (e: React.PointerEvent, d: PlacedDeco) => {
    const c = cellAt(e);
    sizingNow.current = { index: d.index, w: Math.max(1, c.col - d.col + 1), h: Math.max(1, c.row - d.row + 1) };
    setSizing(sizingNow.current);
  };
  const insertValue = (name: string) => {
    const el = editor.current;
    if (!el) return;
    el.setRangeText(`{${name}}`, el.selectionStart ?? el.value.length, el.selectionEnd ?? el.value.length, "end");
    el.focus();
  };
  const shown = (d: PlacedDeco): PlacedDeco =>
    sizing?.index === d.index ? { ...d, ...(d.kind === "hline" ? { w: sizing.w } : d.kind === "vline" ? { h: sizing.h } : { w: sizing.w, h: sizing.h }) } : d;
  const editingDeco = editing === null ? undefined : arranged.decorations.find((d) => d.index === editing);
  const area = (p: { col: number; row: number; w: number; h: number }): CSSProperties => ({ gridColumn: `${p.col + 1} / span ${p.w}`, gridRow: `${p.row + 1} / span ${p.h}` });

  return (
    <div ref={root} className={`board${dock ? " docked" : ""}`} onClick={() => setPicked(null)}>
      {arrange && (
        <ArrangeBar arranged={arranged} tab={tab} tabs={tabs} canEdit={canEdit} custom={custom} commit={commit} onTab={onTab}
          onAdd={(kind) => { commit(addDecoration(arranged, kind, tab)); setPicked(arranged.decorations.length); }}
          onDrop={(t) => { if (drag.current?.kind === "instrument") commit(moveToTab(arranged, drag.current.id, t)); stop(); }} dragging={dragging?.kind === "instrument"} />
      )}
      {arrange && textual(editingDeco) && (
        <div className="deco-vars" role="group" aria-label="Insert a value">
          <span className="lbl">Value</span>
          {[...Object.keys(monitors), ...state.variables.map((v) => v.name).filter((n) => !(n in monitors))].map((n) => (
            <button key={n} type="button" className={`chip${n in monitors ? "" : " var"}`} title={`Put {${n}} in the text at the caret`} onMouseDown={(e) => e.preventDefault()} onClick={() => insertValue(n)}>{n}</button>
          ))}
        </div>
      )}
      {empty && !arrange && <p className="board-empty">Add a monitor block (a Graph, a Display, a Scope) on the Flow: its instrument shows here, and a run fills it.</p>}
      {(!empty || arrange) && (
        <div ref={grid} className={`board-grid${arrange ? " arranging" : ""}`} style={{ "--cols": columns, "--row": `${ROW}px`, "--gap": `${GAP}px` } as CSSProperties}
          onDragOver={(e) => { if (!drag.current) return; e.preventDefault(); setTarget(landing(e)); }}
          onDrop={(e) => { const at = landing(e); if (at && drag.current) moveTo(drag.current, at.col, at.row); stop(); }}>
          {canEdit && Array.from({ length: rows * columns }, (_, i) => <div key={i} className="slot" style={{ gridColumn: (i % columns) + 1, gridRow: Math.floor(i / columns) + 1 }} />)}
          {target && dragged && <div className="drop" style={area({ ...target, w: dragged.w, h: dragged.h })} />}
          {decos.map((raw) => {
            const d = shown(raw);
            const line = d.kind === "hline" || d.kind === "vline";
            return (
              <div key={d.index} style={area(d)}
                className={`deco deco-${d.kind}${d.kind === "label" ? ` ${d.style}` : ""}${picked === d.index ? " picked" : ""}${dragging?.kind === "decoration" && dragging.id === d.index ? " dragging" : ""}`}
                draggable={canEdit && editing !== d.index && !sizing} tabIndex={canEdit ? 0 : undefined}
                role={line ? "separator" : undefined} aria-orientation={d.kind === "vline" ? "vertical" : d.kind === "hline" ? "horizontal" : undefined}
                onClick={canEdit ? (e) => { e.stopPropagation(); setPicked(d.index); } : undefined}
                onDoubleClick={() => canEdit && textual(d) && setEditing(d.index)}
                onKeyDown={(e) => canEdit && decoKey(e, d)}
                onDragStart={(e) => (sizing ? e.preventDefault() : startDrag(e, { kind: "decoration", id: d.index, col: d.col, row: d.row }))} onDragEnd={stop}>
                {d.kind === "section" && <span className="deco-title">{editing === d.index ? <EditText value={d.text} label="Section title" inputRef={editor} onDone={(v) => finishText(d, v)} /> : <Formatted text={d.text} latest={latest} vars={vars} />}</span>}
                {d.kind === "label" && (editing === d.index ? <EditText value={d.text} label="Label text" inputRef={editor} onDone={(v) => finishText(d, v)} /> : <span><Formatted text={d.text} latest={latest} vars={vars} /></span>)}
                {d.kind === "console" && <div className="deco-frame"><Console logs={state.logs} onBlock={onBlock} /></div>}
                {(d.kind === "station" || d.kind === "controls") && <div className="deco-frame deco-later">{d.kind === "station" ? "The Station's view" : "Variable controls"}: not on the Board in v0.1 yet</div>}
                {canEdit && picked === d.index && (
                  <>
                    <span className="deco-tools" onClick={(e) => e.stopPropagation()}>
                      {d.kind === "label" && (
                        <Segmented label="Label style" value={d.style} onChange={(s) => commit(editDecoration(arranged, d.index, { style: s }))}
                          options={[{ value: "heading", label: "Heading" }, { value: "note", label: "Note" }]} />
                      )}
                      <RemoveKey label="Remove (Delete)" onClick={() => { commit(removeDecoration(arranged, d.index)); setPicked(null); }} />
                    </span>
                    <span className={`deco-grip${line ? ` grip-${d.kind}` : ""}`} title={line ? "Drag to change its length" : "Drag to resize"} draggable={false}
                      onMouseDown={(e) => e.preventDefault()} onClick={(e) => e.stopPropagation()}
                      onPointerDown={(e) => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); sizePoint(e, d); }}
                      onPointerMove={(e) => sizingNow.current && e.buttons && sizePoint(e, d)}
                      onPointerUp={(e) => {
                        const last = sizingNow.current;
                        if (last) commit(resizeDecoration(arranged, d.index, last.w, last.h));
                        sizingNow.current = null;
                        setSizing(null);
                        e.currentTarget.releasePointerCapture(e.pointerId);
                      }} />
                  </>
                )}
              </div>
            );
          })}
          {placed.map((p) => {
            const m = monitors[p.block];
            const value = latestOf(state, p.block);
            const Renderer = instrumentFor(m.kind) ?? Fallback;
            return (
              <div key={p.block} style={area(p)} className={`cell size-${p.size}${dragging?.kind === "instrument" && dragging.id === p.block ? " dragging" : ""}`}
                draggable={canEdit} tabIndex={canEdit ? 0 : undefined} aria-label={canEdit ? `${p.block}: drag or use the arrow keys to move it` : undefined}
                onKeyDown={(e) => canEdit && arrow(e, { kind: "instrument", id: p.block, dx: 0, dy: 0 }, p)}
                onDragStart={(e) => startDrag(e, { kind: "instrument", id: p.block, col: p.col, row: p.row })} onDragEnd={stop}>
                <Renderer name={p.block} kind={m.kind} latest={value} idle={value === undefined} vector={vectorText(value, state.vectorComponents[p.block])}
                  state={state} send={send} params={m.params as Record<string, ParamValue> | undefined} size={p.size} inputs={m.inputs ?? []} sources={m.sources ?? {}}
                  settings={p.settings} onSettings={(next) => commit(setSettings(arranged, p.block, next))} taps={taps} onTap={(id) => onTap(p.block, id)} />
                {canEdit && (
                  <span className="cell-tools" onClick={(e) => e.stopPropagation()}>
                    <Segmented label={`Size of ${p.block}`} value={p.size} onChange={(s: Size) => commit(resizeInstrument(arranged, p.block, s))}
                      options={SIZES.map((s) => ({ value: s, label: SIZE_LABEL[s], hint: `${CELLS[s][0]} × ${CELLS[s][1]} cells` }))} />
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** What a `{name}` in a label reads for a variable: the engine's resolved value, else a plain variable's own. */
export function varValues(list: Variables, values: Record<string, unknown>): Record<string, unknown> {
  return { ...Object.fromEntries(list.filter((v) => !v.expr).map((v) => [v.name, v.value])), ...values };
}

/** Arrange's bar over the grid: what to do, what to add, the open tab's name and the layout's reset. */
function ArrangeBar({ arranged, tab, tabs, canEdit, custom, commit, onTab, onAdd, onDrop, dragging }: {
  arranged: Arranged; tab: string; tabs: string[]; canEdit: boolean; custom: boolean; commit: (l: BoardLayout | undefined) => void;
  onTab: (t: string) => void; onAdd: (k: DecoKind) => void; onDrop: (tab: string) => void; dragging: boolean;
}) {
  const [name, setName] = useState(tab);
  useLayoutEffect(() => setName(tab), [tab]);
  const rename = () => {
    const v = name.trim();
    if (!v || v === tab || tabs.includes(v)) return setName(tab);
    commit(renameTab(arranged, tab, v));
    onTab(v);
  };
  const keys: ReactNode = ADD.map(([kind, text, title]) => (
    <Key key={kind} size="sm" kind="quiet" disabled={!canEdit} title={title} onClick={() => onAdd(kind)}>{text}</Key>
  ));
  return (
    <div className="arrange-bar" onClick={(e) => e.stopPropagation()}>
      <span className="hint">
        {arranged.narrowed ? "The Board is narrower than its layout: widen it to arrange." : "Drag an instrument or decoration to a cell (or focus it and use the arrow keys); double-click text to edit it."}
      </span>
      <span className="group" role="group" aria-label="Add">{keys}</span>
      <span className="group" role="group" aria-label="Tabs">
        {tabs.length > 0 && <>
          <input className="well tab-name" aria-label="This tab's name" value={name} disabled={!canEdit} onChange={(e) => setName(e.target.value)}
            onBlur={rename} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") rename(); if (e.key === "Escape") setName(tab); }} />
          {tabs.filter((t) => t !== tab).map((t) => dragging && (
            <span key={t} className="tab-drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onDrop(t); }}>to {t}</span>
          ))}
          {tabIsEmpty(arranged, tab) && <Key size="sm" kind="quiet" disabled={!canEdit} title="Remove this empty tab" onClick={() => commit(removeTab(arranged, tab))}>Remove tab</Key>}
        </>}
        <Key size="sm" kind="quiet" icon="add" disabled={!canEdit} title="Another page of the Board" onClick={() => {
          const next = freshTabName(tabs.length ? tabs : ["Main"]);
          commit(addTab(arranged, next));
          onTab(next);
        }}>Tab</Key>
      </span>
      <Key size="sm" kind="quiet" disabled={!custom} title={custom ? "Back to the station's layout, or the automatic one" : "This is the station's layout"} onClick={() => commit(undefined)}>Reset layout</Key>
    </div>
  );
}
