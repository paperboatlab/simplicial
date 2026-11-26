// A block on the Flow canvas, drawn with the kit's faces (@paperboatlab/ui/canvas): everything it shows comes
// from the station's BlockDef. A block with a plate (`view.compact` or an icon) draws as the plate; double-click
// floats its card over it, and the card's unfold key puts the card on the canvas instead (`unfolded`, saved),
// making room for it. Other blocks are always their card. In and Out blocks are the pills of a group's ports.
import { Key } from "@paperboatlab/ui";
import {
  BlockCard, CompactBlock, Glyph, ParamRow, PortHandle, captionValue, iconValid, isRef, rotateIcon, signOf, usePortLayout,
} from "@paperboatlab/ui/canvas";
import { Position, useReactFlow, useStore, useUpdateNodeInternals, type NodeProps } from "@xyflow/react";
import { useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { runWord } from "../engine.ts";
import type { ParamDef, ParamValue } from "../protocol.ts";
import { ConnectorsContext, IconWires, Lock, OnBlocks, RunStates, Vars } from "./flowContexts.ts";
import { makeRoom, type Rect } from "./flowLayout.ts";
import { hasStepPorts, inForm, type BlockNode, type Wire } from "./flowModel.ts";
import { isPortType, OUTER, PORT_IN, portBlocksOf } from "./portBlocks.ts";

/** A card's head: what it sits above its port body, so a plate's ports line up with the card's. */
const HEAD = 28;
const nodeEl = (id: string) => document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"]`);
const fmt = (v: unknown) => (typeof v === "number" ? String(Number(v.toPrecision(4))).replace("-", "−") : v === undefined ? undefined : String(v));

export function Block(props: NodeProps<BlockNode>) {
  return isPortType(props.data.def.type) ? <PortPill {...props} /> : <BlockFace {...props} />;
}

function BlockFace({ id, data, selected }: NodeProps<BlockNode>) {
  const { updateNodeData, setNodes, getNode } = useReactFlow<BlockNode, Wire>();
  const states = useContext(RunStates);
  const lock = useContext(Lock);
  const vars = useContext(Vars);
  const { params, missing, commented, commentMode, comment, unfolded } = data;
  const def = inForm(data.def, params);
  const word = runWord(states, id);
  const connectors = useContext(ConnectorsContext);
  const iconWires = useContext(IconWires);
  const on = useContext(OnBlocks).has(id);
  const [noteOpen, setNoteOpen] = useState(false);
  const [bound, setBound] = useState<string | null>(null); // the param whose binding is shown
  // Ports that follow a param come and go: have the canvas measure the handles again.
  const updateInternals = useUpdateNodeInternals();
  const portKey = [...def.inputs, ...def.outputs].map((p) => p.id).join(",");
  useEffect(() => updateInternals(id), [portKey, id, updateInternals, data.rotation, data.mirror, data.ports, unfolded]);
  const hasPlate = (!!def.view?.compact || iconValid(def.view?.icon)) && !missing && !hasStepPorts(def);
  const plate = hasPlate && !unfolded;
  const ports = usePortLayout({
    id,
    def,
    sides: data.ports,
    save: (ports) => updateNodeData(id, { ports }),
    disabled: missing || !!lock,
    sign: (p, dir) => (dir === "in" ? signOf(def, params, def.inputs.indexOf(p)) : ""),
    handles: !plate, // a floating card's ports are the plate's dots under it
  });
  const setParam = (param: string, v: ParamValue) => updateNodeData(id, { params: { ...params, [param]: v } });

  // Unfold on the canvas: the card's port body takes the plate's place (its head above), then
  // what it grew over moves aside. Fold: the plate back where the card's body was.
  const moved = useRef<Rect | "fold" | null>(null);
  const move = (dx: number, dy: number, change: Partial<BlockNode["data"]> = {}) =>
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy }, data: { ...n.data, ...change } } : n)));
  const toggleUnfold = () => {
    const node = getNode(id);
    if (!node) return;
    if (unfolded) {
      moved.current = "fold";
      move(0, HEAD, { unfolded: undefined });
      return;
    }
    const p = nodeEl(id)?.querySelector<HTMLElement>(".plate");
    const was = { x: node.position.x + (p?.offsetLeft ?? 0), y: node.position.y + (p?.offsetTop ?? 0), w: p?.offsetWidth ?? 64, h: p?.offsetHeight ?? 56 };
    moved.current = was;
    move(was.x - node.position.x, was.y - node.position.y - HEAD, { unfolded: true });
  };
  useLayoutEffect(() => {
    const was = moved.current;
    moved.current = null;
    const el = nodeEl(id);
    if (!was || !el) return;
    if (was === "fold") {
      const off = el.querySelector<HTMLElement>(".plate")?.offsetLeft ?? 0; // a caption wider than the plate centres it
      if (off) move(-off, 0);
    } else setNodes((ns) => makeRoom(ns, id, was, { x: was.x, y: was.y - HEAD, w: el.offsetWidth, h: el.offsetHeight }) as BlockNode[]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unfolded]);

  // A bound param's chip: the variable's value after it; a click shows the binding (Show it, or Unbind).
  const valueOf = (v: ParamValue | undefined) => {
    if (!isRef(v)) return undefined;
    const name = "var" in v ? v.var : /^\w+$/.test(v.expr.trim()) ? v.expr.trim() : "";
    return fmt(vars.values[name] ?? vars.list.find((x) => x.name === name)?.value);
  };
  const unbind = (p: ParamDef) => {
    const now = Number(valueOf(params[p.id])?.replace("−", "-"));
    setParam(p.id, p.type === "number" && Number.isFinite(now) ? now : p.default);
    setBound(null);
  };
  const boundParam = def.params.find((p) => p.id === bound && isRef(params[p.id]));
  const boundRef = boundParam && params[boundParam.id];
  const under = (noteOpen || boundParam) && (
    <>
      {boundParam && isRef(boundRef) && (
        <div className="binding">
          <span>{boundParam.id} = {"var" in boundRef ? <b>{boundRef.var}</b> : <b>ƒ {boundRef.expr}</b>}</span>
          {"var" in boundRef && <Key size="sm" kind="quiet" onClick={() => vars.show(boundRef.var)}>Show</Key>}
          <span title={lock || "Keep its value here, not the variable's"}><Key size="sm" kind="quiet" disabled={!!lock} onClick={() => unbind(boundParam)}>Unbind</Key></span>
        </div>
      )}
      {noteOpen && (
        <textarea aria-label={`Note on ${def.label}`} placeholder="Notes or formulas…" autoFocus value={comment ?? ""} readOnly={!!lock} title={lock || undefined}
          onChange={(e) => updateNodeData(id, { comment: e.target.value || undefined })} />
      )}
    </>
  );

  const card = (
    <BlockCard
      name={missing ? def.type : def.label}
      kind={def.kind}
      state={missing ? "missing" : word}
      commented={commented ? (commentMode === "through" ? "through" : "out") : undefined}
      linked={def.linked}
      linkedId={def.linked ? id : undefined}
      step={hasStepPorts(def)}
      selected={!!selected && !plate}
      note={comment}
      onNote={() => setNoteOpen((o) => !o)}
      fold={hasPlate ? (unfolded ? "fold" : "unfold") : undefined}
      onFold={toggleUnfold}
      under={under || undefined}
      title={missing ? `This station has no "${def.type}" block: its params and wires are kept. Replace or delete it.` : def.linked ? `Linked to station object ${id}: set its properties, or remove it, on the Station` : undefined}
      glyph={def.view?.glyph && !def.view.icon ? <Glyph name={captionValue(def.view.glyph, params)} /> : undefined}
      ports={ports}
      params={def.params.length > 0 && def.params.map((p) => (
        <ParamRow key={p.id} def={p} value={params[p.id]} disabled={missing || !!lock} computed={valueOf(params[p.id])} vars={vars.hints}
          onChange={(v) => setParam(p.id, v)} onBound={() => setBound((b) => (b === p.id ? null : p.id))} />
      ))}
    />
  );
  if (!plate) return card;
  const placedIcon = (data.rotation || data.mirror) && def.view?.icon ? rotateIcon(def.view.icon, { rotation: data.rotation, mirror: data.mirror }) : def.view?.icon;
  return (
    <CompactBlock
      id={id}
      def={placedIcon ? { ...def, view: { ...def.view, icon: placedIcon } } : def}
      sides={data.ports}
      params={params}
      selected={!!selected}
      commented={commented}
      word={word}
      card={card}
      connectors={connectors}
      wires={iconWires.count.get(id)}
      live={on}
    />
  );
}

