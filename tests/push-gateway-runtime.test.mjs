import test from "node:test";
import assert from "node:assert/strict";

import { createPushGatewayState } from "../src/server/push-gateway-store.mjs";
import {
  buildRetryPolicySummary,
  recordPushGatewayAttempt,
  reconcilePushGatewayState,
  summarizePushGatewayState,
} from "../src/server/push-gateway-runtime.mjs";

function buildBundle(overrides = {}) {
  return {
    id: "bundle-1",
    dispatchKey: "2026-04-24:2026-04-23T22:00:00.000Z:stage-0",
    alertTriggerKey: "2026-04-24:2026-04-23T22:00:00.000Z",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    riskLevel: "RED",
    title: "Bus 1002 in 2 min",
    createdAt: "2026-04-24T07:00:00+09:00",
    stage: 0,
    escalationLabel: "Initial",
    liveEtaGuardMode: "conservative",
    accuracyRiskBufferMin: 2,
    accuracySpreadMin: 5,
    notificationSpec: {
      title: "Bus 1002 in 2 min",
      body: "Catch this bus now.",
      spokenText: "This bus must be caught.",
      soundPresetId: "mechanical",
      volumePercent: 100,
      vibrationPattern: [1000, 200],
      vibrationRepeats: 5,
      fullScreen: true,
      criticalBypass: true,
      useMechanicalTone: true,
      speechVolume: 1,
      speechRate: 0.9,
    },
    ...overrides,
  };
}

function buildQueueState(overrides = {}) {
  return {
    dateKey: "2026-04-24",
    bundles: [buildBundle()],
    handledDispatchKeys: [],
    lastGeneratedAt: "2026-04-24T07:00:00+09:00",
    ...overrides,
  };
}

function buildDeviceProfile(overrides = {}) {
  return {
    deviceId: "android-1",
    deviceName: "Office Android",
    platform: "android",
    pushEnabled: true,
    pushToken: "dQw4w9WgXcQ:APA91bExampleExampleExampleExampleToken1234567890",
    fullScreenEnabled: true,
    dndOverrideGranted: true,
    batteryOptimizationIgnored: true,
    localBackupEnabled: true,
    soundEnabled: true,
    vibrationEnabled: true,
    ttsEnabled: true,
    ...overrides,
  };
}

test("reconcilePushGatewayState auto-records a new bundle once", async () => {
  const env = {
    PUSH_GATEWAY_MODE: "preview",
    FCM_PROJECT_ID: "demo-project",
    FCM_ACCESS_TOKEN: "token-123",
  };

  const result = await reconcilePushGatewayState(
    createPushGatewayState(),
    buildQueueState(),
    buildDeviceProfile(),
    new Date("2026-04-24T07:00:00+09:00"),
    env,
  );

  assert.equal(result.newAttempts.length, 1);
  assert.equal(result.newAttempts[0].status, "DRY_RUN_READY");
  assert.equal(result.newAttempts[0].origin, "auto");
  assert.equal(result.newAttempts[0].routeNumber, "1002");
  assert.equal(result.newAttempts[0].liveEtaGuardMode, "conservative");
  assert.equal(result.newAttempts[0].accuracyRiskBufferMin, 2);
  assert.equal(result.newAttempts[0].accuracySpreadMin, 5);
  assert.deepEqual(result.state.handledDispatchKeys, ["2026-04-24:2026-04-23T22:00:00.000Z:stage-0"]);
  assert.equal(result.retryPolicy.pendingRetries, 0);
});

test("reconcilePushGatewayState does not duplicate auto dispatch for the same handled bundle", async () => {
  const env = {
    PUSH_GATEWAY_MODE: "preview",
    FCM_PROJECT_ID: "demo-project",
    FCM_ACCESS_TOKEN: "token-123",
  };

  const first = await reconcilePushGatewayState(
    createPushGatewayState(),
    buildQueueState(),
    buildDeviceProfile(),
    new Date("2026-04-24T07:00:00+09:00"),
    env,
  );
  const second = await reconcilePushGatewayState(
    first.state,
    buildQueueState(),
    buildDeviceProfile(),
    new Date("2026-04-24T07:00:15+09:00"),
    env,
  );

  assert.equal(first.state.attempts.length, 1);
  assert.equal(second.newAttempts.length, 0);
  assert.equal(second.state.attempts.length, 1);
});

