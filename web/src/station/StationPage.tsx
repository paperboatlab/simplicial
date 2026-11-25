// The Station page's body (M4, #5; mockup: agent-docs rebrand/apps/simplicial): the 3D view on the kit's stage, a click
// picks the object a part belongs to and its properties float over the view's corner; the Graph view shows the objects
// and joints as the kit's cards with their link slots as ports, a wire from an object's body fills a slot. Props, links
// and places are edited here and sent to the station (`station.set`). A linked object's block is on the Flow.
import { Key } from "@paperboatlab/ui";
import { BlockCard, ParamRow, PortHandle } from "@paperboatlab/ui/canvas";
import { SceneView, type Entity, type View } from "@paperboatlab/ui/stage";
import {
  Background, Position, ReactFlow, ReactFlowProvider, applyNodeChanges, type Connection, type Edge, type Node, type NodeChange, type NodeProps,
} from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";
import type { ObjectDef, ParamValue, Station, StationObject } from "../protocol.ts";
import { entitiesOf, graphPos, objectOfEntity, propValue, setLink, setPos, setProp } from "./stationEdits.ts";

type Props = {
  station: Station | null;
  defs: ObjectDef[];
  scene: Record<string, Entity>;
  view: View;
  grid: boolean;
  mode: "3d" | "graph";
  /** A run is going: what it shows can't be edited. */
  locked: boolean;
  onChange: (next: Station) => void;
  /** Show a linked object's block on the Flow. */
  onBlock: (id: string) => void;
};

export function StationPage({ station, defs, scene, view, grid, mode, locked, onChange, onBlock }: Props) {
  const [picked, setPicked] = useState<string | null>(null);
  const defOf = (o: StationObject) => defs.find((d) => d.type === o.type);
  const object = station?.objects.find((o) => o.id === picked);
  const ids = useMemo(() => Object.keys(scene), [scene]);
  return (
    <div className="station-body">
      {mode === "3d" ? (
        <>
          {/* the stage's camera is placed from the view at mount: a new view remounts it */}
          <SceneView key={JSON.stringify(view)} view={view} grid={grid} entities={scene}
            onPick={(e) => setPicked(objectOfEntity(e, station))} selected={entitiesOf(picked, ids)} />
          {object && station && (
            <Properties object={object} def={defOf(object)} station={station} locked={locked} onChange={onChange} onBlock={onBlock} onClose={() => setPicked(null)} />
          )}
        </>
      ) : station && station.objects.length > 0 ? (
        <ReactFlowProvider>
          <ObjectGraph station={station} defs={defs} picked={picked} onPick={setPicked} locked={locked} onChange={onChange} />
        </ReactFlowProvider>
      ) : <p className="page-later">No station objects: this station draws its scene from code</p>}
    </div>
  );
}

/** The picked object's properties, floating over the 3D view's corner (they step aside when the view is narrow). */
function Properties({ object, def, station, locked, onChange, onBlock, onClose }: {
  object: StationObject; def?: ObjectDef; station: Station; locked: boolean;
  onChange: (s: Station) => void; onBlock: (id: string) => void; onClose: () => void;
}) {
  return (
    <div className="fprops" role="dialog" aria-label={`${def?.label ?? object.type} ${object.id}`}>
      <div className="fh">
        <b>{def?.label ?? object.type}</b><span className="fid">{object.id}</span>
        <span className="block-tag">{def?.role === "joint" ? "joint" : def ? "object" : "missing"}</span>
        <button type="button" className="fclose" aria-label="Close" title="Close (click the empty scene)" onClick={onClose}>×</button>
      </div>
      <div className="block-params">
        {(def?.props ?? []).map((p) => (
          <ParamRow key={p.id} def={p} value={propValue(object, def, p.id)} disabled={locked} onChange={(v) => onChange(setProp(station, object.id, p.id, v))} />
        ))}
        {(def?.links ?? []).map((slot) => (
          <label key={slot} className="flink">
            <span>{slot}</span>
            <select className="well" value={object.links?.[slot] ?? ""} disabled={locked} onChange={(e) => onChange(setLink(station, object.id, slot, e.target.value || null))}>
              <option value="">none</option>
              {station.objects.filter((o) => o.id !== object.id).map((o) => <option key={o.id}>{o.id}</option>)}
            </select>
          </label>
        ))}
      </div>
      {def?.block && (
        <div className="ffoot">
          <span>Its block on the Flow: <code>{object.id}</code></span>
          <Key size="sm" kind="quiet" icon="go" onClick={() => onBlock(object.id)}>Show</Key>
        </div>
      )}
    </div>
  );
}

