// A wire on the Flow canvas: routed square round the blocks (the kit's router, one pass for the canvas), or along
// the bends the user dragged; a step wire 2 px with its arrowhead, an image wire dashed, the selected one 3 px with
// its remove key and its movable segments (the kit's styles and bends). Wires out of one port run as one line and
// branch off it at a dot; Ctrl-drag or right-drag on a wire pulls a new branch out of it.
import { RemoveKey } from "@paperboatlab/ui";
import { middleOf, nearestOnRoute, orthoPoints, roundedPolyline, squareUp, useWireBends, type Point } from "@paperboatlab/ui/canvas";
import { BaseEdge, EdgeLabelRenderer, Position, useReactFlow, type EdgeProps } from "@xyflow/react";
import { useContext, type PointerEvent as ReactPointerEvent } from "react";
import { Branch, CommentedOutContext, HotWire, IconWires, Lit, Lock, SetBends, WireRoutes } from "./flowContexts.ts";
import type { Wire } from "./flowModel.ts";

const sideOf = (p: Position): "left" | "right" | "top" | "bottom" => (p === Position.Left ? "left" : p === Position.Top ? "top" : p === Position.Bottom ? "bottom" : "right");

/** A step wire's arrowhead, a filled triangle just outside its target port: which way control passes. */
function stepArrow(points: readonly Point[]): string | null {
  if (points.length < 2) return null;
  const [a, b] = [points[points.length - 2], points[points.length - 1]];
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const length = Math.hypot(dx, dy) || 1;
  const [ux, uy] = [dx / length, dy / length];
  const [size, half] = [9, 4];
  const [bx, by] = [b[0] - ux * size, b[1] - uy * size];
  return `${b[0]},${b[1]} ${bx - uy * half},${by + ux * half} ${bx + uy * half},${by - ux * half}`;
}

export function WireEdge({ id, data, selected, markerEnd, ...geometry }: EdgeProps<Wire>) {
  const { deleteElements, screenToFlowPosition } = useReactFlow();
  const branch = useContext(Branch);
  const hot = useContext(HotWire) === id;
  const lit = useContext(Lit);
  const follow = lit ? (lit.has(id) ? " lit" : " dim") : "";
  const route = useContext(WireRoutes)?.get(id);
  const commentedOut = useContext(CommentedOutContext);
  const missing = useContext(IconWires).missing;
  const lock = useContext(Lock);
  const look =
    (commentedOut.has(geometry.source) || commentedOut.has(geometry.target) ? " wire-commented" : "") +
    (missing.has(`${geometry.source}:${geometry.sourceHandleId}`) || missing.has(`${geometry.target}:${geometry.targetHandleId}`) ? " wire-missing" : "");

  const setBends = useContext(SetBends);
  // The ports as the router saw them, else as React Flow does.
  const from: Point = route ? route.points[0] : [geometry.sourceX, geometry.sourceY];
  const to: Point = route ? route.points[route.points.length - 1] : [geometry.targetX, geometry.targetY];
  const routed = data?.points
    ? squareUp(from, data.points, to)
    : (route?.points ?? orthoPoints(from, sideOf(geometry.sourcePosition), to, sideOf(geometry.targetPosition)));
  const { points, handles } = useWireBends(routed, !!selected && !!setBends, (bends) => setBends?.(id, bends));
  const dots = route?.branches ?? [];
  const path = roundedPolyline(points, 8, dots);
  // Ctrl-drag or right-drag pulls a branch out of the wire, once the pointer has moved (a Ctrl-click still picks it).
  const grab = (e: ReactPointerEvent) => {
    if (!branch || !(e.ctrlKey || e.metaKey || e.button === 2)) return;
    e.preventDefault(); // no pan, no box
    const down = { x: e.clientX, y: e.clientY };
    const move = (m: PointerEvent) => {
      if (Math.hypot(m.clientX - down.x, m.clientY - down.y) < 4) return;
      off();
      const at = screenToFlowPosition(down);
      branch.start(id, { nodeId: geometry.source, handleId: geometry.sourceHandleId ?? null, type: "source" }, nearestOnRoute(points, [at.x, at.y]));
    };
    const off = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", off);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", off);
  };
  const pulled = branch?.line?.wire === id ? branch.line : null;
  const arrow = data?.type === "step" ? stepArrow(points) : null;
  const [x, y] = route && !data?.points && points === routed ? [route.labelX, route.labelY] : middleOf(points);
  return (
    <>
      {/* Casing: a wider stroke in the canvas colour, so where wires cross, one is seen to pass over the other. */}
      <path d={path} className={`wire-casing${follow}${look}`} />
      <BaseEdge id={id} path={path} markerEnd={markerEnd} className={`wire-${data?.type ?? "signal"}${hot ? " lit" : ""}${follow}${look}`} />
      {arrow && <polygon className={`wire-arrow${follow}${look}`} points={arrow} />}
      {dots.map(([cx, cy]) => <circle key={`${cx},${cy}`} cx={cx} cy={cy} r={3.5} className={`wire-dot${follow}${look}`} />)}
      {/* Where a branch is grabbed: a wide, invisible stroke (nokey: Ctrl here is a branch, not a selection box). */}
      <path d={path} className="wire-hit nokey" data-wire={id} onPointerDown={grab} onContextMenu={(e) => branch && e.preventDefault()} />
      {pulled && <path className="wire-branching" d={roundedPolyline([pulled.from, [pulled.from[0], pulled.to[1]], pulled.to], 8)} />}
      {selected && !lock && (
        <EdgeLabelRenderer>
          <span className="wire-remove nodrag nopan" style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y - 16}px)` }}>
            <RemoveKey label="Delete the wire" onClick={() => void deleteElements({ edges: [{ id }] })} />
          </span>
        </EdgeLabelRenderer>
      )}
      {handles}
    </>
  );
}
