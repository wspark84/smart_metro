import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readDispatchExecutionState, writeDispatchExecutionState } from "../src/server/dispatch-execution-store.mjs";

test("readDispatchExecutionState returns null when no execution file exists", async () => {
  const root = await mkdtemp(join(tmpdir(), "buswakeup-dispatch-execution-"));
  const filePath = join(root, "dispatch-executions.json");

  try {
    const value = await readDispatchExecutionState(filePath);
    assert.equal(value, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writeDispatchExecutionState persists execution attempts and handled bundle ids", async () => {
  const root = await mkdtemp(join(tmpdir(), "buswakeup-dispatch-execution-"));
  const filePath = join(root, "nested", "dispatch-executions.json");
  const payload = {
    dateKey: "2026-04-22",
    attempts: [{ id: "attempt-1", title: "Dispatch execution" }],
    handledBundleIds: ["bundle-1"],
    lastExecutedAt: "2026-04-22T00:00:00.000Z",
  };

  try {
    await writeDispatchExecutionState(payload, filePath);
    const loaded = await readDispatchExecutionState(filePath);
    assert.deepEqual(loaded, payload);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
