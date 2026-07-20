import test from "node:test";
import assert from "node:assert/strict";

import { applyAlarmDeliveryAction, createAlarmDeliveryState, reconcileAlarmDelivery } from "../src/server/alarm-delivery.mjs";

function buildRuntimeResult(triggerAt = "2026-04-21T22:03:00.000Z") {
  return {
    runtime: {
      dateKey: "2026-04-22",
      status: "running",
    },
    dueEvents: [
      {
        id: "event-1",
        kind: "ALARM_TRIGGERED",
        title: "Bus 1002 in 5 min",
        detail: "Leave now.",
        createdAt: "2026-04-22T07:03:00+09:00",
        triggerAt,
        dateKey: "2026-04-22",
        routeNumber: "1002",
        stopName: "광화문역",
        riskLevel: "GREEN",
        urgency: "RELAXED",
        arrivalsMin: [5, 22],
        source: "demo-projection",
        notificationSpec: {
          title: "Bus 1002 in 5 min",
        },
      },
    ],
  };
}

test("reconcileAlarmDelivery creates a current active alert from the newest unhandled due event", () => {
  const delivery = reconcileAlarmDelivery(createAlarmDeliveryState(), buildRuntimeResult(), new Date("2026-04-22T07:03:10+09:00"));

  assert.ok(delivery.currentAlert);
  assert.equal(delivery.currentAlert.status, "ACTIVE");
  assert.equal(delivery.currentAlert.triggerKey, "2026-04-22:2026-04-21T22:03:00.000Z");
});

test("applyAlarmDeliveryAction snoozes the active alert for one minute and resets activation when it resumes", () => {
  const first = reconcileAlarmDelivery(createAlarmDeliveryState(), buildRuntimeResult(), new Date("2026-04-22T07:03:10+09:00"));
  const snoozed = applyAlarmDeliveryAction(first, { type: "SNOOZE_1M" }, new Date("2026-04-22T07:03:20+09:00"));

  assert.equal(snoozed.currentAlert.status, "SNOOZED");
  assert.ok(snoozed.currentAlert.snoozedUntil);

  const resumedAt = new Date("2026-04-22T07:04:30+09:00");
  const resumed = reconcileAlarmDelivery(snoozed, { runtime: { dateKey: "2026-04-22", status: "running" }, dueEvents: [] }, resumedAt);
  assert.equal(resumed.currentAlert.status, "ACTIVE");
  assert.equal(resumed.currentAlert.snoozedUntil, null);
  assert.equal(resumed.currentAlert.activatedAt, resumedAt.toISOString());
});

test("applyAlarmDeliveryAction acknowledges the active alert and stores the handled trigger key", () => {
  const first = reconcileAlarmDelivery(createAlarmDeliveryState(), buildRuntimeResult(), new Date("2026-04-22T07:03:10+09:00"));
  const acknowledged = applyAlarmDeliveryAction(first, { type: "ACK_DEPARTED" }, new Date("2026-04-22T07:03:30+09:00"));

  assert.equal(acknowledged.currentAlert, null);
  assert.deepEqual(acknowledged.handledTriggerKeys, ["2026-04-22:2026-04-21T22:03:00.000Z"]);
  assert.equal(acknowledged.lastAction, "ACK_DEPARTED");
});
