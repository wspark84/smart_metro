import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readAlarmDeliveryState, writeAlarmDeliveryState } from "../src/server/alarm-delivery-store.mjs";

test("readAlarmDeliveryState returns null when no delivery file exists", async () => {
  const root = await mkdtemp(join(tmpdir(), "buswakeup-delivery-"));
  const filePath = join(root, "alarm-delivery.json");

  try {
    const value = await readAlarmDeliveryState(filePath);
    assert.equal(value, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writeAlarmDeliveryState persists a delivery state that can be read back", async () => {
  const root = await mkdtemp(join(tmpdir(), "buswakeup-delivery-"));
  const filePath = join(root, "nested", "alarm-delivery.json");
  const payload = {
    currentAlert: {
      triggerKey: "2026-04-22:2026-04-21T22:03:00.000Z",
      status: "ACTIVE",
    },
    handledTriggerKeys: [],
    lastAction: "",
    lastActionAt: null,
  };

  try {
    await writeAlarmDeliveryState(payload, filePath);
    const loaded = await readAlarmDeliveryState(filePath);
    assert.deepEqual(loaded, payload);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
