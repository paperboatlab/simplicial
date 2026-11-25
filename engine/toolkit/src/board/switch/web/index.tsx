// The switch block's instrument. The page bundles this file and calls register(host); it names none of it.
import type { ToolkitWebHost } from "@paperboat/host";
import { SwitchInstrument } from "./SwitchInstrument.tsx";
import "./switch.css";

export function register(host: ToolkitWebHost): void {
  host.registerInstrument("switch", SwitchInstrument, { size: "compact" });
}
