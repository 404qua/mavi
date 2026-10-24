// Route search over the tiled graph, then expansion of the found route into a cell-level path.
//
//   import { snapCandidates } from "./snapper.js";
//   import { findPath } from "./search.js";
//
//   const starts = await snapCandidates(lat1, lon1, { direction: "from" });   // default count 4
//   const ends   = await snapCandidates(lat2, lon2, { direction: "to"   });
//   const line   = await findPath(starts, ends);     [lon, lat, lon, lat, ...]  or null if no route
//
// runns pathfinding through the graph tiles, then expands the graph edges into a cell-level detailed path. 
//
// Costs are the builder's integer centimetre weights

import * as snapper from "./snapper.js";
import { now, poolMap } from "./utils.js";

if (new Uint8Array(new Uint32Array([1]).buffer)[0] !== 1) throw new Error("search.js needs a little-endian platform");

const PIX_DEG = 0.003374120830641, PIX_RAD = PIX_DEG * Math.PI / 180;
const MARS_RADIUS_CM = 3396190 * 100;
const ROW_KEY_STRIDE = 16777216, CELL_KEY_RANGE = 1048576, MAGIC = 0x3254474d;   // "MGT2": 8-byte edge records
const NORTH_BIT = 1, EAST_BIT = 2, SOUTH_BIT = 4, WEST_BIT = 8;

const DEFAULTS = {
  heuristicWeight: 1.65,
  maxExpansions: 4e6,
  simplify: true,          // drop vertices in the middle of straight runs
  maxRun: 32,              // ...but keep a vertex at least every N cells
  typed: false,
  returnCells: false,      // detailed result: include the raw cell path
  strict: false,           // throw if a segment's recomputed cost differs from the graph's
  yieldMs: 12,
  signal: undefined,
  onProgress: undefined,
  prefetchEvery: 32,
  prefetchDepth: 256,
  bidirectional: true,
  ringPrefetch: true,
  corridor: { frac: 0.12, minKm: 250, widen: [2, 4] },
};

// parallel typed array for keys and payloads
class MinHeap {              
  constructor(capacity = 1024) { this.keys = new Float64Array(capacity); this.values = new Float64Array(capacity); this.size = 0; this.poppedKey = 0; this.poppedValue = 0; }
  push(key, value) {
    if (this.size === this.keys.length) {
      const newKeys = new Float64Array(this.size * 2), newValues = new Float64Array(this.size * 2);
      newKeys.set(this.keys); newValues.set(this.values); this.keys = newKeys; this.values = newValues;
    }
    const keyArray = this.keys, valueArray = this.values; let index = this.size++;
    while (index > 0) { const parentIndex = (index - 1) >> 1; if (keyArray[parentIndex] <= key) break; keyArray[index] = keyArray[parentIndex]; valueArray[index] = valueArray[parentIndex]; index = parentIndex; }
    keyArray[index] = key; valueArray[index] = value;
  }
  pop() {
    const keyArray = this.keys, valueArray = this.values; this.poppedKey = keyArray[0]; this.poppedValue = valueArray[0];
    const remaining = --this.size;
    if (remaining > 0) {
      const lastKey = keyArray[remaining], lastValue = valueArray[remaining]; let index = 0;
      for (;;) {
        let childIndex = 2 * index + 1; if (childIndex >= remaining) break;
        if (childIndex + 1 < remaining && keyArray[childIndex + 1] < keyArray[childIndex]) childIndex++;
        if (keyArray[childIndex] >= lastKey) break;
        keyArray[index] = keyArray[childIndex]; valueArray[index] = valueArray[childIndex]; index = childIndex;
      }
      keyArray[index] = lastKey; valueArray[index] = lastValue;
    }
  }
}

// single array of (dist * 2^20 + cell)
class PackedHeap {           
  constructor() { this.items = new Float64Array(1 << 12); this.size = 0; }
  push(packedKey) {
    if (this.size === this.items.length) { const grown = new Float64Array(this.size * 2); grown.set(this.items); this.items = grown; }
    const items = this.items; let index = this.size++;
    while (index > 0) { const parentIndex = (index - 1) >> 1; if (items[parentIndex] <= packedKey) break; items[index] = items[parentIndex]; index = parentIndex; }
    items[index] = packedKey;
  }
  pop() {
    const items = this.items, top = items[0], last = items[--this.size]; let index = 0;
    for (;;) {
      let childIndex = 2 * index + 1; if (childIndex >= this.size) break;
      if (childIndex + 1 < this.size && items[childIndex + 1] < items[childIndex]) childIndex++;
      if (items[childIndex] >= last) break;
      items[index] = items[childIndex]; index = childIndex;
    }
    items[index] = last;
    return top;
  }
}

// graph tiles
function parseTile(buf, tileX, tileY) {
  if (buf.byteLength < 16 || (buf.byteLength & 3)) throw new Error(`graph tile ${tileX},${tileY}: bad size ${buf.byteLength}`);
  const words = new Uint32Array(buf);
  if (words[0] !== MAGIC) throw new Error(`graph tile ${tileX},${tileY}: bad magic`);
  const nodeCount = words[1], edgeCount = words[2];
  if (buf.byteLength < 16 + 16 * nodeCount + 8 * edgeCount) throw new Error(`graph tile ${tileX},${tileY}: truncated`);
  const keys = new Float64Array(nodeCount);
  for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex++) {
    const recordStart = 4 + 4 * nodeIndex;
    keys[nodeIndex] = (words[recordStart + 1] & 0xffff) * ROW_KEY_STRIDE + words[recordStart] * 4 + ((words[recordStart + 1] >>> 16) & 0xff);
  }
  return { tileX, tileY, nodeCount, edgeCount, words, edgeBase: 4 + 4 * nodeCount, keys, bytes: buf.byteLength + keys.byteLength };
}

