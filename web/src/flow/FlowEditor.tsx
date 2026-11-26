// The Flow canvas (React Flow): blocks as the kit's plates and cards, wires routed square, groups and their
// levels, the selection dialog, the canvas tools, the minimap (Navigator) and the empty canvas's hint. The canvas
// state is the app's (App.tsx: it runs it, counts it and undoes it); this fills `controls` with what the menus do.
import { useCanvasHotkeys, CanvasTools, ConnectionLine, CANVAS_GESTURES, SNAP, WireDragContext, type Point } from "@paperboatlab/ui/canvas";
import {
  Background, BackgroundVariant, MiniMap, Panel, ReactFlow, SelectionMode, useNodesInitialized, useReactFlow, useStore, useStoreApi, useUpdateNodeInternals,
  type FitViewOptions, type OnEdgesChange, type OnNodesChange,
} from "@xyflow/react";
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { BlockDef, Connectors } from "../protocol.ts";
import { Block } from "./Block.tsx";
import { flipBlock, rotateBlock } from "./blockEdits.ts";
import { BLOCK_SIZE, useCardDrop, type Hint } from "./cardDrop.ts";
import { Branch, CommentedOutContext, ConnectorsContext, GroupActions, HotWire, IconWires, Lit, Lock, RunStates, SetBends, Vars, WireRoutes } from "./flowContexts.ts";
import { useFlowClipboard } from "./flowClipboard.ts";
import { withBlock } from "./flowGraph.ts";
import { useFlowGroups } from "./flowGroups.ts";
import { arrangeFlowNodes, clearWireBends } from "./flowLayout.ts";
import { useFlowLevels } from "./flowLevels.ts";
import { hasStepPorts, inForm, isBlock, markUses, portType, type BlockNode, type FlowNode, type Wire } from "./flowModel.ts";
import { commentedOutIds, iconWireCounts, nodeGeometry, routeCanvasWires } from "./flowWires.ts";
import { Boundary, GroupBox } from "./Groups.tsx";
import { display, isFrame, isLevel, type GroupData, type GroupNode } from "./groups.ts";
import { useLitWires } from "./litWires.ts";
import { PORT_IN } from "./portBlocks.ts";
import { SelectionDialog } from "./SelectionDialog.tsx";
import { usePortDirections } from "./usePortDirections.ts";
import { useWireDrag } from "./wireDrag.ts";
import { wireRules } from "./wireRules.ts";
import { WireEdge } from "./WireEdge.tsx";

const nodeTypes = { block: Block, frame: GroupBox, boundary: Boundary };
const edgeTypes = { wire: WireEdge };
const NO_CONNECTORS: Connectors = {};

/** What the menus and quick add do on the canvas: the same actions as its keys and the selection dialog. */
export type FlowControls = {
  copy: () => void;
  cut: () => void;
  paste: () => void;
  canPaste: () => boolean;
  selectAll: () => void;
  /** Arrange this level and its contents; false when locked or already arranged. */
  arrange: () => boolean;
  /** A new block at a point on the screen (quick add's spot), on the open level. */
  place: (def: BlockDef, at: { x: number; y: number }) => void;
  fit: () => void;
};

type Props = {
  blocks: BlockDef[];
  connectors?: Connectors;
  nodes: FlowNode[];
  edges: Wire[];
  setNodes: Dispatch<SetStateAction<FlowNode[]>>;
  setEdges: Dispatch<SetStateAction<Wire[]>>;
  onNodesChange: OnNodesChange<FlowNode>;
  onEdgesChange: OnEdgesChange<Wire>;
  /** The Flow is in view: its keys work. */
  active: boolean;
  /** Show the overview map: the Flow page alone in view (Navigator). */
  minimap: boolean;
  /** The subsystem or story open on the canvas (#68); null: the top level. */
  level: string | null;
  setLevel: (level: string | null) => void;
  /** Why the flow can't be edited now (a run); "" while it can. */
  lock: string;
  controls: MutableRefObject<FlowControls | null>;
  /** Quick add at a point on the screen (a double-click on empty canvas). */
  onQuickAdd: (at: { x: number; y: number }) => void;
  /** Room left round the flow when it is fitted (the run dock floats over its foot). */
  fit: FitViewOptions;
};

