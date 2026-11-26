// The project around the open file (#6, from legacy's projectSession.ts): whether it is saved, a word before unsaved
// work is replaced, the recent projects, and the unsaved work kept as it happens and offered back after a reload.
// Opening and saving are the page's (App.tsx, hubs.ts); they tell this what happened.
import { ago } from "@paperboatlab/ui";
import { useEffect, useRef, useState } from "react";
import type { StationFlow } from "./protocol.ts";
import { addRecent, clearAutosave, loadAutosave, loadRecent, saveAutosave, saveRecent, type Stored } from "./project.ts";

/** A question before something is replaced, and its answers; the last is the safe one (Esc). `looked`: where it looked (E1). */
export type Notice = { title: string; text: string[]; looked?: [string, string][]; actions: { label: string; primary?: boolean; run?: () => void }[] };

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
  const [recent, setRecent] = useState<Stored[]>(loadRecent);
  const checked = useRef("");  // the station whose kept work was looked for
  const dirty = baseline !== null && key !== "" && key !== baseline;
  const take = useRef(snapshot);
  take.current = snapshot;

  useEffect(() => {
    if (!engine) return;
    const t = window.setTimeout(() => setKey(JSON.stringify(take.current())), 250);
    return () => window.clearTimeout(t);
  }, [engine, ...parts]); // eslint-disable-line react-hooks/exhaustive-deps -- the parts are the snapshot's
  useEffect(() => setBaseline(null), [engine]);
  useEffect(() => {
    if (baseline !== null || key === "") return;
    // the canvas settles (linked blocks, places); taken afresh, as `key` may still be the project before an open
    const t = window.setTimeout(() => setBaseline(JSON.stringify(take.current())), 500);
    return () => window.clearTimeout(t);
  }, [key, baseline]);

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
    dirty, notice, recent,
    close: () => setNotice(null),
    /** Ask something of the page's own (E1, E5). */
    tell: setNotice,
    /** Do `verb` now, or after a word when it would replace unsaved work. */
    ask: (title: string, verb: string, go: () => void) => {
      if (!dirty) return go();
      setNotice({ title, text: [`“${name}” has changes that weren't saved. ${verb} replaces them.`], actions: [{ label: verb, primary: true, run: go }, { label: "Cancel" }] });
    },
    /** A project was opened (or started): unsaved from what it settles to (`changed`: unsaved until saved, its station
     *  found elsewhere, E2); kept in Open recent when it has a name. */
    opened: (s?: Omit<Stored, "savedAt">, changed = false) => {
      setBaseline(changed ? "changed" : null);
      checked.current = engine;  // a file opened on purpose: no offer to restore what was there before
      if (s) setRecent((list) => saveRecent(addRecent(list, { ...s, savedAt: Date.now() })));
    },
    /** It was saved as `s`: saved from here on, and kept in Open recent. */
    saved: (s: Omit<Stored, "savedAt">) => {
      setBaseline(JSON.stringify(take.current()));  // the project as the page holds it (`s.project` also has its station's place)
      setRecent((list) => saveRecent(addRecent(list, { ...s, savedAt: Date.now() })));
      clearAutosave(engine);
    },
  };
}
