// Independent reference for the snapping tests. Deliberately does NOT share code
// relaxation sweeps (Bellman-Ford style), not a heap Dijkstra.
// with snapper.js: weights use BigInt, and distances come from repeated
const NB = 1, EB = 2, SB = 4, WB = 8;
// [dx, dy, bit on source, bit on neighbour, horizontal?]
const DIRS = [[0, -1, NB, SB, false], [1, 0, EB, WB, true], [0, 1, SB, NB, false], [-1, 0, WB, EB, true]];

export function stepWeight(dcm, f, t, { lamCm, nsCm, bias }) {
  const bn = BigInt((100 - bias) * (f + t) + 2 * bias * t);
  const num = BigInt(lamCm) * BigInt(dcm) * bn, den = BigInt(nsCm) * 200n;
  return Number(BigInt(dcm) + (num + den / 2n) / den);
}

export function regionOf(W, ROWS, R, x, r) {
  const x0 = Math.floor(x / R) * R, r0 = Math.floor(r / R) * R;
  return { x0, r0, w: Math.min(W, x0 + R) - x0, h: Math.min(ROWS, r0 + R) - r0 };
}

/** dist[] over the region. rev=false: cost source->cell. rev=true: cost cell->source. */
export function referenceDistances(P, region, sx, sr, rev) {
  const { byteAt, ewCm, nsCm } = P;
  const { x0, r0, w, h } = region, n = w * h;
  const bytes = new Uint8Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) bytes[y * w + x] = byteAt(x0 + x, r0 + y);
  const dist = new Float64Array(n).fill(Infinity);
  dist[(sr - r0) * w + (sx - x0)] = 0;
  const cache = new Map();
  const W_ = (dcm, f, t) => {
    const k = (dcm * 16 + f) * 16 + t;
    let v = cache.get(k);
    if (v === undefined) { v = stepWeight(dcm, f, t, P); cache.set(k, v); }
    return v;
  };
  for (let pass = 0, changed = true; changed; pass++) {
    if (pass > 100000) throw new Error("reference did not converge");
    changed = false;
    for (let i = 0; i < n; i++) {
      const u = pass % 2 ? n - 1 - i : i;
      if (dist[u] === Infinity) continue;
      const uy = Math.floor(u / w), ux = u % w, bu = bytes[u], cu = bu & 15;
      if (cu === 15) continue;
      for (const [dx, dy, bitU, bitV, horiz] of DIRS) {
        const vx = ux + dx, vy = uy + dy;
        if (vx < 0 || vy < 0 || vx >= w || vy >= h) continue;
        const bv = bytes[vy * w + vx], cv = bv & 15;
        if (cv === 15 || !((bu >> 4) & bitU) || !((bv >> 4) & bitV)) continue;
        const dcm = horiz ? ewCm[r0 + uy] : nsCm;
        const nd = dist[u] + (rev ? W_(dcm, cv, cu) : W_(dcm, cu, cv));
        if (nd < dist[vy * w + vx]) { dist[vy * w + vx] = nd; changed = true; }
      }
    }
  }
  return dist;
}

/** Half-nodes whose cell is in the region and reachable, sorted by (cost, key, side). */
export function expectedHalfNodes(nodes, W, region, dist) {
  const { x0, r0, w, h } = region, out = [];
  const add = (n, cx, cr, side) => {
    if (cx < x0 || cx >= x0 + w || cr < r0 || cr >= r0 + h) return;
    const d = dist[(cr - r0) * w + (cx - x0)];
    if (d !== Infinity) out.push({ key: `${n.x},${n.row},${n.dir}`, side, cost: d });
  };
  for (const n of nodes) {
    add(n, n.x, n.row, 0);
    if (n.dir === 1) add(n, (n.x + 1) % W, n.row, 1);
    else if (n.dir === 2) add(n, n.x, n.row + 1, 1);
  }
  return sortHalves(out);
}

export const cmpHalf = (a, b) => a.cost - b.cost || (a.key < b.key ? -1 : a.key > b.key ? 1 : a.side - b.side);
export const sortHalves = (l) => l.slice().sort(cmpHalf);
