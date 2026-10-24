// Offline suite for snapper.js (no network). Run:  node --test test/pathfinder.test.mjs
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { freshModule, makeWorld, centerLatLon, mulberry32, binResponse } from "./helpers/world.mjs";
import { referenceDistances, expectedHalfNodes, regionOf, stepWeight, sortHalves } from "./helpers/reference.mjs";

const OPEN = 0xf1, WALL = 0xff;
async function setup(opts, cfg) {
  const world = makeWorld(opts).install();
  const mod = await freshModule();
  if (cfg) mod.configure(cfg);
  const at = (x, r) => centerLatLon(x, r, world.firstRow, cfg?.lonOrigin ?? -180);
  return { world, mod, at };
}
const snap = (t, x, r, o) => { const { lat, lon } = t.at(x, r); return t.mod.snapCandidates(lat, lon, o); };

// ---------------------------------------------------------------------------
describe("geometry", () => {
  const m = { width: 106694, rowCount: 44456, firstRow: 4446 };
  it("cell <-> lat/lon round-trips at corners, seam and middle", async () => {
    const mod = await freshModule();
    for (const [x, r] of [[0, 0], [1, 1], [53346, 22228], [53347, 22229], [m.width - 2, m.rowCount - 2], [m.width - 1, m.rowCount - 1], [0, m.rowCount - 1], [m.width - 1, 0]]) {
      const ll = mod.cellToLatLon(x, r, m);
      assert.ok(ll.lon >= -180 && ll.lon <= 180, `lon ${ll.lon}`);
      assert.deepEqual(mod.latLonToCell(ll.lat, ll.lon, m), { column: x, row: r });
    }
  });
  it("lon +-180 both land on the seam columns; lon wraps by 360", async () => {
    const mod = await freshModule();
    assert.equal(mod.latLonToCell(0, -180, m).column, 0);
    assert.equal(mod.latLonToCell(0, 180, m).column, 0);               // documented: +180 wraps to column 0
    assert.equal(mod.latLonToCell(0, 179.999, m).column, m.width - 1);
    assert.deepEqual(mod.latLonToCell(10, 25, m), mod.latLonToCell(10, 25 + 360, m));
    assert.deepEqual(mod.latLonToCell(10, 25, m), mod.latLonToCell(10, 25 - 360, m));
  });
  it("rejects bad input and latitudes outside the covered band", async () => {
    const mod = await freshModule();
    const rowLat = (r) => 90 - (r + m.firstRow + 0.5) * 0.003374120830641;
    assert.doesNotThrow(() => mod.latLonToCell(rowLat(0), 0, m));
    assert.doesNotThrow(() => mod.latLonToCell(rowLat(m.rowCount - 1), 0, m));
    assert.throws(() => mod.latLonToCell(rowLat(-1), 0, m), /outside the covered band/);
    assert.throws(() => mod.latLonToCell(rowLat(m.rowCount), 0, m), /outside the covered band/);
    assert.throws(() => mod.latLonToCell(91, 0, m), /bad lat\/lon/);
    assert.throws(() => mod.latLonToCell(NaN, 0, m), /bad lat\/lon/);
    assert.throws(() => mod.latLonToCell(0, Infinity, m), /bad lat\/lon/);
  });
  it("configure({lonOrigin}) shifts the longitude mapping", async () => {
    const mod = await freshModule(); mod.configure({ lonOrigin: 0 });
    assert.equal(mod.latLonToCell(0, 5 * 0.003374120830641 + 0.001, m).column, 5);
  });
});