/**
 * An In or Out block, drawn as the pill a subsystem's port is inside it: `In 2`, its number among
 * its group's Ins top to bottom (the port it is on the group's block), then its name if it has
 * one. Double-click the pill to name it; Enter keeps, Escape cancels, empty goes back to `In 2`.
 */
function PortPill({ id, data, selected }: NodeProps<BlockNode>) {
  const { updateNodeData } = useReactFlow<BlockNode, Wire>();
  const lock = useContext(Lock);
  const into = data.def.type === PORT_IN;
  const name = String(data.params.name ?? "").trim();
  // Its number among the In (or Out) blocks beside it: re-read only when that number changes.
  const index = useStore((s) => {
    const me = s.nodeLookup.get(id);
    const kin = [...s.nodeLookup.values()].filter((n) => n.parentId === me?.parentId && (n.data as BlockNode["data"]).def?.type === data.def.type);
    return portBlocksOf(kin).find((p) => p.node.id === id)?.index ?? 1;
  });
  const [editing, setEditing] = useState(false);
  const cancel = useRef(false);
  const tag = `${into ? "In" : "Out"} ${index}`;
  return (
    <div
      className={`port-pill ${into ? "in" : "out"}${selected ? " selected" : ""}`}
      title={`${into ? "Input" : "Output"} ${index} of the group${name ? `: ${name}` : ""}. ${lock || "Double-click to name it"}`}
      onDoubleClick={(e) => (e.stopPropagation(), !lock && setEditing(true))}
    >
      {/* The port facing outside the group is the group's own: there, not drawn here. */}
      <PortHandle type={into ? "target" : "source"} position={into ? Position.Left : Position.Right} id={OUTER} className="outer" />
      {!into && <PortHandle type="target" position={Position.Left} id="u" />}
      <span className="port-pill-tag">{tag}</span>
      {editing ? (
        <input
          className="port-pill-name nodrag"
          autoFocus
          defaultValue={name}
          placeholder="name"
          aria-label={`Name of ${tag}`}
          size={Math.max(4, name.length)}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") (cancel.current = true), e.currentTarget.blur();
          }}
          onBlur={(e) => {
            setEditing(false);
            if (!cancel.current) updateNodeData(id, { params: { ...data.params, name: e.currentTarget.value.trim() } });
            cancel.current = false;
          }}
        />
      ) : (
        name && <span className="port-pill-name">{name}</span>
      )}
      {into && <PortHandle type="source" position={Position.Right} id="y" />}
    </div>
  );
}
