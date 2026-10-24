// Live suite: runs snapper.js against the REAL Pages data. Skipped unless LIVE=1.
//   LIVE=1 node --test test/live.test.mjs
// Optional env: LIVE_CELLS, LIVE_GRAPH (base URLs), LIVE_SAMPLES (default 6), LIVE_SEED (default 1)
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { freshModule, mulberry32 } from "./helpers/world.mjs";
import { referenceDistances, expectedHalfNodes, regionOf, sortHalves } from "./helpers/reference.mjs";

const LIVE = !!process.env.LIVE;
const CELLS = (process.env.LIVE_CELLS ?? "https://marswalk-cells.pages.dev").replace(/\/$/, "");
const GRAPH = (process.env.LIVE_GRAPH ?? "https://marswalk-graph.pages.dev").replace(/\/$/, "");
const N = +(process.env.LIVE_SAMPLES ?? 6), SEED = +(process.env.LIVE_SEED ?? 1);
const opt = { skip: LIVE ? false : "set LIVE=1 to run against the real data", timeout: 900000 };
const PIX = 0.003374120830641;

const get = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`); return r; };
let _meta;
async function meta() {
  return (_meta ??= (async () => {
    const [c, g, ew] = await Promise.all([get(`${CELLS}/cells.meta.json`).then((r) => r.json()), get(`${GRAPH}/graph.meta.json`).then((r) => r.json()),
      get(`${GRAPH}/ewCm.bin`).then((r) => r.arrayBuffer())]);
    return { c, g, ewCm: new Uint32Array(ew), lamCm: Math.round(g.lambdaM * 100), bias: g.reverseBiasPct ?? 25 };
  })());
}
const tiles = new Map();
const cellTile = (tx, ty) => { const k = `${tx},${ty}`; if (!tiles.has(k)) tiles.set(k, get(`${CELLS}/tiles/${ty}/${tx}.bin`).then(async (r) => new Uint8Array(await r.arrayBuffer()))); return tiles.get(k); };
async function graphNodes(tx, ty) {
  const res = await fetch(`${GRAPH}/tiles/${ty}/${tx}.bin`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const dv = new DataView(await res.arrayBuffer()), nN = dv.getUint32(4, true), out = [];
  assert.equal(dv.getUint32(0, true), 0x3254474d, "graph magic");
  for (let i = 0; i < nN; i++) { const p = 16 + i * 16; out.push({ x: dv.getUint32(p, true), row: dv.getUint16(p + 4, true), dir: dv.getUint8(p + 6), cc: dv.getUint8(p + 7) }); }
  return out;
}
const fresh = async () => { const mod = await freshModule(); mod.configure({ cellsBase: CELLS, graphBase: GRAPH }); return mod; };
const ll = (x, r, m) => ({ lat: 90 - (r + m.g.firstRow + 0.5) * PIX, lon: -180 + (x + 0.5) * PIX });

describe("live data", opt, () => {
  it("metadata is internally consistent", opt, async () => {
    const m = await meta();
    assert.equal(m.c.gz, false, "cells must be stored raw");
    for (const k of ["tile", "width", "rows", "tilesX", "tilesY"]) assert.equal(m.c[k], m.g[k], k);
    assert.ok(m.g.tilesX * m.g.tile >= m.g.width && (m.g.tilesX - 1) * m.g.tile < m.g.width, "tilesX covers width exactly");
    assert.ok(m.g.tilesY * m.g.tile >= m.g.rows && (m.g.tilesY - 1) * m.g.tile < m.g.rows, "tilesY covers rows exactly");
    assert.equal(m.ewCm.length, m.g.rows);
    assert.equal(m.g.tile % m.g.region, 0);
    assert.ok(m.g.reverseBiasPct === 25 && m.g.nsCm > 0 && m.g.lambdaM > 0);
    assert.ok(m.ewCm.every((v) => v >= 1), "ewCm entries positive");
  });

  it("corner and sampled tiles load with correct sizes/magic", opt, async () => {
    const { g } = await meta(), rnd = mulberry32(SEED);
    const list = [[0, 0], [g.tilesX - 1, 0], [0, g.tilesY - 1], [g.tilesX - 1, g.tilesY - 1]];
    for (let i = 0; i < 6; i++) list.push([Math.floor(rnd() * g.tilesX), Math.floor(rnd() * g.tilesY)]);
    for (const [tx, ty] of list) {
      assert.equal((await cellTile(tx, ty)).length, g.tile * g.tile, `cell tile ${tx},${ty}`);
      await graphNodes(tx, ty);
    }
  });

  it("matches the independent reference solver on sampled land points (both directions)", opt, async (t) => {
    const m = await meta(), { g } = m, rnd = mulberry32(SEED), mod = await fresh();
    let done = 0, guard = 0;
    while (done < N && guard++ < 500) {
      const tx = Math.floor(rnd() * g.tilesX), ty = Math.floor(rnd() * g.tilesY);
      const x = tx * g.tile + Math.floor(rnd() * Math.min(g.tile, g.width - tx * g.tile));
      const r = ty * g.tile + Math.floor(rnd() * Math.min(g.tile, g.rows - ty * g.tile));
      const tile = await cellTile(tx, ty), byteAt = (cx, cr) => tile[(cr % g.tile) * g.tile + (cx % g.tile)];
      if ((byteAt(x, r) & 15) === 15) continue;
      const nodes = await graphNodes(tx, ty), region = regionOf(g.width, g.rows, g.region, x, r);
      const P = { byteAt, ewCm: m.ewCm, nsCm: g.nsCm, lamCm: m.lamCm, bias: m.bias };
      const { lat, lon } = ll(x, r, m);
      for (const rev of [false, true]) {
        const got = await mod.snapCandidates(lat, lon, { count: 1e6, direction: rev ? "to" : "from" });
        const exp = expectedHalfNodes(nodes, g.width, region, referenceDistances(P, region, x, r, rev));
        assert.deepEqual(sortHalves(got.map(({ key, side, cost }) => ({ key, side, cost }))), exp, `(${x},${r}) ${rev ? "to" : "from"}`);
        t.diagnostic(`(${x},${r}) ${rev ? "to" : "from"}: ${exp.length} half-nodes, nearest ${exp[0]?.cost ?? "-"} cm`);
      }
      done++;
    }
    assert.equal(done, N, "could not find enough land samples");
  });

  it("snapping at a node's own cell returns that node at cost 0", opt, async () => {
    const m = await meta(), { g } = m, mod = await fresh(), rnd = mulberry32(SEED + 1);
    let checked = 0;
    for (let tries = 0; tries < 40 && checked < 5; tries++) {
      const tx = Math.floor(rnd() * g.tilesX), ty = Math.floor(rnd() * g.tilesY), nodes = await graphNodes(tx, ty), tile = await cellTile(tx, ty);
      const cand = nodes.filter((n) => n.dir === 0 || n.dir === 1 || n.dir === 2).filter((n) => (tile[(n.row % g.tile) * g.tile + (n.x % g.tile)] & 15) < 15);
      if (!cand.length) continue;
      const n = cand[Math.floor(rnd() * cand.length)], { lat, lon } = ll(n.x, n.row, m);
      const got = await mod.snapCandidates(lat, lon, { count: 50 });
      assert.ok(got.some((c) => c.key === `${n.x},${n.row},${n.dir}` && c.side === 0 && c.cost === 0), `node ${n.x},${n.row},${n.dir}`);
      checked++;
    }
    assert.ok(checked >= 3);
  });

  it("grid corners and the longitude seam do not throw; results stay inside the grid", opt, async (t) => {
    const m = await meta(), { g } = m, mod = await fresh();
    const pts = [[0, 0], [g.width - 1, 0], [0, g.rows - 1], [g.width - 1, g.rows - 1]];
    for (const [x, r] of pts) {
      const { lat, lon } = ll(x, r, m), c = await mod.snapCandidates(lat, lon, { count: 8 });
      for (const n of c) { assert.ok(n.cell.column >= 0 && n.cell.column < g.width && n.cell.row >= 0 && n.cell.row < g.rows); assert.ok(Number.isFinite(n.cost)); }
      t.diagnostic(`corner (${x},${r}): ${c.length} candidates${c[0] ? `, nearest ${c[0].key} cost ${c[0].cost}` : ""}`);
    }
    const lat = ll(100, Math.floor(g.rows / 2), m).lat;
    for (const lon of [-179.9995, 179.9995, -180, 180]) { const c = await mod.snapCandidates(lat, lon, { count: 3 }); t.diagnostic(`lon ${lon}: ${c.length} candidates`); }
  });

  it("a known landmark snaps near where it should (set LIVE_LANDMARK=lat,lon)", { ...opt, skip: LIVE && process.env.LIVE_LANDMARK ? false : "set LIVE_LANDMARK=lat,lon" }, async (t) => {
    const [lat, lon] = process.env.LIVE_LANDMARK.split(",").map(Number), mod = await fresh();
    const n = await mod.snapToNode(lat, lon);
    assert.ok(n, "no node found");
    const dKm = Math.hypot((n.lat - lat) * 59.27, (n.lon - lon) * 59.27 * Math.cos(lat * Math.PI / 180));
    t.diagnostic(`snapped to ${n.key} (${n.kind}) at ${n.lat.toFixed(4)},${n.lon.toFixed(4)}, ~${dKm.toFixed(1)} km away, cost ${n.cost} cm, moved=${n.request.moved}`);
    assert.ok(dKm < 60, "nearest node is implausibly far");
  });
});
