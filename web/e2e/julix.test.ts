// End to end: Julix's variables with no station running (the owner's report on #80). Julix finds the page's server by
// its record in <tmp>/paperboat-runtime, as it finds a station, and sends it `variables.set` (server/share.ts). The
// page shows them From Julix with no station; a station started later gets them from the page (Julix never heard of
// it): the dropdown lists k, a click binds it, and a run uses its value.
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { browser, connect, ENGINE, missing, port, ROOT, sleep, STATION } from "./harness.ts";

const RECORDS = path.join(process.platform === "win32" ? os.tmpdir() : "/tmp", "paperboat-runtime");

test("Julix's variables reach the page with no station, and a station started later runs with them", { skip: missing, timeout: 180_000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(process.env.SIMPLICIAL_E2E_TMP ?? os.tmpdir(), "simplicial-e2e-julix-"));
  const folder = path.join(tmp, "flows"), profile = path.join(tmp, "profile");
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, "live.psf"), `${JSON.stringify({
    paperboat: 1, station: { name: "scratchpad" },
    flow: { nodes: [{ id: "c1", type: "constant", params: {}, pos: [0, 0] }, { id: "d1", type: "display", params: {}, pos: [200, 0] }],
      edges: [{ from: ["c1", "y"], to: ["d1", "in"] }] },
    run: { duration: 0.2 },
  }, null, 2)}\n`);
  const env = { ...process.env, PAPERBOAT_HOME: path.join(tmp, "home"), PAPERBOAT_ROOT: ROOT, PAPERBOAT_BIN: "/bin/false" };
  const [station, web, debug] = [port(), port(), port()];
  const kids: ChildProcess[] = [
    spawn(ENGINE, ["web", "start", "--port", String(web), "--host", "127.0.0.1", "--folder", folder], { cwd: folder, env, stdio: "ignore" }),
  ];
  const [bin, pre] = browser()!;
  const flatpak = bin === "flatpak" ? [`--filesystem=${tmp}`] : [];
  kids.push(spawn(bin, [...pre.slice(0, 1), ...flatpak, ...pre.slice(1), "--headless=new", "--disable-gpu", ...(process.env.CI ? ["--no-sandbox"] : []), `--remote-debugging-port=${debug}`,
    `--user-data-dir=${profile}`, "--no-first-run", "about:blank"], { stdio: "ignore" }));
  let page: Awaited<ReturnType<typeof connect>> | undefined;
  let julix: WebSocket | undefined;
  const record = path.join(RECORDS, `station-${web}.json`);
  try {
    page = await connect(debug);
    const { cmd, run, until, mouse, key } = page;
    const base = `http://127.0.0.1:${web}`;
    for (let i = 0; i < 80; i++) { try { await fetch(`${base}/`); break; } catch { await sleep(250); } }

    // Julix, as server/share.ts: the records of what runs (the page's server has one, a page's), a socket to it,
    // `variables.set` with its source. No station runs.
    for (let i = 0; i < 40 && !fs.existsSync(record); i++) await sleep(100);
    const r = JSON.parse(fs.readFileSync(record, "utf8")) as { pid: number; port: number; ws_url: string; page?: boolean };
    assert.equal(r.page, true);
    assert.equal(r.pid, kids[0].pid);
    assert.deepEqual(((await (await fetch(`${base}/__paperboat/stations`)).json()) as { port: number }[]).filter((s) => s.port === web), [], "no station list has it");
    julix = new WebSocket(r.ws_url.replace("//localhost:", "//127.0.0.1:"));
    await new Promise((ok, no) => { julix!.onopen = ok; julix!.onerror = no; });
    julix.send(JSON.stringify({ type: "variables.set", source: "julix", variables: [{ name: "k", type: "number", value: 2.5 }] }));

    // the flow with no station: From Julix lists k
    const fromJulix = `[...document.querySelectorAll('.var-group[aria-label="From Julix"] .var-row-name b')].map((b) => b.textContent)`;
    await cmd("Page.navigate", { url: `${base}/?open=:live.psf&nostation=1` });
    await until("k From Julix, with no station", `${fromJulix}.includes("k")`, 40000);

    // a station starts (Julix never hears of it: it sends to the page's server only); the page hands it Julix's k
    kids.push(spawn(STATION, ["--port", String(station)], { cwd: folder, env, stdio: "ignore" }));
    for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${station}/variables.remote`); break; } catch { await sleep(250); } }
    await cmd("Page.navigate", { url: `${base}/?station=ws://localhost:${station}&open=:live.psf` });
    await until("the flow on its station", `(document.querySelector(".pg-flow .sum")?.textContent ?? "").includes("2 blocks")`, 40000);
    await until("the station to have k from the page", `fetch("http://127.0.0.1:${station}/variables.remote").then((r) => r.json()).then((b) => b.variables.some((v) => v.name === "k" && v.value === 2.5))`, 20000);

    // the dropdown: c1's value field, ↓ lists k, a click binds it; a run shows 2.5
    const field = `document.querySelector('.react-flow__node[data-id="c1"] [aria-label="value"]')`;
    const hint = `[...document.querySelectorAll(".param-hint")].find((h) => h.querySelector("b").textContent === "k")`;
    const plate = `document.querySelector('.react-flow__node[data-id="c1"] .plate')`;
    await until("c1's plate", plate);
    await sleep(1500);  // the opened flow settles (projectSession.ts)
    await mouse(plate, 2);
    await until("c1's card", field);
    await mouse(field);
    await until("the field focused", `document.activeElement === ${field}`);
    await key("ArrowDown", "ArrowDown", 40);
    await until("k in the dropdown", hint);
    await mouse(hint);
    await key("Enter", "Enter", 13);
    await until("c1 bound to k", `${field}?.value === "k" && ${field}.classList.contains("bound")`);
    await key("Escape", "Escape", 27);
    await key("r", "KeyR", 82, 2);
    await until("the run to end", `document.querySelector(".run-status.status-done, .run-status.status-failed")`, 40000);
    assert.equal(await run<boolean>(`!!document.querySelector(".run-status.status-done")`), true);
    await until("the Display", `document.querySelector(".display output")?.textContent.trim() === "2.5"`);

    // Julix quits: the page's server drops its list, and the page takes it back from the station
    julix.close();
    await until("k gone from the station", `fetch("http://127.0.0.1:${station}/variables.remote").then((r) => r.json()).then((b) => !b.variables.some((v) => v.name === "k"))`, 20000);
    assert.deepEqual(page.errors, []);
  } finally {
    julix?.close();
    await Promise.race([page?.cmd("Browser.close"), sleep(2000)]);
    page?.close();
    for (const k of kids) k.kill();
    spawnSync("pkill", ["-f", "--", `--user-data-dir=${profile}`]);
    await sleep(500);
    assert.equal(fs.existsSync(record), false, "the page's server takes its record with it");
    fs.rmSync(path.join(RECORDS, `station-${station}.json`), { force: true });  // a station stopped leaves its own
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
