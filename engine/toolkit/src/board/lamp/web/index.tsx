// The lamp block's instrument. The page bundles this file and calls register(host); it names none of it.
import type { ToolkitWebHost } from "@paperboat/host";
import { LampInstrument } from "./LampInstrument.tsx";
import "./lamp.css";

export function register(host: ToolkitWebHost): void {
  host.registerInstrument("lamp", LampInstrument, { size: "compact", order: 0 });
}
