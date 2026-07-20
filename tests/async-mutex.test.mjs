import assert from "node:assert/strict";
import test from "node:test";

import { createAsyncMutex } from "../src/server/async-mutex.mjs";

test("createAsyncMutex keeps stateful work from overlapping", async () => {
  const runExclusive = createAsyncMutex();
  let activeUser = "";
  const observedUsers = [];

  await Promise.all([
    runExclusive(async () => {
      activeUser = "first-user";
      await new Promise((resolve) => setTimeout(resolve, 12));
      observedUsers.push(activeUser);
    }),
    runExclusive(async () => {
      activeUser = "second-user";
      observedUsers.push(activeUser);
    }),
  ]);

  assert.deepEqual(observedUsers, ["first-user", "second-user"]);
});
