import test from "node:test";
import assert from "node:assert/strict";

import { buildUserDataFilePath, buildUserDataRoot, sanitizeUserStorageKey } from "../src/server/user-storage.mjs";

test("user-storage builds safe per-user data paths", () => {
  assert.equal(sanitizeUserStorageKey(" Founder@Example.com "), "founder-example-com");
  assert.match(buildUserDataRoot("owner-1"), /data[\\/]users[\\/]owner-1$/);
  assert.match(buildUserDataFilePath("owner-1", "app-state.json"), /data[\\/]users[\\/]owner-1[\\/]app-state\.json$/);
});
