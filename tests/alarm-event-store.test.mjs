import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { appendAlarmEvents, readAlarmEvents } from "../src/server/alarm-event-store.mjs";

test("readAlarmEvents returns an empty list when no event file exists", async () => {
  const root = await mkdtemp(join(tmpdir(), "buswakeup-events-"));
  const filePath = join(root, "alarm-events.json");

  try {
    const value = await readAlarmEvents(filePath);
    assert.deepEqual(value, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("appendAlarmEvents prepends new events and keeps the newest entries first", async () => {
  const root = await mkdtemp(join(tmpdir(), "buswakeup-events-"));
  const filePath = join(root, "alarm-events.json");

  try {
    await appendAlarmEvents(
      [
        {
          id: "event-1",
          kind: "APP_ACTION",
          title: "Opened dashboard",
          createdAt: "2026-04-22T07:00:00.000Z",
        },
        {
          id: "event-2",
          kind: "ALARM_TRIGGERED",
          title: "Bus 1002 in 5 min",
          createdAt: "2026-04-22T07:03:00.000Z",
          liveEtaGuardMode: "conservative",
          deliveryPriorityClass: "boosted",
          deliveryPriorityReason: "high-watch-first-main-alarm",
          accuracyRiskBufferMin: 2,
          accuracySpreadMin: 5,
          volumePercent: 85,
          vibrationRepeats: 3,
          mechanicalLoopBoost: 2,
          speechRepeatCount: 2,
        },
      ],
      filePath,
    );

    const loaded = await readAlarmEvents(filePath);
    assert.equal(loaded.length, 2);
    assert.equal(loaded[0].id, "event-2");
    assert.equal(loaded[1].id, "event-1");
    assert.equal(loaded[0].liveEtaGuardMode, "conservative");
    assert.equal(loaded[0].deliveryPriorityClass, "boosted");
    assert.equal(loaded[0].deliveryPriorityReason, "high-watch-first-main-alarm");
    assert.equal(loaded[0].accuracyRiskBufferMin, 2);
    assert.equal(loaded[0].accuracySpreadMin, 5);
    assert.equal(loaded[0].volumePercent, 85);
    assert.equal(loaded[0].vibrationRepeats, 3);
    assert.equal(loaded[0].mechanicalLoopBoost, 2);
    assert.equal(loaded[0].speechRepeatCount, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
