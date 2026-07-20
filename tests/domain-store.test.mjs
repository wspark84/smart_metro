import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readDomainSnapshot, writeDomainSnapshot } from "../src/server/domain-store.mjs";

test("readDomainSnapshot returns null when the domain file does not exist", async () => {
  const root = await mkdtemp(join(tmpdir(), "buswakeup-domain-"));
  const filePath = join(root, "domain-store.json");

  try {
    const value = await readDomainSnapshot(filePath);
    assert.equal(value, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writeDomainSnapshot persists a domain JSON object that can be read back", async () => {
  const root = await mkdtemp(join(tmpdir(), "buswakeup-domain-"));
  const filePath = join(root, "nested", "domain-store.json");
  const payload = {
    user: {
      id: "demo-user",
      name: "Kim",
    },
    route: {
      id: "primary-route",
      selectedStopId: "CITY_HALL",
    },
    meta: {
      updatedAt: "2026-04-22T00:00:00.000Z",
    },
  };

  try {
    await writeDomainSnapshot(payload, filePath);
    const loaded = await readDomainSnapshot(filePath);
    assert.deepEqual(loaded, payload);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
