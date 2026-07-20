import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readAlarmRuntimeState, writeAlarmRuntimeState } from "../src/server/alarm-runtime-store.mjs";

test("readAlarmRuntimeState returns null when no runtime file exists", async () => {
  const root = await mkdtemp(join(tmpdir(), "buswakeup-runtime-"));
  const filePath = join(root, "alarm-runtime.json");

  try {
    const value = await readAlarmRuntimeState(filePath);
    assert.equal(value, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writeAlarmRuntimeState persists a runtime state that can be read back", async () => {
  const root = await mkdtemp(join(tmpdir(), "buswakeup-runtime-"));
  const filePath = join(root, "nested", "alarm-runtime.json");
  const payload = {
    status: "running",
    dateKey: "2026-04-22",
    firedTriggerKeys: ["2026-04-22:2026-04-21T22:03:00.000Z"],
  };

  try {
    await writeAlarmRuntimeState(payload, filePath);
    const loaded = await readAlarmRuntimeState(filePath);
    assert.deepEqual(loaded, payload);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
