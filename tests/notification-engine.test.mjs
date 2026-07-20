import test from "node:test";
import assert from "node:assert/strict";

import { buildEscalationTimeline, composeAlertCopy, getNotificationSpec } from "../src/logic/notification-engine.js";

test("green alert starts with light urgency and uses the mechanical preset by default", () => {
  const spec = getNotificationSpec({
    riskLevel: "GREEN",
    routeNumber: "1002",
    arrivalsMin: [5, 18],
    urgency: "RELAXED",
  });

  assert.equal(spec.volumePercent, 50);
  assert.equal(spec.fullScreen, false);
  assert.deepEqual(spec.vibrationPattern, [200, 300, 200]);
  assert.equal(spec.vibrationRepeats, 1);
  assert.equal(spec.soundPresetId, "mechanical");
});

test("red alert becomes critical after 30 seconds of no response", () => {
  const spec = getNotificationSpec({
    riskLevel: "RED",
    routeNumber: "1002",
    arrivalsMin: [2, 20],
    urgency: "HURRY",
    escalationEnabled: true,
    secondsSinceTrigger: 30,
    dndBypass: true,
  });

  assert.equal(spec.stage, 2);
  assert.equal(spec.fullScreen, true);
  assert.equal(spec.volumePercent, 100);
  assert.equal(spec.criticalBypass, true);
  assert.equal(spec.vibrationRepeats, 8);
  assert.equal(spec.soundPresetId, "mechanical");
  assert.equal(spec.speechVolume, 1);
});

test("must-catch copy repeats the late warning phrase in Korean", () => {
  const copy = composeAlertCopy({
    routeNumber: "8109",
    arrivalsMin: [4, 21],
    urgency: "MUST_CATCH",
    riskLevel: "YELLOW",
    riskMessage: "이번 버스를 꼭 타야 합니다.",
  });

  assert.match(copy.body, /이 버스 놓치면 지각이다/);
  assert.match(copy.body, /다음 버스는 21분 후 도착입니다/);
  assert.match(copy.spokenText, /이 버스 놓치면 지각이다/);
  assert.match(copy.spokenText, /이번 버스를 꼭 타야 합니다/);
});

test("notification copy adds a live ETA warning and safety buffer when providers are sharply diverged", () => {
  const copy = composeAlertCopy({
    routeNumber: "1002",
    arrivalsMin: [3, 14],
    urgency: "RELAXED",
    riskLevel: "GREEN",
    liveEtaDisagreementLevel: "diverged",
    accuracySpreadMin: 5,
    comparableProviderCount: 2,
    accuracyRiskBufferMin: 2,
  });

  assert.match(copy.body, /실시간 도착 정보가 지금 5분 정도 서로 다르게 들어오고 있습니다/);
  assert.match(copy.spokenText, /방금 다시 확인 중입니다/);
  assert.match(copy.accuracyWarningText, /2분 더 일찍 움직이는 기준으로 계산 중입니다/);
});

test("notification copy explains recent historical instability when the route has been shaky all week", () => {
  const copy = composeAlertCopy({
    routeNumber: "1002",
    arrivalsMin: [3, 14],
    urgency: "RELAXED",
    riskLevel: "GREEN",
    historicalBiasLevel: "high",
    historicalBiasRouteTraceCount: 4,
    historicalBiasWeekdayTraceCount: 2,
  });

  assert.match(copy.body, /최근 7일 동안 4번 흔들렸고, 같은 요일 시간대에도 2번 흔들렸습니다/);
  assert.match(copy.spokenText, /평소에도 흔들리는 구간이라 지금은 더 보수적으로 보고 있습니다/);
  assert.match(copy.historicalBiasText, /평소에도 흔들리는 구간/);
});

test("notification spec marks a stability precheck and prefixes the title", () => {
  const spec = getNotificationSpec({
    riskLevel: "GREEN",
    routeNumber: "1002",
    arrivalsMin: [8, 18],
    urgency: "RELAXED",
    stabilityPrecheck: true,
    stabilityPrecheckLeadMin: 10,
  });

  assert.equal(spec.stabilityPrecheck, true);
  assert.equal(spec.stabilityPrecheckLeadMin, 10);
  assert.match(spec.title, /^Stability precheck · /);
});

test("boosted first alarm raises sound and vibration intensity even before red escalation", () => {
  const spec = getNotificationSpec({
    riskLevel: "YELLOW",
    routeNumber: "1002",
    arrivalsMin: [5, 18],
    urgency: "RELAXED",
    deliveryPriorityClass: "boosted",
    deliveryPriorityReason: "high-watch-first-main-alarm",
  });

  assert.equal(spec.deliveryPriorityClass, "boosted");
  assert.equal(spec.reinforcedDelivery, true);
  assert.equal(spec.volumePercent, 85);
  assert.equal(spec.vibrationRepeats, 3);
  assert.equal(spec.speechVolume, 1);
  assert.equal(spec.speechRate, 0.95);
  assert.equal(spec.speechRepeatCount, 2);
  assert.equal(spec.mechanicalLoopBoost, 2);
  assert.equal(spec.fullScreen, false);
});

test("buildEscalationTimeline returns initial, escalated, and critical stages", () => {
  const timeline = buildEscalationTimeline({
    riskLevel: "RED",
    routeNumber: "500",
    arrivalsMin: [1, 14],
    urgency: "HURRY",
    escalationEnabled: true,
    dndBypass: false,
    preferredSoundPresetId: "mechanical",
  });

  assert.deepEqual(
    timeline.map((item) => [item.secondsSinceTrigger, item.stage, item.escalationLabel]),
    [
      [0, 0, "Initial"],
      [15, 1, "Escalated"],
      [30, 2, "Critical"],
    ],
  );
});