function buildRev(view) {              // incoming edges per half-node (2*nodeIndex + side), built once per tile
  const { words, nodeCount, edgeCount, edgeBase } = view;
  const offsets = new Uint32Array(2 * nodeCount + 2);
  const range = (nodeIndex, side) => (side === 0 ? [words[4 + 4 * nodeIndex + 2], words[4 + 4 * nodeIndex + 3]] : [words[4 + 4 * nodeIndex + 3], nodeIndex + 1 < nodeCount ? words[4 + 4 * (nodeIndex + 1) + 2] : edgeCount]);
  for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex++) for (let side = 0; side < 2; side++) {
    const [edgeStart, edgeEnd] = range(nodeIndex, side);
    for (let edgeIndex = edgeStart; edgeIndex < edgeEnd; edgeIndex++) { const target = words[edgeBase + 2 * edgeIndex], targetIndex = target & 0x3fffffff; if (targetIndex < nodeCount) offsets[2 * targetIndex + ((target >>> 30) & 1) + 1]++; }
  }
  for (let halfIndex = 0; halfIndex < 2 * nodeCount + 1; halfIndex++) offsets[halfIndex + 1] += offsets[halfIndex];
  const cursor = offsets.slice(0, 2 * nodeCount + 1), sources = new Int32Array(offsets[2 * nodeCount + 1]), weights = new Uint32Array(sources.length);
  for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex++) for (let side = 0; side < 2; side++) {
    const [edgeStart, edgeEnd] = range(nodeIndex, side);
    for (let edgeIndex = edgeStart; edgeIndex < edgeEnd; edgeIndex++) {
      const target = words[edgeBase + 2 * edgeIndex], targetIndex = target & 0x3fffffff; if (targetIndex >= nodeCount) continue;
      const targetHalf = 2 * targetIndex + ((target >>> 30) & 1), position = cursor[targetHalf]++;
      sources[position] = 2 * nodeIndex + side; weights[position] = words[edgeBase + 2 * edgeIndex + 1];
    }
  }
  return { offsets, sources, weights };
}

function findKey(view, key) {
  const keys = view.keys; let low = 0, high = keys.length - 1;
  while (low <= high) { const middle = (low + high) >> 1, value = keys[middle]; if (value === key) return middle; if (value < key) low = middle + 1; else high = middle - 1; }
  return -1;
}

class TileStore {
  constructor(pathfinder, cfg) {
    this.pathfinder = pathfinder; this.cfg = cfg; this.entries = new Map(); this.bytes = 0; this.active = 0; this.loads = 0;
    this.demandQueue = []; this.prefetchQueue = [];
    this.profile = { storeHits: 0, semaphoreWaitMs: 0, fetchAwaitMs: 0, parseMs: 0, parsedBytes: 0, tileLoads: 0, prefetchStarted: 0, prefetchPromoted: 0 };
  }
  sync(tileX, tileY) { const entry = this.entries.get(tileX + "," + tileY); return entry && entry.done ? entry.value : undefined; }   // undefined = not ready
  has(tileX, tileY) { return this.entries.has(tileX + "," + tileY); }
  prefetch(tileX, tileY) {         // speculative, low priority; returns true if a new request was queued
    if (this.entries.has(tileX + "," + tileY)) return false;
    if (this.prefetchQueue.length >= this.cfg.maxQueuedPrefetch) return false;
    this.profile.prefetchStarted++;
    this.get(tileX, tileY, false).catch(() => {});
    return true;
  }
  get(tileX, tileY, demand = true) {
    const key = tileX + "," + tileY; let entry = this.entries.get(key);
    if (entry) {
      this.profile.storeHits++;
      if (entry.done) { this.entries.delete(key); this.entries.set(key, entry); }
      else if (demand && entry.waiter) this._promote(entry);
      return entry.promise;
    }
    entry = { done: false, value: undefined, size: 0, promise: null, waiter: null };
    entry.promise = this._load(tileX, tileY, entry, demand).then((parsed) => { entry.done = true; entry.value = parsed; entry.size = parsed ? parsed.bytes : 0; this.bytes += entry.size; this._evict(); return parsed; },
      (error) => { this.entries.delete(key); throw error; });
    this.entries.set(key, entry);
    return entry.promise;
  }
  async _load(tileX, tileY, entry, demand) {
    const waitStart = now();
    await this._acquire(entry, demand);
    this.profile.semaphoreWaitMs += now() - waitStart;
    try {
      const fetchStart = now();
      const buf = await this.pathfinder.fetchGraphTileBuffer(tileX, tileY);
      this.profile.fetchAwaitMs += now() - fetchStart;
      this.loads++;
      this.profile.tileLoads++;
      if (!buf) return null;
      const parseStart = now(), parsed = parseTile(buf, tileX, tileY);
      this.profile.parseMs += now() - parseStart;
      this.profile.parsedBytes += buf.byteLength;
      return parsed;
    } finally { this._release(); }
  }
  _acquire(entry, demand) {
    if (this.active < this.cfg.fetchConcurrency) { this.active++; return Promise.resolve(); }
    return new Promise((resolve) => { const waiter = { resolve }; entry.waiter = waiter; (demand ? this.demandQueue : this.prefetchQueue).push(waiter); });
  }
  _release() {
    const waiter = this.demandQueue.shift() || this.prefetchQueue.pop();
    if (waiter) waiter.resolve(); else this.active--;
  }
  _promote(entry) {
    const index = this.prefetchQueue.indexOf(entry.waiter);
    if (index >= 0) { this.prefetchQueue.splice(index, 1); this.demandQueue.push(entry.waiter); this.profile.prefetchPromoted++; }
  }
  _evict() {
    if (this.bytes <= this.cfg.cacheBytes) return;
    for (const [key, entry] of this.entries) {
      if (this.bytes <= this.cfg.cacheBytes) break;
      if (!entry.done) continue;
      this.entries.delete(key); this.bytes -= entry.size;
    }
  }
}

