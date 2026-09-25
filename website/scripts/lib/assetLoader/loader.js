import { decode as decodePNG } from "https://cdn.jsdelivr.net/npm/fast-png@6.1.0/+esm";

const tileCount = 128;
const tileCols = 16;
const tileRows = 8;
const loadAttempts = 3;

const loaded = {
    surface: new Map(),
    height: new Map(),
};

const inFlight = {
    surface: new Map(),
    height: new Map(),
};

const lazyQueue = [];
const lazyQueueKeys = new Set();
let lazyRunning = false;

const dbReady = new Promise((resolve, reject) => {
    const request = indexedDB.open("marsTileCache", 1);

    request.onupgradeneeded = (event) => {
        const database = event.target.result;

        if (!database.objectStoreNames.contains("tiles")) {
            database.createObjectStore("tiles");
        }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
});

function normalizeQuery(query) {
    if (query === "surface") {
        return ["surface"];
    }

    if (query === "height") {
        return ["height"];
    }

    return ["surface", "height"];
}

/**
 * checks if the requested tiiles are loaded in memory
 *
 * @param {number} tileId (0 to 127)
 * @param {"surface" | "height"} [query] - Asset type to check ("surface", "height", or undefined for both).
 * @returns {boolean} True if all requested asset types are cached in memory, false otherwise.
 */
function isLoaded(tileId, query) {
    const types = normalizeQuery(query);
    return types.every((type) => loaded[type].has(tileId));
}

function getStoredTile(key) {
    return dbReady.then(
        (database) =>
            new Promise((resolve, reject) => {
                const transaction = database.transaction("tiles", "readonly");
                const store = transaction.objectStore("tiles");
                const request = store.get(key);

                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            })
    );
}

function storeTile(key, blob) {
    return dbReady.then(
        (database) =>
            new Promise((resolve, reject) => {
                const transaction = database.transaction("tiles", "readwrite");
                const store = transaction.objectStore("tiles");

                store.put(blob, key);

                transaction.oncomplete = () => resolve();
                transaction.onerror = () => reject(transaction.error);
            })
    );
}

async function decodeHeight(blob) {
    const buffer = await blob.arrayBuffer();
    const image = decodePNG(buffer);

    if (image.depth !== 16) {
        throw new Error(`Expected 16-bit height PNG, got depth ${image.depth}`);
    }

    if (image.channels !== 1) {
        throw new Error(
            `Expected single-channel grayscale height PNG, got ${image.channels} channels`
        );
    }

    return {
        data: image.data,
        width: image.width,
        height: image.height,
    };
}

async function decodeTile(blob, type) {
    if (type === "surface") {
        return createImageBitmap(blob);
    }

    const { data } = await decodeHeight(blob);
    return data;
}

function getTileUrl(tileId, type) {
    if (type === "surface") {
        return `../Data/tiles/baseMap/${tileId}.jpg`;
    }

    return `../Data/tiles/marsHeight/${tileId}.png`;
}

async function load(tileId, type) {
    if (loaded[type].has(tileId)) {
        return;
    }

    const existing = inFlight[type].get(tileId);

    if (existing) {
        return existing;
    }

    const promise = (async () => {
        let lastError;
        let forceNetwork = false;

        for (let attempt = 1; attempt <= loadAttempts; attempt += 1) {
            try {
                const key = `${type}:${tileId}`;
                let blob = forceNetwork
                    ? null
                    : await getStoredTile(key).catch(() => null);

                const fromCache = Boolean(blob);

                if (!blob) {
                    const response = await fetch(getTileUrl(tileId, type));

                    if (!response.ok) {
                        throw new Error(
                            `Failed to load ${type} tile ${tileId}: HTTP ${response.status}`
                        );
                    }

                    blob = await response.blob();

                    storeTile(key, blob).catch((error) => {
                        console.error(
                            `Failed to cache ${type} tile ${tileId}`,
                            error
                        );
                    });
                }

                try {
                    const data = await decodeTile(blob, type);
                    loaded[type].set(tileId, data);
                    return;
                } catch (decodeError) {
                    if (fromCache) {
                        forceNetwork = true;
                    }

                    throw decodeError;
                }
            } catch (error) {
                lastError = error;

                console.error(
                    `Load attempt ${attempt}/${loadAttempts} failed for ${type} tile ${tileId}`,
                    error
                );
            }
        }

        throw lastError;
    })().finally(() => {
        inFlight[type].delete(tileId);
    });

    inFlight[type].set(tileId, promise);
    return promise;
}

/**
 * @param {number | number[]} tileIds - Single tile ID or array of tile IDs
 * @param {"surface" | "height"} [type] - Asset type to fetch ("surface", "height", or empty for both)
 * @returns {Promise<ImageBitmap | Uint8Array | [ImageBitmap, Uint8Array] | Array>}
 * Resolves to:
 * - Single tile ID & "surface": `ImageBitmap`
 * - Single tile ID & "height": `Uint8Array` (16-bit height buffer data)
 * - Single tile ID & empty type: `[ImageBitmap, Uint8Array]`
 * - Array of tile IDs: Array of results corresponding to each input tile ID.
 */
async function getTile(tileIds, type) {
    const ids = Array.isArray(tileIds) ? tileIds : [tileIds];
    const types = normalizeQuery(type);

    const results = await Promise.all(
        ids.map(async (tileId) => {
            await Promise.all(
                types.map((loadType) => load(tileId, loadType))
            );

            if (types.length === 1) {
                return loaded[types[0]].get(tileId);
            }

            return types.map((loadType) => loaded[loadType].get(tileId));
        })
    );

    return Array.isArray(tileIds) ? results : results[0];
}

function fireLoads(ids, query) {
    const types = normalizeQuery(query);

    return Promise.all(
        ids.flatMap((tileId) => types.map((type) => load(tileId, type)))
    );
}

async function runLazyQueue() {
    if (lazyRunning) {
        return;
    }

    lazyRunning = true;

    while (lazyQueue.length > 0) {
        const entry = lazyQueue.shift();
        lazyQueueKeys.delete(entry.key);

        if (loaded[entry.type].has(entry.tileId)) {
            continue;
        }

        try {
            await load(entry.tileId, entry.type);
        } catch (error) {
            console.error(
                `Lazy load failed for ${entry.type} tile ${entry.tileId}`,
                error
            );
        }
    }

    lazyRunning = false;
}

/**
 * @param {number | number[]} tileIds - Single tile ID or array of tile IDs
 * @param {"surface" | "height"} [query] - Asset type to fetch ("surface", "height", or empty for both)
 * @param {boolean} [spiral=false] - If true, also queues surrounding tiles using a BFS starting from the first tile ID.
 * @returns {Promise<void>} Resolves immediately once items are added to the background queue.
 */
function lazyLoad(tileIds, query, spiral = false) {
    const ids = Array.isArray(tileIds) ? tileIds : [tileIds];
    const types = normalizeQuery(query);
    const newEntries = [];

    const collect = (id) => {
        for (const type of types) {
            if (loaded[type].has(id)) {
                continue;
            }

            const key = `${type}:${id}`;

            if (lazyQueueKeys.has(key)) {
                continue;
            }

            lazyQueueKeys.add(key);
            newEntries.push({ tileId: id, type, key });
        }
    };

    ids.forEach(collect);

    if (spiral) {
        getSpiral(ids[0]).forEach(collect);
    }

    lazyQueue.unshift(...newEntries);
    runLazyQueue();

    return Promise.resolve();
}

function getNeighbor(tileId, dx, dy) {
    const col = tileId % tileCols;
    const row = Math.floor(tileId / tileCols);

    const newCol = (col + dx + tileCols) % tileCols;
    const newRow = row + dy;

    if (newRow < 0 || newRow >= tileRows) {
        return null;
    }

    return newRow * tileCols + newCol;
}

function getSpiral(tileId) {
    const order = [];
    const seen = new Set([tileId]);
    const directions = [
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
    ];

    let frontier = [tileId];

    while (order.length < tileCount - 1 && frontier.length > 0) {
        const nextFrontier = [];

        for (const current of frontier) {
            for (const [dx, dy] of directions) {
                const next = getNeighbor(current, dx, dy);

                if (next !== null && !seen.has(next)) {
                    seen.add(next);
                    order.push(next);
                    nextFrontier.push(next);
                }
            }
        }

        frontier = nextFrontier;
    }

    return order;
}

/**
 * canncels lazy loads and loads the stuff asked for
 * @param {number | number[]} tileIds - tile ID or array of tile IDs
 * @param {"surface" | "height"} [query] - Asset type to fetch ("surface", "height", or empty for both).
 * @returns {Promise<ImageBitmap | Uint8Array | [ImageBitmap, Uint8Array] | Array>}
 * Resolves to the loaded tile data with structure matching `getTile`.
 */
async function priorityLoad(tileIds, query) {
    const ids = Array.isArray(tileIds) ? tileIds : [tileIds];

    lazyQueue.length = 0;
    lazyQueueKeys.clear();

    await fireLoads(ids, query);

    const types = normalizeQuery(query);
    const results = ids.map((tileId) => {
        if (types.length === 1) {
            return loaded[types[0]].get(tileId);
        }

        return types.map((type) => loaded[type].get(tileId));
    });

    lazyLoad(ids, query, true);

    return Array.isArray(tileIds) ? results : results[0];
}

/**
 * @returns {Promise<{ surface: ImageBitmap, height: { data: Uint8Array, width: number, height: number } }>}
 * Object containing:
 * - `surface`: `ImageBitmap` of 2K base map.
 * - `height`: Object containing raw height pixel array (`data`), `width`, and `height`.
 */
async function load2k() {
    const surfaceKey = "2k:surface";
    const heightKey = "2k:height";

    let surfaceBlob = await getStoredTile(surfaceKey).catch(() => null);
    let heightBlob = await getStoredTile(heightKey).catch(() => null);

    if (!surfaceBlob) {
        const response = await fetch("../Data/2k/baseMap.jpg");

        if (!response.ok) {
            throw new Error(
                `Failed to load 2K surface image: HTTP ${response.status}`
            );
        }

        surfaceBlob = await response.blob();

        storeTile(surfaceKey, surfaceBlob).catch((error) => {
            console.error("Failed to cache 2K surface image", error);
        });
    }

    if (!heightBlob) {
        const response = await fetch("../Data/2k/marsHeight.png");

        if (!response.ok) {
            throw new Error(
                `Failed to load 2K height image: HTTP ${response.status}`
            );
        }

        heightBlob = await response.blob();

        storeTile(heightKey, heightBlob).catch((error) => {
            console.error("Failed to cache 2K height image", error);
        });
    }

    const surface = await createImageBitmap(surfaceBlob);
    const height = await decodeHeight(heightBlob);

    return { surface, height };
}

export {
    lazyLoad,
    priorityLoad,
    getTile,
    isLoaded,
    load2k,
};