// ---------------------------------------------------------------------------
describe("weights (golden numbers, hand-derived from buildGraph.cpp stepWeight)", () => {
  it("the BigInt reference reproduces the hand-derived constants", () => {
    const P = { lamCm: 5000, nsCm: 20000, bias: 25 };
    assert.equal(stepWeight(20000, 3, 3, P), 35000);
    assert.equal(stepWeight(20000, 2, 12, P), 61250);
    assert.equal(stepWeight(20000, 12, 2, P), 48750);
  });
  it("straight uniform N/S walk = steps x 35000 cm (cost 3 terrain)", async () => {
    const t = await setup({ cell: () => 0xf3, nodes: [{ x: 5, row: 0, dir: 0 }] });
    const c = await snap(t, 5, 5, { count: 1 });
    assert.equal(c[0].cost, 5 * 35000);
  });
  it("E/W steps use the per-row ewCm width", async () => {
    const t = await setup({ cell: () => 0xf3, nodes: [{ x: 10, row: 5, dir: 0 }] });
    const c = await snap(t, 5, 5, { count: 1 });
    const step = stepWeight(t.world.ewCm[5], 3, 3, { lamCm: 5000, nsCm: 20000, bias: 25 });
    assert.equal(c[0].cost, 5 * step);
  });
  it("direction matters: entering a costly cell is dearer than leaving it", async () => {
    const cell = (x, r) => (x === 5 && r === 5 ? 0xf2 : x === 5 && r === 4 ? 0xfc : WALL);
    const t = await setup({ cell, nodes: [{ x: 5, row: 4, dir: 0 }] });
    assert.equal((await snap(t, 5, 5, { direction: "from" }))[0].cost, 61250);  // 2 -> 12
    assert.equal((await snap(t, 5, 5, { direction: "to" }))[0].cost, 48750);    // 12 -> 2
  });
});

// ---------------------------------------------------------------------------
function randomWorld(seed, W = 70, ROWS = 50) {
  const rnd = mulberry32(seed), grid = new Uint8Array(W * ROWS);
  for (let i = 0; i < grid.length; i++) {
    const cost = rnd() < 0.12 ? 15 : Math.floor(rnd() * 15);
    let mask = 0; for (const b of [1, 2, 4, 8]) if (rnd() < 0.9) mask |= b;
    grid[i] = (mask << 4) | cost;
  }
  const seen = new Set(), nodes = [];
  while (nodes.length < 110) {
    const x = Math.floor(rnd() * W), row = Math.floor(rnd() * ROWS);
    let dir = Math.floor(rnd() * 3); if (dir === 2 && row + 1 >= ROWS) dir = 0;
    const k = `${x},${row},${dir}`; if (seen.has(k)) continue; seen.add(k);
    nodes.push({ x, row, dir, cc: 0 });
  }
  nodes.push({ x: W - 1, row: 7, dir: 1, cc: 0 });          // guarantee a seam portal
  return { world: makeWorld({ W, ROWS, cell: (x, r) => grid[r * W + x], nodes }), rnd };
}

async function checkPoint(t, x, r, rev) {
  const { world } = t, tag = `(${x},${r}) ${rev ? "to" : "from"}`;
  const got = await snap(t, x, r, { count: 1e6, direction: rev ? "to" : "from" });
  if ((world.cell(x, r) & 15) === 15 || (world.cell(x, r) >> 4) === 0) {
    assert.deepEqual(got, [], tag);
    return;
  }
  const region = regionOf(world.W, world.ROWS, world.R, x, r);
  const P = { byteAt: (cx, cr) => world.cell(cx, cr), ewCm: world.ewCm, nsCm: world.nsCm, lamCm: world.lamCm, bias: world.bias };
  const expectFor = (sx, sr) => expectedHalfNodes(world.nodes, world.W, region, referenceDistances(P, region, sx, sr, rev));
  const sx = x, sr = r;
  const act = sortHalves(got.map(({ key, side, cost }) => ({ key, side, cost })));
  assert.deepEqual(act, expectFor(sx, sr), tag);
  for (let i = 1; i < got.length; i++) assert.ok(got[i].cost >= got[i - 1].cost, `${tag} not sorted`);
}

describe("differential test against the independent reference solver", () => {
  it("random terrain, masks, blocked cells, nodes; both directions; incl. partial edge tiles", async () => {
    let checks = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const { world, rnd } = randomWorld(seed);
      world.install(); const mod = await freshModule();
      const t = { world, mod, at: (x, r) => centerLatLon(x, r, world.firstRow) };
      const pts = [[0, 0], [world.W - 1, 0], [0, world.ROWS - 1], [world.W - 1, world.ROWS - 1]];
      for (let i = 0; i < 8; i++) pts.push([Math.floor(rnd() * world.W), Math.floor(rnd() * world.ROWS)]);
      for (const [x, r] of pts) for (const rev of [false, true]) { await checkPoint(t, x, r, rev); checks++; }
    }
    assert.ok(checks >= 200);
  });
  it("grid whose size is an exact multiple of the tile and region", async () => {
    const { world } = randomWorld(77, 64, 64);
    world.install(); const mod = await freshModule();
    const t = { world, mod, at: (x, r) => centerLatLon(x, r, world.firstRow) };
    for (const [x, r] of [[0, 0], [63, 63], [31, 32], [32, 31], [17, 40]]) for (const rev of [false, true]) await checkPoint(t, x, r, rev);
  });
});

