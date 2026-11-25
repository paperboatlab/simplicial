declare module "*.css";
/** The toolkits' web parts, gathered by the build (scripts/build.ts): [path, module] for each. */
declare module "toolkit-web" {
  const parts: [string, { register?: (host: import("./board/host.ts").ToolkitWebHost) => void }][];
  export default parts;
}
/** The page's version (package.json) and its commit ("" outside a git checkout), set by the build (scripts/build.ts). */
declare const __VERSION__: string;
declare const __COMMIT__: string;
