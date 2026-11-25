// Builds the page into web/dist/: the bundle (esbuild), its fonts, the app mark's frames (AppMark and the
// splash load them beside the bundle) and index.html. `--watch` rebuilds on change.
import * as esbuild from "esbuild";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const web = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(web, "dist");
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
fs.cpSync(path.join(web, "../node_modules/@paperboatlab/ui/src/marks/simplicial"), path.join(dist, "marks/simplicial"), { recursive: true });
fs.writeFileSync(path.join(dist, "index.html"), `<!doctype html>
<html lang="en" data-app="simplicial">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Simplicial</title>
<link rel="icon" href="marks/simplicial/rest.webp">
<link rel="stylesheet" href="main.css">
</head>
<body><div id="root"></div><script type="module" src="main.js"></script></body>
</html>
`);
// The toolkits' web parts (board/toolkits.ts): every built-in `engine/toolkit/src/<package>/[<block>/]web/index.tsx`,
// found at build time; they import the page's host as `@paperboat/host`.
const toolkits = path.join(web, "../engine/toolkit/src");
const toolkitWeb: esbuild.Plugin = {
  name: "toolkit-web",
  setup(build) {
    build.onResolve({ filter: /^toolkit-web$/ }, () => ({ path: "toolkit-web", namespace: "toolkit-web" }));
    build.onLoad({ filter: /.*/, namespace: "toolkit-web" }, () => {
      const parts = fs.globSync(["*/*/web/index.{ts,tsx}", "*/web/index.{ts,tsx}"], { cwd: toolkits }).sort();
      return {
        contents: parts.map((p, i) => `import * as p${i} from ${JSON.stringify(path.join(toolkits, p))};`).join("\n")
          + `\nexport default [${parts.map((p, i) => `[${JSON.stringify(p)}, p${i}]`).join(", ")}];`,
        resolveDir: web, watchDirs: [toolkits], loader: "ts",
      };
    });
  },
};
// The page's version and commit, for About (css.d.ts declares them).
const version = JSON.parse(fs.readFileSync(path.join(web, "../package.json"), "utf8")).version as string;
let commit = "";
try { commit = execSync("git rev-parse --short HEAD", { cwd: web, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { /* not a checkout */ }
const options: esbuild.BuildOptions = {
  entryPoints: [path.join(web, "src/main.tsx")],
  bundle: true, format: "esm", outdir: dist, jsx: "automatic", target: "es2022", minify: !process.argv.includes("--watch"),
  sourcemap: true, define: { __VERSION__: JSON.stringify(version), __COMMIT__: JSON.stringify(commit) }, plugins: [toolkitWeb], alias: { "@paperboat/host": path.join(web, "src/board/host.ts") }, loader: { ".woff2": "file", ".woff": "file", ".ttf": "file" }, assetNames: "fonts/[name]-[hash]", logLevel: "warning",
};
if (process.argv.includes("--watch")) { await (await esbuild.context(options)).watch(); console.log("watching web/src/ → web/dist/"); }
else await esbuild.build(options);
