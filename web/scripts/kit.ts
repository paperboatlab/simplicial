// The tests' loader: node strips no types under node_modules, and the kit ships TypeScript (and TSX),
// so its files go through esbuild on the way in. `node --import ./web/scripts/kit.ts --test …`
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";

registerHooks({
  load(url, context, next) {
    if (!/\/node_modules\/@paperboatlab\/ui\/.*\.tsx?$/.test(url)) return next(url, context);
    const { code } = transformSync(readFileSync(fileURLToPath(url), "utf8"), { loader: url.endsWith("x") ? "tsx" : "ts", jsx: "automatic", format: "esm" });
    return { format: "module", source: code, shortCircuit: true };
  },
});
