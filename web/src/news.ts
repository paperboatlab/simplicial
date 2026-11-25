// What the page tells in a toast (the kit's useToasts; ui-example.html §10): work in the background and its
// end. Losing the station (working while it reconnects, then done on the same toast) and a run that ends in
// a fault. The Console keeps the lines; a failure's detail points there.
import { useEffect, useRef } from "react";
import type { Toast } from "@paperboatlab/ui";
import type { EngineState } from "./engine.ts";

type Seen = Pick<EngineState, "connection" | "engine" | "run" | "failed">;
export type News = Omit<Toast, "id"> & { about: "station" | "run" };

/** The news between two states of the engine, if any. */
export function news(was: Seen, now: Seen): News[] {
  const out: News[] = [];
  if (was.connection === "open" && now.connection === "closed") {
    out.push({ about: "station", title: "Lost the station", detail: `${now.engine || "The station"} · reconnecting…`, state: "working" });
  } else if (was.connection !== "open" && now.connection === "open" && was.engine) {
    out.push({ about: "station", title: `Back on ${was.engine}`, state: "done" });  // engine set: it had said hello before
  }
  if (was.run && now.run?.id === was.run.id && was.run.status === "running" && now.run.status === "failed") {
    const why = now.connection !== "open" ? "The station went away mid-run" : now.failed.length ? `${now.failed[0]} failed` : "The station stopped it";
    out.push({ about: "run", title: "The run failed", detail: `${why} · see the Console`, state: "failed" });
  }
  return out;
}

/** Shows the engine's news as toasts; the station's loss and its return are one toast. */
export function useNews(state: EngineState, show: (t: Omit<Toast, "id"> & { id?: number }) => number) {
  const was = useRef<Seen>(state);
  const lost = useRef<number | undefined>(undefined);
  useEffect(() => {
    for (const { about, ...t } of news(was.current, state)) {
      if (about === "run") { show(t); continue; }
      const id = show({ ...t, id: lost.current });
      lost.current = t.state === "working" ? id : undefined;
    }
    was.current = state;
  }, [state, show]);
}
