import test from "node:test";
import assert from "node:assert/strict";

import {
  consumeAuthActionToken,
  createAuthActionToken,
  pruneAuthActionTokens,
  replacePendingAuthActionToken,
} from "../src/server/auth-action-store.mjs";

test("account action tokens are one-time, expire, and never store their raw value", () => {
  const now = new Date("2026-05-13T00:00:00.000Z");
  const first = createAuthActionToken("verify-email", "user-1", now);

  assert.notEqual(first.record.tokenHash, first.token);
  assert.equal(first.record.purpose, "verify-email");
  assert.equal(pruneAuthActionTokens([first.record], now).length, 1);

  const consumed = consumeAuthActionToken([first.record], "verify-email", first.token, now);
  assert.equal(consumed.record?.userId, "user-1");
  assert.ok(consumed.records[0].consumedAt);
  assert.equal(consumeAuthActionToken(consumed.records, "verify-email", first.token, now).record, null);
  assert.equal(pruneAuthActionTokens(consumed.records, now).length, 0);
});

test("reissuing an action invalidates the previous pending action for that user and purpose", () => {
  const now = new Date("2026-05-13T00:00:00.000Z");
  const earlier = createAuthActionToken("reset-password", "user-1", now);
  const replacement = createAuthActionToken("reset-password", "user-1", now);
  const unrelated = createAuthActionToken("verify-email", "user-1", now);

  const records = replacePendingAuthActionToken([earlier.record, unrelated.record], replacement.record);
  assert.deepEqual(records.map((record) => record.id), [unrelated.record.id, replacement.record.id]);
  assert.equal(pruneAuthActionTokens([replacement.record], new Date("2026-05-13T00:31:00.000Z")).length, 0);
});