// local (in-region) Dijkstra on cell tiles, used to expand graph edges into cells
class LocalSolver {
  constructor(pathfinder, meta) {
    this.pathfinder = pathfinder; this.meta = meta;
    const cellCount = meta.regionSize * meta.regionSize;
    this.regionBuffer = new Uint8Array(cellCount); this.dist = new Float64Array(cellCount); this.stamp = new Uint32Array(cellCount); this.parentCode = new Uint8Array(cellCount);
    this.heap = new PackedHeap(); this.epoch = 0; this.eastWestTables = new Map();
    this.originColumn = -1; this.originRow = -1; this.width = 0; this.height = 0;
    this.profile = { solveCalls: 0, solveMs: 0, cellsSettled: 0, appendCalls: 0, appendMs: 0, appendedCells: 0 };
  }
  eastWestTable(row) {
    let table = this.eastWestTables.get(row);
    if (!table) {
      table = new Uint32Array(256); const stepLengthCm = this.meta.eastWestCm[row], meta = this.meta;
      for (let fromCost = 0; fromCost < 16; fromCost++) for (let toCost = 0; toCost < 16; toCost++) table[(fromCost << 4) | toCost] = this.pathfinder.stepWeight(stepLengthCm, fromCost, toCost, meta.lambdaCm, meta.northSouthCm, meta.biasPercent);
      this.eastWestTables.set(row, table);
    }
    return table;
  }
  load(originColumn, originRow, tile) {
    if (this.originColumn === originColumn && this.originRow === originRow) return;
    const meta = this.meta;
    this.originColumn = originColumn; this.originRow = originRow;
    this.width = Math.min(meta.width, originColumn + meta.regionSize) - originColumn; this.height = Math.min(meta.rowCount, originRow + meta.regionSize) - originRow;
    for (let rowOffset = 0; rowOffset < this.height; rowOffset++) {
      const src = ((originRow + rowOffset) % meta.tileSize) * meta.tileSize + (originColumn % meta.tileSize);
      this.regionBuffer.set(tile.subarray(src, src + this.width), rowOffset * this.width);
    }
  }
  solve(src, dst) {          // forward cost src -> dst, or Infinity
    const { width, height, regionBuffer, dist, stamp, parentCode, heap } = this, northSouthTable = this.meta.northSouthTable;
    const started = now(); let settled = 0;
    const finish = (value) => {
      this.profile.solveCalls++;
      this.profile.solveMs += now() - started;
      this.profile.cellsSettled += settled;
      return value;
    };
    const searchEpoch = ++this.epoch;
    heap.size = 0; dist[src] = 0; stamp[src] = searchEpoch; parentCode[src] = 255; heap.push(src);
    while (heap.size > 0) {
      const packedKey = heap.pop(), cellIndex = packedKey % CELL_KEY_RANGE, cellDistance = (packedKey - cellIndex) / CELL_KEY_RANGE;
      if (cellDistance !== dist[cellIndex]) continue;
      settled++;
      if (cellIndex === dst) return finish(cellDistance);
      const localRow = (cellIndex / width) | 0, localColumn = cellIndex - localRow * width, currentCost = regionBuffer[cellIndex] & 15, currentMask = regionBuffer[cellIndex] >> 4;
      const eastWestTable = this.eastWestTable(this.originRow + localRow);
      const relax = (neighborIndex, backBit, table, directionCode) => {
        const neighborByte = regionBuffer[neighborIndex], neighborCost = neighborByte & 15;
        if (neighborCost === 15 || !((neighborByte >> 4) & backBit)) return;
        const newDistance = cellDistance + table[(currentCost << 4) | neighborCost];
        if (stamp[neighborIndex] !== searchEpoch || newDistance < dist[neighborIndex]) { stamp[neighborIndex] = searchEpoch; dist[neighborIndex] = newDistance; parentCode[neighborIndex] = directionCode; heap.push(newDistance * CELL_KEY_RANGE + neighborIndex); }
      };
      if (localRow > 0 && (currentMask & NORTH_BIT)) relax(cellIndex - width, SOUTH_BIT, northSouthTable, 2);
      if (localRow < height - 1 && (currentMask & SOUTH_BIT)) relax(cellIndex + width, NORTH_BIT, northSouthTable, 0);
      if (localColumn < width - 1 && (currentMask & EAST_BIT)) relax(cellIndex + 1, WEST_BIT, eastWestTable, 3);
      if (localColumn > 0 && (currentMask & WEST_BIT)) relax(cellIndex - 1, EAST_BIT, eastWestTable, 1);
    }
    return finish(Infinity);
  }
  appendPath(dst, push) {    // cells src..dst of the last solve(), in order
    const started = now();
    const reversedCells = [], width = this.width;
    for (let cellIndex = dst; ;) {
      reversedCells.push(cellIndex);
      const directionCode = this.parentCode[cellIndex]; if (directionCode === 255) break;
      cellIndex = directionCode === 0 ? cellIndex - width : directionCode === 1 ? cellIndex + 1 : directionCode === 2 ? cellIndex + width : cellIndex - 1;
    }
    for (let reversedIndex = reversedCells.length - 1; reversedIndex >= 0; reversedIndex--) push(this.originColumn + (reversedCells[reversedIndex] % width), this.originRow + Math.floor(reversedCells[reversedIndex] / width));
    this.profile.appendCalls++;
    this.profile.appendMs += now() - started;
    this.profile.appendedCells += reversedCells.length;
  }
}

// helpers
const keyOf = (column, row, dir) => row * ROW_KEY_STRIDE + column * 4 + dir;

function parseKey(text) {
  const match = typeof text === "string" && /^(\d+),(\d+),([012])$/.exec(text);
  if (!match) throw new TypeError(`bad node key ${JSON.stringify(text)}`);
  return { column: +match[1], row: +match[2], dir: +match[3] };
}

