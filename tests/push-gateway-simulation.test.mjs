import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRetrySimulationBundle,
  buildRetrySimulationQueueFromItems,
  buildRetrySimulationQueueState,
  createSimulationDeviceProfile,
  createSimulationDispatchRunner,
  isSimulationDispatchKey,
  pruneSimulationGatewayState,
} from "../src/server/push-gateway-simulation.mjs";

test("createSimulationDeviceProfile injects a usable simulation token", () => {
  const profile = createSimulationDeviceProfile({
    deviceName: "Office Android",
    platform: "android",
    pushEnabled: false,
    pushToken: "demo-fcm-token",
  });

  assert.equal(profile.pushEnabled, true);
  assert.equal(profile.deviceName, "Office Android (Simulation)");
  assert.match(profile.pushToken, /:/);
});

test("buildRetrySimulationBundle creates a unique date-prefixed dispatch key", () => {
  const bundle = buildRetrySimulationBundle(
    {
      routeNumber: "1002",
      stopName: "Gwanghwamun",
      riskLevel: "RED",
    },
    new Date("2026-04-25T07:00:00+09:00"),
  );

  assert.match(bundle.dispatchKey, /^2026-04-25:/);
  assert.match(bundle.title, /\[Simulation\]/);
  assert.equal(bundle.routeNumber, "1002");
});

test("buildRetrySimulationQueueFromItems reconstructs runnable bundles from retry entries", () => {
  const queueState = buildRetrySimulationQueueFromItems(
    [
      {
        dispatchKey: "2026-04-25:2026-04-24T22:00:00.000Z:stage-0:simulation-demo",
        routeNumber: "1002",
        stopName: "Gwanghwamun",
        riskLevel: "RED",
        title: "[Simulation] 1002 retry path",
        stage: 0,
        escalationLabel: "Retry",
        retryAttempt: 1,
        scheduledAt: "2026-04-24T22:00:30.000Z",
      },
    ],
    new Date("2026-04-25T07:02:00+09:00"),
  );

  assert.equal(queueState.dateKey, "2026-04-25");
  assert.equal(queueState.bundles.length, 1);
  assert.equal(queueState.bundles[0].dispatchKey, "2026-04-25:2026-04-24T22:00:00.000Z:stage-0:simulation-demo");
  assert.equal(queueState.bundles[0].title, "[Simulation] 1002 retry path");
});

test("createSimulationDispatchRunner can simulate a retryable provider failure", async () => {
  const runner = createSimulationDispatchRunner("retryable-failure");
  const attempt = await runner(
    {
      status: "ready",
      adapter: "fcm",
      title: "[Simulation] 1002 retry path",
      dispatchKey: "2026-04-25:2026-04-24T22:00:00.000Z:stage-0:simulation-demo",
      routeNumber: "1002",
      stopName: "Gwanghwamun",
      stage: 0,
      escalationLabel: "Simulation",
      riskLevel: "RED",
      envelope: {
        message: {
          data: {
            routeNumber: "1002",
            stopName: "Gwanghwamun",
          },
        },
      },
      targetHealth: {
        deliveryReadiness: "ready",
      },
    },
    null,
    new Date("2026-04-25T07:03:00+09:00"),
  );

  assert.equal(attempt.status, "FAILED");
  assert.equal(attempt.mode, "simulate");
  assert.equal(attempt.response.statusCode, 503);
  assert.equal(attempt.response.simulated, true);
});

test("createSimulationDispatchRunner can simulate a hard provider failure", async () => {
  const runner = createSimulationDispatchRunner("hard-failure");
  const attempt = await runner(
    {
      status: "ready",
      adapter: "fcm",
      title: "[Simulation] hard fail",
      dispatchKey: "2026-04-25:2026-04-24T22:00:00.000Z:stage-0:simulation-demo",
      routeNumber: "1002",
      stopName: "Gwanghwamun",
      stage: 0,
      escalationLabel: "Simulation",
      riskLevel: "RED",
      envelope: {
        message: {
          data: {
            routeNumber: "1002",
            stopName: "Gwanghwamun",
          },
        },
      },
      targetHealth: {
        deliveryReadiness: "ready",
      },
    },
    null,
    new Date("2026-04-25T07:04:00+09:00"),
  );

  assert.equal(attempt.status, "FAILED");
  assert.equal(attempt.response.statusCode, 400);
});

test("pruneSimulationGatewayState removes simulation-only retry state and keeps real records", () => {
  const state = pruneSimulationGatewayState({
    dateKey: "2026-04-25",
    attempts: [
      {
        id: "sim-1",
        dispatchKey: "2026-04-25:2026-04-24T22:00:00.000Z:stage-0:simulation-demo",
        createdAt: "2026-04-24T22:30:00.000Z",
      },
      {
        id: "real-1",
        dispatchKey: "2026-04-25:2026-04-24T22:00:00.000Z:stage-0",
        createdAt: "2026-04-24T22:29:00.000Z",
      },
    ],
    handledDispatchKeys: [
      "2026-04-25:2026-04-24T22:00:00.000Z:stage-0:simulation-demo",
      "2026-04-25:2026-04-24T22:00:00.000Z:stage-0",
    ],
    retryQueue: [
      {
        dispatchKey: "2026-04-25:2026-04-24T22:00:00.000Z:stage-0:simulation-demo",
      },
      {
        dispatchKey: "2026-04-25:2026-04-24T22:00:00.000Z:stage-1",
      },
    ],
    lastAttemptAt: "2026-04-24T22:30:00.000Z",
  });

  assert.equal(isSimulationDispatchKey("2026-04-25:2026-04-24T22:00:00.000Z:stage-0:simulation-demo"), true);
  assert.equal(state.attempts.length, 1);
  assert.equal(state.attempts[0].id, "real-1");
  assert.deepEqual(state.handledDispatchKeys, ["2026-04-25:2026-04-24T22:00:00.000Z:stage-0"]);
  assert.deepEqual(state.retryQueue, [{ dispatchKey: "2026-04-25:2026-04-24T22:00:00.000Z:stage-1" }]);
  assert.equal(state.lastAttemptAt, "2026-04-24T22:29:00.000Z");
});
