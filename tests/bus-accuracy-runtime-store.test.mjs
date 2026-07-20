import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createBusAccuracyRuntimeState, markBusAccuracyAutoProbeResult } from "../src/server/bus-accuracy-runtime.mjs";
import { readBusAccuracyRuntimeState, writeBusAccuracyRuntimeState } from "../src/server/bus-accuracy-runtime-store.mjs";

test("readBusAccuracyRuntimeState returns defaults when the file is missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bus-accuracy-runtime-store-"));
  const filePath = join(dir, "bus-accuracy-runtime.json");

  try {
    const runtime = await readBusAccuracyRuntimeState(filePath);
    assert.equal(runtime.autoProbeCount, 0);
    assert.equal(runtime.lastStatus, "idle");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeBusAccuracyRuntimeState persists the latest auto-probe status", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bus-accuracy-runtime-store-"));
  const filePath = join(dir, "bus-accuracy-runtime.json");

  try {
    const runtime = markBusAccuracyAutoProbeResult(createBusAccuracyRuntimeState(), {
      probeKey: "gyeonggi::1002::광화문역",
      now: new Date("2026-05-15T07:05:00.000Z"),
      status: "ready",
      reason: "first-probe",
      comparisonCount: 2,
    });

    await writeBusAccuracyRuntimeState(runtime, filePath);
    const restored = await readBusAccuracyRuntimeState(filePath);

    assert.equal(restored.autoProbeCount, 1);
    assert.equal(restored.lastComparisonCount, 2);
    assert.equal(restored.lastStatus, "ready");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
