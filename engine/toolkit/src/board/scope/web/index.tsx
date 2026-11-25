// The scope block's instrument. The page bundles this file and calls register(host); it names none of it.
import type { ToolkitWebHost } from "@paperboat/host";
import { scopeWidget } from "@paperboatlab/ui/scope";
import { ScopeInstrument } from "./ScopeInstrument.tsx";

export function register(host: ToolkitWebHost): void {
  // The same id the kit's Scope marks itself with: the adapter and the widget cannot drift.
  host.registerInstrument(scopeWidget.id, ScopeInstrument, { size: "large" });
}
