export function addTiming(table, kind, field, value = 1) {
  const row = table[kind] ??= {};
  row[field] = (row[field] ?? 0) + value;
}

export async function fetchWithRetries(url, { allow404 = false, retries, kind, requestStats }) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const started = typeof performance !== "undefined" ? performance.now() : Date.now();
    let requestRecorded = false;
    try {
      const res = await fetch(url);
      const elapsed = (typeof performance !== "undefined" ? performance.now() : Date.now()) - started;
      addTiming(requestStats, kind, "count");
      addTiming(requestStats, kind, "ms", elapsed);
      requestRecorded = true;
      if (res.status === 404 && allow404) return null;
      if (!res.ok) {
        addTiming(requestStats, kind, "errors");
        throw new Error(`HTTP ${res.status} for ${url}`);
      }
      const entries = typeof performance !== "undefined" ? performance.getEntriesByName(url) : [];
      const entry = entries.length ? entries[entries.length - 1] : null;
      if (entry) {
        addTiming(requestStats, kind, "transferBytes", entry.transferSize || 0);
        addTiming(requestStats, kind, "encodedBytes", entry.encodedBodySize || 0);
        if (entry.transferSize === 0) addTiming(requestStats, kind, "cacheLike");
      }
      return res;
    } catch (error) {
      if (!requestRecorded) {
        addTiming(requestStats, kind, "count");
        addTiming(requestStats, kind, "ms", (typeof performance !== "undefined" ? performance.now() : Date.now()) - started);
        addTiming(requestStats, kind, "errors");
      }
      lastError = error;
    }
  }
  throw lastError;
}

export function diagnosticsDelta(before, after) {
  const diff = (beforeTable = {}, afterTable = {}) => {
    const out = {};
    for (const kind of new Set([...Object.keys(beforeTable), ...Object.keys(afterTable)])) {
      const left = beforeTable[kind] ?? {}, right = afterTable[kind] ?? {}, row = {};
      for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) row[key] = (right[key] ?? 0) - (left[key] ?? 0);
      out[kind] = row;
    }
    return out;
  };
  return { cacheHits: diff(before.cacheHits, after.cacheHits), cacheMisses: diff(before.cacheMisses, after.cacheMisses), requests: diff(before.requests, after.requests), bodyReads: diff(before.bodyReads, after.bodyReads), snap: diff(before.snap, after.snap) };
}

export const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export async function poolMap(items, limit, callback) {
  let nextIndex = 0;
  const worker = async () => { while (nextIndex < items.length) { const item = items[nextIndex++]; await callback(item); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}