// ---------------------------------------------------------------------------
describe("partial edge tiles (padding must never be read)", () => {
  it("last column region is 6 wide, last row region is 2 tall; padding is free+open and ignored", async () => {
    // W=70: last region x 64..69. ROWS=50: last region rows 48..49. Padding bytes are 0xF0.
    const nodes = [{ x: 69, row: 49, dir: 0 }, { x: 64, row: 48, dir: 0 }];
    const t = await setup({ cell: () => 0xf5, nodes });
    const c = await snap(t, 64, 48, { count: 5 });
    const ew = (r) => stepWeight(t.world.ewCm[r], 5, 5, { lamCm: 5000, nsCm: 20000, bias: 25 });
    const ns = stepWeight(20000, 5, 5, { lamCm: 5000, nsCm: 20000, bias: 25 });
    assert.equal(c.length, 2);
    assert.equal(c[0].key, "64,48,0"); assert.equal(c[0].cost, 0);
    // best path to (69,49): 5 east + 1 south, order chosen by cost
    const viaTop = 5 * ew(48) + ns, viaBottom = 1 * ns + 5 * ew(49);
    assert.equal(c[1].cost, Math.min(viaTop, viaBottom));
  });
  it("bottom-right and top-right corner queries work and never report cells outside the grid", async () => {
    const nodes = [{ x: 69, row: 49, dir: 0 }, { x: 69, row: 0, dir: 0 }];
    const t = await setup({ cell: () => OPEN, nodes });
    for (const [x, r] of [[69, 49], [69, 0], [0, 49]]) {
      const c = await snap(t, x, r, { count: 50 });
      for (const n of c) { assert.ok(n.cell.column >= 0 && n.cell.column < 70 && n.cell.row >= 0 && n.cell.row < 50); }
    }
    assert.equal((await snap(t, 69, 49, { count: 1 }))[0].cost, 0);
  });
  it("an out-of-range row/column is rejected, not clamped into padding", async () => {
    const t = await setup({ cell: () => OPEN, nodes: [{ x: 3, row: 3, dir: 0 }] });
    const { lat } = t.at(5, 50);                                  // row == ROWS
    await assert.rejects(t.mod.snapCandidates(lat, -180 + 5 * 0.0034), /outside the covered band/);
  });
});

// ---------------------------------------------------------------------------
describe("portal half-nodes", () => {
  const nodes = [{ x: 69, row: 7, dir: 1 }, { x: 20, row: 15, dir: 2 }, { x: 40, row: 4, dir: 0 }];
  it("seam portal (W-1,row,E): side 0 at x=W-1, side 1 at x=0", async () => {
    const t = await setup({ cell: () => OPEN, nodes });
    const a = (await snap(t, 0, 7, { count: 1 }))[0];
    assert.deepEqual([a.key, a.side, a.kind, a.cost, a.cell], ["69,7,1", 1, "portal", 0, { column: 0, row: 7 }]);
    const b = (await snap(t, 69, 7, { count: 1 }))[0];
    assert.deepEqual([b.key, b.side, b.cost, b.cell], ["69,7,1", 0, 0, { column: 69, row: 7 }]);
  });
  it("south portal: side 0 on the canonical row, side 1 on the row below (next region)", async () => {
    const t = await setup({ cell: () => OPEN, nodes });
    const a = (await snap(t, 20, 15, { count: 1 }))[0], b = (await snap(t, 20, 16, { count: 1 }))[0];
    assert.deepEqual([a.key, a.side, a.cost], ["20,15,2", 0, 0]);
    assert.deepEqual([b.key, b.side, b.cost, b.cell], ["20,15,2", 1, 0, { column: 20, row: 16 }]);
  });
  it("interior nodes report kind 'interior', dir 0, side 0", async () => {
    const t = await setup({ cell: () => OPEN, nodes });
    const n = (await snap(t, 40, 4, { count: 1 }))[0];
    assert.deepEqual([n.kind, n.dir, n.side, n.cost], ["interior", 0, 0, 0]);
  });
  it("a result's lat/lon maps back to its own cell", async () => {
    const t = await setup({ cell: () => OPEN, nodes });
    const n = (await snap(t, 0, 7, { count: 1 }))[0];
    assert.deepEqual(t.mod.latLonToCell(n.lat, n.lon, await t.mod.getMeta()), n.cell);
  });
  it("a node is invisible from regions that contain neither of its cells", async () => {
    const t = await setup({ cell: () => OPEN, nodes });
    const keys = (await snap(t, 50, 40, { count: 100 })).map((n) => n.key);
    assert.ok(!keys.includes("69,7,1") && !keys.includes("20,15,2"));
  });
});

