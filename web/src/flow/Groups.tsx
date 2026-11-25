// The group boxes on the Flow canvas (#68; groups.ts says what they are): a subsystem or story from outside is
// one card (the kit's, with the second edge behind it), its ports movable like a block's; a frame is a dashed
// box round its blocks, or one card when collapsed; In and Out are where wires from outside a level come and go.
import { Icon, Key, NumberField, Switch } from "@paperboatlab/ui";
import { BlockCard, PortHandle, usePortLayout, WireDragContext } from "@paperboatlab/ui/canvas";
import { NodeResizer, Position, type NodeProps } from "@xyflow/react";
import { useContext } from "react";
import { GroupActions, Lock } from "./flowContexts.ts";
import { GHOST_IN, GHOST_OUT, SEP, STORY_DEF, type BoundaryNode, type GroupNode } from "./groups.ts";

export function GroupBox(props: NodeProps<GroupNode>) {
  return props.data.kind === "visual" && !props.data.collapsed ? <Frame {...props} /> : <Subsystem {...props} />;
}

/** A frame: a dashed box round its blocks. */
function Frame({ id, data, selected }: NodeProps<GroupNode>) {
  const { update, ungroup } = useContext(GroupActions);
  const lock = useContext(Lock);
  return (
    <div className={`frame${selected ? " selected" : ""}`}>
      <NodeResizer isVisible={!!selected && !lock} minWidth={180} minHeight={100} onResizeEnd={(_, p) => update(id, { size: { w: p.width, h: p.height } })} />
      <div className="frame-head">
        <button type="button" className="frame-toggle nodrag" title="Collapse to one block" aria-label="Collapse" onClick={() => update(id, { collapsed: true })}>
          <Icon name="chevron-down" size={14} />
        </button>
        <input className="frame-label nodrag" aria-label="Frame name" value={data.label} disabled={!!lock} onChange={(e) => update(id, { label: e.target.value })} />
        <span className="frame-kind">frame</span>
        <span title={lock || "Remove the frame; its blocks stay"}><Key size="sm" kind="quiet" className="nodrag" disabled={!!lock} onClick={() => ungroup(id)}>ungroup</Key></span>
      </div>
    </div>
  );
}

/** A subsystem or story from outside, or a collapsed frame: one card, its ports movable like a block's. */
function Subsystem({ id, data, selected }: NodeProps<GroupNode>) {
  const { update, ungroup, enter, stateOf } = useContext(GroupActions);
  const lock = useContext(Lock);
  const story = data.kind === "story";
  const frame = data.kind === "visual";
  const inputs = [...(story ? STORY_DEF.inputs : []), ...(data.ports?.inputs ?? [])];
  const outputs = [...(story ? STORY_DEF.outputs : []), ...(data.ports?.outputs ?? [])];
  const ports = usePortLayout({
    id,
    def: { inputs, outputs },
    sides: data.sides,
    save: (sides) => update(id, { sides }),
    disabled: !!lock,
    name: (p) => data.ports?.names?.[p.id] ?? p.id.replace(SEP, "."),
  });
  const wiring = !!useContext(WireDragContext);
  const empty = inputs.length + outputs.length === 0;
  return (
    <BlockCard
      name={data.label}
      kind="function"
      group={frame ? undefined : story ? "story" : "subsystem"}
      step={story}
      state={stateOf(id)}
      selected={!!selected}
      title={frame ? undefined : "Double-click to open"}
      keys={<>
        {frame
          ? <Key size="sm" kind="quiet" className="nodrag" title="Open the frame round its blocks" onClick={() => update(id, { collapsed: false })}>open</Key>
          : <Key size="sm" kind="quiet" className="nodrag" title="Open: show what is inside (double-click)" onClick={() => enter(id)}>open</Key>}
        <span title={lock || "Ungroup: put its blocks back here"}><Key size="sm" kind="quiet" className="nodrag" disabled={!!lock} onClick={() => ungroup(id)}>ungroup</Key></span>
      </>}
      ports={{
        top: ports.top,
        bottom: ports.bottom,
        rows: <>
          {ports.rows}
          {empty && <p className="group-empty">{frame ? "no wires cross it" : "no ports: add an In or Out block inside"}</p>}
          {/* Always there (React Flow measures them once), shown while a wire is dragged. */}
          {!frame && <>
            <PortHandle type="target" position={Position.Left} id={GHOST_IN} top="calc(100% - 8px)" label="New input" className={`ghost-port${wiring ? " on" : ""}`} />
            <PortHandle type="source" position={Position.Right} id={GHOST_OUT} top="calc(100% - 8px)" label="New output" className={`ghost-port${wiring ? " on" : ""}`} />
          </>}
        </>,
      }}
      params={story && <>
        <label className="param-label" title="How long the story runs when a path arrives (0: once)">seconds</label>
        <span className="param-field">
          <NumberField className="param-well nodrag" aria-label="seconds" disabled={!!lock} value={data.seconds} valid={(v) => v >= 0} onChange={(seconds) => update(id, { seconds })} />
          <span className="unit">s</span>
        </span>
        <label className="param-label" title="Start its blocks afresh each time a path arrives (a story in a loop starts over)">fresh</label>
        <span className="param-field"><Switch label="fresh" checked={data.reset} onChange={(reset) => !lock && update(id, { reset })} /></span>
      </>}
    />
  );
}

/** Where the wires from outside a level come in (In) and leave (Out), at its edges. */
export function Boundary({ data }: NodeProps<BoundaryNode>) {
  const into = data.dir === "in";
  return (
    <div className={`boundary port-${data.type}`} title={into ? `Comes in from ${data.label}, outside` : `Goes out to ${data.label}, outside`}>
      {!into && <PortHandle type="target" position={Position.Left} id={data.handle} />}
      <span className="boundary-tag">{into ? "In" : "Out"}</span>
      <span className="boundary-name">{data.label}</span>
      {into && <PortHandle type="source" position={Position.Right} id={data.handle} />}
    </div>
  );
}
