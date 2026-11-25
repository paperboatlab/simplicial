import { Instrument } from "@paperboatlab/ui/plot";
import { SceneView } from "@paperboatlab/ui/stage";
import type { InstrumentProps } from "@paperboat/host";

/** The Board's 3D view: the Station's scene itself, on the kit's stage, to keep it in view while the Flow and Board run. It has no wire of its own. */
export function View3DInstrument({ name, state, scene }: InstrumentProps) {
  const count = Object.keys(state.entities).length;
  return (
    <Instrument name={name} detail="3D view" value={count === 1 ? "1 object" : `${count} objects`} idle={!count} hint={count ? undefined : "Add an object or a mesh on the Station"} className="view3d">
      {count > 0 && <SceneView key={JSON.stringify(state.view)} view={state.view} grid={state.view.mode !== "3d" || state.view.grid !== false} entities={scene} cube="compact" />}
    </Instrument>
  );
}
