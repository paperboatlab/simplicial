// The choice block's instrument. The page bundles this file and calls register(host).
import type { ToolkitWebHost } from "@paperboat/host";
import { ChoiceInstrument } from "./ChoiceInstrument.tsx";
import "./choice.css";

export function register(host: ToolkitWebHost): void {
  host.registerInstrument("choice", ChoiceInstrument, { size: "normal" });
}
