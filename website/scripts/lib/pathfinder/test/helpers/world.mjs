// Synthetic "CDN": serves cell tiles, graph tiles and metadata from memory so the
// real snapper.js can run unmodified (globalThis.fetch is replaced).
export const P = 0.003374120830641;
const CELLS = "https://marswalk-cells.pages.dev", GRAPH = "https://marswalk-graph.pages.dev";
let seq = 0;

/** Fresh snapper.js instance (its tile/meta caches and config start empty). */
export async function freshModule() {
  const href = new URL("../../snapper.js", import.meta.url).href + "?t=" + ++seq;
  return import(href);
}

export function centerLatLon(x, r, firstRow, lonOrigin = -180) {
  return { lat: 90 - (r + firstRow + 0.5) * P, lon: lonOrigin + (x + 0.5) * P };
}

const toAB = (b) => { const u = Buffer.from(b); return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength); };
const bin = (b) => ({ ok: true, status: 200, arrayBuffer: async () => toAB(b) });
export const binResponse = bin;

/**
 * opts: T,R,W,ROWS,firstRow,lambdaM,bias,padByte,cell(x,r)->byte,nodes[{x,row,dir,cc}]
 * Edge tiles are padded to T x T with padByte (default 0xF0 = free, all exits open,
 * so any read of padding would visibly change costs).
 */
export function makeWorld(o = {}) {
  const w = { T: 32, R: 16, W: 70, ROWS: 50, firstRow: 100, lambdaM: 50, bias: 25, padByte: 0xf0,
    cell: () => 0xf1, nodes: [], ...o };
  w.tilesX = Math.ceil(w.W / w.T); w.tilesY = Math.ceil(w.ROWS / w.T);
  w.nsCm = 20000; w.lamCm = Math.round(w.lambdaM * 100);
  w.ewCm = Uint32Array.from({ length: w.ROWS }, (_, r) => 12000 + (r * 37) % 5000);
  w.cellsMeta = { tile: w.T, tilesX: w.tilesX, tilesY: w.tilesY, width: w.W, rows: w.ROWS, firstRow: w.firstRow, gz: false };
  w.graphMeta = { version: 2, tile: w.T, tilesX: w.tilesX, tilesY: w.tilesY, width: w.W, rows: w.ROWS,
    firstRow: w.firstRow, region: w.R, lambdaM: w.lambdaM, nsCm: w.nsCm, reverseBiasPct: w.bias, wrapMul: 1 };
  w.calls = []; w.failFirst = new Map(); w.override = new Map();
  w.cellTileUrl = (tx, ty) => `${CELLS}/tiles/${ty}/${tx}.bin`;
  w.graphTileUrl = (tx, ty) => `${GRAPH}/tiles/${ty}/${tx}.bin`;
  w.ewUrl = `${GRAPH}/ewCm.bin`;
  w.count = (url) => w.calls.filter((u) => u === url).length;

  const cellsOf = (n) => {
    const c = [[n.x, n.row]];
    if (n.dir === 1) c.push([(n.x + 1) % w.W, n.row]); else if (n.dir === 2) c.push([n.x, n.row + 1]);
    return c;
  };
  w.tileNodes = (tx, ty) => w.nodes.filter((n) => cellsOf(n).some(([x, r]) => Math.floor(x / w.T) === tx && Math.floor(r / w.T) === ty));
  const cellBlob = (tx, ty) => {
    const b = Buffer.alloc(w.T * w.T, w.padByte);
    for (let y = 0; y < w.T; y++) for (let x = 0; x < w.T; x++) {
      const gx = tx * w.T + x, gr = ty * w.T + y;
      if (gx < w.W && gr < w.ROWS) b[y * w.T + x] = w.cell(gx, gr);
    }
    return b;
  };
  const graphBlob = (tx, ty) => {
    const ns = w.tileNodes(tx, ty);
    if (!ns.length) return null;
    const b = Buffer.alloc(16 + ns.length * 16);
    b.writeUInt32LE(0x3254474d, 0); b.writeUInt32LE(ns.length, 4);
    ns.forEach((n, i) => { const p = 16 + i * 16; b.writeUInt32LE(n.x, p); b.writeUInt16LE(n.row, p + 4); b[p + 6] = n.dir; b[p + 7] = n.cc ?? 0; });
    return b;
  };
  w.fetch = async (url) => {
    url = String(url); w.calls.push(url);
    const f = w.failFirst.get(url);
    if (f && f.n > 0) { f.n--; if (f.mode === "throw") throw new TypeError("network down"); return { ok: false, status: f.status ?? 500 }; }
    if (w.override.has(url)) return w.override.get(url)();
    if (url === `${CELLS}/cells.meta.json`) return { ok: true, status: 200, json: async () => w.cellsMeta };
    if (url === `${GRAPH}/graph.meta.json`) return { ok: true, status: 200, json: async () => w.graphMeta };
    if (url === w.ewUrl) return bin(Buffer.from(w.ewCm.buffer));
    let m = url.match(/^https:\/\/marswalk-cells\.pages\.dev\/tiles\/(\d+)\/(\d+)\.bin$/);
    if (m && +m[1] < w.tilesY && +m[2] < w.tilesX) return bin(cellBlob(+m[2], +m[1]));
    m = url.match(/^https:\/\/marswalk-graph\.pages\.dev\/tiles\/(\d+)\/(\d+)\.bin$/);
    if (m) { const g = graphBlob(+m[2], +m[1]); if (g) return bin(g); }
    return { ok: false, status: 404 };
  };
  w.install = () => { globalThis.fetch = w.fetch; return w; };
  return w;
}

export function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
