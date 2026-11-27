// End to end (M5, #6): open a flow from a folder, edit it (a block, the run's length), save it, reopen it. The real engine
// (the scratchpad station and the page server, from engine/build) and the built page (web/dist) in a headless Chromium,
// driven over CDP. Skipped where one is missing: build the engine and the page, and have chromium on PATH, the Flatpak
// org.chromium.Chromium, or CHROME=<binary>. `npm run e2e` (SIMPLICIAL_BUILD=<engine build folder>, SIMPLICIAL_E2E_TMP=<folder>).
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../..");
const BUILD = process.env.SIMPLICIAL_BUILD ?? path.join(ROOT, "engine/build");  // another checkout's, say
const ENGINE = path.join(BUILD, "tools/simplicial-engine");
const STATION = path.join(BUILD, "scratchpad/paperboat-scratchpad");
const PAGE = path.join(ROOT, "web/dist/index.html");
const onPath = (b: string) => (process.env.PATH ?? "").split(path.delimiter).some((d) => fs.existsSync(path.join(d, b)));
/** The browser's command, and whether it is the Flatpak (its sandbox sees only the folders it is given). */
const browser = (): [string, string[]] | null => {
  if (process.env.CHROME) return [process.env.CHROME, []];
  for (const b of ["chromium", "chromium-browser", "google-chrome"]) if (onPath(b)) return [b, []];
  if (onPath("flatpak") && spawnSync("flatpak", ["info", "org.chromium.Chromium"], { stdio: "ignore" }).status === 0) return ["flatpak", ["run", "org.chromium.Chromium"]];
  return null;
};
const missing = !fs.existsSync(ENGINE) || !fs.existsSync(STATION) ? "no engine build (cmake --build engine/build)"
  : !fs.existsSync(PAGE) ? "no page build (npm run build)" : !browser() ? "no Chromium" : false;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const port = () => 40000 + Math.floor(Math.random() * 20000);

/** A page over CDP: evaluate, wait for, type, press. */
async function connect(debug: number) {
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
  await cmd("Runtime.enable");
  await cmd("Page.enable");
  await cmd("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  return { cmd, run, until, click, key, errors, close: () => ws.close() };
}

test("open a flow, edit it, save it, reopen it", { skip: missing, timeout: 180_000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(process.env.SIMPLICIAL_E2E_TMP ?? os.tmpdir(), "simplicial-e2e-"));
  const folder = path.join(tmp, "flows"), profile = path.join(tmp, "profile");
  fs.mkdirSync(folder);
  const file = path.join(folder, "loop.psf");
  fs.writeFileSync(file, `${JSON.stringify({ paperboat: 1, station: { name: "scratchpad" }, flow: { nodes: [], edges: [] } }, null, 2)}\n`);
  const env = { ...process.env, PAPERBOAT_HOME: path.join(tmp, "home"), PAPERBOAT_ROOT: ROOT };
  const [station, web, debug] = [port(), port(), port()];
  const kids: ChildProcess[] = [
    spawn(STATION, ["--port", String(station)], { cwd: folder, env, stdio: "ignore" }),
    spawn(ENGINE, ["web", "start", "--port", String(web), "--host", "127.0.0.1", "--folder", folder], { cwd: folder, env, stdio: "ignore" }),
  ];
  const [bin, pre] = browser()!;
  const flatpak = bin === "flatpak" ? [`--filesystem=${tmp}`] : [];
  kids.push(spawn(bin, [...pre.slice(0, 1), ...flatpak, ...pre.slice(1), "--headless=new", "--disable-gpu", ...(process.env.CI ? ["--no-sandbox"] : []), `--remote-debugging-port=${debug}`,
    `--user-data-dir=${profile}`, "--no-first-run", "about:blank"], { stdio: "ignore" }));
  let page: Awaited<ReturnType<typeof connect>> | undefined;
  try {
    page = await connect(debug);
    const { cmd, run, until, click, key } = page;
    const open = `http://127.0.0.1:${web}/?station=ws://localhost:${station}&open=:loop.psf`;
    const flowHead = `document.querySelector(".pg-flow .sum")?.textContent ?? ""`;
    const length = `document.querySelector('input[aria-label="Run length, s"]')?.value`;

    // open: the flow on its station, empty
    for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${web}/`); break; } catch { await sleep(250); } }
    await cmd("Page.navigate", { url: open });
    await until("the flow to open", `(${flowHead}).startsWith("loop.psf") && (${flowHead}).includes("0 blocks")`, 40000);
    await sleep(1500);  // the opened flow settles (projectSession.ts): what it is saved as

    // edit: a block from the library, and the run's length in Run settings…
    await click(".pg-flow .key", "Add block");
    await until("the block library", `document.querySelector(".lib-card")`);
    await click(".lib-card");
    await until("the block on the Flow", `(${flowHead}).includes("1 block")`);
    await click(".menubar .menu-title", "Run");
    await click(".menu .menu-item", "Run settings");
    await until("Run settings", length);
    await run(`document.querySelector('input[aria-label="Run length, s"]').select()`);
    await cmd("Input.insertText", { text: "25" });
    await key("Tab", "Tab", 9);
    await key("Escape", "Escape", 27);
    await until("the flow to be changed", `document.querySelector(".pg-flow .dirty")`);

    // save: Ctrl S writes it back where it came from
    await key("s", "KeyS", 83, 2);
    await until("the save", `!document.querySelector(".pg-flow .dirty")`);
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(saved.paperboat, 1);
    assert.equal(saved.station.name, "scratchpad");
    assert.equal(saved.flow.nodes.length, 1);
    assert.equal(saved.run?.duration, 25);

    // reopen: a fresh page on the same file has both
    await cmd("Page.navigate", { url: "about:blank" });
    await cmd("Page.navigate", { url: open });
    await until("the flow to open again", `(${flowHead}).startsWith("loop.psf") && (${flowHead}).includes("1 block")`, 40000);
    await click(".menubar .menu-title", "Run");
    await click(".menu .menu-item", "Run settings");
    await until("Run settings", length);
    assert.equal(await run(length), "25");
    assert.deepEqual(page.errors, []);
  } finally {
    await Promise.race([page?.cmd("Browser.close"), sleep(2000)]);
    page?.close();
    for (const k of kids) k.kill();
    spawnSync("pkill", ["-f", "--", `--user-data-dir=${profile}`]);
    await sleep(500);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
