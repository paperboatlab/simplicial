// The block library (the Flow's Add block key): every block the station offers as a card, its packages in a rail on the
// left (the built-in ones, then installed toolkits; optional toolkits not installed below, with how to install one), a
// search over names, descriptions, ports and params. A card says the block's name, kind, what it does and its ports.
// Click or Enter adds it to the Flow (as quick add does), or drag it onto the canvas (cardDrop.ts plans the drop).
// Arrows move between cards; Esc closes. Quick add (/) stays the fast way at the cursor.
import { Dialog, Icon, Key, Tag } from "@paperboatlab/ui";
import { BlockIcon, Glyph, captionValue } from "@paperboatlab/ui/canvas";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { BlockDef, ParamValue, ToolkitStatus } from "../protocol.ts";
import { BLOCK_DRAG, dragging } from "./cardDrop.ts";
import { findBlocks, groupOf, groupsOf, kindWord } from "./librarySearch.ts";

const title = (g: string) => g[0].toUpperCase() + g.slice(1);
const ports = (b: BlockDef) => `${b.inputs.map((p) => p.id).join(", ") || "–"} → ${b.outputs.map((p) => p.id).join(", ") || "–"}`;

/** The block's plate as the canvas draws it: its icon, else its glyph; a card-only block, its kind's icon. */
function Plate({ def }: { def: BlockDef }) {
  const defaults = Object.fromEntries(def.params.map((p) => [p.id, p.default])) as Record<string, ParamValue>;
  const v = def.view;
  return (
    <span className="lib-plate" aria-hidden="true">
      {v?.icon ? <BlockIcon icon={v.icon} type={def.type} fill={(t) => captionValue(t, defaults)} />
        : v?.glyph ? <Glyph name={captionValue(v.glyph, defaults)} />
        : <Icon name={def.kind === "monitor" ? "a-board" : "a-flow"} />}
    </span>
  );
}