export function FlowEditor({ blocks, connectors = NO_CONNECTORS, nodes, edges, setNodes, setEdges, onNodesChange, onEdgesChange, active, minimap, level: wanted, setLevel, lock, controls, onQuickAdd, fit }: Props) {
  const states = useContext(RunStates);
  const hoverVar = useContext(Vars).hover;
  // ---- Levels (#68): a subsystem or story opens on the canvas; the way back is the breadcrumb ----
  const { level, go, path } = useFlowLevels(wanted, setLevel, nodes, edges, setNodes, setEdges);
  // Which wires may join which ports, and the type a new one takes.
  const rules = wireRules(nodes, connectors, blocks.some((b) => b.type === PORT_IN));
  const { defOf, isValidConnection } = rules;
  const shown = display(nodes, edges, (node, port, side) => portType(defOf(node), port, side) ?? "signal", level);
  const shownIds = new Set(shown.nodes.filter((n) => !n.hidden).map((n) => n.id));
  const { actions, stateOf, canGroup, canFrame, canStory, group } = useFlowGroups(nodes, edges, blocks, shownIds, setNodes, setEdges);
  const { lit, follow, unlit } = useLitWires(edges);
  const { screenToFlowPosition, deleteElements, fitView } = useReactFlow();

  // ---- Fit once the cards have a size (an early fit measures one card and zooms to the cap), and again
  // when the canvas changes size (another view mode, a drawer opened) ----
  const initialized = useNodesInitialized();
  const fitted = useRef(false);
  useLayoutEffect(() => {
    fitted.current = false; // another level: fit its own contents
  }, [level]);
  useEffect(() => {
    if (!initialized || fitted.current) return;
    fitted.current = true;
    void fitView({ ...fit, duration: 200 });
  }, [initialized, fitView, fit, level]);
  const wrap = useRef<HTMLDivElement>(null);
  const fitRef = useRef(fit);
  fitRef.current = fit;
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    let t = 0;
    let size = "";
    const ro = new ResizeObserver(([e]) => {
      const now = `${Math.round(e.contentRect.width)}x${Math.round(e.contentRect.height)}`;
      if (now === size || !e.contentRect.width) return;
      const first = !size;
      size = now;
      if (first) return;
      window.clearTimeout(t);
      t = window.setTimeout(() => void fitView({ ...fitRef.current, duration: 200 }), 160); // once the slide or the drawer has settled
    });
    ro.observe(el);
    return () => (ro.disconnect(), window.clearTimeout(t));
  }, [fitView]);

  const store = useStoreApi();
  const latest = useRef({ nodes, edges, level });
  latest.current = { nodes, edges, level };
  // One state update makes the whole recursive arrangement one undo step (#103).
  const arrange = (): boolean => {
    if (lock) return false;
    const current = latest.current;
    const next = arrangeFlowNodes(current.nodes, current.edges, current.level, (nodeId, handleId, dir) => {
      const n = store.getState().nodeLookup.get(nodeId);
      const list = dir === "source" ? n?.internals.handleBounds?.source : n?.internals.handleBounds?.target;
      const h = list?.find((x) => (x.id ?? null) === (handleId ?? null));
      return h ? h.y + h.height / 2 : undefined;
    });
    if (next === current.nodes) return false;
    // The blocks moved under the wires: the bends dragged for their old places no longer fit.
    const nextEdges = clearWireBends(current.edges);
    latest.current = { ...current, nodes: next, edges: nextEdges };
    setNodes(next);
    if (nextEdges !== current.edges) setEdges(nextEdges);
    window.setTimeout(() => void fitView({ ...fit, duration: 200, maxZoom: 1.2 }), 30);
    return true;
  };
  // ---- Copy, cut and paste: Ctrl C / X / V on the Flow page, except while typing ----
  const { copied, copySelected, pasteCopied, duplicateSelected } = useFlowClipboard(store, latest, setNodes, setEdges, !lock);

  // ---- Drawing and moving wires; while one is dragged (#52), the port it would join is raised ----
  const { wireDrag, handlers, branch } = useWireDrag(rules, setEdges, store, screenToFlowPosition, actions.addPort);
  const iconWires = useMemo(() => iconWireCounts(nodes, edges), [nodes, edges]);
  usePortDirections(wrap);

  // ---- Several at once: Ctrl-drag on empty canvas draws a box; the dialog acts on it (#54) ----
  const [busy, setBusy] = useState(false); // dragging blocks or the box: the dialog waits
  const pickedNodes = shown.nodes.filter((n) => n.selected && !n.hidden);
  const pickedBlocks = pickedNodes.filter(isBlock);
  const pickedWires = shown.edges.filter((w) => w.selected);
  const pickedFrames = pickedNodes.filter(isFrame);
  const kept = pickedNodes.filter((n) => isBlock(n) && n.data.def.linked).length; // linked blocks aren't deleted
  const many = pickedNodes.length > 0; // a block or group, with or without wires (wires alone have ×)
  const allCommented = pickedBlocks.length > 0 && pickedBlocks.every((b) => b.data.commented);
  // A story is one step of a Step flow: offered where a step block or a story is on the sheet.
  const stepFlow = nodes.some((n) => !n.parentId && (isBlock(n) ? hasStepPorts(inForm(n.data.def, n.data.params)) : n.data.kind === "story"));

  const toggleComment = (mode: "out" | "through" = "out") => {
    if (pickedBlocks.length === 0 || lock) return;
    const shouldComment = !allCommented || (mode === "through" && pickedBlocks.some((b) => b.data.commentMode !== "through"));
    const ids = new Set(pickedBlocks.map((b) => b.id));
    setNodes((ns) => ns.map((n) => (!ids.has(n.id) || !isBlock(n) ? n : { ...n, data: { ...n.data, commented: shouldComment || undefined, commentMode: shouldComment ? mode : undefined } })));
  };

  // The dialog floats above the selection, or below it when the selection is at the top of the canvas.
  const pickedIds = pickedNodes.map((n) => n.id).join(",");
  const roomAbove = useStore((st) => {
    const [, ty, zoom] = st.transform;
    let top = Infinity;
    for (const id of pickedIds ? pickedIds.split(",") : []) {
      const n = st.nodeLookup.get(id);
      if (n) top = Math.min(top, n.internals.positionAbsolute.y * zoom + ty);
    }
    return top > 64;
  });
  const deselect = () => {
    setNodes((ns) => (ns.some((n) => n.selected) ? ns.map((n) => (n.selected ? { ...n, selected: false } : n)) : ns));
    setEdges((ws) => (ws.some((w) => w.selected) ? ws.map((w) => (w.selected ? { ...w, selected: false } : w)) : ws));
  };
  const selectAll = () => {
    setNodes((ns) => ns.map((n) => (shownIds.has(n.id) && !n.selected ? { ...n, selected: true } : n)));
    setEdges((ws) => ws.map((w) => (shownIds.has(w.source) && shownIds.has(w.target) && !w.selected ? { ...w, selected: true } : w)));
  };
  const removePicked = () => {
    if (lock) return;
    void deleteElements({ nodes: pickedNodes.map((n) => ({ id: n.id })), edges: pickedWires.map((w) => ({ id: w.id })) });
  };

  const updateNodeInternals = useUpdateNodeInternals();
  const turn = (edit: (n: BlockNode) => FlowNode) => {
    if (pickedBlocks.length === 0 || lock) return;
    const ids = new Set(pickedBlocks.map((b) => b.id));
    setNodes((ns) => ns.map((n) => (!ids.has(n.id) || !isBlock(n) ? n : edit(n))));
    pickedBlocks.forEach((b) => updateNodeInternals(b.id));
  };
  const [help, setHelp] = useState(false);

  useCanvasHotkeys({
    hasSelection: (many || pickedWires.length > 0) && !lock,
    onRotateCW: () => turn((n) => rotateBlock(n, true)),
    onRotateCCW: () => turn((n) => rotateBlock(n, false)),
    onFlipH: () => turn((n) => flipBlock(n, "x")),
    onFlipV: () => turn((n) => flipBlock(n, "y")),
    onDuplicate: () => void duplicateSelected(),
    onDelete: removePicked,
    onComment: () => toggleComment("out"),
    onBypass: () => toggleComment("through"),
    onSelectAll: selectAll,
    onEscape: () => (help ? setHelp(false) : deselect()),
    onHelp: () => setHelp((h) => !h),
  }, active);

  const place = (def: BlockDef, screen: { x: number; y: number }) => {
    if (lock) return;
    const at = screenToFlowPosition(screen);
    setNodes((ns) => withBlock(ns, def, { x: at.x - BLOCK_SIZE.w / 2, y: at.y - 16 }, level)[0]);
  };
  controls.current = {
    copy: () => void copySelected(false),
    cut: () => void copySelected(true),
    paste: () => void pasteCopied(),
    canPaste: () => copied.current !== null,
    selectAll,
    arrange,
    place,
    fit: () => void fitView({ ...fit, duration: 200 }),
  };
  useEffect(() => () => void (controls.current = null), [controls]);

  // A dragged card: plan what dropping it here would do, show that, and do it on drop.
  const { hint, setHint, onDragOver, onDrop } = useCardDrop(wrap, nodes, edges, level, defOf, setNodes, setEdges, screenToFlowPosition);
  const geometry = useStore((st) => nodeGeometry(st.nodeLookup));
  // `geometry` stands for the lookup, which React Flow changes in place
  const wireRoutes = useMemo(() => routeCanvasWires(store.getState().nodeLookup, shown.edges), [shown.edges, geometry, store]);
  const setBends = useMemo(
    () => (lock ? null : (id: string, bends: Point[]) => setEdges((ws) => ws.map((w) => (w.id === id ? { ...w, data: { type: w.data?.type ?? "signal", ...w.data, points: bends } } : w)))),
    [lock, setEdges],
  );
  const box = wrap.current?.getBoundingClientRect();
  const rel = (x: number, y: number) => ({ x: x - (box?.left ?? 0), y: y - (box?.top ?? 0) });
  const commentedOut = useMemo(() => commentedOutIds(nodes), [nodes]);
  const editable = !lock;

  return (
    <GroupActions.Provider value={{ ...actions, enter: go, stateOf }}>
    <Lock.Provider value={lock}>
    <HotWire.Provider value={hint?.plan.kind === "insert" ? hint.plan.wire.id : null}>
    <Lit.Provider value={lit}>
    <WireRoutes.Provider value={wireRoutes}>
    <SetBends.Provider value={setBends}>
    <Branch.Provider value={lock ? null : branch}>
    <ConnectorsContext.Provider value={connectors}>
    <IconWires.Provider value={iconWires}>
    <CommentedOutContext.Provider value={commentedOut}>
      <div
        className={`flow-canvas${lock ? " locked" : ""}`}
        ref={wrap}
        onMouseOver={follow}
        onMouseLeave={unlit}
        onDoubleClick={(e) => {
          // Empty canvas only: not a block, a wire, a port or a control.
          const t = e.target as Element;
          if (!lock && !t.closest(".react-flow__node, .react-flow__edge, .react-flow__handle, .react-flow__panel, .react-flow__minimap, button, input, select, textarea"))
            onQuickAdd({ x: e.clientX, y: e.clientY });
        }}
        onDragOver={(e) => !lock && onDragOver(e)}
        onDragLeave={(e) => !wrap.current?.contains(e.relatedTarget as globalThis.Node | null) && setHint(null)}
        onDrop={(e) => !lock && onDrop(e)}
      >
        <WireDragContext.Provider value={wireDrag}>
          <ReactFlow
            connectionLineComponent={ConnectionLine}
            nodes={markUses(shown.nodes, nodes, hoverVar)}
            edges={shown.edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            {...(editable ? handlers : {})}
            nodesDraggable={editable}
            nodesConnectable={editable}
            edgesReconnectable={editable}
            isValidConnection={isValidConnection}
            connectionRadius={SNAP.connect}
            reconnectRadius={SNAP.reconnect}
            deleteKeyCode={null} // the canvas's own keys delete (useCanvasHotkeys), once, and not during a run
            multiSelectionKeyCode={["Control", "Meta"]}
            selectionKeyCode={["Control", "Meta"]} // Ctrl-drag on the canvas draws a box…
            selectionMode={SelectionMode.Partial} // …and picks every block it touches; a plain drag pans
            panActivationKeyCode={null} // Space belongs to the station (Key blocks)
            onNodeDoubleClick={(_, n) => isLevel(n as GroupNode) && go(n.id)}
            onNodeDragStart={() => setBusy(true)}
            onNodeDragStop={() => setBusy(false)}
            onSelectionDragStart={() => setBusy(true)}
            onSelectionDragStop={() => setBusy(false)}
            onSelectionStart={() => setBusy(true)}
            onSelectionEnd={() => setBusy(false)}
            zoomOnDoubleClick={false} // double-click is quick add
            minZoom={0.2}
            fitView
            fitViewOptions={fit}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={16} size={1.2} color="var(--dots)" />
            {level && <LevelCrumbs level={level} path={path} go={go} lock={lock} rename={(id, label) => actions.update(id, { label })} />}
            {minimap && (
              <MiniMap
                pannable
                zoomable
                ariaLabel="Overview of the flow: click or drag to move the view"
                // Words, not colours, tell kinds apart: grey blocks, groups as outlines, the accent for running, red for failed.
                nodeColor={(n) => (n.type === "frame" && (n.data as GroupData).kind === "visual" ? "transparent" : states.failed.has(n.id) ? "var(--danger)" : states.active.has(n.id) ? "var(--accent)" : "var(--line-strong)")}
                nodeStrokeColor={(n) => (states.failed.has(n.id) ? "var(--danger)" : states.active.has(n.id) ? "var(--accent)" : "var(--line-strong)")}
                nodeStrokeWidth={2}
                nodeBorderRadius={2}
                maskColor="color-mix(in srgb, var(--surface-sunken) 55%, transparent)"
                maskStrokeColor="var(--line-ink)"
                maskStrokeWidth={1}
              />
            )}
            <CanvasTools gestures={GESTURES} fit={fit} open={help} onOpen={setHelp} />
            <SelectionDialog
              pickedNodes={pickedNodes}
              pickedBlocks={pickedBlocks}
              pickedWires={pickedWires}
              pickedFrames={pickedFrames}
              isVisible={many && !busy}
              roomAbove={roomAbove}
              allCommented={allCommented}
              kept={kept}
              canGroup={canGroup}
              canFrame={canFrame}
              canStory={canStory && stepFlow}
              lock={lock}
              toggleComment={toggleComment}
              removePicked={removePicked}
              group={(kind) => !lock && group(kind)}
              ungroup={(id) => !lock && actions.ungroup(id)}
            />
          </ReactFlow>
        </WireDragContext.Provider>
        {shown.nodes.length === 0 && (
          <p className="canvas-empty"><kbd className="kbd">/</kbd> or double-click to add a block</p>
        )}
        {hint && <DropHint hint={hint} rel={rel} />}
      </div>
    </CommentedOutContext.Provider>
    </IconWires.Provider>
    </ConnectorsContext.Provider>
    </Branch.Provider>
    </SetBends.Provider>
    </WireRoutes.Provider>
    </Lit.Provider>
    </HotWire.Provider>
    </Lock.Provider>
    </GroupActions.Provider>
  );
}

