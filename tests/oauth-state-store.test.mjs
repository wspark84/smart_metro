import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { readOAuthStates, writeOAuthStates } from "../src/server/oauth-state-store.mjs";

test("oauth-state-store persists oauth state records", async () => {
  const directory = await mkdtemp(join(tmpdir(), "buswakeup-oauth-state-"));
  const filePath = join(directory, "oauth-states.json");

  try {
    await writeOAuthStates(
      [
        {
          id: "state-1",
          provider: "google",
          state: "abc123",
          nonce: "nonce123",
          redirectAfterAuth: "/#/home",
          createdAt: "2026-05-13T00:00:00.000Z",
          expiresAt: "2026-05-13T00:10:00.000Z",
        },
      ],
      filePath,
    );

    const records = await readOAuthStates(filePath);
    assert.equal(records.length, 1);
    assert.equal(records[0].provider, "google");
    assert.equal(records[0].state, "abc123");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