// ---------------------------------------------------------------------------
describe("blocked, trapped and unreachable cases", () => {
  it("blocked start cell returns no candidates and snapToNode returns null", async () => {
    const t = await setup({ cell: (x, r) => (x === 8 && r === 8 ? WALL : OPEN), nodes: [{ x: 8, row: 6, dir: 0 }] });
    assert.deepEqual(await snap(t, 8, 8, { count: 1 }), []);
    const { lat, lon } = t.at(8, 8);
    assert.equal(await t.mod.snapToNode(lat, lon), null);
  });
  it("region with no passable cell -> [] and snapToNode null", async () => {
    const cell = (x, r) => (x >= 16 && x < 32 && r >= 16 && r < 32 ? WALL : OPEN);
    const t = await setup({ cell, nodes: [{ x: 3, row: 3, dir: 0 }] });
    assert.deepEqual(await snap(t, 20, 20), []);
    const { lat, lon } = t.at(20, 20);
    assert.equal(await t.mod.snapToNode(lat, lon), null);
  });
  it("enclosed pocket cannot reach any node -> null", async () => {
    const ring = (x, r) => Math.max(Math.abs(x - 40), Math.abs(r - 8)) === 1;
    const cell = (x, r) => (ring(x, r) ? WALL : OPEN);
    const t = await setup({ cell, nodes: [{ x: 33, row: 2, dir: 0 }] });
    const { lat, lon } = t.at(40, 8);
    assert.equal(await t.mod.snapToNode(lat, lon), null);
  });
  it("one-way masks: a node only reachable against the exit mask is not returned", async () => {
    // corridor row 5, x 5..9; cell (7,5) forbids exits E/W -> nodes beyond it are cut off
    const cell = (x, r) => (r !== 5 || x < 5 || x > 9 ? WALL : x === 7 ? 0x01 | (0x5 << 4) : OPEN);
    const t = await setup({ cell, nodes: [{ x: 5, row: 5, dir: 0 }, { x: 9, row: 5, dir: 0 }] });
    const keys = (await snap(t, 5, 5, { count: 10 })).map((n) => n.key);
    assert.deepEqual(keys, ["5,5,0"]);
  });
  it("tile without a graph blob (404) behaves as 'no nodes' -> null", async () => {
    const t = await setup({ cell: () => OPEN, nodes: [] });
    const { lat, lon } = t.at(5, 5);
    assert.equal(await t.mod.snapToNode(lat, lon), null);
  });
});

// ---------------------------------------------------------------------------
describe("options and result shape", () => {
  const nodes = Array.from({ length: 12 }, (_, i) => ({ x: 2 + i, row: 3 + (i % 5), dir: 0 }));
  it("count limits and sorts results; default is 8; count<=0 acts as 1", async () => {
    const t = await setup({ cell: () => OPEN, nodes });
    const three = await snap(t, 8, 8, { count: 3 });
    assert.equal(three.length, 3);
    assert.ok(three.every((n, i) => i === 0 || n.cost >= three[i - 1].cost));
    assert.equal((await snap(t, 8, 8)).length, 8);
    assert.equal((await snap(t, 8, 8, { count: 0 })).length, 1);
    assert.equal((await snap(t, 8, 8, { count: 1000 })).length, 12);
  });
  it("snapToNode == first candidate; direction field is echoed", async () => {
    const t = await setup({ cell: () => OPEN, nodes });
    const { lat, lon } = t.at(8, 8);
    const one = await t.mod.snapToNode(lat, lon), all = await t.mod.snapCandidates(lat, lon);
    assert.deepEqual(one, all[0]);
    assert.equal(one.direction, "from");
    assert.equal((await t.mod.snapToNode(lat, lon, { direction: "to" })).direction, "to");
  });
  it("result carries tile coords, node index, request echo", async () => {
    const t = await setup({ cell: () => OPEN, nodes });
    const n = (await snap(t, 8, 8, { count: 1 }))[0];
    assert.deepEqual([n.tileX, n.tileY], [0, 0]);
    assert.deepEqual(n.request.cell, { column: 8, row: 8 });
    assert.ok(Number.isInteger(n.index) && n.index >= 0);
  });
});

