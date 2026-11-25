// The 3D view block's instrument: the Station's scene, on the Board. The page bundles this file and calls register(host).
import type { ToolkitWebHost } from "@paperboat/host";
import { View3DInstrument } from "./View3DInstrument.tsx";
import "./view3d.css";

export function register(host: ToolkitWebHost): void {
  host.registerInstrument("view3d", View3DInstrument, { size: "large", order: 1 });
}
