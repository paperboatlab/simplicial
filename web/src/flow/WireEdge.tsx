// A wire on the Flow canvas: routed square round the blocks (the kit's router, one pass for the canvas), or along
// the bends the user dragged; a step wire 2 px with its arrowhead, an image wire dashed, the selected one 3 px with
// its remove key and its movable segments (the kit's styles and bends).
import { RemoveKey } from "@paperboatlab/ui";
import { middleOf, orthoPoints, roundedPolyline, squareUp, useWireBends, type Point } from "@paperboatlab/ui/canvas";
import { BaseEdge, EdgeLabelRenderer, Position, useReactFlow, type EdgeProps } from "@xyflow/react";
import { useContext } from "react";
import { CommentedOutContext, HotWire, IconWires, Lit, Lock, SetBends, WireRoutes } from "./flowContexts.ts";
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
  const { deleteElements } = useReactFlow();
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
  const path = roundedPolyline(points, 8);
  const arrow = data?.type === "step" ? stepArrow(points) : null;
  const [x, y] = route && !data?.points && points === routed ? [route.labelX, route.labelY] : middleOf(points);
  return (
    <>
      {/* Casing: a wider stroke in the canvas colour, so where wires cross, one is seen to pass over the other. */}
      <path d={path} className={`wire-casing${follow}${look}`} />
      <BaseEdge id={id} path={path} markerEnd={markerEnd} className={`wire-${data?.type ?? "signal"}${hot ? " lit" : ""}${follow}${look}`} />
      {arrow && <polygon className={`wire-arrow${follow}${look}`} points={arrow} />}
      {/* What a dropped card finds under the pointer: a wide, invisible stroke tagged with the wire. */}
      <path d={path} className="wire-hit" data-wire={id} />
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
