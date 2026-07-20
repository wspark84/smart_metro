import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readAppState, writeAppState } from "../src/server/app-state-store.mjs";

test("readAppState returns null when no persisted file exists", async () => {
  const root = await mkdtemp(join(tmpdir(), "buswakeup-state-"));
  const filePath = join(root, "app-state.json");

  try {
    const value = await readAppState(filePath);
    assert.equal(value, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writeAppState persists a JSON object that can be read back", async () => {
  const root = await mkdtemp(join(tmpdir(), "buswakeup-state-"));
  const filePath = join(root, "nested", "app-state.json");
  const payload = {
    user: {
      requiredArrivalTime: "09:00",
    },
    live: {
      provider: "gyeonggi",
      stationId: "200000118",
    },
  };

  try {
    await writeAppState(payload, filePath);
    const loaded = await readAppState(filePath);
    assert.deepEqual(loaded, payload);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
