import test from "node:test";
import assert from "node:assert/strict";

import { buildPushPreview } from "../src/server/push-preview.mjs";

function buildBundle(overrides = {}) {
  return {
    dispatchKey: "2026-04-23:2026-04-22T22:00:00.000Z:stage-1",
    alertTriggerKey: "2026-04-23:2026-04-22T22:00:00.000Z",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    riskLevel: "RED",
    title: "Bus 1002 in 4 min",
    stage: 1,
    escalationLabel: "Escalated",
    liveEtaGuardMode: "conservative",
    accuracyRiskBufferMin: 2,
    accuracySpreadMin: 5,
    notificationSpec: {
      title: "Bus 1002 in 4 min",
      body: "This bus must be caught now.",
      soundPresetId: "mechanical",
      volumePercent: 100,
      useMechanicalTone: true,
      fullScreen: true,
      criticalBypass: false,
      vibrationPattern: [1000, 200],
      vibrationRepeats: 8,
      spokenText: "Repeat the late warning.",
      speechVolume: 1,
      speechRate: 0.9,
      mechanicalLoopBoost: 0,
      speechRepeatCount: 1,
    },
    ...overrides,
  };
}

test("buildPushPreview returns a ready FCM adapter envelope for Android devices with a token", () => {
  const preview = buildPushPreview(
    buildBundle(),
    {
      deviceId: "primary-device",
      deviceName: "Office Android",
      platform: "android",
      pushEnabled: true,
      pushToken: "dQw4w9WgXcQ:APA91bExampleExampleExampleExampleToken1234567890",
    },
    new Date("2026-04-23T07:00:00+09:00"),
  );

  assert.equal(preview.status, "ready");
  assert.equal(preview.adapter, "fcm");
  assert.equal(preview.envelope.adapter, "fcm");
  assert.equal(preview.envelope.message.sound.presetId, "mechanical");
  assert.equal(preview.envelope.platformHints.channelId, "buswakeup-critical");
  assert.equal(preview.envelope.message.data.liveEtaGuardMode, "conservative");
  assert.equal(preview.envelope.message.data.accuracyRiskBufferMin, "2");
  assert.equal(preview.envelope.message.data.accuracySpreadMin, "5");
  assert.equal(preview.liveEtaGuardMode, "conservative");
  assert.equal(preview.accuracyRiskBufferMin, 2);
  assert.equal(preview.accuracySpreadMin, 5);
  assert.match(preview.target.tokenMasked, /^dQw4w9/);
  assert.equal(preview.targetHealth.deliveryReadiness, "ready");
});

test("buildPushPreview routes an iPhone FCM registration token through Firebase", () => {
  const preview = buildPushPreview(
    buildBundle(),
    {
      platform: "ios",
      pushEnabled: true,
      pushToken: "dQw4w9WgXcQ:APA91bExampleExampleExampleExampleToken1234567890",
    },
  );

  assert.equal(preview.status, "ready");
  assert.equal(preview.adapter, "fcm");
  assert.equal(preview.envelope.adapter, "fcm");
});

test("buildPushPreview upgrades Android channel hints for a boosted first alarm", () => {
  const preview = buildPushPreview(
    buildBundle({
      riskLevel: "YELLOW",
      deliveryPriorityClass: "boosted",
      deliveryPriorityReason: "high-watch-first-main-alarm",
      notificationSpec: {
        ...buildBundle().notificationSpec,
        volumePercent: 85,
        vibrationRepeats: 3,
        fullScreen: false,
        criticalBypass: false,
        mechanicalLoopBoost: 2,
        speechRepeatCount: 2,
      },
    }),
    {
      deviceId: "primary-device",
      deviceName: "Office Android",
      platform: "android",
      pushEnabled: true,
      pushToken: "dQw4w9WgXcQ:APA91bExampleExampleExampleExampleToken1234567890",
    },
    new Date("2026-04-23T07:00:00+09:00"),
  );

  assert.equal(preview.deliveryPriorityClass, "boosted");
  assert.equal(preview.envelope.platformHints.channelId, "buswakeup-critical");
  assert.equal(preview.envelope.platformHints.priority, "max");
  assert.equal(preview.envelope.message.data.deliveryPriorityClass, "boosted");
  assert.equal(preview.envelope.message.data.deliveryPriorityReason, "high-watch-first-main-alarm");
  assert.equal(preview.envelope.message.data.mechanicalLoopBoost, "2");
  assert.equal(preview.envelope.message.data.speechRepeatCount, "2");
  assert.equal(preview.envelope.message.sound.loopBoost, 2);
  assert.equal(preview.envelope.message.interruption.vibrationRepeats, 3);
  assert.equal(preview.envelope.message.speech.repeatCount, 2);
  assert.equal(preview.volumePercent, 85);
  assert.equal(preview.vibrationRepeats, 3);
  assert.equal(preview.mechanicalLoopBoost, 2);
  assert.equal(preview.speechRepeatCount, 2);
});

test("buildPushPreview blocks the adapter preview when the token is missing", () => {
  const preview = buildPushPreview(
    buildBundle(),
    {
      platform: "ios",
      pushEnabled: true,
      pushToken: "",
    },
    new Date("2026-04-23T07:00:00+09:00"),
  );

  assert.equal(preview.status, "blocked");
  assert.equal(preview.adapter, "apns");
  assert.equal(preview.envelope, null);
  assert.match(preview.reason, /token/i);
});

test("buildPushPreview blocks malformed platform tokens before provider handoff", () => {
  const preview = buildPushPreview(
    buildBundle(),
    {
      platform: "ios",
      pushEnabled: true,
      pushToken: "not-a-real-apns-token",
    },
    new Date("2026-04-23T07:00:00+09:00"),
  );

  assert.equal(preview.status, "blocked");
  assert.equal(preview.adapter, "apns");
  assert.equal(preview.envelope, null);
  assert.match(preview.reason, /hexadecimal/i);
});
