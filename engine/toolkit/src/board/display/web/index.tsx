// The display block's instrument. The page bundles this file and calls register(host); it names none of it.
import type { ToolkitWebHost } from "@paperboat/host";
import { DisplayInstrument } from "./DisplayInstrument.tsx";
import "./display.css";

export function register(host: ToolkitWebHost): void {
  host.registerInstrument("display", DisplayInstrument, { size: "compact", order: 0 });
}
