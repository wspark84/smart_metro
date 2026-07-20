import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  readAuthSessions,
  readAuthUsers,
  writeAuthSessions,
  writeAuthUsers,
} from "../src/server/auth-store.mjs";

test("auth-store persists users and sessions arrays", async () => {
  const directory = await mkdtemp(join(tmpdir(), "buswakeup-auth-store-"));
  const usersFile = join(directory, "users.json");
  const sessionsFile = join(directory, "sessions.json");

  try {
    await writeAuthUsers(
      [
        {
          id: "user-1",
          email: "owner@example.com",
          name: "Owner",
          passwordHash: "hash",
          passwordSalt: "salt",
          createdAt: "2026-05-13T00:00:00.000Z",
          updatedAt: "2026-05-13T00:00:00.000Z",
        },
      ],
      usersFile,
    );
    await writeAuthSessions(
      [
        {
          id: "session-1",
          userId: "user-1",
          createdAt: "2026-05-13T00:00:00.000Z",
          updatedAt: "2026-05-13T00:00:00.000Z",
          expiresAt: "2026-06-12T00:00:00.000Z",
        },
      ],
      sessionsFile,
    );

    assert.equal((await readAuthUsers(usersFile))[0].email, "owner@example.com");
    assert.equal((await readAuthSessions(sessionsFile))[0].userId, "user-1");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
