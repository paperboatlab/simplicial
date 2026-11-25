import assert from "node:assert/strict";
import { test } from "node:test";
import { entitiesOf, graphPos, objectOfEntity, propValue, setLink, setPos, setProp } from "../src/station/stationEdits.ts";
import type { ObjectDef, Station } from "../src/protocol.ts";

const station: Station = { objects: [{ id: "cart", type: "cart", props: { mass: 1 } }, { id: "hinge", type: "hinge", links: { a: "cart" } }] };

test("a part of the scene picks its object; an object outlines its parts", () => {
  assert.equal(objectOfEntity("cart/wheel", station), "cart");
  assert.equal(objectOfEntity("cart", station), "cart");
  assert.equal(objectOfEntity("floor", station), null);
  assert.equal(objectOfEntity(null, station), null);
  assert.deepEqual(entitiesOf("cart", ["cart/a", "cart/b", "cartx/c", "hinge/d", "cart"]), ["cart/a", "cart/b", "cart"]);
  assert.deepEqual(entitiesOf(null, ["cart/a"]), []);
});

test("props, links and places change one object, and only it", () => {
  const s = setProp(station, "cart", "mass", { var: "m" });
  assert.deepEqual(s.objects[0].props, { mass: { var: "m" } });
  assert.equal(s.objects[1], station.objects[1]);
  assert.deepEqual(setLink(station, "hinge", "b", "cart").objects[1].links, { a: "cart", b: "cart" });
  assert.deepEqual(setLink(station, "hinge", "a", null).objects[1].links, {});
  assert.deepEqual(setPos(station, "cart", [10.4, 20.6]).objects[0].pos, [10, 21]);
  assert.deepEqual(graphPos(station.objects[1], 1), { x: 280, y: 0 });
  assert.deepEqual(graphPos({ id: "x", type: "x", pos: [5, 6] }, 3), { x: 5, y: 6 });
});

test("a prop reads its own value, else its type's default", () => {
  const def = { type: "cart", label: "Cart", role: "body", links: [], props: [{ id: "mass", type: "number", default: 2 }, { id: "len", type: "number", default: 3 }] } as unknown as ObjectDef;
  assert.equal(propValue(station.objects[0], def, "mass"), 1);
  assert.equal(propValue(station.objects[0], def, "len"), 3);
  assert.equal(propValue(station.objects[0], undefined, "len"), undefined);
});
