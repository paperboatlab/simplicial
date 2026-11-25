// Builds the page into web/dist/: the bundle (esbuild), its fonts, the app mark's frames (AppMark and the
// splash load them beside the bundle) and index.html. `--watch` rebuilds on change.
import * as esbuild from "esbuild";
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
const options: esbuild.BuildOptions = {
  entryPoints: [path.join(web, "src/main.tsx")],
  bundle: true, format: "esm", outdir: dist, jsx: "automatic", target: "es2022", minify: !process.argv.includes("--watch"),
  sourcemap: true, loader: { ".woff2": "file", ".woff": "file", ".ttf": "file" }, assetNames: "fonts/[name]-[hash]", logLevel: "warning",
};
if (process.argv.includes("--watch")) { await (await esbuild.context(options)).watch(); console.log("watching web/src/ → web/dist/"); }
else await esbuild.build(options);
