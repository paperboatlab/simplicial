// The selection dialog (#54): floats above the blocks and groups picked on the Flow canvas (below them at the
// top of the canvas) and says in words what is picked, then Comment ▾ and Group ▾ (each a menu; what can't
// apply stays, greyed, and says why) and Delete. Linked blocks stay, and it says so.
import { Icon, Key, Menu, type MenuEntry } from "@paperboatlab/ui";
import { NodeToolbar, Position } from "@xyflow/react";
import { useRef, useState } from "react";
import type { GroupData, GroupNode } from "./groups.ts";
import type { BlockNode, FlowNode, Wire } from "./flowModel.ts";

type Props = {
  pickedNodes: FlowNode[];
  pickedBlocks: BlockNode[];
  pickedWires: Wire[];
  pickedFrames: GroupNode[];
  /** Something is picked, and nothing is being dragged. */
  isVisible: boolean;
  /** Room for the dialog above the selection, else it goes below. */
  roomAbove: boolean;
  allCommented: boolean;
  /** Linked blocks among the picked: they aren't deleted. */
  kept: number;
  canGroup: boolean;
  canFrame: boolean;
  /** A story fits here: a Step flow, and signal blocks only. */
  canStory: boolean;
  /** Why nothing can change now (a run); "" when it can. */
  lock: string;
  toggleComment: (mode: "out" | "through") => void;
  removePicked: () => void;
  group: (kind: GroupData["kind"]) => void;
  ungroup: (id: string) => void;
};

export function SelectionDialog(p: Props) {
  const [open, setOpen] = useState<"comment" | "group" | null>(null);
  const keys = { comment: useRef<HTMLSpanElement>(null), group: useRef<HTMLSpanElement>(null) };
  const counted = (n: number, one: string) => (n ? [`${n} ${one}${n === 1 ? "" : "s"}`] : []);
  const summary = [...counted(p.pickedBlocks.length, "block"), ...counted(p.pickedFrames.length, "group"), ...counted(p.pickedWires.length, "wire")].join(" · ");
  const why = (ok: boolean, otherwise: string) => (p.lock ? { disabled: true, why: p.lock } : ok ? {} : { disabled: true, why: otherwise });
  const noBlocks = "Pick a block: groups and wires can't be commented out";
  const menus: Record<"comment" | "group", MenuEntry[]> = {
    comment: [
      { id: "out", label: p.allCommented ? "Uncomment" : "Comment out", shortcut: "Ctrl /", ...why(p.pickedBlocks.length > 0, noBlocks), run: () => p.toggleComment("out") },
      { id: "through", label: "Bypass", shortcut: "Ctrl Shift Y", ...why(p.pickedBlocks.length > 0, noBlocks), run: () => p.toggleComment("through") },
    ],
    group: [
      { id: "subsystem", label: "Subsystem", ...why(p.canGroup, "Pick blocks or groups in the same place (not some in a frame)"), run: () => p.group("subsystem") },
      { id: "story", label: "Story", ...why(p.canStory, "A story is one step of a Step flow, round signal blocks only"), run: () => p.group("story") },
      { id: "frame", label: "Frame", ...why(p.canFrame, "A frame goes round blocks on one level, not round groups"), run: () => p.group("visual") },
      { id: "ungroup", label: "Ungroup", ...why(p.pickedFrames.length > 0, "Pick a group to put its blocks back"), run: () => p.pickedFrames.forEach((f) => p.ungroup(f.id)) },
    ],
  };
  const nothing = p.kept === p.pickedNodes.length && p.pickedWires.length === 0;
  const deleteWhy = p.lock || (nothing ? "Linked blocks come from the station: remove their object on the Station" : "");
  const unfold = (m: "comment" | "group", label: string) => (
    <span className="sel-menu" ref={keys[m]}>
      <Key size="sm" kind="quiet" aria-expanded={open === m} onClick={() => setOpen(open === m ? null : m)}>{label}<Icon name="chevron-down" size={12} /></Key>
      {open === m && <Menu label={label} items={menus[m]} onClose={() => setOpen(null)} triggerRef={keys[m]} className="sel-pop" />}
    </span>
  );
  return (
    <NodeToolbar nodeId={p.pickedNodes.map((n) => n.id)} isVisible={p.isVisible} position={p.roomAbove ? Position.Top : Position.Bottom} offset={14}
      className="selection-dialog nodrag nopan nowheel">
      <span className="sel-what">{summary}</span>
      <i className="sel-sep" />
      {unfold("comment", "Comment")}
      {unfold("group", "Group")}
      <i className="sel-sep" />
      <span title={deleteWhy || "Delete the selection"}>
        <Key size="sm" kind="quiet" shortcut="Del" disabled={!!deleteWhy} onClick={p.removePicked}>Delete</Key>
      </span>
      {p.kept > 0 && !nothing && <span className="sel-what" title="Linked blocks come from the station">{p.kept} linked {p.kept === 1 ? "block stays" : "blocks stay"}</span>}
    </NodeToolbar>
  );
}
