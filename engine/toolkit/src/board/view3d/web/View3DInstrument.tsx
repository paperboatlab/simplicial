import { Instrument } from "@paperboatlab/ui/plot";
import type { InstrumentProps } from "@paperboat/host";

/**
 * The Board's 3D view: the Station's scene itself, to keep the stage in view while the Flow and Board run.
 * It has no wire of its own. Until the Station's 3D view is in the page (simplicial#5) it says what it would show.
 */
export function View3DInstrument({ name, state }: InstrumentProps) {
  const count = Object.keys(state.entities).length;
  return (
    <Instrument name={name} detail="3D view" value={count === 1 ? "1 object" : `${count} objects`} className="view3d">
      <span className="view3d-empty">{count ? "The Station's 3D view shows here once the Station page draws it" : "Add an object or a mesh on the Station"}</span>
    </Instrument>
  );
}
