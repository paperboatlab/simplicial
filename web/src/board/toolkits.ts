// The toolkits' web parts (pb#172): every built-in block's `engine/toolkit/src/<package>/<block>/web/index.tsx`
// (and a package's own `web/index.tsx`) exports `register(host)`. The build bundles them all as `toolkit-web`
// (scripts/build.ts), so the page names no toolkit and no block; this calls each one once.
import parts from "toolkit-web";
import { toolkitWebHost } from "./host.ts";

for (const [path, part] of parts) {
  if (typeof part.register === "function") part.register(toolkitWebHost);
  else console.warn(`${path}: a toolkit's web/index must export register(host)`);
}
