// snap arbitrary point to nearest node
//
//   import { snapToNode, snapCandidates, configure } from "./snapper.js";
//   const fromNode = await snapToNode(lat, lon);                    // path cost FROM the point to the node
//   const toNode = await snapToNode(lat, lon, { direction: "to" }); // path cost FROM the node to the point
//
// Exact snapping through A* over the 256x256 region containing the cell

import { addTiming, fetchWithRetries } from "./utils.js";

const PIX_DEG = 0.003374120830641; // same constant as buildGraph.cpp
const NORTH_BIT = 1, EAST_BIT = 2, SOUTH_BIT = 4, WEST_BIT = 8;

const config = {
  cellsBase: "https://marswalk-cells.pages.dev",
  graphBase: "https://marswalk-graph.pages.dev",
  lonOrigin: -180,
  fetchRetries: 2,
};

export function configure(opts) {
  Object.assign(config, opts);
}

const cache = new Map();
const diagnostics = { cacheHits: {}, cacheMisses: {}, requests: {}, bodyReads: {}, snap: {} };
const diagnosticKind = (url) => url.includes("/tiles/")
  ? url.includes("marswalk-graph") ? "graphTile" : "cellTile"
  : url.endsWith("ewCm.bin") ? "ewCm" : url.endsWith(".json") ? "metadata" : "other";
export function getDiagnostics() {
  return structuredClone(diagnostics);
}

function bufferFromResponse(res, kind) {
  const startTime = typeof performance !== "undefined" ? performance.now() : Date.now();

  return res.arrayBuffer().then((buf) => {
    addTiming(diagnostics.bodyReads, kind, "count");
    addTiming(diagnostics.bodyReads, kind, "ms", (typeof performance !== "undefined" ? performance.now() : Date.now()) - startTime);
    addTiming(diagnostics.bodyReads, kind, "bytes", buf.byteLength);
    return buf;
  });
}

function CachedPromise(key, make) {
  const kind = key.startsWith("gbuf") ? "graphTile" : key.startsWith("c") ? "cellTile" : key.startsWith("g") ? "graphNodes" : "metadata";
  if (cache.has(key)) {
    addTiming(diagnostics.cacheHits, kind, "count");
  } else {
    addTiming(diagnostics.cacheMisses, kind, "count");
    const promise = make().catch((error) => {
      cache.delete(key);
      throw error;
    });
    cache.set(key, promise);
  }
  return cache.get(key);
}

function fetchResource(url, allow404 = false) {
  return fetchWithRetries(url, {
    allow404,
    retries: config.fetchRetries,
    kind: diagnosticKind(url),
    requestStats: diagnostics.requests,
  });
}

export function getMeta() { // graph and cell metadata
  return CachedPromise("meta", async () => {
    const [cellsMeta, graphMeta, eastWestBytes] = await Promise.all([
      fetchResource(`${config.cellsBase}/cells.meta.json`).then((response) => response.json()),
      fetchResource(`${config.graphBase}/graph.meta.json`).then((response) => response.json()),
      fetchResource(`${config.graphBase}/ewCm.bin`).then((response) => bufferFromResponse(response, "ewCm")),
    ]);
    if (cellsMeta.gz) throw new Error("cells are marked gz; this loader expects raw tiles");
    if (cellsMeta.tile !== graphMeta.tile || cellsMeta.width !== graphMeta.width || cellsMeta.rows !== graphMeta.rows) {
      throw new Error("cells and graph metadata disagree");
    }
    const eastWestCm = new Uint32Array(eastWestBytes);
    if (eastWestCm.length !== graphMeta.rows) throw new Error("ewCm.bin length does not match rows");
    const lambdaCm = Math.round(graphMeta.lambdaM * 100);
    return {
      tileSize: graphMeta.tile,
      width: graphMeta.width,
      rowCount: graphMeta.rows,
      firstRow: graphMeta.firstRow,
      tilesX: graphMeta.tilesX,
      tilesY: graphMeta.tilesY,
      regionSize: graphMeta.region,
      northSouthCm: graphMeta.nsCm,
      lambdaCm,
      biasPercent: graphMeta.reverseBiasPct ?? 25,
      eastWestCm,
      wrapMultiplier: graphMeta.wrapMul,
      northSouthTable: stepTable(graphMeta.nsCm, lambdaCm, graphMeta.reverseBiasPct ?? 25),
    };
  });
}

