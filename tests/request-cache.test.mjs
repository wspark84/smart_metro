import test from "node:test";
import assert from "node:assert/strict";

import { createRequestCache, loadWithCache } from "../src/server/request-cache.mjs";

test("loadWithCache stores a live value and reuses it within the ttl", async () => {
  const cache = createRequestCache();
  let loadCount = 0;

  const first = await loadWithCache({
    cache,
    key: ["arrivals", "seoul", "100000001"],
    ttlMs: 10_000,
    now: 1_000,
    loader: async () => {
      loadCount += 1;
      return { arrivalsMin: [3, 11] };
    },
  });

  const second = await loadWithCache({
    cache,
    key: ["arrivals", "seoul", "100000001"],
    ttlMs: 10_000,
    now: 2_000,
    loader: async () => {
      loadCount += 1;
      return { arrivalsMin: [2, 10] };
    },
  });

  assert.equal(loadCount, 1);
  assert.equal(first.cacheStatus, "live");
  assert.equal(second.cacheStatus, "cache-hit");
  assert.deepEqual(second.value, { arrivalsMin: [3, 11] });
});

test("loadWithCache falls back to the last successful value when refresh fails", async () => {
  const cache = createRequestCache();

  await loadWithCache({
    cache,
    key: "gyeonggi-arrivals",
    ttlMs: 10_000,
    now: 1_000,
    loader: async () => ({ arrivalsMin: [4, 16] }),
  });

  const fallback = await loadWithCache({
    cache,
    key: "gyeonggi-arrivals",
    ttlMs: 10_000,
    now: 20_000,
    loader: async () => {
      throw new Error("Upstream timeout");
    },
  });

  assert.equal(fallback.cacheStatus, "stale-fallback");
  assert.equal(fallback.stale, true);
  assert.match(fallback.fallbackError, /Upstream timeout/);
  assert.deepEqual(fallback.value, { arrivalsMin: [4, 16] });
});
