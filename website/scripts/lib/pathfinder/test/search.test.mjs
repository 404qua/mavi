import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeWorld, centerLatLon } from "./helpers/world.mjs";
import { makeSearch } from "../search.js";

describe("search.js pipeline", () => {
  it("returns null when either snapper result is null or empty", async () => {
    const search = makeSearch({});
    assert.equal(await search.findPathDetailed(null, []), null);
    assert.equal(await search.findPathDetailed([], null), null);
    assert.equal(await search.findPath(null, []), null);
  });

  it("findPathDetailed returns a valid cell coordinate sequence for direct in-region route", async () => {
    const world = makeWorld({ W: 70, ROWS: 50, nodes: [{ x: 2, row: 2, dir: 0 }] }).install();
    const pf = await import("../snapper.js");
    const search = makeSearch(pf);

    const p1 = centerLatLon(5, 5, world.firstRow);
    const p2 = centerLatLon(10, 8, world.firstRow);

    const starts = await pf.snapCandidates(p1.lat, p1.lon, { direction: "from" });
    const ends = await pf.snapCandidates(p2.lat, p2.lon, { direction: "to" });

    assert.ok(starts.length > 0, "has start candidates");
    assert.ok(ends.length > 0, "has end candidates");

    const res = await search.findPathDetailed(starts, ends);
    assert.ok(res, "result exists");
    assert.equal(res.source, "direct");
    assert.ok(Array.isArray(res.coords), "coords is array");
    assert.ok(res.coords.length >= 4, "coords has at least 2 points (4 elements)");

    // Coordinates are [lon, lat, lon, lat, ...] suitable for ReplaceCurrentPath
    for (let i = 0; i < res.coords.length; i += 2) {
      const lon = res.coords[i];
      const lat = res.coords[i + 1];
      assert.ok(lon >= -180 && lon <= 180, `valid lon ${lon}`);
      assert.ok(lat >= -90 && lat <= 90, `valid lat ${lat}`);
    }
  });

  it("findPath returns flat array directly", async () => {
    const world = makeWorld({ W: 70, ROWS: 50, nodes: [{ x: 2, row: 2, dir: 0 }] }).install();
    const pf = await import("../snapper.js");
    const search = makeSearch(pf);

    const p1 = centerLatLon(5, 5, world.firstRow);
    const p2 = centerLatLon(10, 8, world.firstRow);

    const starts = await pf.snapCandidates(p1.lat, p1.lon, { direction: "from" });
    const ends = await pf.snapCandidates(p2.lat, p2.lon, { direction: "to" });

    const line = await search.findPath(starts, ends);
    assert.ok(Array.isArray(line));
    assert.ok(line.length >= 4);
  });
});