function decode(id) {
  const side = id % 2, key = (id - side) / 2, row = Math.floor(key / ROW_KEY_STRIDE), remainder = key - row * ROW_KEY_STRIDE;
  return { key, side, row, column: Math.floor(remainder / 4), dir: remainder % 4 };
}

function halfCell(width, decoded) {
  if (decoded.side === 0) return { column: decoded.column, row: decoded.row };
  return decoded.dir === 1 ? { column: (decoded.column + 1) % width, row: decoded.row } : { column: decoded.column, row: decoded.row + 1 };
}

function normalize(list, label, meta) {
  const nodes = Array.isArray(list) ? list : list ? [list] : [];
  let firstUsedCell = null; const out = [];
  for (const node of nodes) {
    if (!node || typeof node !== "object") throw new TypeError(`${label} node must be an object from the snapper`);
    const parsedKey = parseKey(node.key), side = node.side | 0;
    if (!(side === 0 || side === 1) || (parsedKey.dir === 0 && side !== 0)) throw new TypeError(`${label} node has an invalid side`);
    if (!Number.isFinite(node.cost) || node.cost < 0) throw new TypeError(`${label} node has an invalid cost`);
    const usedCell = node.request && (node.request.usedCell ?? node.request.cell);
    if (!usedCell || !Number.isInteger(usedCell.column) || !Number.isInteger(usedCell.row) || usedCell.column < 0 || usedCell.column >= meta.width || usedCell.row < 0 || usedCell.row >= meta.rowCount)
      throw new TypeError(`${label} node is missing a valid request cell (pass the snapper's results unchanged)`);
    if (firstUsedCell && (firstUsedCell.column !== usedCell.column || firstUsedCell.row !== usedCell.row)) throw new TypeError(`${label} nodes come from different points`);
    firstUsedCell = usedCell;
    out.push({ id: keyOf(parsedKey.column, parsedKey.row, parsedKey.dir) * 2 + side, cost: node.cost, usedCell });
  }
  return out;
}

function makeHeuristic(meta, goal, weight) {
  if (!weight) return () => 0;
  const latitudeOfRow = (row) => (90 - (row + meta.firstRow + 0.5) * PIX_DEG) * Math.PI / 180;
  const goalLatitude = latitudeOfRow(goal.row), goalLatitudeCos = Math.cos(goalLatitude), width = meta.width, wrapMultiplier = meta.wrapMultiplier || 1;
  // Great-circle distance between cell centres
  // Every step weighs at least its physical length, (0.999 absorbs cm rounding).
  return (column, row) => {
    const lowColumn = Math.min(column, goal.column), highColumn = Math.max(column, goal.column);
    const columnDifference = Math.min(highColumn - lowColumn, (width - 1 - highColumn) + wrapMultiplier + lowColumn);
    const latitude = latitudeOfRow(row), halfLatitudeSine = Math.sin((latitude - goalLatitude) / 2), halfLongitudeSine = Math.sin(columnDifference * PIX_RAD / 2);
    const haversine = halfLatitudeSine * halfLatitudeSine + Math.cos(latitude) * goalLatitudeCos * halfLongitudeSine * halfLongitudeSine;
    return weight * 0.999 * 2 * MARS_RADIUS_CM * Math.asin(Math.min(1, Math.sqrt(haversine)));
  };
}

function makeCone(meta, startCell, goalCell, options) {
  const widthFraction = options.frac, minHalfWidth = (options.minKm * 1e5) / MARS_RADIUS_CM;       // radians
  const clampToUnit = (value) => (value > 1 ? 1 : value < -1 ? -1 : value);
  const toUnitVector = (column, row) => {
    const latitude = (90 - (row + meta.firstRow + 0.5) * PIX_DEG) * Math.PI / 180, longitude = (column + 0.5) * PIX_RAD, latitudeCos = Math.cos(latitude);
    return [latitudeCos * Math.cos(longitude), latitudeCos * Math.sin(longitude), Math.sin(latitude)];
  };
  const startVector = toUnitVector(startCell.column, startCell.row), goalVector = toUnitVector(goalCell.column, goalCell.row);
  const routeAngle = Math.acos(clampToUnit(startVector[0] * goalVector[0] + startVector[1] * goalVector[1] + startVector[2] * goalVector[2]));   // route angle
  if (!(routeAngle > 1e-6) || routeAngle > Math.PI - 0.02) return null;                // degenerate or near-antipodal: no cone
  let normalX = startVector[1] * goalVector[2] - startVector[2] * goalVector[1], normalY = startVector[2] * goalVector[0] - startVector[0] * goalVector[2], normalZ = startVector[0] * goalVector[1] - startVector[1] * goalVector[0];
  const normalLength = Math.hypot(normalX, normalY, normalZ); normalX /= normalLength; normalY /= normalLength; normalZ /= normalLength;           // normal of the great circle
  const alongX = normalY * startVector[2] - normalZ * startVector[1], alongY = normalZ * startVector[0] - normalX * startVector[2], alongZ = normalX * startVector[1] - normalY * startVector[0];   // normal x start: points toward the goal
  const allowed = (column, row, scale, slack) => {
    if (scale === Infinity) return true;
    const latitude = (90 - (row + meta.firstRow + 0.5) * PIX_DEG) * Math.PI / 180, longitude = (column + 0.5) * PIX_RAD, latitudeCos = Math.cos(latitude);
    const pointX = latitudeCos * Math.cos(longitude), pointY = latitudeCos * Math.sin(longitude), pointZ = Math.sin(latitude);
    const alongAngle = Math.atan2(pointX * alongX + pointY * alongY + pointZ * alongZ, pointX * startVector[0] + pointY * startVector[1] + pointZ * startVector[2]);   // angle along the line
    let offLineAngle, halfWidth;
    if (alongAngle <= 0) { offLineAngle = Math.acos(clampToUnit(pointX * startVector[0] + pointY * startVector[1] + pointZ * startVector[2])); halfWidth = minHalfWidth; }                 // behind the start
    else if (alongAngle >= routeAngle) { offLineAngle = Math.acos(clampToUnit(pointX * goalVector[0] + pointY * goalVector[1] + pointZ * goalVector[2])); halfWidth = minHalfWidth; }       // beyond the goal
    else { offLineAngle = Math.abs(Math.asin(clampToUnit(pointX * normalX + pointY * normalY + pointZ * normalZ))); const routeFraction = alongAngle / routeAngle; halfWidth = minHalfWidth + widthFraction * routeAngle * 4 * routeFraction * (1 - routeFraction); }
    return offLineAngle <= halfWidth * scale + slack;
  };
  return { allowed, routeAngle, minHalfWidth };
}