export function BlockLibrary({ blocks, toolkits, used, onAdd, onClose, onToolkits }: {
  /** The palette: the catalog's blocks, linked ones left out. */
  blocks: BlockDef[];
  toolkits: ToolkitStatus[];
  /** How many of each type the Flow has. */
  used: Record<string, number>;
  onAdd: (def: BlockDef) => void;
  onClose: () => void;
  /** Run › Toolkits…, from a toolkit not installed. */
  onToolkits?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");  // "" every package; else one, or "tk:<name>" a toolkit not installed
  const [sel, setSel] = useState(0);
  const grid = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => groupsOf(blocks), [blocks]);
  const absent = toolkits.filter((t) => !t.builtin && !t.installed);
  const found = useMemo(() => findBlocks(blocks, query), [blocks, query]);
  const missing = group.startsWith("tk:") ? absent.find((t) => `tk:${t.name}` === group) : undefined;
  // Every package with no search: a section each; else one list, best matches first.
  const sections: [string | null, BlockDef[]][] = missing ? []
    : group ? [[null, found.filter((b) => groupOf(b) === group)]]
    : query.trim() ? [[null, found]]
    : groups.map((g) => [g, found.filter((b) => groupOf(b) === g)]);
  const flat = sections.flatMap(([, list]) => list);
  const at = Math.min(sel, flat.length - 1);
  useEffect(() => setSel(0), [query, group]);
  useEffect(() => { void grid.current?.querySelector(`[data-i="${at}"]`)?.scrollIntoView({ block: "nearest" }); }, [at]);  // a browser may return a promise: no cleanup

  /** Up or down: the card in the nearest row that way, nearest across. */
  const vertical = (dir: 1 | -1) => {
    const els = [...(grid.current?.querySelectorAll<HTMLElement>("[data-i]") ?? [])];
    const cur = els[at]?.getBoundingClientRect();
    if (!cur) return;
    const cx = cur.left + cur.width / 2;
    let best: [number, number, number] | null = null;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      const dy = Math.round(dir > 0 ? r.top - cur.bottom : cur.top - r.bottom);
      const dx = Math.abs(r.left + r.width / 2 - cx);
      if (dy >= 0 && (!best || dy < best[0] || (dy === best[0] && dx < best[1]))) best = [dy, dx, Number(el.dataset.i)];
    }
    if (best) setSel(best[2]);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLButtonElement && e.key === "Enter") return;  // a package's key takes its own Enter
    const field = e.target instanceof HTMLInputElement ? e.target : null;
    const caret = field?.selectionStart ?? 0;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") vertical(e.key === "ArrowDown" ? 1 : -1);
    else if (e.key === "ArrowRight" && !(field && caret < field.value.length)) setSel(Math.min(at + 1, flat.length - 1));
    else if (e.key === "ArrowLeft" && !(field && caret > 0)) setSel(Math.max(at - 1, 0));
    else if (e.key === "Enter" && flat[at]) onAdd(flat[at]);
    else return;
    e.preventDefault();
  };

  const card = (b: BlockDef, i: number) => (
    <div key={b.type} role="option" aria-selected={i === at} data-i={i} className="lib-card" draggable title={`${b.label} (${b.type}): click to add, or drag onto the canvas`}
      onMouseMove={() => i !== at && setSel(i)} onClick={() => onAdd(b)}
      onDragStart={(e) => {
        dragging.current = b;
        e.dataTransfer.setData(BLOCK_DRAG, b.type);
        e.dataTransfer.effectAllowed = "copy";
        setTimeout(() => document.body.classList.add("lib-dragging"));  // the library lets the pointer through to the canvas (after this event, or the drag is cancelled)
      }}
      onDragEnd={() => {
        const dropped = !dragging.current;  // the canvas's drop takes it (cardDrop.ts)
        dragging.current = null;
        document.body.classList.remove("lib-dragging");
        if (dropped) onClose();
      }}>
      <Plate def={b} />
      <div className="lib-text">
        <div className="lib-name"><b>{b.label}</b><Tag>{kindWord(b)}</Tag></div>
        {b.description && <p>{b.description}</p>}
        <div className="lib-ports"><code title={`Inputs → outputs: ${ports(b)}`}>{ports(b)}</code>{used[b.type] ? <small>{used[b.type]} on the Flow</small> : null}</div>
      </div>
    </div>
  );

  let i = 0;
  return (
    <Dialog title="Block library" tags={[`${blocks.length} blocks`]} className="block-library" onClose={onClose}>
      <div className="lib-body" onKeyDown={onKey}>
        <nav className="lib-nav" aria-label="Packages">
          {["", ...groups].map((g) => (
            <button key={g || "all"} type="button" aria-current={group === g ? "page" : undefined} onClick={() => setGroup(g)}>
              {g ? title(g) : "All"}<small>{g ? found.filter((b) => groupOf(b) === g).length : found.length}</small>
            </button>
          ))}
          {absent.length > 0 && <h3>Not installed</h3>}
          {absent.map((t) => (
            <button key={t.name} type="button" className="absent" aria-current={group === `tk:${t.name}` ? "page" : undefined} onClick={() => setGroup(`tk:${t.name}`)}>
              {title(t.name)}<small>{t.blocks?.length ?? ""}</small>
            </button>
          ))}
        </nav>
        <div className="lib-main">
          <label className="lib-field">
            <Icon name="search" />
            <input autoFocus aria-label="Search blocks" placeholder="Search names, descriptions, ports and params" value={query} onChange={(e) => setQuery(e.target.value)} />
            {query && <small>{flat.length} {flat.length === 1 ? "match" : "matches"}</small>}
          </label>
          <div ref={grid} className="lib-cards" role="listbox" aria-label="Blocks">
            {missing ? (
              <div className="lib-absent">
                <h3>{title(missing.name)} <Tag>not installed</Tag></h3>
                {missing.description && <p>{missing.description}</p>}
                <p>Install it in Toolkits…, or with <code>paperboat toolkit install {missing.name}</code>, then restart the station.</p>
                {onToolkits && <p><Key size="sm" icon="extensions" onClick={onToolkits}>Toolkits…</Key></p>}
                {missing.blocks && <div className="lib-names">{missing.blocks.map((n) => <Tag key={n}>{n}</Tag>)}</div>}
              </div>
            ) : flat.length === 0 ? (
              <p className="lib-empty">{query ? `Nothing matches “${query}”` : "This station offers no blocks here"}</p>
            ) : sections.map(([g, list]) => list.length > 0 && (
              <section key={g ?? "found"}>
                {g && <h3 className="group-label">{title(g)}</h3>}
                <div className="lib-grid">{list.map((b) => card(b, i++))}</div>
              </section>
            ))}
          </div>
          <div className="lib-foot"><span><kbd>↑↓←→</kbd>choose</span><span><kbd>↵</kbd>add to the Flow</span><span>or drag onto the canvas</span><span><kbd>esc</kbd>close</span></div>
        </div>
      </div>
    </Dialog>
  );
}
