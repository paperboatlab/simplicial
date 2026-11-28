// End to end: blocks' params bound to variables from their lists (the kit's ParamRow), as a person does it, on floating
// cards, the blocks' plates double-clicked. A number param: the flow's kp picked with the keys, Julix's k with the mouse.
// A matrix param: Julix's matrix Q picked with the mouse. A Variable block: the flow's matrix M chosen from its list.
// All show, survive a save and a reopen, and a run uses their values (the matrices through a Determinant each).
// Julix is its socket (server/share.ts): `variables.set` with `source: "julix"` sent to the station. Its names are
// not ones a Julix of yours is likely to have: every running station hears every Julix on the computer.
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
  // two Numbers, a Matrix and a Variable, each on a Display (the matrices through a Determinant): a run shows them
  const node = (id: string, type: string, x: number, y: number) => ({ id, type, params: {}, pos: [x, y] });
  const wire = (from: string, out: string, to: string, into: string) => ({ from: [from, out], to: [to, into] });
  fs.writeFileSync(file, `${JSON.stringify({
    paperboat: 1, station: { name: "scratchpad" },
    variables: [{ name: "kp", type: "number", value: 4 }, { name: "M", type: "matrix", value: "2 0; 0 3" }],
    flow: {
      nodes: [node("c1", "constant", 0, 0), node("d1", "display", 200, 0), node("c2", "constant", 0, 160), node("d2", "display", 200, 160),
        node("m1", "matrix_constant", 450, 0), node("det1", "determinant", 650, 0), node("d3", "display", 850, 0),
        node("v1", "variable", 450, 160), node("det2", "determinant", 650, 160), node("d4", "display", 850, 160)],
      edges: [wire("c1", "y", "d1", "in"), wire("c2", "y", "d2", "in"), wire("m1", "y", "det1", "a"), wire("det1", "det", "d3", "in"),
        wire("v1", "y", "det2", "a"), wire("det2", "det", "d4", "in")],
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
    const field = (id: string, param = "value") => `document.querySelector('.react-flow__node[data-id="${id}"] [aria-label="${param}"]')`;
    const hints = `[...document.querySelectorAll(".param-hint b")].map((b) => b.textContent)`;
    const hint = (name: string) => `[...document.querySelectorAll(".param-hint")].find((h) => h.querySelector("b").textContent === ${JSON.stringify(name)})`;
    const displays = `[...document.querySelectorAll(".display output")].map((o) => o.textContent.trim()).sort()`;
    for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${web}/`); break; } catch { await sleep(250); } }
    await cmd("Page.navigate", { url: open });
    await until("the flow to open", `(${flowHead}).startsWith("vars.psf") && (${flowHead}).includes("10 blocks")`, 40000);
    const fit = `[...document.querySelectorAll(".pg-flow button")].find((b) => /fit/i.test(b.getAttribute("aria-label") ?? b.title))`;
    await mouse(fit);  // all of it in view
    await sleep(500);

    // Julix's session has k = 2.5 and Q = [1 2; 3 4] (a matrix as Julix sends it: its rows): it shares them with the
    // station, and the Variables card lists them From Julix
    julix = new WebSocket(`ws://127.0.0.1:${station}`);
    await new Promise((r, j) => { julix!.onopen = r; julix!.onerror = j; });
    julix.send(JSON.stringify({ type: "variables.set", source: "julix", variables: [{ name: "k", type: "number", value: 2.5 }, { name: "Q", type: "matrix", value: "1.0 2.0; 3.0 4.0" }] }));
    const fromJulix = `[...document.querySelectorAll('.var-group[aria-label="From Julix"] .var-row-name b')].map((b) => b.textContent)`;
    await until("Julix's k and Q in the Variables card", `${fromJulix}.includes("k") && ${fromJulix}.includes("Q")`, 20000);

    // the flow's kp, with the keys: c1's card, its value field, ↓ lists every variable, ↓ ↑ pick, Enter takes, Enter sets
    await mouse(plate("c1"), 2);
    await until("c1's card", field("c1"));
    await mouse(field("c1"));
    await until("the field focused", `document.activeElement === ${field("c1")}`);
    await key("ArrowDown", "ArrowDown", 40);
    // (another Julix on this computer may add its own: every running station hears every Julix)
    await until("the list of the number variables", `${hints}[0] === "kp" && ${hints}.includes("k")`);
    assert.equal(await run<boolean>(`${hints}.some((n) => n === "M" || n === "Q")`), false, "a matrix is no number");
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

    // Julix's matrix Q on the Matrix's rows, with the mouse: ↓ lists the matrix variables only, a click takes Q, Enter sets
    await mouse(plate("m1"), 2);
    await until("m1's card", field("m1", "values"));
    await mouse(field("m1", "values"));
    await until("the field focused", `document.activeElement === ${field("m1", "values")}`);
    await key("ArrowDown", "ArrowDown", 40);
    await until("the matrix variables", `${hints}[0] === "M" && ${hints}.includes("Q")`);
    assert.equal(await run<boolean>(`${hints}.some((n) => n === "kp" || n === "k")`), false, "a number is no matrix");
    await mouse(hint("Q"));
    await until("Q taken", `${field("m1", "values")}?.value === "Q"`);
    await key("Enter", "Enter", 13);
    await until("m1 bound to Q", `${field("m1", "values")}?.classList.contains("bound")`);
    await key("Escape", "Escape", 27);

    // the flow's matrix M on the Variable block, from its list (a select: focused, M typed, as the keys choose in one)
    await mouse(plate("v1"), 2);
    await until("v1's card", field("v1", "name"));
    assert.deepEqual(await run<string[]>(`[...${field("v1", "name")}.options].map((o) => o.value).filter((v) => ["", "kp", "M", "k", "Q"].includes(v))`), ["", "kp", "M", "k", "Q"]);
    await run(`${field("v1", "name")}.focus()`);
    await cmd("Input.dispatchKeyEvent", { type: "keyDown", key: "M", code: "KeyM", windowsVirtualKeyCode: 77, text: "M" });
    await cmd("Input.dispatchKeyEvent", { type: "keyUp", key: "M", code: "KeyM", windowsVirtualKeyCode: 77 });
    await until("M chosen", `${field("v1", "name")}?.value === "M"`);
    await key("Escape", "Escape", 27);

    // save: every binding is in the file
    await key("s", "KeyS", 83, 2);
    await until("the save", `!document.querySelector(".pg-flow .dirty")`);
    const params = (f: { flow: { nodes: { id: string; params: object }[] } }) =>
      Object.fromEntries(f.flow.nodes.filter((n) => Object.keys(n.params).length).map((n) => [n.id, n.params]));
    assert.deepEqual(params(JSON.parse(fs.readFileSync(file, "utf8"))),
      { c1: { value: { var: "kp" } }, c2: { value: { var: "k" } }, m1: { values: { var: "Q" } }, v1: { name: "M" } });

    // reopen, and run: the Displays show kp's 4, Julix's 2.5, det Q = −2 and det M = 6
    await cmd("Page.navigate", { url: "about:blank" });
    await cmd("Page.navigate", { url: open });
    await until("the flow to open again", `(${flowHead}).startsWith("vars.psf") && (${flowHead}).includes("10 blocks")`, 40000);
    await mouse(plate("c2"), 2);
    await until("c2 still bound to k", `${field("c2")}?.value === "k" && ${field("c2")}.classList.contains("bound")`);
    await key("Escape", "Escape", 27);
    await key("r", "KeyR", 82, 2);
    await until("the run to end", `document.querySelector(".run-status.status-done, .run-status.status-failed")`, 40000);
    assert.equal(await run<boolean>(`!!document.querySelector(".run-status.status-done")`), true);
    await until("the Displays", `${displays}.join() === "2.5,4,6,−2"`);
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
