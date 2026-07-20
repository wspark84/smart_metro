import test from "node:test";
import assert from "node:assert/strict";

import { createDispatchQueueState, reconcileDispatchQueue } from "../src/server/dispatch-engine.mjs";

function buildDeliveryState(overrides = {}) {
  return {
    currentAlert: {
      triggerKey: "2026-04-22:2026-04-21T22:45:00.000Z",
      routeNumber: "1002",
      stopName: "광화문역",
      riskLevel: "RED",
      title: "Bus 1002 in 2 min",
      detail: "Move now.",
      urgency: "HURRY",
      arrivalsMin: [2, 19],
      status: "ACTIVE",
      activatedAt: "2026-04-22T07:00:00+09:00",
      notificationSpec: {
        fullScreen: true,
        criticalBypass: true,
        soundPresetId: "strong",
        volumePercent: 100,
        vibrationPattern: [1000, 200],
        vibrationRepeats: 5,
        accuracyRiskBufferMin: 2,
        accuracySpreadMin: 5,
      },
      liveEtaGuardMode: "conservative",
    },
    ...overrides,
  };
}

test("reconcileDispatchQueue creates a dispatch bundle for a new active alert", () => {
  const profile = {
    deviceName: "Office Android",
    platform: "android",
    pushEnabled: true,
    pushToken: "token-123",
    fullScreenEnabled: true,
    dndOverrideGranted: true,
    localBackupEnabled: true,
    soundEnabled: true,
    vibrationEnabled: true,
    ttsEnabled: true,
  };

  const result = reconcileDispatchQueue(createDispatchQueueState(), buildDeliveryState(), profile, new Date("2026-04-22T07:00:00+09:00"));

  assert.equal(result.newBundles.length, 1);
  assert.equal(result.queue.bundles.length, 1);
  assert.equal(result.queue.handledDispatchKeys[0], "2026-04-22:2026-04-21T22:45:00.000Z:stage-0");
  assert.equal(result.queue.bundles[0].summary.queued > 0, true);
  assert.equal(result.queue.bundles[0].stage, 0);
  assert.equal(result.queue.bundles[0].liveEtaGuardMode, "conservative");
  assert.equal(result.queue.bundles[0].accuracyRiskBufferMin, 2);
  assert.equal(result.queue.bundles[0].accuracySpreadMin, 5);
});

test("reconcileDispatchQueue preserves boosted first-alarm delivery priority", () => {
  const result = reconcileDispatchQueue(
    createDispatchQueueState(),
    buildDeliveryState({
      currentAlert: {
        ...buildDeliveryState().currentAlert,
        riskLevel: "YELLOW",
        deliveryPriorityClass: "boosted",
        deliveryPriorityReason: "high-watch-first-main-alarm",
        notificationSpec: {
          ...buildDeliveryState().currentAlert.notificationSpec,
          fullScreen: false,
          criticalBypass: false,
        },
      },
    }),
    {
      platform: "android",
      pushEnabled: true,
      pushToken: "token-123",
      fullScreenEnabled: true,
      dndOverrideGranted: true,
      localBackupEnabled: true,
      soundEnabled: true,
      vibrationEnabled: true,
      ttsEnabled: true,
    },
    new Date("2026-04-22T07:00:00+09:00"),
  );

  assert.equal(result.queue.bundles[0].deliveryPriorityClass, "boosted");
  assert.equal(result.queue.bundles[0].deliveryPriorityReason, "high-watch-first-main-alarm");
  assert.match(result.queue.bundles[0].channels.find((channel) => channel.channel === "push").detail, /boosted first-alarm priority/i);
  assert.equal(result.queue.bundles[0].notificationSpec.deliveryPriorityClass, "boosted");
  assert.equal(result.queue.bundles[0].notificationSpec.reinforcedDelivery, true);
  assert.equal(result.queue.bundles[0].notificationSpec.volumePercent, 85);
  assert.equal(result.queue.bundles[0].notificationSpec.vibrationRepeats, 3);
});