/** Where you are when a subsystem or story is open (#68): click a level to go back up; this one's name is editable. */
function LevelCrumbs({ level, path, go, rename, lock }: { level: string; path: GroupNode[]; go: (to: string | null) => void; rename: (id: string, label: string) => void; lock: string }) {
  return (
    <Panel position="top-left" className="crumbs" aria-label="Where you are: click a level to go back up (Alt ↑ or Esc goes up one)">
      <button type="button" className="crumb" onClick={() => go(null)}>Flow</button>
      {path.map((g) => (
        <span key={g.id} className="crumb-step">
          <span className="crumb-sep">›</span>
          {g.id === level
            ? <input className="crumb-here nodrag" value={g.data.label} disabled={!!lock} size={Math.max(4, g.data.label.length)} aria-label={`Rename this ${g.data.kind}`} onChange={(e) => rename(g.id, e.target.value)} />
            : <button type="button" className="crumb" onClick={() => go(g.id)}>{g.data.label}</button>}
        </span>
      ))}
      <span className="crumb-kind">{path[path.length - 1]?.data.kind}</span>
    </Panel>
  );
}

/** What dropping the dragged card would do: an outline where it goes, or a line to the port it would join. */
function DropHint({ hint, rel }: { hint: Hint; rel: (x: number, y: number) => { x: number; y: number } }) {
  const at = rel(hint.x, hint.y);
  return (
    <div className="drop-hint" aria-live="polite">
      {hint.plan.kind === "place" && <div className="drop-outline" style={{ left: at.x - BLOCK_SIZE.w / 2, top: at.y - 16, width: BLOCK_SIZE.w, height: BLOCK_SIZE.h }} />}
      {hint.plan.kind === "port" && (() => {
        const h = rel(hint.plan.hx, hint.plan.hy);
        return <svg className="drop-wire"><line x1={h.x} y1={h.y} x2={at.x} y2={at.y} /><circle cx={h.x} cy={h.y} r={5} /></svg>;
      })()}
      <span className="drop-label" style={{ left: at.x + 14, top: at.y + 18 }}>{hint.label}</span>
    </div>
  );
}

/** What the canvas does with a pointer and keys (its ? key): every canvas's, then the Flow's own. */
export const GESTURES: [string, string][] = [
  ...CANVAS_GESTURES,
  ["Branch a wire", "`Ctrl`-drag or right-drag it to an input · or drag again from the output"],
  ["Act on a selection", "The dialog above it: comment, group, delete"],
  ["Inspect · edit a block", "Double-click its plate: the card floats over it · `Esc` or a click away closes it"],
  ["Unfold on the canvas", "unfold in the card's head (fold puts the plate back); what it covers moves aside"],
  ["Open a group", "Double-click it · `Alt ↑` or `Esc` comes back"],
  ["A subsystem's ports", "Add an In or Out block inside it · or drop a wire on its dashed + port"],
  ["Help", "`?` shows this list"],
];
