// The e2e tests' harness: the real engine (the scratchpad station and the page server, from engine/build) and the
// built page (web/dist) in a headless Chromium, driven over CDP. `missing` says why a test is skipped: build the
// engine and the page, and have chromium on PATH, the Flatpak org.chromium.Chromium, or CHROME=<binary>.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "../..");
export const BUILD = process.env.SIMPLICIAL_BUILD ?? path.join(ROOT, "engine/build");  // another checkout's, say
export const ENGINE = path.join(BUILD, "tools/simplicial-engine");
export const STATION = path.join(BUILD, "scratchpad/paperboat-scratchpad");
export const PAGE = path.join(ROOT, "web/dist/index.html");
const onPath = (b: string) => (process.env.PATH ?? "").split(path.delimiter).some((d) => fs.existsSync(path.join(d, b)));
/** The browser's command, and whether it is the Flatpak (its sandbox sees only the folders it is given). */
export const browser = (): [string, string[]] | null => {
  if (process.env.CHROME) return [process.env.CHROME, []];
  for (const b of ["chromium", "chromium-browser", "google-chrome"]) if (onPath(b)) return [b, []];
  if (onPath("flatpak") && spawnSync("flatpak", ["info", "org.chromium.Chromium"], { stdio: "ignore" }).status === 0) return ["flatpak", ["run", "org.chromium.Chromium"]];
  return null;
};
export const missing = !fs.existsSync(ENGINE) || !fs.existsSync(STATION) ? "no engine build (cmake --build engine/build)"
  : !fs.existsSync(PAGE) ? "no page build (npm run build)" : !browser() ? "no Chromium" : false;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const port = () => 40000 + Math.floor(Math.random() * 20000);

/** A page over CDP: evaluate, wait for, type, press. */
export async function connect(debug: number) {
  let url = "";
  for (let i = 0; i < 120 && !url; i++) {
    await sleep(250);
    try { url = ((await (await fetch(`http://127.0.0.1:${debug}/json`)).json()) as { type: string; webSocketDebuggerUrl: string }[]).find((t) => t.type === "page")?.webSocketDebuggerUrl ?? ""; } catch { /* not up yet */ }
  }
  assert.ok(url, "the browser didn't start");
  const ws = new WebSocket(url);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let n = 0;
  const waiting = new Map<number, (m: { result?: { result?: { value?: unknown }; exceptionDetails?: unknown } }) => void>();
  const errors: string[] = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)!(m); waiting.delete(m.id); }
    else if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  };
  const cmd = (method: string, params: object = {}) => new Promise<{ result?: { result?: { value?: unknown }; exceptionDetails?: unknown } }>((r) => {
    const id = ++n;
    waiting.set(id, r);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const run = async <T,>(expr: string): Promise<T> => {
    const r = await cmd("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    assert.equal(r.result?.exceptionDetails, undefined, `${expr}: ${JSON.stringify(r.result?.exceptionDetails)}`);
    return r.result?.result?.value as T;
  };
  const until = async (what: string, expr: string, ms = 20000) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(150)) if (await run<boolean>(`!!(${expr})`)) return;
    assert.fail(`waited for ${what}; the page says: ${await run<string>(`document.body.innerText.replace(/\\s+/g, " ").slice(0, 400)`)}`);
  };
  /** Click the first element matching `sel` whose text starts with `text`. */
  const click = (sel: string, text = "") => run<boolean>(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.textContent.trim().startsWith(${JSON.stringify(text)})); e?.click(); return !!e; })()`)
    .then((ok) => assert.ok(ok, `no ${sel} ${text}`));
  const key = async (key: string, code: string, vk: number, modifiers = 0) => {
    for (const type of ["keyDown", "keyUp"]) await cmd("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: vk, modifiers });
  };
  /** Press the element `expr` finds with the mouse, as a person does (at its middle, real pointer events): `count` 2 double-clicks. */
  const mouse = async (expr: string, count = 1) => {
    const at = await run<[number, number] | null>(`(() => { const b = (${expr})?.getBoundingClientRect(); return b ? [b.x + b.width / 2, b.y + b.height / 2] : null; })()`);
    assert.ok(at, `nothing at ${expr}`);
    await cmd("Input.dispatchMouseEvent", { type: "mouseMoved", x: at[0], y: at[1] });
    for (let i = 1; i <= count; i++) {
      for (const type of ["mousePressed", "mouseReleased"]) await cmd("Input.dispatchMouseEvent", { type, x: at[0], y: at[1], button: "left", clickCount: i });
    }
  };
  await cmd("Runtime.enable");
  await cmd("Page.enable");
  await cmd("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  return { cmd, run, until, click, mouse, key, errors, close: () => ws.close() };
}