type ObjectData = { object: StationObject; def?: ObjectDef; locked: boolean; onProp: (prop: string, v: ParamValue) => void };
type ObjectNode = Node<ObjectData, "object">;

/** An object or joint as the kit's card: its link slots on the left, its body (what fills another's slot) on the right. */
function ObjectCard({ data, selected }: NodeProps<ObjectNode>) {
  const { object, def, locked, onProp } = data;
  const slots = def?.links ?? [];
  const rows = Math.max(slots.length, 1);
  return (
    <BlockCard name={def?.label ?? object.type} linkedId={def?.block ? object.id : undefined} selected={selected}
      kind={object.type} object={def?.role === "joint" ? "joint" : "object"} state={def ? undefined : "missing"}
      ports={{
        rows: Array.from({ length: rows }, (_, i) => (
          <div key={i} className="port-row">
            {slots[i] ? <div className="port in side-left port-link nodrag">{slots[i]}<PortHandle type="target" position={Position.Left} id={slots[i]} /></div> : <span />}
            {i === 0 ? <div className="port out side-right port-link nodrag">body<PortHandle type="source" position={Position.Right} id="body" /></div> : <span />}
          </div>
        )),
      }}
      params={def?.props.length ? def.props.map((p) => (
        <ParamRow key={p.id} def={p} value={propValue(object, def, p.id)} disabled={locked} onChange={(v) => onProp(p.id, v)} />
      )) : undefined} />
  );
}
const NODE_TYPES = { object: ObjectCard };

function ObjectGraph({ station, defs, picked, onPick, locked, onChange }: {
  station: Station; defs: ObjectDef[]; picked: string | null; onPick: (id: string | null) => void; locked: boolean; onChange: (s: Station) => void;
}) {
  const fromStation = () => station.objects.map((o, i): ObjectNode => ({
    id: o.id, type: "object", position: graphPos(o, i), selected: o.id === picked,
    data: { object: o, def: defs.find((d) => d.type === o.type), locked, onProp: (prop, v) => onChange(setProp(station, o.id, prop, v)) },
  }));
  const [nodes, setNodes] = useState<ObjectNode[]>(fromStation);
  useEffect(() => setNodes(fromStation()), [station, defs, picked, locked]); // eslint-disable-line react-hooks/exhaustive-deps
  // A filled slot is a wire from the object filling it (its body) to the slot.
  const edges: Edge[] = station.objects.flatMap((o) => Object.entries(o.links ?? {}).map(([slot, from]) => ({
    id: `${from}>${o.id}.${slot}`, source: from, sourceHandle: "body", target: o.id, targetHandle: slot,
  })));
  const connect = (c: Connection) => { if (c.source && c.target && c.targetHandle && c.source !== c.target) onChange(setLink(station, c.target, c.targetHandle, c.source)); };
  return (
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={NODE_TYPES} fitView fitViewOptions={{ maxZoom: 1, padding: 0.3 }} minZoom={0.3} maxZoom={1.6} proOptions={{ hideAttribution: true }}
        nodesDraggable={!locked} nodesConnectable={!locked} edgesFocusable={!locked}
        onNodesChange={(changes: NodeChange<ObjectNode>[]) => setNodes((ns) => applyNodeChanges(changes, ns))}
        onNodeDragStop={(_, n) => onChange(setPos(station, n.id, [n.position.x, n.position.y]))}
        onNodeClick={(_, n) => onPick(n.id)} onPaneClick={() => onPick(null)} onConnect={connect}
        onEdgesDelete={(gone) => { let s = station; for (const e of gone) if (e.targetHandle) s = setLink(s, e.target, e.targetHandle, null); onChange(s); }}>
        <Background gap={16} size={1} />
      </ReactFlow>
  );
}