export function getCellTile(tileX, tileY) {
  return CachedPromise(`c${tileX},${tileY}`, async () => {
    const res = await fetchResource(`${config.cellsBase}/tiles/${tileY}/${tileX}.bin`);
    const buf = new Uint8Array(await bufferFromResponse(res, "cellTile"));
    const meta = await getMeta();
    if (buf.length !== meta.tileSize * meta.tileSize) {
      throw new Error(`cell tile ${tileX},${tileY}: bad size ${buf.length}`);
    }
    return buf;
  });
}

export function fetchGraphTileBuffer(tileX, tileY) {
  return CachedPromise(`gbuf${tileX},${tileY}`, async () => {
    const res = await fetchResource(`${config.graphBase}/tiles/${tileY}/${tileX}.bin`, true);
    if (!res) return null;
    return await bufferFromResponse(res, "graphTile");
  });
}

export function getGraphNodes(tileX, tileY) {
  return CachedPromise(`g${tileX},${tileY}`, async () => {
    const buf = await fetchGraphTileBuffer(tileX, tileY);
    if (!buf) return [];
    const dataView = new DataView(buf);
    if (dataView.byteLength < 16 || dataView.getUint32(0, true) !== 0x3254474d) {
      throw new Error(`graph tile ${tileX},${tileY}: bad magic`);
    }
    const nodeCount = dataView.getUint32(4, true);
    if (dataView.byteLength < 16 + nodeCount * 16) {
      throw new Error(`graph tile ${tileX},${tileY}: truncated node records`);
    }
    const nodes = new Array(nodeCount);
    for (let i = 0; i < nodeCount; i++) {
      const offset = 16 + i * 16;
      nodes[i] = {
        column: dataView.getUint32(offset, true),
        row: dataView.getUint16(offset + 4, true),
        dir: dataView.getUint8(offset + 6),
        costByte: dataView.getUint8(offset + 7),
      };
    }
    return nodes;
  });
}

export function latLonToCell(lat, lon, meta) {
  if (!(lat <= 90 && lat >= -90) || !Number.isFinite(lon)) throw new Error("bad lat/lon");
  const row = Math.floor((90 - lat) / PIX_DEG) - meta.firstRow;
  if (row < 0 || row >= meta.rowCount) throw new Error(`latitude ${lat} is outside the covered band`);
  let wrappedLon = (lon - config.lonOrigin) % 360;
  if (wrappedLon < 0) wrappedLon += 360;
  const column = Math.min(meta.width - 1, Math.floor(wrappedLon / PIX_DEG)); // columns beyond width-1 fold into the seam cell
  return { column, row };
}

export function cellToLatLon(column, row, meta) {
  let lon = (((column + 0.5) * PIX_DEG + config.lonOrigin) % 360 + 360) % 360;
  if (lon > 180) lon -= 360; // Normalize to [-180, 180] for Cesium compatibility
  return {
    lat: 90 - (row + meta.firstRow + 0.5) * PIX_DEG,
    lon,
  };
}

export function stepWeight(stepLengthCm, fromCost, toCost, lambdaCm, northSouthCm, biasPercent) {
  const blendedCost = (100 - biasPercent) * (fromCost + toCost) + 2 * biasPercent * toCost;
  const numerator = lambdaCm * stepLengthCm * blendedCost, denominator = northSouthCm * 200;
  return stepLengthCm + Math.floor((numerator + denominator / 2) / denominator);
}

function stepTable(northSouthCm, lambdaCm, biasPercent) {
  const table = new Uint32Array(256);
  for (let fromCost = 0; fromCost < 16; fromCost++) {
    for (let toCost = 0; toCost < 16; toCost++) {
      table[(fromCost << 4) | toCost] = stepWeight(northSouthCm, fromCost, toCost, lambdaCm, northSouthCm, biasPercent);
    }
  }
  return table;
}

function eastWestTableRow(meta, row) {
  const table = new Uint32Array(256), stepLengthCm = meta.eastWestCm[row];
  for (let fromCost = 0; fromCost < 16; fromCost++) {
    for (let toCost = 0; toCost < 16; toCost++) {
      table[(fromCost << 4) | toCost] = stepWeight(stepLengthCm, fromCost, toCost, meta.lambdaCm, meta.northSouthCm, meta.biasPercent);
    }
  }
  return table;
}

