import test from "node:test";
import assert from "node:assert/strict";

import { buildTestPushPreview } from "../src/server/test-push.mjs";

test("buildTestPushPreview creates a ready Android test envelope for a valid FCM token", () => {
  const preview = buildTestPushPreview(
    {
      deviceId: "primary-device",
      deviceName: "Office Android",
      platform: "android",
      pushEnabled: true,
      pushToken: "dQw4w9WgXcQ:APA91bExampleExampleExampleExampleToken1234567890",
      dndOverrideGranted: true,
    },
    {
      routeNumber: "1002",
      stopName: "Gwanghwamun",
      riskLevel: "RED",
    },
    new Date("2026-04-24T09:00:00+09:00"),
  );

  assert.equal(preview.status, "ready");
  assert.equal(preview.adapter, "fcm");
  assert.equal(preview.envelope.adapter, "fcm");
  assert.equal(preview.envelope.message.data.testMessage, "true");
  assert.equal(preview.envelope.message.interruption.fullScreen, true);
  assert.equal(preview.envelope.platformHints.channelId, "buswakeup-critical");
});

test("buildTestPushPreview blocks invalid tokens before sending", () => {
  const preview = buildTestPushPreview(
    {
      platform: "android",
      pushEnabled: true,
      pushToken: "demo-fcm-token",
    },
    {},
    new Date("2026-04-24T09:00:00+09:00"),
  );

  assert.equal(preview.status, "blocked");
  assert.equal(preview.envelope, null);
  assert.match(preview.reason, /registration-token format/i);
});