export function makeSearch(pathfinder, config = {}) {
  const cfg = { cacheBytes: 384 * 1024 * 1024, fetchConcurrency: 250, maxQueuedPrefetch: 2000, ...config };
  const store = new TileStore(pathfinder, cfg);

  function configureSearch(overrides) { Object.assign(cfg, overrides); }

  async function findPathDetailed(startNodes, endNodes, opts = {}) {
    const options = { ...DEFAULTS, ...opts };
    const startTime = now(); let lastYield = startTime, yieldMs = 0;
    if (!startNodes || !endNodes || (Array.isArray(startNodes) && startNodes.length === 0) || (Array.isArray(endNodes) && endNodes.length === 0)) return null;
    const meta = await pathfinder.getMeta();
    const starts = normalize(startNodes, "start", meta), ends = normalize(endNodes, "end", meta);
    if (!starts.length || !ends.length) return null;
    const startCell = starts[0].usedCell, endCell = ends[0].usedCell;
    const stats = { expanded: 0, tilesLoaded: 0, segments: 0, mismatches: 0, missingTiles: 0, missingNodes: 0, badEdges: 0,
      graphCostCm: null, directCostCm: null, graphMs: 0, cellsMs: 0 };
    const loadsBefore = store.loads;
    const storeProfileBefore = { ...store.profile };

    const checkAbort = () => {
      if (options.signal && options.signal.aborted) { const abortError = new Error("aborted"); abortError.name = "AbortError"; throw abortError; }
    };
    const progress = (phase, extra = {}) => { if (options.onProgress) options.onProgress({ phase, expanded: stats.expanded, tilesLoaded: store.loads - loadsBefore, ...extra }); };
    const maybeYield = async () => {
      checkAbort();
      if (now() - lastYield > options.yieldMs) {
        const started = now();
        await new Promise((resolve) => setTimeout(resolve, 0));
        yieldMs += now() - started;
        lastYield = now();
      }
    };

    const regionSize = meta.regionSize, regionOf = (cell) => ({ originColumn: Math.floor(cell.column / regionSize) * regionSize, originRow: Math.floor(cell.row / regionSize) * regionSize });
    const solver = new LocalSolver(pathfinder, meta);
    const cellTile = (cell) => pathfinder.getCellTile(Math.floor(cell.column / meta.tileSize), Math.floor(cell.row / meta.tileSize));

    // direct in-region path when both ends share a region
    let direct = null;
    const startRegion = regionOf(startCell), endRegion = regionOf(endCell);
    if (startRegion.originColumn === endRegion.originColumn && startRegion.originRow === endRegion.originRow) {
      solver.load(startRegion.originColumn, startRegion.originRow, await cellTile(startCell));
      const src = (startCell.row - startRegion.originRow) * solver.width + (startCell.column - startRegion.originColumn), dst = (endCell.row - startRegion.originRow) * solver.width + (endCell.column - startRegion.originColumn);
      const cost = solver.solve(src, dst);
      if (cost !== Infinity) { const columns = [], rows = []; solver.appendPath(dst, (column, row) => { columns.push(column); rows.push(row); }); direct = { cost, columns, rows }; stats.directCostCm = cost; }
    }

    // graph search, confined to a torch cone around the straight line start -> goal
    const graphStartTime = now();
    let graphAwaitMs = 0;
    const heuristic = makeHeuristic(meta, endCell, options.heuristicWeight);
    const startById = new Map(), endById = new Map();
    for (const start of starts) { const existing = startById.get(start.id); if (!existing || start.cost < existing.cost) startById.set(start.id, start); }
    for (const end of ends) { const existing = endById.get(end.id); if (!existing || end.cost < existing.cost) endById.set(end.id, end); }

    const cellOfId = (id) => halfCell(meta.width, decode(id));
    const corridorOptions = options.corridor ? { ...DEFAULTS.corridor, ...options.corridor } : null;
    const cone = corridorOptions ? makeCone(meta, startCell, endCell, corridorOptions) : null;
    let coneScale = Infinity;
    stats.corridorScale = null; stats.corridorRetries = 0;

    // Two searches share one loop
    const isBidirectional = !!options.bidirectional;
    const forwardSearch = { isBackward: false, heuristic }, backwardSearch = { isBackward: true, heuristic: makeHeuristic(meta, startCell, options.heuristicWeight) };
    forwardSearch.opposite = backwardSearch; backwardSearch.opposite = forwardSearch;
    let seenTiles, lastPrefetchAt;
    let best = Infinity, bestId = -1, expandedBase = 0;
    const relax = (search, targetId, newCost, fromId, edgeWeight) => {
      const oldCost = search.costs.get(targetId);
      if (oldCost !== undefined && newCost >= oldCost) return;
      const cell = cellOfId(targetId);
      if (cone && !cone.allowed(cell.column, cell.row, coneScale, 0)) return;       // outside the torch beam
      search.costs.set(targetId, newCost); search.parents.set(targetId, fromId); search.edgeWeights.set(targetId, edgeWeight); search.heap.push(newCost + search.heuristic(cell.column, cell.row), targetId);
      const oppositeCost = search.opposite.costs.get(targetId);
      if (oppositeCost !== undefined && newCost + oppositeCost < best) { best = newCost + oppositeCost; bestId = targetId; }   // the two searches meet here
    };
    const tilesX = Math.ceil(meta.width / meta.tileSize), tilesY = Math.ceil(meta.rowCount / meta.tileSize);
    const prefetchTile = (tileX, tileY) => {            // speculative fetch; no latitude wrap
      if (tileY < 0 || tileY >= tilesY) return;
      store.prefetch(((tileX % tilesX) + tilesX) % tilesX, tileY);
    };
    // Aggressive: every so often, request the tile of each of the best-looking open states. The
    // first entries of a binary heap are the cheapest-ish ones, so this is the search frontier.
    const prefetchFrontier = (search) => {
      const count = Math.min(search.heap.size, options.prefetchDepth);
      for (let heapIndex = 0; heapIndex < count; heapIndex++) {
        const frontierId = search.heap.values[heapIndex]; if (search.closed.has(frontierId)) continue;
        const cell = cellOfId(frontierId);
        prefetchTile(Math.floor(cell.column / meta.tileSize), Math.floor(cell.row / meta.tileSize));
      }
    };
    // First time the search reaches a tile, start fetching its neighbours that are inside the cone
    // (their centres may be up to ~half a tile diagonal outside it and still hold in-cone cells).
    const tileSlack = 0.75 * meta.tileSize * PIX_RAD;
    const ringPrefetch = (tileX, tileY) => {
      if (!cone || coneScale === Infinity) return;
      for (let deltaTileY = -1; deltaTileY <= 1; deltaTileY++) for (let deltaTileX = -1; deltaTileX <= 1; deltaTileX++) {
        if (!deltaTileX && !deltaTileY) continue;
        const neighborTileY = tileY + deltaTileY; if (neighborTileY < 0 || neighborTileY >= tilesY) continue;
        const neighborTileX = ((tileX + deltaTileX) % tilesX + tilesX) % tilesX;
        if (cone.allowed((neighborTileX + 0.5) * meta.tileSize, Math.min(meta.rowCount - 1, (neighborTileY + 0.5) * meta.tileSize), coneScale, tileSlack)) store.prefetch(neighborTileX, neighborTileY);
      }
    };
    const topReady = (search) => {                      // is the tile of this search's best open state already in memory?
      if (!search.heap.size) return false;
      const cell = cellOfId(search.heap.values[0]);
      return store.sync(Math.floor(cell.column / meta.tileSize), Math.floor(cell.row / meta.tileSize)) !== undefined;
    };

    const expandOne = async (search) => {
      search.heap.pop();
      const id = search.heap.poppedValue;
      if (search.closed.has(id)) return;
      search.closed.add(id);
      if (++stats.expanded - expandedBase > options.maxExpansions) throw new Error(`search exceeded maxExpansions (${options.maxExpansions})`);
      if (search.isBackward) stats.expandedBack++;
      const costSoFar = search.costs.get(id), decoded = decode(id);

      const cell = halfCell(meta.width, decoded), tileX = Math.floor(cell.column / meta.tileSize), tileY = Math.floor(cell.row / meta.tileSize);
      const tileId = tileY * tilesX + tileX;
      if (!seenTiles.has(tileId)) { seenTiles.add(tileId); if (options.ringPrefetch) ringPrefetch(tileX, tileY); }
      let view = store.sync(tileX, tileY);
      if (view === undefined) {
        prefetchFrontier(forwardSearch); if (isBidirectional) prefetchFrontier(backwardSearch);
        const waitStarted = now();
        view = await store.get(tileX, tileY);
        graphAwaitMs += now() - waitStarted;
      }
      if (!view) { stats.missingTiles++; return; }
      const nodeIndex = findKey(view, decoded.key);
      if (nodeIndex < 0) { stats.missingNodes++; return; }

      const words = view.words, recordStart = 4 + 4 * nodeIndex;
      if (!search.isBackward) {                                               // outgoing edges
        const edgeStart = decoded.side === 0 ? words[recordStart + 2] : words[recordStart + 3];
        const edgeEnd = decoded.side === 0 ? words[recordStart + 3] : (nodeIndex + 1 < view.nodeCount ? words[recordStart + 6] : view.edgeCount);
        for (let edgeIndex = edgeStart; edgeIndex < edgeEnd; edgeIndex++) {
          const edgeOffset = view.edgeBase + 2 * edgeIndex, target = words[edgeOffset];
          const targetIndex = target & 0x3fffffff;
          if (targetIndex >= view.nodeCount) { stats.badEdges++; continue; }
          relax(search, view.keys[targetIndex] * 2 + ((target >>> 30) & 1), costSoFar + words[edgeOffset + 1], id, words[edgeOffset + 1]);
        }
      } else {                                                     // incoming edges, walked backward
        const rev = view.rev || (view.rev = buildRev(view)), targetHalf = 2 * nodeIndex + decoded.side;
        for (let position = rev.offsets[targetHalf]; position < rev.offsets[targetHalf + 1]; position++) {
          const fromHalf = rev.sources[position];
          relax(search, view.keys[fromHalf >> 1] * 2 + (fromHalf & 1), costSoFar + rev.weights[position], id, rev.weights[position]);   // parent = successor toward the goal
        }
      }
      if (decoded.dir !== 0) {                                           // the crossing joins (key,0) and (key,1)
        const costByte = words[recordStart + 1] >>> 24, sideZeroCost = costByte & 15, sideOneCost = costByte >> 4;
        const otherCell = halfCell(meta.width, { ...decoded, side: 1 - decoded.side });          // the other side may sit in a neighbouring tile
        const otherTileX = Math.floor(otherCell.column / meta.tileSize), otherTileY = Math.floor(otherCell.row / meta.tileSize);
        if (otherTileX !== tileX || otherTileY !== tileY) prefetchTile(otherTileX, otherTileY);
        let stepLengthCm = decoded.dir === 1 ? meta.eastWestCm[decoded.row] : meta.northSouthCm;
        if (decoded.dir === 1 && decoded.column === meta.width - 1) stepLengthCm = Math.round(stepLengthCm * meta.wrapMultiplier);   // seam step is wrapMultiplier cells long
        const fromSide = search.isBackward ? 1 - decoded.side : decoded.side;                 // crossing always priced from the side it leaves
        const crossingWeight = fromSide === 0 ? pathfinder.stepWeight(stepLengthCm, sideZeroCost, sideOneCost, meta.lambdaCm, meta.northSouthCm, meta.biasPercent) : pathfinder.stepWeight(stepLengthCm, sideOneCost, sideZeroCost, meta.lambdaCm, meta.northSouthCm, meta.biasPercent);
        relax(search, decoded.key * 2 + (1 - decoded.side), costSoFar + crossingWeight, id, -1);
      }
    };

    const searchLoop = async () => {
      for (;;) {
        if ((stats.expanded & 255) === 0) { await maybeYield(); if ((stats.expanded & 4095) === 0) progress("graph"); }
        if (!forwardSearch.heap.size || forwardSearch.heap.keys[0] >= best) break;
        if (isBidirectional && (!backwardSearch.heap.size || backwardSearch.heap.keys[0] >= best)) break;
        if (stats.expanded - lastPrefetchAt >= options.prefetchEvery) { lastPrefetchAt = stats.expanded; prefetchFrontier(forwardSearch); if (isBidirectional) prefetchFrontier(backwardSearch); }
        let search = forwardSearch;
        if (isBidirectional) {
          search = forwardSearch.closed.size <= backwardSearch.closed.size ? forwardSearch : backwardSearch;                  // keep the two searches balanced...
          if (!topReady(search) && topReady(search.opposite)) search = search.opposite;          // ...but never idle on the network while the other can work
        }
        await expandOne(search);
      }
    };

    // Try the narrow cone first; if it contains no route, widen it (already-fetched tiles are reused).
    // very unlikely to need even a single widening, but the option is there for testing. This can cost accuracy in edge cases
    // However, it was decided that the tradeoff is worth the performance gain
    const scales = cone ? [1, ...corridorOptions.widen, Infinity] : [Infinity];
    stats.expandedBack = 0;
    for (let attempt = 0; attempt < scales.length; attempt++) {
      coneScale = scales[attempt];
      for (const search of [forwardSearch, backwardSearch]) { search.costs = new Map(); search.parents = new Map(); search.edgeWeights = new Map(); search.closed = new Set(); search.heap = new MinHeap(); }
      seenTiles = new Set(); lastPrefetchAt = -Infinity; expandedBase = stats.expanded;
      best = direct ? direct.cost : Infinity; bestId = -1;
      for (const [id, start] of startById) { const cell = cellOfId(id); forwardSearch.costs.set(id, start.cost); forwardSearch.parents.set(id, -1); forwardSearch.heap.push(start.cost + forwardSearch.heuristic(cell.column, cell.row), id); }
      for (const [id, end] of endById) { const cell = cellOfId(id); backwardSearch.costs.set(id, end.cost); backwardSearch.parents.set(id, -1); if (isBidirectional) backwardSearch.heap.push(end.cost + backwardSearch.heuristic(cell.column, cell.row), id); }
      for (const [id, start] of startById) { const end = endById.get(id); if (end && start.cost + end.cost < best) { best = start.cost + end.cost; bestId = id; } }
      await searchLoop();
      if (bestId !== -1 || direct) break;
      if (attempt + 1 < scales.length) { stats.corridorRetries++; progress("widen", { corridorScale: scales[attempt + 1] }); }
    }
    stats.corridorScale = coneScale;
    stats.graphMs = now() - graphStartTime;
    stats.tilesLoaded = store.loads - loadsBefore;

    // choose and expand
    const outColumns = [], outRows = [];
    const push = (column, row) => { const pointCount = outColumns.length; if (pointCount && outColumns[pointCount - 1] === column && outRows[pointCount - 1] === row) return; outColumns.push(column); outRows.push(row); };
    let source, chainKeys = [], totalCost;

    if (bestId === -1) {
      if (!direct) return null;
      source = "direct"; totalCost = direct.cost;
      for (let index = 0; index < direct.columns.length; index++) push(direct.columns[index], direct.rows[index]);
    } else {
      source = "graph"; totalCost = best; stats.graphCostCm = best;
      const chain = [], edgeWeightChain = new Map();          // edgeWeightChain: id -> weight of the edge into it along the chosen route
      for (let id = bestId; id !== -1; id = forwardSearch.parents.get(id)) chain.push(id);
      chain.reverse();                                 // start ... meeting state
      for (let index = 1; index < chain.length; index++) edgeWeightChain.set(chain[index], forwardSearch.edgeWeights.get(chain[index]));
      let fromId = bestId;
      for (let id = backwardSearch.parents.get(fromId); id !== undefined && id !== -1; id = backwardSearch.parents.get(fromId)) {   // meeting state ... goal
        edgeWeightChain.set(id, backwardSearch.edgeWeights.get(fromId)); chain.push(id);
        fromId = id;
      }
      chainKeys = chain.map((id) => { const decoded = decode(id); return `${decoded.column},${decoded.row},${decoded.dir}/${decoded.side}`; });

      const segments = [{ from: startCell, to: cellOfId(chain[0]), expected: startById.get(chain[0]).cost }];
      for (let index = 1; index < chain.length; index++) {
        const previous = decode(chain[index - 1]), current = decode(chain[index]);
        if (previous.key === current.key) segments.push({ crossing: true, to: cellOfId(chain[index]) });
        else segments.push({ from: cellOfId(chain[index - 1]), to: cellOfId(chain[index]), expected: edgeWeightChain.get(chain[index]) });
      }
      segments.push({ from: cellOfId(chain[chain.length - 1]), to: endCell, expected: endById.get(chain[chain.length - 1]).cost });
      stats.segments = segments.length;

      const cellsStartTime = now();
      const neededTiles = new Map();
      for (const segment of segments) if (!segment.crossing) { const tileKey = Math.floor(segment.from.column / meta.tileSize) + "," + Math.floor(segment.from.row / meta.tileSize); neededTiles.set(tileKey, segment.from); }
      const cellPrefetchStart = now();
      await poolMap([...neededTiles.values()], cfg.fetchConcurrency, (cell) => cellTile(cell));
      const cellPrefetchMs = now() - cellPrefetchStart;
      push(startCell.column, startCell.row);
      let done = 0;
      for (const segment of segments) {
        if (segment.crossing) push(segment.to.column, segment.to.row);
        else {
          const fromRegion = regionOf(segment.from), toRegion = regionOf(segment.to);
          if (fromRegion.originColumn !== toRegion.originColumn || fromRegion.originRow !== toRegion.originRow) throw new Error("graph edge joins cells in different regions");
          solver.load(fromRegion.originColumn, fromRegion.originRow, await cellTile(segment.from));
          const src = (segment.from.row - fromRegion.originRow) * solver.width + (segment.from.column - fromRegion.originColumn), dst = (segment.to.row - fromRegion.originRow) * solver.width + (segment.to.column - fromRegion.originColumn);
          const cost = solver.solve(src, dst);
          if (cost === Infinity || cost !== segment.expected) {
            stats.mismatches++;
            if (options.strict) throw new Error(`segment cost ${cost} differs from graph cost ${segment.expected} at cell ${segment.from.column},${segment.from.row} -> ${segment.to.column},${segment.to.row}`);
          }
          if (cost !== Infinity) solver.appendPath(dst, push);
          else { push(segment.from.column, segment.from.row); push(segment.to.column, segment.to.row); }
        }
        if (++done % 8 === 0) { await maybeYield(); progress("cells", { segmentsDone: done, segmentsTotal: segments.length }); }
      }
      stats.cellsMs = now() - cellsStartTime;
      stats.profile = {
        graph: {
          wallMs: stats.graphMs,
          awaitedTileMs: graphAwaitMs,
          yieldMs,
          otherMs: Math.max(0, stats.graphMs - graphAwaitMs - yieldMs),
          ...Object.fromEntries(Object.entries(store.profile).map(([key, value]) => [key, value - (storeProfileBefore[key] ?? 0)])),
        },
        expansion: {
          wallMs: stats.cellsMs,
          cellTilePrefetchMs: cellPrefetchMs,
          ...solver.profile,
          cellTilesRequested: neededTiles.size,
        },
      };
    }

    // output
    const outputStart = now();
    let lengthCm = 0;
    for (let index = 1; index < outColumns.length; index++) {
      if (outRows[index] !== outRows[index - 1]) lengthCm += meta.northSouthCm;
      else { let stepLengthCm = meta.eastWestCm[outRows[index]]; if (Math.abs(outColumns[index] - outColumns[index - 1]) > 1) stepLengthCm = Math.round(stepLengthCm * meta.wrapMultiplier); lengthCm += stepLengthCm; }
    }
    let keep = null;
    if (options.simplify && outColumns.length > 2) {
      keep = [0];
      let lastKept = 0, previousDeltaColumn = 0, previousDeltaRow = 0;
      const stepAt = (index) => { const deltaColumn = outColumns[index] - outColumns[index - 1]; return Math.abs(deltaColumn) > 1 ? [7, 7] : [deltaColumn, outRows[index] - outRows[index - 1]]; };
      [previousDeltaColumn, previousDeltaRow] = stepAt(1);
      for (let index = 1; index < outColumns.length - 1; index++) {
        const [nextDeltaColumn, nextDeltaRow] = stepAt(index + 1);
        if (nextDeltaColumn !== previousDeltaColumn || nextDeltaRow !== previousDeltaRow || index - lastKept >= options.maxRun) { keep.push(index); lastKept = index; }
        previousDeltaColumn = nextDeltaColumn; previousDeltaRow = nextDeltaRow;
      }
      keep.push(outColumns.length - 1);
    }
    const vertexCount = keep ? keep.length : outColumns.length;
    const coords = options.typed ? new Float64Array(2 * vertexCount) : new Array(2 * vertexCount);
    for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex++) {
      const cellIndex = keep ? keep[vertexIndex] : vertexIndex, latLon = pathfinder.cellToLatLon(outColumns[cellIndex], outRows[cellIndex], meta);
      coords[2 * vertexIndex] = latLon.lon; coords[2 * vertexIndex + 1] = latLon.lat;
    }
    if (!stats.profile) stats.profile = { graph: { wallMs: stats.graphMs }, expansion: { wallMs: 0, ...solver.profile } };
    stats.profile.outputMs = now() - outputStart;
    stats.ms = now() - startTime;
    const result = { coords, costCm: totalCost, lengthCm, source, chain: chainKeys, cellCount: outColumns.length, vertexCount, stats };
    if (options.returnCells) { const cellPairs = new Int32Array(2 * outColumns.length); for (let index = 0; index < outColumns.length; index++) { cellPairs[2 * index] = outColumns[index]; cellPairs[2 * index + 1] = outRows[index]; } result.cells = cellPairs; }
    progress("done");
    return result;
  }

  async function findPath(startNodes, endNodes, opts) {
    const result = await findPathDetailed(startNodes, endNodes, opts);
    return result ? result.coords : null;
  }

  return { findPath, findPathDetailed, configureSearch, store };
}

const instance = makeSearch(snapper);
export const findPath = instance.findPath;
export const findPathDetailed = instance.findPathDetailed;
export const configureSearch = instance.configureSearch;