// binary heap of packed keys (dist * 2^20 + cell), exact in a double for dist < 8.5e9 cm
class Heap {
  constructor() {
    this.packedKeys = new Float64Array(1 << 12);
    this.size = 0;
  }
  push(packedKey) {
    if (this.size === this.packedKeys.length) {
      const grown = new Float64Array(this.size * 2);
      grown.set(this.packedKeys);
      this.packedKeys = grown;
    }
    const keys = this.packedKeys;
    let index = this.size++;
    while (index > 0) {
      const parentIndex = (index - 1) >> 1;
      if (keys[parentIndex] <= packedKey) break;
      keys[index] = keys[parentIndex];
      index = parentIndex;
    }
    keys[index] = packedKey;
  }
  pop() {
    const keys = this.packedKeys, top = keys[0], last = keys[--this.size];
    let index = 0;
    for (;;) {
      let childIndex = 2 * index + 1;
      if (childIndex >= this.size) break;
      if (childIndex + 1 < this.size && keys[childIndex + 1] < keys[childIndex]) childIndex++;
      if (keys[childIndex] >= last) break;
      keys[index] = keys[childIndex];
      index = childIndex;
    }
    keys[index] = last;
    return top;
  }
}
const CELL_KEY_RANGE = 1048576; // from graphBuilder

async function locate(lat, lon) {
  const meta = await getMeta();
  const { column: cellColumn, row: cellRow } = latLonToCell(lat, lon, meta);
  const tileX = Math.floor(cellColumn / meta.tileSize), tileY = Math.floor(cellRow / meta.tileSize);
  const originColumn = Math.floor(cellColumn / meta.regionSize) * meta.regionSize, originRow = Math.floor(cellRow / meta.regionSize) * meta.regionSize;
  const region = {
    originColumn,
    originRow,
    width: Math.min(meta.width, originColumn + meta.regionSize) - originColumn,
    height: Math.min(meta.rowCount, originRow + meta.regionSize) - originRow,
  };
  const [tile, nodes] = await Promise.all([getCellTile(tileX, tileY), getGraphNodes(tileX, tileY)]);
  const regionBuffer = new Uint8Array(region.width * region.height);
  for (let rowOffset = 0; rowOffset < region.height; rowOffset++) {
    const src = ((originRow + rowOffset) % meta.tileSize) * meta.tileSize + (originColumn % meta.tileSize);
    regionBuffer.set(tile.subarray(src, src + region.width), rowOffset * region.width);
  }
  return { meta, cellColumn, cellRow, tileX, tileY, region, regionBuffer, nodes };
}

// half-node cells inside the region -> Map(localCell -> [{nodeIndex, side}])
function halfNodesInRegion(nodes, region, meta) {
  const cellMap = new Map();
  const add = (cellColumn, cellRow, nodeIndex, side) => {
    if (cellColumn < region.originColumn || cellColumn >= region.originColumn + region.width || cellRow < region.originRow || cellRow >= region.originRow + region.height) return;
    const localCell = (cellRow - region.originRow) * region.width + (cellColumn - region.originColumn);
    if (!cellMap.has(localCell)) cellMap.set(localCell, []);
    cellMap.get(localCell).push({ nodeIndex, side });
  };
  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex++) {
    const node = nodes[nodeIndex];
    add(node.column, node.row, nodeIndex, 0);
    if (node.dir === 1) add((node.column + 1) % meta.width, node.row, nodeIndex, 1);
    else if (node.dir === 2) add(node.column, node.row + 1, nodeIndex, 1);
  }
  return cellMap;
}

/**
 * All reachable half-nodes of the region containing (lat, lon), cheapest first
 * (up to opts.count, default 8).
 * opts.direction: "from" (default) = cost of walking from the point to the node,
 *                 "to"             = cost of walking from the node to the point.
 * Returns empty array [] if the point's cell is blocked, has no open direction,
 * or cannot reach any graph node.
 */
