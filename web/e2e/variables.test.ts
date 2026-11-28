// End to end: a block's param bound to a variable from its list (the kit's ParamField), as a person does it, on a
// floating card, the block's plate double-clicked. One is the flow's own variable, picked with the keys; one is Julix's
// shared variable, picked with the mouse. Both show, survive a save and a reopen, and a run uses their values.
// Julix is its socket (server/share.ts): `variables.set` with `source: "julix"` sent to the station.
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { browser, connect, ENGINE, missing, port, ROOT, sleep, STATION } from "./harness.ts";

test("bind a param to a flow variable and to Julix's from the variable list; save, reopen, run", { skip: missing, timeout: 180_000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(process.env.SIMPLICIAL_E2E_TMP ?? os.tmpdir(), "simplicial-e2e-vars-"));
  const folder = path.join(tmp, "flows"), profile = path.join(tmp, "profile");
  fs.mkdirSync(folder);
  const file = path.join(folder, "vars.psf");
  // two Numbers, each on a Display: what a run makes of them shows on the Board
  const node = (id: string, type: string, x: number, y: number) => ({ id, type, params: {}, pos: [x, y] });
  fs.writeFileSync(file, `${JSON.stringify({
    paperboat: 1, station: { name: "scratchpad" },
    variables: [{ name: "kp", type: "number", value: 4 }],
    flow: {
      nodes: [node("c1", "constant", 0, 0), node("c2", "constant", 0, 200), node("d1", "display", 300, 0), node("d2", "display", 300, 200)],
      edges: [{ from: ["c1", "y"], to: ["d1", "in"] }, { from: ["c2", "y"], to: ["d2", "in"] }],
    },
    run: { duration: 0.2 },
  }, null, 2)}\n`);
  const env = { ...process.env, PAPERBOAT_HOME: path.join(tmp, "home"), PAPERBOAT_ROOT: ROOT, PAPERBOAT_BIN: "/bin/false" };
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
  let julix: WebSocket | undefined;
  try {
    page = await connect(debug);
    const { cmd, run, until, mouse, key } = page;
    const open = `http://127.0.0.1:${web}/?station=ws://localhost:${station}&open=:vars.psf`;
    const flowHead = `document.querySelector(".pg-flow .sum")?.textContent ?? ""`;
    const plate = (id: string) => `document.querySelector('.react-flow__node[data-id="${id}"] .plate')`;
    const field = (id: string) => `document.querySelector('.react-flow__node[data-id="${id}"] input[aria-label="value"]')`;
    const hints = `[...document.querySelectorAll(".param-hint b")].map((b) => b.textContent)`;
    const hint = (name: string) => `[...document.querySelectorAll(".param-hint")].find((h) => h.querySelector("b").textContent === ${JSON.stringify(name)})`;
    const displays = `[...document.querySelectorAll(".display output")].map((o) => o.textContent.trim()).sort()`;
    for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${web}/`); break; } catch { await sleep(250); } }
    await cmd("Page.navigate", { url: open });
    await until("the flow to open", `(${flowHead}).startsWith("vars.psf") && (${flowHead}).includes("4 blocks")`, 40000);

    // Julix's session has k = 2.5: it shares it with the station, and the Variables card lists it From Julix
    julix = new WebSocket(`ws://127.0.0.1:${station}`);
    await new Promise((r, j) => { julix!.onopen = r; julix!.onerror = j; });
    julix.send(JSON.stringify({ type: "variables.set", source: "julix", variables: [{ name: "k", type: "number", value: 2.5 }] }));
    await until("Julix's k in the Variables card", `[...document.querySelectorAll('.var-group[aria-label="From Julix"] .var-row-name b')].some((b) => b.textContent === "k")`, 20000);

    // the flow's kp, with the keys: c1's card, its value field, ↓ lists every variable, ↓ ↑ pick, Enter takes, Enter sets
    await mouse(plate("c1"), 2);
    await until("c1's card", field("c1"));
    await mouse(field("c1"));
    await until("the field focused", `document.activeElement === ${field("c1")}`);
    await key("ArrowDown", "ArrowDown", 40);
    // (another Julix on this computer may add its own: every running station hears every Julix)
    await until("the list of every variable", `${hints}[0] === "kp" && ${hints}.includes("k")`);
    // on top: not clipped by the card or the canvas, nothing over it
    assert.equal(await run<boolean>(`(() => { const h = ${hint("k")}, b = h.getBoundingClientRect(); return h.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)); })()`), true);
    await key("ArrowDown", "ArrowDown", 40);
    await key("ArrowUp", "ArrowUp", 38);
    await until("kp picked", `document.querySelector('.param-hint[aria-selected="true"] b')?.textContent === "kp"`);
    await key("Enter", "Enter", 13);
    await until("kp taken", `${field("c1")}?.value === "kp"`);
    await key("Enter", "Enter", 13);
    await until("c1 bound to kp", `${field("c1")}?.classList.contains("bound") && document.activeElement !== ${field("c1")}`);
    await key("Escape", "Escape", 27);  // the card back to its plate

    // Julix's k, with the mouse: c2's card, the field's text replaced by "k", a click on k in the list, then on the
    // empty canvas (it closes the card, and the field with it: what it holds is set all the same)
    await mouse(plate("c2"), 2);
    await until("c2's card", field("c2"));
    await mouse(field("c2"));
    await until("the field focused", `document.activeElement === ${field("c2")}`);
    await run(`${field("c2")}.select()`);  // Ctrl A
    await cmd("Input.insertText", { text: "k" });
    await until("the variables named like k", `${hints}.slice(0, 2).join() === "kp,k"`);
    await mouse(hint("k"));
    await until("k taken, the card still open", `${field("c2")}?.value === "k" && document.activeElement === ${field("c2")}`);
    await mouse(`document.querySelector(".pg-flow .sum")`);
    await until("c2's card closed", `!${field("c2")}`);
    await until("the flow to be changed", `document.querySelector(".pg-flow .dirty")`);

    // save: both bindings are in the file
    await key("s", "KeyS", 83, 2);
    await until("the save", `!document.querySelector(".pg-flow .dirty")`);
    const params = (f: { flow: { nodes: { id: string; params: object }[] } }) => Object.fromEntries(f.flow.nodes.map((n) => [n.id, n.params]));
    assert.deepEqual(params(JSON.parse(fs.readFileSync(file, "utf8"))), { c1: { value: { var: "kp" } }, c2: { value: { var: "k" } }, d1: {}, d2: {} });

    // reopen, and run: the Displays show kp's 4 and Julix's 2.5
    await cmd("Page.navigate", { url: "about:blank" });
    await cmd("Page.navigate", { url: open });
    await until("the flow to open again", `(${flowHead}).startsWith("vars.psf") && (${flowHead}).includes("4 blocks")`, 40000);
    await mouse(plate("c2"), 2);
    await until("c2 still bound to k", `${field("c2")}?.value === "k" && ${field("c2")}.classList.contains("bound")`);
    await key("Escape", "Escape", 27);
    await key("r", "KeyR", 82, 2);
    await until("the run to end", `document.querySelector(".run-status.status-done, .run-status.status-failed")`, 40000);
    assert.equal(await run<boolean>(`!!document.querySelector(".run-status.status-done")`), true);
    await until("the Displays", `${displays}.join() === "2.5,4"`);
    assert.deepEqual(page.errors, []);
  } finally {
    julix?.close();
    await Promise.race([page?.cmd("Browser.close"), sleep(2000)]);
    page?.close();
    for (const k of kids) k.kill();
    spawnSync("pkill", ["-f", "--", `--user-data-dir=${profile}`]);
    await sleep(500);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