test("reconcileDispatchQueue does not duplicate a dispatch bundle for the same handled stage", () => {
  const first = reconcileDispatchQueue(createDispatchQueueState(), buildDeliveryState(), {}, new Date("2026-04-22T07:00:00+09:00"));
  const second = reconcileDispatchQueue(first.queue, buildDeliveryState(), {}, new Date("2026-04-22T07:00:05+09:00"));

  assert.equal(first.queue.bundles.length, 1);
  assert.equal(second.newBundles.length, 0);
  assert.equal(second.queue.bundles.length, 1);
});

test("reconcileDispatchQueue creates a new bundle when the escalation stage advances", () => {
  const first = reconcileDispatchQueue(createDispatchQueueState(), buildDeliveryState(), {}, new Date("2026-04-22T07:00:00+09:00"));
  const escalated = reconcileDispatchQueue(first.queue, buildDeliveryState(), {}, new Date("2026-04-22T07:00:16+09:00"));

  assert.equal(first.queue.bundles.length, 1);
  assert.equal(escalated.newBundles.length, 1);
  assert.equal(escalated.queue.bundles.length, 2);
  assert.equal(escalated.queue.bundles[0].stage, 1);
  assert.equal(escalated.queue.bundles[0].escalationLabel, "Escalated");
});

test("reconcileDispatchQueue clears stale bundles when the date key changes", () => {
  const previous = reconcileDispatchQueue(
    createDispatchQueueState(),
    buildDeliveryState(),
    {},
    { dateKey: "2026-04-22" },
    new Date("2026-04-22T07:00:00+09:00"),
  );

  const nextDay = reconcileDispatchQueue(
    previous.queue,
    { currentAlert: null },
    {},
    { dateKey: "2026-04-23" },
    new Date("2026-04-23T07:00:00+09:00"),
  );

  assert.equal(previous.queue.bundles.length, 1);
  assert.equal(nextDay.queue.bundles.length, 0);
  assert.equal(nextDay.queue.dateKey, "2026-04-23");
});

test("reconcileDispatchQueue clears legacy bundles even when the stored queue had no dateKey", () => {
  const legacyQueue = {
    bundles: [
      {
        id: "bundle-legacy",
        dispatchKey: "2026-04-22:2026-04-21T22:45:00.000Z:stage-0",
        alertTriggerKey: "2026-04-22:2026-04-21T22:45:00.000Z",
        title: "Legacy dispatch",
      },
    ],
    handledDispatchKeys: ["2026-04-22:2026-04-21T22:45:00.000Z:stage-0"],
    lastGeneratedAt: "2026-04-22T07:00:00+09:00",
  };

  const result = reconcileDispatchQueue(
    legacyQueue,
    { currentAlert: null },
    {},
    { dateKey: "2026-04-23" },
    new Date("2026-04-23T07:00:00+09:00"),
  );

  assert.equal(result.queue.bundles.length, 0);
  assert.deepEqual(result.queue.handledDispatchKeys, []);
  assert.equal(result.queue.lastGeneratedAt, null);
  assert.equal(result.queue.dateKey, "2026-04-23");
});

test("reconcileDispatchQueue blocks push and full-screen channels when permissions are missing", () => {
  const result = reconcileDispatchQueue(
    createDispatchQueueState(),
    buildDeliveryState(),
    {
      pushEnabled: true,
      pushToken: "",
      fullScreenEnabled: false,
      dndOverrideGranted: false,
      localBackupEnabled: false,
      soundEnabled: false,
      vibrationEnabled: false,
      ttsEnabled: false,
    },
    new Date("2026-04-22T07:00:16+09:00"),
  );

  const channels = result.queue.bundles[0].channels;
  assert.equal(channels.find((channel) => channel.channel === "push").status, "BLOCKED");
  assert.equal(channels.find((channel) => channel.channel === "full_screen").status, "BLOCKED");
  assert.equal(channels.find((channel) => channel.channel === "dnd_bypass").status, "NOT_REQUIRED");
  assert.equal(channels.find((channel) => channel.channel === "local_backup").status, "DISABLED");
});
