// Settings (REBRAND "Settings"): the kit's window, File › Settings… or Ctrl , (Help › Keyboard shortcuts, Ctrl /, opens it
// on Shortcuts). General: the theme every Paperboat app shares; Simplicial: Station (the one this window is on), Runs
// (its run defaults, Run settings…) and Canvas (the Flow's minimap); Hub, while the workspace is one: its name and folder, the File menu's Switch and
// Close (its own settings are Malachite's); Shortcuts: the registry's keys by menu, then the Flow canvas's. No Editor:
// Simplicial has no editor pane.
import { Icon, Key, Settings, SettingRow, SettingsSection, ShortcutList, Switch, ThemeSetting, isEnabled, type Command, type SettingsPage, type Theme } from "@paperboatlab/ui";
import { Keys } from "@paperboatlab/ui/canvas";
import { tilde, type Workspace } from "@paperboatlab/ui/workspace";
import { GESTURES } from "./flow/FlowEditor.tsx";
import { MENUS } from "./menus.ts";
import type { RunSettings } from "./protocol.ts";
import { runLine } from "./runSettings.ts";

/** A key that runs a command of the registry, greyed with why when it can't. */
const Run = ({ c, label }: { c?: Command; label?: string }) => c ? (
  <span title={isEnabled(c) ? undefined : c.why}><Key size="sm" disabled={!isEnabled(c)} onClick={() => c.run()}>{label ?? c.label}</Key></span>
) : null;

export function SettingsWindow({ page, onClose, theme, onTheme, station, address, runDefaults, minimap, onMinimap, workspace, home, onMalachite, commands }: {
  page: string;
  onClose: () => void;
  theme: Theme;
  onTheme: (t: Theme) => void;
  /** The station this window is on (hello's engine), and where. */
  station?: string;
  address: string;
  runDefaults: RunSettings;
  minimap: boolean;
  onMinimap: (on: boolean) => void;
  workspace: Workspace | null;
  home?: string;
  onMalachite?: () => void;
  /** Every command (the File menu's and the registry's): the Hub page's keys and the Shortcuts page read them. */
  commands: Command[];
}) {
  const cmd = (id: string) => commands.find((c) => c.id === id);
  const hub = workspace?.kind === "hub" ? workspace : null;
  const pages: SettingsPage[] = [
    { id: "general", label: "General", icon: "settings-gear", body: <ThemeSetting theme={theme} onTheme={onTheme} /> },
    { id: "simplicial", label: "Simplicial", icon: "mark-simplicial", body: <>
      <SettingsSection title="Station">
        <SettingRow label="Station" hint={address}>
          <span className="well">{station ?? "none"}</span><Run c={cmd("run.station")} />
        </SettingRow>
      </SettingsSection>
      <SettingsSection title="Runs">
        <SettingRow label="Run defaults" hint="The station's; what a flow changes (Run settings…, the run dock) is kept in its file">
          <span className="well">{runLine(runDefaults)}</span><Run c={cmd("run.settings")} />
        </SettingRow>
      </SettingsSection>
      <SettingsSection title="Canvas">
        <SettingRow label="Minimap" hint="In Navigator, at the Flow canvas's corner">
          <Switch label="Minimap" checked={minimap} onChange={onMinimap} />
        </SettingRow>
      </SettingsSection>
    </> },
    ...(hub ? [{ id: "hub", label: "Hub", icon: "mark-malachite", body: <div className="hub-settings">
      <SettingsSection title="The hub">
        <SettingRow label="Hub" hint="Simplicial's workspace: Open and Save as work in it">
          <span className="well">{hub.name}</span><Run c={cmd("file.connect")} label="Switch hub…" />
        </SettingRow>
        <SettingRow label="Folder" hint="Where its files are">
          <span className="well wide" title={hub.root}><Icon name="folder" size={14} /><span>{`\u200e${tilde(hub.root, home)}`}</span></span>
          <Run c={cmd("file.closeWorkspace")} />
        </SettingRow>
      </SettingsSection>
      <p className="settings-note">The hub's own settings (its name, author, history) are set in Malachite.
        {onMalachite && <> <Key size="sm" kind="quiet" onClick={onMalachite}>Open in Malachite</Key></>}</p>
    </div> } satisfies SettingsPage] : []),
    { id: "shortcuts", label: "Shortcuts", icon: "keys", body: <>
      {/* Alt M (a key only, no menu) is View's */}
      <ShortcutList commands={commands.map((c) => (c.menu === "keys" ? { ...c, menu: "view" } : c))} menus={MENUS} />
      <SettingsSection title="On the Flow canvas">
        {GESTURES.filter(([what, how]) => how.includes("`") && what !== "Help").map(([what, how]) =>  /* the ones with keys; ? is the canvas's own list */ <div key={what} className="set-row key-row"><span>{what}</span><small className="gesture"><Keys text={how} /></small></div>)}
      </SettingsSection>
    </> },
  ];
  return <Settings app="Simplicial" pages={pages} page={page} onClose={onClose} />;
}