test("reconcilePushGatewayState clears previous-day attempts when the queue date changes", async () => {
  const previousDayState = recordPushGatewayAttempt(
    createPushGatewayState(),
    {
      id: "attempt-old",
      createdAt: "2026-04-23T07:00:00.000Z",
      adapter: "fcm",
      previewStatus: "ready",
      dispatchKey: "2026-04-23:2026-04-22T22:00:00.000Z:stage-0",
      title: "Old push",
      stage: 0,
      escalationLabel: "Initial",
      riskLevel: "RED",
      routeNumber: "1002",
      stopName: "Old stop",
      targetReadiness: "ready",
      mode: "preview",
      request: null,
      status: "DRY_RUN_READY",
      reason: "Old preview.",
      response: null,
    },
    {
      origin: "manual",
      dateKey: "2026-04-23",
      markHandled: true,
      handledDispatchKey: "2026-04-23:2026-04-22T22:00:00.000Z:stage-0",
      now: new Date("2026-04-23T07:00:00+09:00"),
    },
  );

  const env = {
    PUSH_GATEWAY_MODE: "preview",
    FCM_PROJECT_ID: "demo-project",
    FCM_ACCESS_TOKEN: "token-123",
  };

  const result = await reconcilePushGatewayState(
    previousDayState,
    buildQueueState(),
    buildDeviceProfile(),
    new Date("2026-04-24T07:00:00+09:00"),
    env,
  );

  assert.equal(result.state.dateKey, "2026-04-24");
  assert.equal(result.state.attempts.length, 1);
  assert.equal(result.state.attempts[0].dispatchKey, "2026-04-24:2026-04-23T22:00:00.000Z:stage-0");
  assert.deepEqual(result.state.handledDispatchKeys, ["2026-04-24:2026-04-23T22:00:00.000Z:stage-0"]);
});

test("failed provider handoff schedules an automatic retry with backoff", async () => {
  const runner = async () => ({
    id: "attempt-failed",
    createdAt: "2026-04-24T07:00:00.000Z",
    adapter: "fcm",
    previewStatus: "ready",
    dispatchKey: "2026-04-24:2026-04-23T22:00:00.000Z:stage-0",
    title: "Bus 1002 in 2 min",
    stage: 0,
    escalationLabel: "Initial",
    riskLevel: "RED",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    targetReadiness: "ready",
    mode: "execute",
    request: null,
    status: "FAILED",
    reason: "Provider temporary failure.",
    response: {
      statusCode: 503,
    },
  });

  const result = await reconcilePushGatewayState(
    createPushGatewayState(),
    buildQueueState(),
    buildDeviceProfile(),
    new Date("2026-04-24T07:00:00+09:00"),
    { PUSH_GATEWAY_MODE: "execute" },
    { dispatchRunner: runner },
  );

  assert.equal(result.newAttempts.length, 1);
  assert.equal(result.newAttempts[0].retryable, true);
  assert.equal(result.newAttempts[0].nextRetryAt, "2026-04-23T22:00:30.000Z");
  assert.equal(result.state.retryQueue.length, 1);
  assert.equal(result.state.retryQueue[0].retryAttempt, 1);
  assert.equal(result.state.retryQueue[0].liveEtaGuardMode, "conservative");
  assert.equal(result.state.retryQueue[0].accuracyRiskBufferMin, 2);
  assert.equal(result.state.retryQueue[0].accuracySpreadMin, 5);
  assert.equal(result.state.retryQueue[0].retryProfileKey, "standard");
  assert.equal(result.retryPolicy.pendingRetries, 1);
});

