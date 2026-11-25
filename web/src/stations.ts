// Finding a station: the ones this page has used, and any on this machine's station ports (51301 up, as
// `paperboat examples start` and the examples' station.toml give them). Each is asked for its hello; the
// ones that answer are listed with the name they give.
import { readStored, writeStored } from "@paperboatlab/ui";

export type Found = { url: string; name: string; version?: string };

const RECENT = "simplicial.stations";
const PORTS = Array.from({ length: 11 }, (_, i) => 51301 + i);
const isList = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");

/** What was typed as a station's address: a port, host:port, or a ws/http URL. "" when it can't be one. */
export function toAddress(typed: string): string {
  const s = typed.trim().replace(/\/+$/, "");
  if (/^\d{2,5}$/.test(s)) return `ws://localhost:${s}`;
  if (/^wss?:\/\/[^\s/]+/.test(s)) return s;
  if (/^https?:\/\/[^\s/]+/.test(s)) return s.replace(/^http/, "ws");
  if (/^[\w.-]+:\d{2,5}$/.test(s)) return `ws://${s}`;
  return "";
}

export const recent = (): string[] => readStored(RECENT, isList) ?? [];
export function remember(url: string) {
  writeStored(RECENT, [url, ...recent().filter((u) => u !== url)].slice(0, 8));
}

/** Where to look: the recent ones first, then the local station ports; each once. */
export function candidates(recentUrls: string[], host = "localhost"): string[] {
  return [...new Set([...recentUrls, ...PORTS.map((p) => `ws://${host}:${p}`)])];
}

/** Ask one address for its hello (a busy station can take a second or two); undefined when nothing answers in time. */
export function probe(url: string, ms = 4000): Promise<Found | undefined> {
  return new Promise((done) => {
    let ws: WebSocket;
    try { ws = new WebSocket(url); } catch { done(undefined); return; }
    const end = (f?: Found) => { clearTimeout(t); ws.onmessage = ws.onerror = ws.onclose = null; ws.close(); done(f); };
    const t = setTimeout(() => end(), ms);
    ws.onerror = ws.onclose = () => end();
    ws.onmessage = (e) => {
      try {
        const m = JSON.parse(String(e.data)) as { type?: string; engine?: string; version?: string };
        if (m.type === "hello") end({ url, name: m.engine || url, version: m.version });
      } catch { /* a binary frame or not ours: wait for the hello */ }
    };
  });
}

/** Open the page on another station: its address in ?station=, the rest of the page as it is. */
export function openStation(url: string) {
  remember(url);
  const q = new URLSearchParams(location.search);
  q.set("station", url);
  location.search = q.toString();
}