export async function snapCandidates(lat, lon, opts = {}) {
  const totalStart = typeof performance !== "undefined" ? performance.now() : Date.now();
  const count = Math.max(1, opts.count ?? 8);
  const isReverse = opts.direction === "to";
  const locateStart = typeof performance !== "undefined" ? performance.now() : Date.now();
  const { meta, cellColumn, cellRow, tileX, tileY, region, regionBuffer, nodes } = await locate(lat, lon);
  const locateMs = (typeof performance !== "undefined" ? performance.now() : Date.now()) - locateStart;
  const { width, height } = region;
  if (width * height > CELL_KEY_RANGE) throw new Error("region too large for the heap key");

  const src = (cellRow - region.originRow) * width + (cellColumn - region.originColumn);
  if ((regionBuffer[src] & 15) === 15 || (regionBuffer[src] >> 4) === 0) return [];

  const halfNodes = halfNodesInRegion(nodes, region, meta);

  const eastWestTables = new Map();
  const eastWestTableFor = (rowIndex) => {
    let table = eastWestTables.get(rowIndex);
    if (!table) {
      table = eastWestTableRow(meta, rowIndex);
      eastWestTables.set(rowIndex, table);
    }
    return table;
  };

  const dist = new Float64Array(width * height).fill(Infinity);
  const done = new Uint8Array(width * height);
  const heap = new Heap();
  dist[src] = 0;
  heap.push(src);

  const out = [];
  const dijkstraStart = typeof performance !== "undefined" ? performance.now() : Date.now();
  let cellsSettled = 0;

  while (heap.size > 0 && out.length < count) {
    const packedKey = heap.pop();
    const cellIndex = packedKey % CELL_KEY_RANGE, cellDistance = (packedKey - cellIndex) / CELL_KEY_RANGE;
    if (done[cellIndex] || cellDistance !== dist[cellIndex]) continue;
    done[cellIndex] = 1;
    cellsSettled++;

    const nodesHere = halfNodes.get(cellIndex);
    if (nodesHere) {
      for (const { nodeIndex, side } of nodesHere) {
        const node = nodes[nodeIndex];
        const cell = side === 0 ? { column: node.column, row: node.row }
          : node.dir === 1 ? { column: (node.column + 1) % meta.width, row: node.row } : { column: node.column, row: node.row + 1 };
        const latLon = cellToLatLon(cell.column, cell.row, meta);
        out.push({
          key: `${node.column},${node.row},${node.dir}`,
          kind: node.dir === 0 ? "interior" : "portal",
          dir: node.dir,
          side,
          tileX,
          tileY,
          index: nodeIndex,
          cell,
          lat: latLon.lat,
          lon: latLon.lon,
          cost: cellDistance,
          direction: isReverse ? "to" : "from",
          request: { lat, lon, cell: { column: cellColumn, row: cellRow } },
        });
      }
    }

    const localRow = (cellIndex / width) | 0, localColumn = cellIndex - localRow * width;
    const currentCost = regionBuffer[cellIndex] & 15, currentMask = regionBuffer[cellIndex] >> 4;
    const globalRow = region.originRow + localRow;
    const eastWestTable = eastWestTableFor(globalRow);
    const relax = (neighborIndex, backBit, table) => {
      const neighborByte = regionBuffer[neighborIndex], neighborCost = neighborByte & 15;
      if (neighborCost === 15 || !((neighborByte >> 4) & backBit)) return;
      const stepCost = isReverse ? table[(neighborCost << 4) | currentCost] : table[(currentCost << 4) | neighborCost];
      const newDistance = cellDistance + stepCost;
      if (newDistance < dist[neighborIndex]) {
        dist[neighborIndex] = newDistance;
        heap.push(newDistance * CELL_KEY_RANGE + neighborIndex);
      }
    };

    if (localRow > 0 && (currentMask & NORTH_BIT)) relax(cellIndex - width, SOUTH_BIT, meta.northSouthTable);
    if (localRow < height - 1 && (currentMask & SOUTH_BIT)) relax(cellIndex + width, NORTH_BIT, meta.northSouthTable);
    if (localColumn < width - 1 && (currentMask & EAST_BIT)) relax(cellIndex + 1, WEST_BIT, eastWestTable);
    if (localColumn > 0 && (currentMask & WEST_BIT)) relax(cellIndex - 1, EAST_BIT, eastWestTable);
  }

  const ended = typeof performance !== "undefined" ? performance.now() : Date.now();
  addTiming(diagnostics.snap, "calls", "count");
  addTiming(diagnostics.snap, "calls", "wallMs", ended - totalStart);
  addTiming(diagnostics.snap, "calls", "locateMs", locateMs);
  addTiming(diagnostics.snap, "calls", "dijkstraMs", ended - dijkstraStart);
  addTiming(diagnostics.snap, "calls", "cellsSettled", cellsSettled);
  addTiming(diagnostics.snap, "calls", "nodesReturned", out.length);
  return out.slice(0, count);
}

/** Nearest node (portal or interior) by exact path cost, or null if trapped or unreachable. */
export async function snapToNode(lat, lon, opts = {}) {
  const candidates = await snapCandidates(lat, lon, { ...opts, count: 1 });
  return candidates?.[0] ?? null;
}