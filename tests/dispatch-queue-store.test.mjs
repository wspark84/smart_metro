import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readDispatchQueueState, writeDispatchQueueState } from "../src/server/dispatch-queue-store.mjs";

test("readDispatchQueueState returns null when no dispatch queue file exists", async () => {
  const root = await mkdtemp(join(tmpdir(), "buswakeup-dispatch-"));
  const filePath = join(root, "dispatch-queue.json");

  try {
    const value = await readDispatchQueueState(filePath);
    assert.equal(value, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writeDispatchQueueState persists queue bundles and handled dispatch keys", async () => {
  const root = await mkdtemp(join(tmpdir(), "buswakeup-dispatch-"));
  const filePath = join(root, "nested", "dispatch-queue.json");
  const payload = {
    dateKey: "2026-04-22",
    bundles: [{ id: "bundle-1", title: "Dispatch" }],
    handledDispatchKeys: ["2026-04-22:foo:stage-0"],
    lastGeneratedAt: "2026-04-22T00:00:00.000Z",
  };

  try {
    await writeDispatchQueueState(payload, filePath);
    const loaded = await readDispatchQueueState(filePath);
    assert.deepEqual(loaded, payload);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readDispatchQueueState migrates legacy handledAlertKeys into handledDispatchKeys", async () => {
  const root = await mkdtemp(join(tmpdir(), "buswakeup-dispatch-"));
  const filePath = join(root, "nested", "dispatch-queue.json");

  try {
    await writeDispatchQueueState(
      {
        bundles: [],
        handledAlertKeys: ["2026-04-22:legacy"],
        lastGeneratedAt: null,
      },
      filePath,
    );
    const loaded = await readDispatchQueueState(filePath);
    assert.deepEqual(loaded.handledDispatchKeys, ["2026-04-22:legacy"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
