// The project around the open file (#6, from legacy's projectSession.ts): whether it is saved, and the unsaved work kept
// as it happens and offered back after a reload. Opening, saving and the word before unsaved work is replaced (the kit's
// Unsaved) are the page's (App.tsx, hubs.ts); they tell this what happened.
import { ago } from "@paperboatlab/ui";
import { useEffect, useRef, useState } from "react";
import type { StationFlow } from "./protocol.ts";
import { clearAutosave, loadAutosave, saveAutosave, type Stored } from "./project.ts";

/** A question before something is replaced, and its answers; the last is the safe one (Esc). `looked`: where it looked (E1). */
export type Notice = { title: string; text: string[]; looked?: [string, string][]; actions: { label: string; primary?: boolean; run?: () => void }[] };

/** How long an opened project's parts stay unchanged before it counts as settled: its own renders take a few ms, an
 *  edit by hand comes later. */
const SETTLED_MS = 60;

export function useProject(
  /** The station's name (hello.engine): unsaved work is kept per station. */
  engine: string,
  /** The project as the page holds it now, and what it is made of (it is taken again when one changes). */
  snapshot: () => StationFlow,
  parts: unknown[],
  /** The open file's name, for the restore offer. */
  name: string,
  /** Put back unsaved work from before a reload. */
  restore: (s: Stored) => void,
) {
  // `key` is the project as text a moment after the last change; it is unsaved while it differs from `baseline`:
  // what the station started with, or what was last opened or saved (null: whatever it settles to next).
  const [key, setKey] = useState("");
  const [baseline, setBaseline] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const checked = useRef("");  // the station whose kept work was looked for
  const dirty = baseline !== null && key !== "" && key !== baseline;
  const take = useRef(snapshot);
  take.current = snapshot;

  useEffect(() => {
    if (!engine) return;
    const t = window.setTimeout(() => setKey(JSON.stringify(take.current())), 250);
    return () => window.clearTimeout(t);
  }, [engine, ...parts]); // eslint-disable-line react-hooks/exhaustive-deps -- the parts are the snapshot's
  // A file opened (or the starter put back): what it settles to is taken as soon as the canvas is still, not after the
  // debounced `key` (#55: an edit in that wait was taken as what was opened, and never marked unsaved).
  const [opening, setOpening] = useState(false);
  useEffect(() => { setBaseline(null); setOpening(false); }, [engine]);
  useEffect(() => {
    if (baseline !== null || key === "" || opening) return;
    // the station's starter settles (graph.load, linked blocks, places); taken afresh
    const t = window.setTimeout(() => setBaseline(JSON.stringify(take.current())), 500);
    return () => window.clearTimeout(t);
  }, [key, baseline, opening]);
  useEffect(() => {
    if (baseline !== null || !opening) return;
    // the open settles in a few renders (the canvas from the file, linked blocks, loose wires): quiet for a moment
    const t = window.setTimeout(() => { setBaseline(JSON.stringify(take.current())); setOpening(false); }, SETTLED_MS);
    return () => window.clearTimeout(t);
  }, [baseline, opening, ...parts]); // eslint-disable-line react-hooks/exhaustive-deps -- the parts are the snapshot's

  // After a reload: the work this station had unsaved, offered back once the starter has settled.
  useEffect(() => {
    if (baseline === null || checked.current === engine) return;
    checked.current = engine;
    const s = loadAutosave(engine);
    if (!s || JSON.stringify(s.project) === baseline) return void clearAutosave(engine);
    setNotice({
      title: "Restore your last session?",
      text: [`“${s.name}” had changes that weren't saved (${ago(s.savedAt, Date.now())}).`],
      actions: [
        { label: "Restore", primary: true, run: () => restore(s) },
        { label: "Discard", run: () => clearAutosave(engine) },
        { label: "Not now" },
      ],
    });
  }, [baseline, engine]); // eslint-disable-line react-hooks/exhaustive-deps -- once per station
  // Unsaved work is kept as it happens; while the offer is up, what it offers stays.
  useEffect(() => {
    if (checked.current !== engine || notice) return;
    if (dirty) saveAutosave(engine, { name, savedAt: Date.now(), project: JSON.parse(key) as StationFlow });
    else clearAutosave(engine);
  }, [key, dirty]); // eslint-disable-line react-hooks/exhaustive-deps -- when the project changes

  return {
    dirty, notice,
    close: () => setNotice(null),
    /** Ask something of the page's own (E1, E5). */
    tell: setNotice,
    /** A project was opened (or started): unsaved from what it settles to (`changed`: unsaved until saved, its station
     *  found elsewhere, E2). */
    opened: (changed = false) => {
      setBaseline(changed ? "changed" : null);
      setOpening(!changed);
      checked.current = engine;  // a file opened on purpose: no offer to restore what was there before
    },
    /** It was saved: saved from here on. */
    saved: () => {
      setBaseline(JSON.stringify(take.current()));
      clearAutosave(engine);
    },
  };
}