test("boosted first-alarm failures retry faster than the standard queue", async () => {
  const runner = async () => ({
    id: "attempt-boosted-failed",
    createdAt: "2026-04-24T07:00:00.000Z",
    adapter: "fcm",
    previewStatus: "ready",
    dispatchKey: "2026-04-24:2026-04-23T22:00:00.000Z:stage-0",
    title: "Bus 1002 in 2 min",
    stage: 0,
    escalationLabel: "Initial",
    riskLevel: "YELLOW",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    targetReadiness: "ready",
    mode: "execute",
    deliveryPriorityClass: "boosted",
    deliveryPriorityReason: "high-watch-first-main-alarm",
    volumePercent: 85,
    vibrationRepeats: 3,
    mechanicalLoopBoost: 2,
    speechRepeatCount: 2,
    request: null,
    status: "FAILED",
    reason: "Provider temporary failure.",
    response: {
      statusCode: 503,
    },
  });

  const result = await reconcilePushGatewayState(
    createPushGatewayState(),
    buildQueueState({
      bundles: [
        buildBundle({
          riskLevel: "YELLOW",
          deliveryPriorityClass: "boosted",
          deliveryPriorityReason: "high-watch-first-main-alarm",
        }),
      ],
    }),
    buildDeviceProfile(),
    new Date("2026-04-24T07:00:00+09:00"),
    { PUSH_GATEWAY_MODE: "execute" },
    { dispatchRunner: runner },
  );

  assert.equal(result.newAttempts[0].deliveryPriorityClass, "boosted");
  assert.equal(result.newAttempts[0].nextRetryAt, "2026-04-23T22:00:10.000Z");
  assert.equal(result.state.retryQueue[0].retryProfileKey, "boosted");
  assert.equal(result.state.retryQueue[0].retryProfileLabel, "Boosted first-alarm retry");
  assert.equal(result.state.retryQueue[0].retryDelayMs, 10000);
  assert.equal(result.state.retryQueue[0].volumePercent, 85);
  assert.equal(result.state.retryQueue[0].vibrationRepeats, 3);
  assert.equal(result.state.retryQueue[0].mechanicalLoopBoost, 2);
  assert.equal(result.state.retryQueue[0].speechRepeatCount, 2);
  assert.equal(result.retryPolicy.boostedPendingRetries, 1);
  assert.equal(result.retryPolicy.nextRetryDeliveryPriorityClass, "boosted");
  assert.deepEqual(result.retryPolicy.priorityBackoffSeconds.boosted, [10, 30, 90]);
});

test("client-side provider failure does not schedule retry for a non-retryable 400 response", async () => {
  const runner = async () => ({
    id: "attempt-client-error",
    createdAt: "2026-04-24T07:00:00.000Z",
    adapter: "fcm",
    previewStatus: "ready",
    dispatchKey: "2026-04-24:2026-04-23T22:00:00.000Z:stage-0",
    title: "Bus 1002 in 2 min",
    stage: 0,
    escalationLabel: "Initial",
    riskLevel: "RED",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    targetReadiness: "ready",
    mode: "execute",
    request: null,
    status: "FAILED",
    reason: "Provider rejected the token.",
    response: {
      statusCode: 400,
    },
  });

  const result = await reconcilePushGatewayState(
    createPushGatewayState(),
    buildQueueState(),
    buildDeviceProfile(),
    new Date("2026-04-24T07:00:00+09:00"),
    { PUSH_GATEWAY_MODE: "execute" },
    { dispatchRunner: runner },
  );

  assert.equal(result.newAttempts[0].retryable, false);
  assert.equal(result.state.retryQueue.length, 0);
  assert.equal(result.retryPolicy.pendingRetries, 0);
});

test("a provider-marked unregistered token never enters the retry queue", async () => {
  const runner = async () => ({
    id: "attempt-unregistered-token",
    createdAt: "2026-04-24T07:00:00.000Z",
    adapter: "fcm",
    previewStatus: "ready",
    dispatchKey: "2026-04-24:2026-04-23T22:00:00.000Z:stage-0",
    title: "Bus 1002 in 2 min",
    stage: 0,
    escalationLabel: "Initial",
    riskLevel: "RED",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    targetReadiness: "ready",
    mode: "execute",
    request: null,
    status: "FAILED",
    reason: "FCM reported that this device token is no longer registered.",
    response: {
      statusCode: 404,
      failureCategory: "TOKEN_UNREGISTERED",
      providerErrorCode: "UNREGISTERED",
      retryable: false,
      tokenAction: "RE_REGISTER",
      reason: "Open BusWakeUp on that phone and register the refreshed FCM token again.",
    },
  });

  const result = await reconcilePushGatewayState(
    createPushGatewayState(),
    buildQueueState(),
    buildDeviceProfile(),
    new Date("2026-04-24T07:00:00+09:00"),
    { PUSH_GATEWAY_MODE: "execute" },
    { dispatchRunner: runner },
  );

  assert.equal(result.newAttempts[0].retryable, false);
  assert.match(result.newAttempts[0].retryReason, /refreshed FCM token/i);
  assert.equal(result.state.retryQueue.length, 0);
});

