declare module "*.css";
/** The toolkits' web parts, gathered by the build (scripts/build.ts): [path, module] for each. */
declare module "toolkit-web" {
  const parts: [string, { register?: (host: import("./board/host.ts").ToolkitWebHost) => void }][];
  export default parts;
}
