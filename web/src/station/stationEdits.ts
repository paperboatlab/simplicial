// What the Station page does to the station (its objects): pure, so it is tested. The page sends the result
// (`station.set`) and keeps it, since the station doesn't send it back.
import type { ObjectDef, ParamValue, Station, StationObject } from "../protocol.ts";

/** The station object a scene entity belongs to: entities are named `<object id>/<part>`; null when none is. */
export function objectOfEntity(entityId: string | null, station: Station | null): string | null {
  if (!entityId || !station) return null;
  const id = entityId.split("/")[0];
  return station.objects.some((o) => o.id === id) ? id : null;
}

/** The scene entities that draw an object: its id, or `<id>/…`. */
export const entitiesOf = (objectId: string | null, ids: readonly string[]): string[] =>
  objectId ? ids.filter((e) => e === objectId || e.startsWith(`${objectId}/`)) : [];

const change = (station: Station, id: string, f: (o: StationObject) => StationObject): Station =>
  ({ ...station, objects: station.objects.map((o) => (o.id === id ? f(o) : o)) });

/** An object's prop set (a number, a bound variable…). */
export const setProp = (station: Station, id: string, prop: string, value: ParamValue): Station =>
  change(station, id, (o) => ({ ...o, props: { ...o.props, [prop]: value } }));

/** An object's link slot filled with another object, or emptied (null). */
export const setLink = (station: Station, id: string, slot: string, to: string | null): Station =>
  change(station, id, (o) => {
    const links = { ...o.links };
    if (to) links[slot] = to;
    else delete links[slot];
    return { ...o, links };
  });

/** Where an object sits on the Graph view. */
export const setPos = (station: Station, id: string, pos: [number, number]): Station =>
  change(station, id, (o) => ({ ...o, pos: [Math.round(pos[0]), Math.round(pos[1])] }));

/** An object's place on the Graph view: its own, else a row of cards left to right. */
export const graphPos = (o: StationObject, i: number): { x: number; y: number } =>
  o.pos ? { x: o.pos[0], y: o.pos[1] } : { x: i * 280, y: 0 };

/** An object's prop value: its own, else its type's default. */
export const propValue = (o: StationObject, def: ObjectDef | undefined, prop: string): ParamValue | undefined =>
  o.props?.[prop] ?? def?.props.find((p) => p.id === prop)?.default;