test("due retry item runs again and leaves the queue when the retry succeeds", async () => {
  const baseState = {
    ...createPushGatewayState(),
    dateKey: "2026-04-24",
    handledDispatchKeys: ["2026-04-24:2026-04-23T22:00:00.000Z:stage-0"],
    retryQueue: [
      {
        id: "retry-1",
        dispatchKey: "2026-04-24:2026-04-23T22:00:00.000Z:stage-0",
        routeNumber: "1002",
        stopName: "Gwanghwamun",
        riskLevel: "RED",
        retryAttempt: 1,
        scheduledAt: "2026-04-23T22:00:30.000Z",
        lastAttemptId: "attempt-failed",
        reason: "Temporary failure.",
      },
    ],
  };
  const runner = async () => ({
    id: "attempt-retry-success",
    createdAt: "2026-04-24T07:01:00.000Z",
    adapter: "fcm",
    previewStatus: "ready",
    dispatchKey: "2026-04-24:2026-04-23T22:00:00.000Z:stage-0",
    title: "Bus 1002 in 2 min",
    stage: 0,
    escalationLabel: "Initial",
    riskLevel: "RED",
    routeNumber: "1002",
    stopName: "Gwanghwamun",
    targetReadiness: "ready",
    mode: "execute",
    request: null,
    status: "SENT",
    reason: "Provider accepted retry.",
    response: {
      statusCode: 200,
    },
  });

  const result = await reconcilePushGatewayState(
    baseState,
    buildQueueState(),
    buildDeviceProfile(),
    new Date("2026-04-24T07:01:00+09:00"),
    { PUSH_GATEWAY_MODE: "execute" },
    { dispatchRunner: runner },
  );

  assert.equal(result.newAttempts.length, 1);
  assert.equal(result.newAttempts[0].origin, "retry");
  assert.equal(result.newAttempts[0].retryAttempt, 1);
  assert.equal(result.state.retryQueue.length, 0);
  assert.equal(result.retryPolicy.pendingRetries, 0);
});

test("buildRetryPolicySummary exposes pending retry count and next retry time", () => {
  const summary = buildRetryPolicySummary([
    { scheduledAt: "2026-04-24T07:01:00.000Z" },
    { scheduledAt: "2026-04-24T07:03:00.000Z" },
  ]);

  assert.equal(summary.pendingRetries, 2);
  assert.equal(summary.nextRetryAt, "2026-04-24T07:01:00.000Z");
  assert.deepEqual(summary.backoffSeconds, [30, 120, 300]);
});

test("buildRetryPolicySummary separates boosted retry profiles from the standard queue", () => {
  const summary = buildRetryPolicySummary([
    {
      scheduledAt: "2026-04-24T07:01:00.000Z",
      deliveryPriorityClass: "boosted",
      retryProfileKey: "boosted",
    },
    {
      scheduledAt: "2026-04-24T07:03:00.000Z",
      deliveryPriorityClass: "normal",
      retryProfileKey: "standard",
    },
  ]);

  assert.equal(summary.pendingRetries, 2);
  assert.equal(summary.boostedPendingRetries, 1);
  assert.equal(summary.nextRetryDeliveryPriorityClass, "boosted");
  assert.deepEqual(summary.priorityBackoffSeconds.standard, [30, 120, 300]);
  assert.deepEqual(summary.priorityBackoffSeconds.boosted, [10, 30, 90]);
  assert.deepEqual(summary.activeRetryProfiles.sort(), ["boosted", "standard"]);
});

test("summarizePushGatewayState exposes retry queue and policy together", () => {
  const state = {
    ...createPushGatewayState(),
    dateKey: "2026-04-24",
    attempts: [
      {
        id: "attempt-1",
        dispatchKey: "2026-04-24:2026-04-23T22:00:00.000Z:stage-0",
      },
    ],
    handledDispatchKeys: ["2026-04-24:2026-04-23T22:00:00.000Z:stage-0"],
    retryQueue: [
      {
        id: "retry-1",
        dispatchKey: "2026-04-24:2026-04-23T22:00:00.000Z:stage-0",
        retryAttempt: 1,
        scheduledAt: "2026-04-24T07:01:00.000Z",
      },
    ],
    lastAttemptAt: "2026-04-24T07:00:00.000Z",
  };

  const summary = summarizePushGatewayState(state, 2);

  assert.equal(summary.total, 1);
  assert.equal(summary.handledDispatchKeys, 1);
  assert.equal(summary.retryQueue.length, 1);
  assert.equal(summary.retryPolicy.pendingRetries, 1);
  assert.equal(summary.retryPolicy.nextRetryAt, "2026-04-24T07:01:00.000Z");
  assert.equal(summary.dateKey, "2026-04-24");
});
