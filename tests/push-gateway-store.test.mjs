import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPushGatewayState, readPushGatewayState, writePushGatewayState } from "../src/server/push-gateway-store.mjs";

test("readPushGatewayState returns null when no push gateway file exists", async () => {
  const root = await mkdtemp(join(tmpdir(), "buswakeup-push-gateway-"));
  const filePath = join(root, "push-gateway.json");

  try {
    const value = await readPushGatewayState(filePath);
    assert.equal(value, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writePushGatewayState persists attempts that can be read back", async () => {
  const root = await mkdtemp(join(tmpdir(), "buswakeup-push-gateway-"));
  const filePath = join(root, "nested", "push-gateway.json");
  const payload = {
    ...createPushGatewayState(),
    dateKey: "2026-04-24",
    attempts: [{ id: "attempt-1", status: "DRY_RUN_READY", adapter: "fcm" }],
    handledDispatchKeys: ["2026-04-24:2026-04-23T22:00:00.000Z:stage-0"],
    retryQueue: [{ id: "retry-1", dispatchKey: "2026-04-24:2026-04-23T22:00:00.000Z:stage-0", retryAttempt: 1 }],
    lastAttemptAt: "2026-04-23T00:00:00.000Z",
  };

  try {
    await writePushGatewayState(payload, filePath);
    const loaded = await readPushGatewayState(filePath);
    assert.deepEqual(loaded, payload);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
