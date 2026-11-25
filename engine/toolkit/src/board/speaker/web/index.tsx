// The speaker block's instrument. The page bundles this file and calls register(host).
import type { ToolkitWebHost } from "@paperboat/host";
import { SpeakerInstrument } from "./SpeakerInstrument.tsx";
import "./speaker.css";

export function register(host: ToolkitWebHost): void {
  host.registerInstrument("speaker", SpeakerInstrument, { size: "normal", order: 0 });
}
