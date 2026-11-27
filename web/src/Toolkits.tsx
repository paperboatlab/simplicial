// Run › Toolkits…: the optional toolkits in the kit's package manager (PackageWindow, PackagePanel: "Julix shows Julia,
// Simplicial its toolkits, Articula the Modelica libraries"), from legacy's Toolkits.tsx. The engine is the runtime, the
// installed toolkits the environment, toolkits.toml the registry; installing, updating and removing are the station's
// (`toolkit.install`, `toolkit.uninstall`; `toolkits.status` says how it goes, the Console what it printed), and a
// restart of the station picks the blocks up.
import { newerRelease, PackagePanel, PackageWindow } from "@paperboatlab/ui/packages";
import { useEffect, useState } from "react";
import type { ClientMsg, ToolkitStatus } from "./protocol.ts";

export function Toolkits({ toolkits, connected, version, station, send, onClose }: {
  toolkits: ToolkitStatus[];
  connected: boolean;
  /** The engine serving the station (hello.version). */
  version?: string;
  /** The station's name (hello.engine). */
  station?: string;
  send: (m: ClientMsg) => void;
  onClose: () => void;
}) {
  // what was asked and not yet answered by a toolkits.status, so the row says so at once
  const [asked, setAsked] = useState<Record<string, string>>({});
  useEffect(() => setAsked({}), [toolkits]);
  const items = toolkits.filter((t) => !t.builtin);
  const busyOf = (t: ToolkitStatus) => t.busy ?? asked[t.name];
  const working = items.find((t) => !!busyOf(t));
  const versionOf = (t: ToolkitStatus) => (t.version && t.version !== "unknown" ? t.version : undefined);
  // the releases, once a window (GitHub's API allows 60 calls an hour: one ask, every toolkit's)
  useEffect(() => { if (connected && items.some((t) => !t.versions?.length)) send({ type: "toolkit.versions", name: items[0].name }); }, [connected]); // eslint-disable-line react-hooks/exhaustive-deps -- once
  const install = (name: string, v?: string) => {
    setAsked((a) => ({ ...a, [name]: "installing" }));
    send({ type: "toolkit.install", name, ...(v ? { version: v } : {}) });
  };
  return (
    <PackageWindow title="Toolkits" tags={[version && `engine ${version}`, station]} onClose={onClose}>
      <PackagePanel noun="toolkit" busy={working ? `${busyOf(working)} ${working.name}` : ""}
        error={connected ? undefined : "Not connected to a station: toolkits install into the engine that serves one."}
        runtime={{ title: "Simplicial engine", tag: version, hint: "Toolkits build against this engine and install beside it; Simplicial updates with paperboat app update simplicial." }}
        environment={{
          title: "toolkits",
          packages: items.filter((t) => t.installed || busyOf(t)).map((t) => ({
            name: t.name, version: versionOf(t), status: busyOf(t) ? `${busyOf(t)}…` : undefined,
            keep: t.required ? "This station needs it: it can't be removed" : undefined, update: newerRelease(versionOf(t), t.versions),
          })),
          empty: "No optional toolkits installed. Add one from the registry.",
          remove: connected ? (name) => { setAsked((a) => ({ ...a, [name]: "uninstalling" })); send({ type: "toolkit.uninstall", name }); } : undefined,
          update: connected ? install : undefined,
          actions: [{ label: "Restart station", title: "Its blocks come with a restart, after installing or removing", disabled: !connected, run: () => { onClose(); send({ type: "station.restart" }); } }],
        }}
        registry={{
          title: "toolkits.toml", pickVersion: true, itemsLabel: `${items.length} ${items.length === 1 ? "toolkit" : "toolkits"}`,
          items: items.map((t) => ({
            name: t.name, latest: versionOf(t) ?? t.default ?? t.versions?.[0], description: t.description, repo: t.repo,
            versions: [...(t.versions ?? []), "dev"], facts: t.required && !t.installed ? ["missing: this station needs it"] : undefined,
          })),
          add: (name, v) => connected && install(name, v),
        }} />
    </PackageWindow>
  );
}
