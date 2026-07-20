import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createBusAccuracyState, recordForecastObservation } from "../src/server/bus-accuracy.mjs";
import { readBusAccuracyState, writeBusAccuracyState } from "../src/server/bus-accuracy-store.mjs";

test("readBusAccuracyState returns an empty normalized state when no file exists", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bus-accuracy-store-"));
  const filePath = join(dir, "bus-accuracy.json");

  try {
    const state = await readBusAccuracyState(filePath);
    assert.deepEqual(state.pendingObservations, []);
    assert.deepEqual(state.resolvedSamples, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeBusAccuracyState persists pending observations", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bus-accuracy-store-"));
  const filePath = join(dir, "bus-accuracy.json");

  try {
    let state = createBusAccuracyState();
    state = recordForecastObservation(state, {
      provider: "tago",
      region: "gyeonggi",
      routeNumber: "1002",
      stopName: "광화문역",
      predictedMinutes: 4,
      observedAt: "2026-05-14T07:00:00.000Z",
    });

    await writeBusAccuracyState(state, filePath);
    const restored = await readBusAccuracyState(filePath);

    assert.equal(restored.pendingObservations.length, 1);
    assert.equal(restored.pendingObservations[0].provider, "tago");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
