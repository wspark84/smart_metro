export function createRequestCache() {
  return {
    entries: new Map(),
    pending: new Map(),
  };
}

export const defaultRequestCache = createRequestCache();

export function resetRequestCache(cache = defaultRequestCache) {
  cache.entries.clear();
  cache.pending.clear();
}

function normalizeKey(key) {
  return typeof key === "string" ? key : JSON.stringify(key);
}

export async function loadWithCache({
  cache = defaultRequestCache,
  key,
  ttlMs,
  loader,
  allowStaleOnError = true,
  now = Date.now(),
}) {
  const cacheKey = normalizeKey(key);
  const cached = cache.entries.get(cacheKey);

  if (cached && cached.expiresAt > now) {
    return {
      value: cached.value,
      cacheStatus: "cache-hit",
      fetchedAt: cached.fetchedAt,
      servedAt: new Date(now).toISOString(),
      stale: false,
      fallbackError: "",
    };
  }

  if (cache.pending.has(cacheKey)) {
    return cache.pending.get(cacheKey);
  }

  const task = (async () => {
    try {
      const value = await loader();
      const fetchedAt = new Date(now).toISOString();
      cache.entries.set(cacheKey, {
        value,
        fetchedAt,
        expiresAt: now + ttlMs,
      });

      return {
        value,
        cacheStatus: "live",
        fetchedAt,
        servedAt: fetchedAt,
        stale: false,
        fallbackError: "",
      };
    } catch (error) {
      if (allowStaleOnError && cached) {
        return {
          value: cached.value,
          cacheStatus: "stale-fallback",
          fetchedAt: cached.fetchedAt,
          servedAt: new Date(now).toISOString(),
          stale: true,
          fallbackError: error instanceof Error ? error.message : "Unknown upstream fetch error.",
        };
      }

      throw error;
    }
  })();

  cache.pending.set(cacheKey, task);

  try {
    return await task;
  } finally {
    cache.pending.delete(cacheKey);
  }
}
