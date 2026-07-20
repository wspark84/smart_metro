import test from "node:test";
import assert from "node:assert/strict";

import { resetDispatchQueueForAlert, resetPushGatewayHandledKeysForAlert } from "../src/server/alert-pipeline-reset.mjs";

test("resetDispatchQueueForAlert removes queued bundles and handled keys for one alert trigger only", () => {
  const queueState = {
    dateKey: "2026-04-24",
    bundles: [
      {
        id: "bundle-a0",
        dispatchKey: "2026-04-24:2026-04-24T05:55:00.000Z:stage-0",
        alertTriggerKey: "2026-04-24:2026-04-24T05:55:00.000Z",
      },
      {
        id: "bundle-a1",
        dispatchKey: "2026-04-24:2026-04-24T05:55:00.000Z:stage-1",
        alertTriggerKey: "2026-04-24:2026-04-24T05:55:00.000Z",
      },
      {
        id: "bundle-b0",
        dispatchKey: "2026-04-24:2026-04-24T05:56:00.000Z:stage-0",
        alertTriggerKey: "2026-04-24:2026-04-24T05:56:00.000Z",
      },
    ],
    handledDispatchKeys: [
      "2026-04-24:2026-04-24T05:55:00.000Z:stage-0",
      "2026-04-24:2026-04-24T05:55:00.000Z:stage-1",
      "2026-04-24:2026-04-24T05:56:00.000Z:stage-0",
    ],
    lastGeneratedAt: "2026-04-24T05:56:00.000Z",
  };

  const result = resetDispatchQueueForAlert(queueState, "2026-04-24:2026-04-24T05:55:00.000Z");

  assert.equal(result.bundles.length, 1);
  assert.equal(result.bundles[0].dispatchKey, "2026-04-24:2026-04-24T05:56:00.000Z:stage-0");
  assert.deepEqual(result.handledDispatchKeys, ["2026-04-24:2026-04-24T05:56:00.000Z:stage-0"]);
});

test("resetPushGatewayHandledKeysForAlert clears only the matching dispatch keys", () => {
  const gatewayState = {
    dateKey: "2026-04-24",
    attempts: [{ id: "attempt-1" }],
    handledDispatchKeys: [
      "2026-04-24:2026-04-24T05:55:00.000Z:stage-0",
      "2026-04-24:2026-04-24T05:55:00.000Z:stage-1",
      "2026-04-24:2026-04-24T05:56:00.000Z:stage-0",
    ],
    lastAttemptAt: "2026-04-24T06:00:00.000Z",
  };

  const result = resetPushGatewayHandledKeysForAlert(gatewayState, "2026-04-24:2026-04-24T05:55:00.000Z");

  assert.deepEqual(result.handledDispatchKeys, ["2026-04-24:2026-04-24T05:56:00.000Z:stage-0"]);
  assert.equal(result.attempts.length, 1);
  assert.equal(result.lastAttemptAt, "2026-04-24T06:00:00.000Z");
});
