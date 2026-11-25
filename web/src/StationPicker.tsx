// Choose a station (a window in the centre): over the splash while no station answers, and from File any
// time. It lists the stations it finds (the recent ones and this machine's station ports); an address
// opens any other.
import { useEffect, useState } from "react";
import { Dialog, Key } from "@paperboatlab/ui";
import { candidates, openStation, probe, recent, toAddress, type Found } from "./stations.ts";

export function StationPicker({ current, wait, onClose }: {
  /** The station this page is on, or trying. */
  current: string;
  /** No station yet: it can't be closed. */
  wait?: boolean;
  onClose: () => void;
}) {
  const [round, setRound] = useState(0);
  const { found, looking } = useStations(true, round, current);
  const [typed, setTyped] = useState("");
  const address = toAddress(typed);

  return (
    <Dialog title="Choose a station" wait={wait} className="stations-window" onClose={() => { if (!wait) onClose(); }}
      actions={<>
        <Key kind="quiet" busy={looking} disabled={looking} onClick={() => setRound((r) => r + 1)}>Look again</Key>
        <span className="grow" />
        {!wait && <Key onClick={onClose}>Cancel</Key>}
      </>}>
      <p>{wait ? `Nothing answers at ${current}. Choose a station, or give its address.` : "The stations on this machine, and the ones you used."}</p>
      <div className="stations-list" role="listbox" aria-label="Stations" aria-busy={looking}>
        {found.map((f) => (
          <button key={f.url} type="button" role="option" aria-selected={f.url === current} className="stations-row" onClick={() => openStation(f.url)}>
            <span className="stations-name">{f.name}</span>
            <span className="stations-url">{f.url.replace(/^ws:\/\//, "")}</span>
            {f.url === current && <span className="tag">this page</span>}
          </button>
        ))}
        {looking ? <span className="stations-note">Looking on this machine</span>
          : !found.length && <span className="stations-note">No station answers on this machine (ports 8765–8775)</span>}
      </div>
      <form className="stations-addr" onSubmit={(e) => { e.preventDefault(); if (address) openStation(address); }}>
        <label className="well"><input aria-label="Station address" placeholder="Address: 8766, host:8766, ws://host:8766" spellCheck={false} value={typed} onChange={(e) => setTyped(e.target.value)} /></label>
        <Key kind="primary" type="submit" disabled={!address} title={address ? `Open ${address}` : "Give a port, host:port or a ws:// address"}>Open</Key>
      </form>
    </Dialog>
  );
}

/** The stations that answer (the recent ones and this machine's station ports), in that order, while `active`; a new `round` looks again. */
export function useStations(active: boolean, round = 0, current?: string): { found: Found[]; looking: boolean } {
  const [found, setFound] = useState<Found[]>([]);
  const [looking, setLooking] = useState(active);
  useEffect(() => {
    if (!active) return;
    let live = true;
    setFound([]);
    setLooking(true);
    const all = candidates(current ? [current, ...recent()] : recent());
    void Promise.all(all.map((u) => probe(u).then((f) => { if (f && live) setFound((l) => [...l, f].sort((a, b) => all.indexOf(a.url) - all.indexOf(b.url))); })))
      .then(() => { if (live) setLooking(false); });
    return () => { live = false; };
  }, [active, round, current]);
  return { found, looking };
}
