import test from "node:test";
import assert from "node:assert/strict";

import { createDispatchExecutionState, reconcileDispatchExecutions } from "../src/server/dispatch-execution-engine.mjs";

function buildQueueState(overrides = {}) {
  return {
    dateKey: "2026-04-22",
    bundles: [
      {
        id: "bundle-1",
        dispatchKey: "2026-04-22:2026-04-21T22:45:00.000Z:stage-0",
        alertTriggerKey: "2026-04-22:2026-04-21T22:45:00.000Z",
        routeNumber: "1002",
        stopName: "Gwanghwamun",
        riskLevel: "RED",
        title: "Bus 1002 in 2 min",
        createdAt: "2026-04-22T07:00:00+09:00",
        deviceSnapshot: {
          deviceId: "primary-device",
          deviceName: "Office Android",
          platform: "android",
        },
        channels: [
          { channel: "push", label: "Push Notification", status: "QUEUED", detail: "Push payload can be queued." },
          { channel: "full_screen", label: "Full-screen Alarm", status: "BLOCKED", detail: "Permission is missing." },
          { channel: "sound", label: "Alarm Sound", status: "DISABLED", detail: "Sound is turned off." },
        ],
      },
    ],
    handledAlertKeys: [],
    lastGeneratedAt: "2026-04-22T07:00:00+09:00",
    ...overrides,
  };
}

test("reconcileDispatchExecutions creates one execution attempt for a new bundle", () => {
  const result = reconcileDispatchExecutions(
    createDispatchExecutionState(),
    buildQueueState(),
    {
      deviceName: "Office Android",
      platform: "android",
      pushEnabled: true,
      pushToken: "token-123",
    },
    new Date("2026-04-22T07:00:10+09:00"),
  );

  assert.equal(result.newAttempts.length, 1);
  assert.equal(result.executions.attempts.length, 1);
  assert.equal(result.executions.attempts[0].summary.simulated_sent, 1);
  assert.equal(result.executions.attempts[0].summary.failed, 1);
  assert.equal(result.executions.attempts[0].summary.skipped, 1);
});

test("reconcileDispatchExecutions preserves boosted first-alarm delivery priority from the queue bundle", () => {
  const result = reconcileDispatchExecutions(
    createDispatchExecutionState(),
    buildQueueState({
      bundles: [
        {
          id: "bundle-boosted",
          dispatchKey: "2026-04-22:2026-04-21T22:45:00.000Z:stage-0",
          alertTriggerKey: "2026-04-22:2026-04-21T22:45:00.000Z",
          routeNumber: "1002",
          stopName: "Gwanghwamun",
          riskLevel: "YELLOW",
          title: "Bus 1002 in 4 min",
          deliveryPriorityClass: "boosted",
          deliveryPriorityReason: "high-watch-first-main-alarm",
          notificationSpec: {
            volumePercent: 85,
            vibrationRepeats: 3,
            mechanicalLoopBoost: 2,
            speechRepeatCount: 2,
          },
          channels: [{ channel: "push", label: "Push Notification", status: "QUEUED", detail: "Boosted push." }],
        },
      ],
    }),
    {
      deviceName: "Office Android",
      platform: "android",
      pushEnabled: true,
      pushToken: "token-123",
    },
    new Date("2026-04-22T07:00:10+09:00"),
  );

  assert.equal(result.executions.attempts[0].deliveryPriorityClass, "boosted");
  assert.equal(result.executions.attempts[0].deliveryPriorityReason, "high-watch-first-main-alarm");
  assert.equal(result.executions.attempts[0].volumePercent, 85);
  assert.equal(result.executions.attempts[0].vibrationRepeats, 3);
  assert.equal(result.executions.attempts[0].mechanicalLoopBoost, 2);
  assert.equal(result.executions.attempts[0].speechRepeatCount, 2);
});

test("reconcileDispatchExecutions clears legacy attempts when the queue date moves to a new day", () => {
  const legacyState = {
    attempts: [
      {
        id: "attempt-legacy",
        dispatchKey: "2026-04-22:2026-04-21T22:45:00.000Z:stage-0",
        alertTriggerKey: "2026-04-22:2026-04-21T22:45:00.000Z",
        title: "Legacy execution",
      },
    ],
    handledBundleIds: ["bundle-legacy"],
    lastExecutedAt: "2026-04-22T07:00:10+09:00",
  };

  const result = reconcileDispatchExecutions(
    legacyState,
    {
      dateKey: "2026-04-23",
      bundles: [],
    },
    {},
    new Date("2026-04-23T07:00:10+09:00"),
  );

  assert.equal(result.executions.attempts.length, 0);
  assert.deepEqual(result.executions.handledBundleIds, []);
  assert.equal(result.executions.lastExecutedAt, null);
  assert.equal(result.executions.dateKey, "2026-04-23");
});

test("reconcileDispatchExecutions does not duplicate an execution attempt for the same bundle", () => {
  const first = reconcileDispatchExecutions(
    createDispatchExecutionState(),
    buildQueueState(),
    {},
    new Date("2026-04-22T07:00:10+09:00"),
  );
  const second = reconcileDispatchExecutions(first.executions, buildQueueState(), {}, new Date("2026-04-22T07:01:00+09:00"));

  assert.equal(first.executions.attempts.length, 1);
  assert.equal(second.newAttempts.length, 0);
  assert.equal(second.executions.attempts.length, 1);
});

test("queued local backup keeps a simulated sent status even when battery optimization is still active", () => {
  const result = reconcileDispatchExecutions(
    createDispatchExecutionState(),
    buildQueueState({
      bundles: [
        {
          id: "bundle-2",
          title: "Bus 701 in 6 min",
          channels: [{ channel: "local_backup", label: "Local Backup Alarm", status: "QUEUED", detail: "Fallback ready." }],
        },
      ],
    }),
    {
      batteryOptimizationIgnored: false,
      localBackupEnabled: true,
    },
    new Date("2026-04-22T07:00:10+09:00"),
  );

  assert.equal(result.executions.attempts[0].channels[0].executionStatus, "SIMULATED_SENT");
  assert.match(result.executions.attempts[0].channels[0].detail, /battery optimization/i);
});