// ---------------------------------------------------------------------------
describe("loading, caching, retries and corrupt data", () => {
  const nodes = [{ x: 5, row: 5, dir: 0 }];
  it("each URL is fetched once, even for parallel and repeated queries", async () => {
    const t = await setup({ cell: () => OPEN, nodes });
    await Promise.all([1, 2, 3, 4, 5].map(() => snap(t, 8, 8, { count: 1 })));
    await snap(t, 9, 9, { count: 1 });
    for (const u of [t.world.cellTileUrl(0, 0), t.world.graphTileUrl(0, 0), t.world.ewUrl]) assert.equal(t.world.count(u), 1, u);
    assert.equal(t.world.calls.filter((u) => u.endsWith("graph.meta.json")).length, 1);
  });
  it("retries transient HTTP errors (2 retries by default) and then succeeds", async () => {
    const t = await setup({ cell: () => OPEN, nodes });
    t.world.failFirst.set(t.world.cellTileUrl(0, 0), { n: 2, status: 500 });
    assert.equal((await snap(t, 8, 8, { count: 1 })).length, 1);
    assert.equal(t.world.count(t.world.cellTileUrl(0, 0)), 3);
  });
  it("retries network exceptions too", async () => {
    const t = await setup({ cell: () => OPEN, nodes });
    t.world.failFirst.set(t.world.graphTileUrl(0, 0), { n: 1, mode: "throw" });
    assert.equal((await snap(t, 8, 8, { count: 1 })).length, 1);
  });
  it("gives up after the retries, and a later call recovers (failures are not cached)", async () => {
    const t = await setup({ cell: () => OPEN, nodes });
    t.world.failFirst.set(t.world.cellTileUrl(0, 0), { n: 3, status: 503 });
    await assert.rejects(snap(t, 8, 8), /HTTP 503/);
    assert.equal((await snap(t, 8, 8, { count: 1 })).length, 1);
  });
  it("configure({fetchRetries:0}) disables retrying", async () => {
    const t = await setup({ cell: () => OPEN, nodes }, { fetchRetries: 0 });
    t.world.failFirst.set(t.world.cellTileUrl(0, 0), { n: 1, status: 500 });
    await assert.rejects(snap(t, 8, 8), /HTTP 500/);
  });
  it("cells marked gz are refused", async () => {
    const t = await setup({ cell: () => OPEN, nodes }); t.world.cellsMeta.gz = true;
    await assert.rejects(snap(t, 8, 8), /gz/);
  });
  it("cells/graph metadata mismatch is refused", async () => {
    const t = await setup({ cell: () => OPEN, nodes }); t.world.graphMeta.width += 1;
    await assert.rejects(snap(t, 8, 8), /disagree/);
  });
  it("ewCm.bin of the wrong length is refused", async () => {
    const t = await setup({ cell: () => OPEN, nodes });
    t.world.override.set(t.world.ewUrl, () => binResponse(Buffer.alloc(4 * (t.world.ROWS - 1))));
    await assert.rejects(snap(t, 8, 8), /ewCm/);
  });
  it("cell tile 404 and wrong-size cell tiles are errors", async () => {
    let t = await setup({ cell: () => OPEN, nodes });
    t.world.override.set(t.world.cellTileUrl(0, 0), () => ({ ok: false, status: 404 }));
    await assert.rejects(snap(t, 8, 8), /HTTP 404/);
    t = await setup({ cell: () => OPEN, nodes });
    t.world.override.set(t.world.cellTileUrl(0, 0), () => binResponse(Buffer.alloc(100)));
    await assert.rejects(snap(t, 8, 8), /bad size/);
  });
  it("graph tile with bad magic or truncated node table is an error", async () => {
    let t = await setup({ cell: () => OPEN, nodes });
    t.world.override.set(t.world.graphTileUrl(0, 0), () => binResponse(Buffer.alloc(64)));
    await assert.rejects(snap(t, 8, 8), /bad magic/);
    t = await setup({ cell: () => OPEN, nodes });
    const h = Buffer.alloc(16); h.writeUInt32LE(0x3254474d, 0); h.writeUInt32LE(5, 4);
    t.world.override.set(t.world.graphTileUrl(0, 0), () => binResponse(h));
    await assert.rejects(snap(t, 8, 8), /truncated/);
  });
});
