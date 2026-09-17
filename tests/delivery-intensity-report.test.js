import test from "node:test";
import assert from "node:assert/strict";

import { buildDeliveryIntensityReport } from "../src/logic/delivery-intensity-report.js";

test("buildDeliveryIntensityReport keeps only today's traces and picks the strongest configured playback", () => {
  const report = buildDeliveryIntensityReport({
    now: new Date("2026-04-24T08:10:00+09:00"),
    timeZone: "Asia/Seoul",
    events: [
      {
        title: "Bus 1002 in 4 min",
        routeNumber: "1002",
        stopName: "Gwanghwamun",
        createdAt: "2026-04-24T07:03:00+09:00",
        triggerAt: "2026-04-23T22:03:00.000Z",
        dateKey: "2026-04-24",
        deliveryPriorityClass: "boosted",
        volumePercent: 85,
        vibrationRepeats: 3,
        mechanicalLoopBoost: 2,
        speechRepeatCount: 2,
      },
      {
        title: "Old event",
        routeNumber: "700",
        stopName: "City Hall",
        createdAt: "2026-04-23T23:50:00+09:00",
        volumePercent: 100,
        vibrationRepeats: 5,
        mechanicalLoopBoost: 3,
        speechRepeatCount: 2,
      },
    ],
    pushGatewayAttempts: [
      {
        title: "Push handoff",
        dispatchKey: "2026-04-24:2026-04-23T22:03:00.000Z:stage-0",
        routeNumber: "1002",
        stopName: "Gwanghwamun",
        createdAt: "2026-04-24T07:04:00+09:00",
        status: "SENT",
        deliveryPriorityClass: "boosted",
        volumePercent: 85,
        vibrationRepeats: 3,
        mechanicalLoopBoost: 2,
        speechRepeatCount: 2,
      },
      {
        title: "Lower intensity",
        routeNumber: "701",
        stopName: "Seoul Station",
        createdAt: "2026-04-24T07:05:00+09:00",
        status: "DRY_RUN_READY",
        deliveryPriorityClass: "normal",
        volumePercent: 70,
        vibrationRepeats: 2,
        mechanicalLoopBoost: 0,
        speechRepeatCount: 1,
      },
    ],
  });

  assert.equal(report.dateKey, "2026-04-24");
  assert.equal(report.totalSignals, 3);
  assert.equal(report.boostedCount, 2);
  assert.equal(report.maxScore, 160);
  assert.equal(report.topSignal?.routeNumber, "1002");
  assert.equal(report.topSignal?.stopName, "Gwanghwamun");
  assert.equal(report.topSignal?.deliveryPriorityClass, "boosted");
  assert.equal(report.topSignal?.mechanicalLoopBoost, 2);
  assert.equal(report.topSignal?.speechRepeatCount, 2);
  assert.equal(report.topAlert?.deliveryOutcomeCode, "delivered");
  assert.equal(report.topAlert?.deliveryOutcomeLabel, "DELIVERED");
  assert.equal(report.outcomeBreakdown.delivered, 1);
  assert.equal(report.outcomeBreakdown.pushVisibleCount, 2);
  assert.equal(report.outcomeBreakdown.deliveredRatePercent, 50);
  assert.equal(report.topRouteStop?.routeNumber, "1002");
  assert.equal(report.topRouteStop?.count, 2);
  assert.equal(report.topRouteStop?.boostedCount, 2);
  assert.equal(
    report.sourceBreakdown.find((item) => item.source === "server_event")?.maxScore,
    160,
  );
});

test("buildDeliveryIntensityReport ignores traces that have no playback intensity metadata", () => {
  const report = buildDeliveryIntensityReport({
    now: new Date("2026-04-24T08:10:00+09:00"),
    timeZone: "Asia/Seoul",
    events: [
      {
        title: "No playback info",
        routeNumber: "1002",
        stopName: "Gwanghwamun",
        createdAt: "2026-04-24T07:03:00+09:00",
      },
    ],
  });

  assert.equal(report.totalSignals, 0);
  assert.equal(report.topSignal, null);
  assert.equal(report.topRouteStop, null);
});

test("buildDeliveryIntensityReport shows retry pending when the strongest alert is still queued for another send", () => {
  const report = buildDeliveryIntensityReport({
    now: new Date("2026-04-24T08:10:00+09:00"),
    timeZone: "Asia/Seoul",
    dispatchBundles: [
      {
        title: "Bus 1002 in 4 min",
        dispatchKey: "2026-04-24:2026-04-23T22:03:00.000Z:stage-0",
        alertTriggerKey: "2026-04-24:2026-04-23T22:03:00.000Z",
        routeNumber: "1002",
        stopName: "Gwanghwamun",
        riskLevel: "YELLOW",
        createdAt: "2026-04-24T07:03:00+09:00",
        deliveryPriorityClass: "boosted",
        notificationSpec: {
          volumePercent: 85,
          vibrationRepeats: 3,
          mechanicalLoopBoost: 2,
          speechRepeatCount: 2,
        },
      },
    ],
    pushGatewayAttempts: [
      {
        title: "Push failed once",
        dispatchKey: "2026-04-24:2026-04-23T22:03:00.000Z:stage-0",
        routeNumber: "1002",
        stopName: "Gwanghwamun",
        createdAt: "2026-04-24T07:04:00+09:00",
        status: "FAILED",
        reason: "Provider temporary failure.",
        deliveryPriorityClass: "boosted",
        volumePercent: 85,
        vibrationRepeats: 3,
        mechanicalLoopBoost: 2,
        speechRepeatCount: 2,
      },
    ],
    retryQueue: [
      {
        title: "Retry pending",
        dispatchKey: "2026-04-24:2026-04-23T22:03:00.000Z:stage-0",
        routeNumber: "1002",
        stopName: "Gwanghwamun",
        scheduledAt: "2026-04-24T07:04:10+09:00",
        deliveryPriorityClass: "boosted",
        volumePercent: 85,
        vibrationRepeats: 3,
        mechanicalLoopBoost: 2,
        speechRepeatCount: 2,
      },
    ],
  });

  assert.equal(report.topAlert?.deliveryOutcomeCode, "retry_pending");
  assert.equal(report.topAlert?.deliveryOutcomeLabel, "RETRY PENDING");
  assert.equal(report.topAttentionAlert?.deliveryOutcomeCode, "retry_pending");
  assert.equal(report.topAttentionAlert?.attentionActionLabel, "WATCH NEXT RETRY");
  assert.match(report.topAttentionAlert?.attentionActionCopy || "", /재시도 예정: 2026-04-23T22:04:10\.000Z/i);
  assert.equal(report.topAttentionAlert?.attentionTarget?.screen, "home");
  assert.equal(report.topAttentionAlert?.attentionTarget?.panelId, "push-gateway-panel");
  assert.equal(report.topAttentionAlert?.attentionTarget?.buttonLabel, "재시도 대기열 열기");
  assert.equal(report.topAttentionAlert?.attentionQuickAction?.action, "run-push-retry-simulation");
  assert.equal(report.topAttentionAlert?.attentionQuickAction?.buttonLabel, "대기 중인 재시도 시험");
  assert.equal(report.topAttentionAlert?.attentionCause?.label, "재시도 시각 지남");
  assert.match(report.topAttentionAlert?.attentionCause?.copy || "", /예정된 시각이 지났지만/i);
  assert.equal(report.topAttentionCause?.label, "재시도 시각 지남");
  assert.equal(report.topAttentionCause?.count, 1);
  assert.equal(report.topAttentionCause?.routeStopCount, 1);
  assert.equal(report.topAttentionCause?.attentionTarget?.panelId, "push-gateway-panel");
  assert.equal(report.topAttentionCause?.attentionTarget?.panelItemKind, "retry-queue");
  assert.equal(report.topAttentionCause?.attentionQuickAction?.action, "run-push-retry-simulation");
  assert.equal(report.topAttentionAlert?.attentionStatus?.label, "다음 재시도");
  assert.equal(report.topAttentionAlert?.attentionStatus?.value, "1시간 지남");
  assert.match(report.topAttentionAlert?.attentionStatus?.copy || "", /2026-04-23T22:04:10\.000Z로 예정된 재시도 시각이 지났습니다/i);
  assert.equal(report.topAttentionAlert?.attentionTarget?.panelItemKind, "retry-queue");
  assert.equal(
    report.topAttentionAlert?.attentionTarget?.panelItemKey,
    "2026-04-24:2026-04-23T22:03:00.000Z:stage-0",
  );
  assert.equal(report.outcomeBreakdown.retry_pending, 1);
  assert.equal(report.outcomeBreakdown.needsAttentionCount, 1);
  assert.equal(report.outcomeBreakdown.pushVisibleCount, 1);
  assert.equal(report.outcomeBreakdown.deliveredRatePercent, 0);
});

test("buildDeliveryIntensityReport separates upstream-only alerts from push-visible outcomes", () => {
  const report = buildDeliveryIntensityReport({
    now: new Date("2026-04-24T08:10:00+09:00"),
    timeZone: "Asia/Seoul",
    events: [
      {
        title: "Triggered only",
        routeNumber: "1002",
        stopName: "Gwanghwamun",
        createdAt: "2026-04-24T07:03:00+09:00",
        triggerAt: "2026-04-23T22:03:00.000Z",
        dateKey: "2026-04-24",
        volumePercent: 85,
        vibrationRepeats: 3,
        mechanicalLoopBoost: 2,
        speechRepeatCount: 2,
      },
    ],
    dispatchExecutions: [
      {
        title: "Simulated only",
        dispatchKey: "2026-04-24:2026-04-23T22:08:00.000Z:stage-0",
        alertTriggerKey: "2026-04-24:2026-04-23T22:08:00.000Z",
        routeNumber: "701",
        stopName: "Seoul Station",
        executedAt: "2026-04-24T07:08:00+09:00",
        volumePercent: 80,
        vibrationRepeats: 2,
        mechanicalLoopBoost: 1,
        speechRepeatCount: 1,
      },
    ],
  });

  assert.equal(report.outcomeBreakdown.pushVisibleCount, 0);
  assert.equal(report.outcomeBreakdown.upstreamOnlyCount, 2);
  assert.equal(report.outcomeBreakdown.triggered, 1);
  assert.equal(report.outcomeBreakdown.simulated, 1);
});

test("buildDeliveryIntensityReport prioritizes blocked alerts above failed and retry-pending ones in the top attention slot", () => {
  const report = buildDeliveryIntensityReport({
    now: new Date("2026-04-24T08:10:00+09:00"),
    timeZone: "Asia/Seoul",
    pushGatewayAttempts: [
      {
        title: "Retry pending alert",
        dispatchKey: "2026-04-24:2026-04-23T22:03:00.000Z:stage-0",
        routeNumber: "1002",
        stopName: "Gwanghwamun",
        createdAt: "2026-04-24T07:04:00+09:00",
        status: "FAILED",
        deliveryPriorityClass: "boosted",
        volumePercent: 95,
        vibrationRepeats: 4,
        mechanicalLoopBoost: 2,
        speechRepeatCount: 2,
      },
      {
        title: "Blocked alert",
        dispatchKey: "2026-04-24:2026-04-23T22:05:00.000Z:stage-0",
        routeNumber: "700",
        stopName: "City Hall",
        createdAt: "2026-04-24T07:05:00+09:00",
        status: "BLOCKED",
        reason: "The token format is invalid.",
        deliveryPriorityClass: "boosted",
        volumePercent: 85,
        vibrationRepeats: 3,
        mechanicalLoopBoost: 2,
        speechRepeatCount: 2,
      },
    ],
    retryQueue: [
      {
        title: "Retry still queued",
        dispatchKey: "2026-04-24:2026-04-23T22:03:00.000Z:stage-0",
        routeNumber: "1002",
        stopName: "Gwanghwamun",
        scheduledAt: "2026-04-24T07:04:10+09:00",
        deliveryPriorityClass: "boosted",
        volumePercent: 95,
        vibrationRepeats: 4,
        mechanicalLoopBoost: 2,
        speechRepeatCount: 2,
      },
    ],
  });

  assert.equal(report.outcomeBreakdown.needsAttentionCount, 2);
  assert.equal(report.topAttentionAlert?.routeNumber, "700");
  assert.equal(report.topAttentionAlert?.deliveryOutcomeCode, "blocked");
  assert.equal(report.topAttentionAlert?.deliveryOutcomeLabel, "BLOCKED");
  assert.equal(report.topAttentionAlert?.attentionActionLabel, "UNBLOCK PUSH PATH");
  assert.match(report.topAttentionAlert?.attentionActionCopy || "", /기기 토큰, 알림 권한과 푸시 인증 설정/i);
  assert.equal(report.topAttentionAlert?.attentionTarget?.screen, "settings");
  assert.equal(report.topAttentionAlert?.attentionTarget?.panelId, "device-delivery-panel");
  assert.equal(report.topAttentionAlert?.attentionTarget?.panelItemId, "device-push-token-input");
  assert.equal(report.topAttentionAlert?.attentionTarget?.buttonLabel, "푸시 토큰 설정 열기");
  assert.equal(report.topAttentionAlert?.attentionQuickAction?.action, "register-device-token");
  assert.equal(report.topAttentionAlert?.attentionQuickAction?.buttonLabel, "현재 토큰 등록");
  assert.equal(report.topAttentionAlert?.attentionCause?.label, "토큰 문제로 차단");
  assert.match(report.topAttentionAlert?.attentionCause?.copy || "", /기기 토큰 또는 토큰 형식 문제/i);
  assert.equal(report.topAttentionCause?.label, "토큰 문제로 차단");
  assert.equal(report.topAttentionCause?.highestOutcomeLabel, "BLOCKED");
  assert.equal(report.topAttentionCause?.attentionTarget?.panelId, "device-delivery-panel");
  assert.equal(report.topAttentionCause?.attentionTarget?.panelItemId, "device-push-token-input");
  assert.equal(report.topAttentionCause?.attentionQuickAction?.action, "register-device-token");
  assert.equal(report.topAttentionAlert?.attentionStatus?.label, "최근 차단");
  assert.equal(report.topAttentionAlert?.attentionStatus?.value, "1시간 전");
  assert.match(report.topAttentionAlert?.attentionStatus?.copy || "", /최근 차단 시각: 2026-04-23T22:05:00\.000Z/i);
});

test("buildDeliveryIntensityReport gives failed top attention alerts a direct follow-up action", () => {
  const report = buildDeliveryIntensityReport({
    now: new Date("2026-04-24T08:10:00+09:00"),
    timeZone: "Asia/Seoul",
    pushGatewayAttempts: [
      {
        title: "Failed alert",
        dispatchKey: "2026-04-24:2026-04-23T22:03:00.000Z:stage-0",
        routeNumber: "110A",
        stopName: "Central Library",
        createdAt: "2026-04-24T07:06:00+09:00",
        status: "FAILED",
        reason: "Provider rejected the token.",
        deliveryPriorityClass: "boosted",
        volumePercent: 88,
        vibrationRepeats: 3,
        mechanicalLoopBoost: 2,
        speechRepeatCount: 2,
      },
    ],
  });

  assert.equal(report.topAttentionAlert?.deliveryOutcomeCode, "failed");
  assert.equal(report.topAttentionAlert?.attentionActionLabel, "CHECK LAST FAILURE");
  assert.match(report.topAttentionAlert?.attentionActionCopy || "", /예정된 재시도가 없어/i);
  assert.equal(report.topAttentionAlert?.attentionTarget?.screen, "home");
  assert.equal(report.topAttentionAlert?.attentionTarget?.panelId, "push-gateway-panel");
  assert.equal(report.topAttentionAlert?.attentionTarget?.panelItemKind, "push-attempt");
  assert.equal(
    report.topAttentionAlert?.attentionTarget?.panelItemKey,
    "2026-04-24:2026-04-23T22:03:00.000Z:stage-0",
  );
  assert.equal(report.topAttentionAlert?.attentionTarget?.buttonLabel, "실패한 전송 확인");
  assert.equal(report.topAttentionAlert?.attentionQuickAction?.action, "run-push-gateway");
  assert.equal(report.topAttentionAlert?.attentionQuickAction?.buttonLabel, "전송 요청 모의 실행");
  assert.equal(report.topAttentionAlert?.attentionCause?.label, "제공처가 요청 거부");
  assert.match(report.topAttentionAlert?.attentionCause?.copy || "", /제공처가 요청을 거부/i);
  assert.equal(report.topAttentionCause?.label, "제공처가 요청 거부");
  assert.equal(report.topAttentionCause?.attentionTarget?.panelId, "push-gateway-panel");
  assert.equal(report.topAttentionCause?.attentionTarget?.panelItemKind, "push-attempt");
  assert.equal(report.topAttentionCause?.attentionQuickAction?.action, "run-push-gateway");
  assert.equal(report.topAttentionAlert?.attentionStatus?.label, "최근 실패");
  assert.equal(report.topAttentionAlert?.attentionStatus?.value, "1시간 전");
  assert.match(report.topAttentionAlert?.attentionStatus?.copy || "", /최근 실패 시각: 2026-04-23T22:06:00\.000Z/i);
});

test("buildDeliveryIntensityReport ranks the most common attention cause ahead of less frequent issues", () => {
  const report = buildDeliveryIntensityReport({
    now: new Date("2026-04-24T08:10:00+09:00"),
    timeZone: "Asia/Seoul",
    pushGatewayAttempts: [
      {
        title: "Failed alert A",
        dispatchKey: "2026-04-24:2026-04-23T22:03:00.000Z:stage-0",
        routeNumber: "110A",
        stopName: "Central Library",
        createdAt: "2026-04-24T07:06:00+09:00",
        status: "FAILED",
        reason: "Provider rejected the token.",
        deliveryPriorityClass: "boosted",
        volumePercent: 88,
        vibrationRepeats: 3,
        mechanicalLoopBoost: 2,
        speechRepeatCount: 2,
      },
      {
        title: "Failed alert B",
        dispatchKey: "2026-04-24:2026-04-23T22:04:00.000Z:stage-0",
        routeNumber: "702",
        stopName: "City Hall",
        createdAt: "2026-04-24T07:07:00+09:00",
        status: "FAILED",
        reason: "Provider rejected the token.",
        deliveryPriorityClass: "boosted",
        volumePercent: 86,
        vibrationRepeats: 3,
        mechanicalLoopBoost: 2,
        speechRepeatCount: 2,
      },
      {
        title: "Blocked alert",
        dispatchKey: "2026-04-24:2026-04-23T22:05:00.000Z:stage-0",
        routeNumber: "700",
        stopName: "River Park",
        createdAt: "2026-04-24T07:05:00+09:00",
        status: "BLOCKED",
        reason: "The token format is invalid.",
        deliveryPriorityClass: "boosted",
        volumePercent: 84,
        vibrationRepeats: 3,
        mechanicalLoopBoost: 2,
        speechRepeatCount: 2,
      },
    ],
  });

  assert.equal(report.topAttentionAlert?.deliveryOutcomeCode, "blocked");
  assert.equal(report.topAttentionCause?.label, "제공처가 요청 거부");
  assert.equal(report.topAttentionCause?.count, 2);
  assert.equal(report.topAttentionCause?.routeStopCount, 2);
  assert.equal(report.topAttentionCause?.deliveryOutcomeLabel, "FAILED");
  assert.equal(report.topAttentionCause?.attentionTarget?.panelId, "push-gateway-panel");
  assert.equal(report.topAttentionCause?.attentionQuickAction?.action, "run-push-gateway");
  assert.equal(report.topAttentionCause?.outcomeMix?.[0]?.label, "FAILED");
  assert.equal(report.topAttentionCause?.outcomeMix?.[0]?.count, 2);
  assert.equal(report.topAttentionCause?.spreadSummary?.label, "SPREADING");
  assert.equal(report.topAttentionCause?.topRouteStops?.length, 2);
  assert.equal(report.topAttentionCause?.topRouteStops?.[0]?.routeNumber, "702");
  assert.equal(report.topAttentionCause?.topRouteStops?.[0]?.stopName, "City Hall");
  assert.equal(report.topAttentionCause?.topRouteStops?.[0]?.count, 1);
  assert.equal(report.attentionCauseBreakdown?.[0]?.label, "제공처가 요청 거부");
  assert.equal(report.attentionCauseBreakdown?.[1]?.label, "토큰 문제로 차단");
});

test("buildDeliveryIntensityReport keeps the affected commute pairs for the top issue in count order", () => {
  const report = buildDeliveryIntensityReport({
    now: new Date("2026-04-24T08:10:00+09:00"),
    timeZone: "Asia/Seoul",
    pushGatewayAttempts: [
      {
        title: "Retry alert A",
        dispatchKey: "2026-04-24:2026-04-23T22:03:00.000Z:stage-0",
        routeNumber: "1002",
        stopName: "Gwanghwamun",
        createdAt: "2026-04-24T07:04:00+09:00",
        status: "FAILED",
        reason: "Provider temporary failure.",
        deliveryPriorityClass: "boosted",
        volumePercent: 85,
        vibrationRepeats: 3,
        mechanicalLoopBoost: 2,
        speechRepeatCount: 2,
      },
      {
        title: "Retry alert B",
        dispatchKey: "2026-04-24:2026-04-23T22:04:00.000Z:stage-0",
        routeNumber: "1002",
        stopName: "Gwanghwamun",
        createdAt: "2026-04-24T07:05:00+09:00",
        status: "FAILED",
        reason: "Provider temporary failure.",
        deliveryPriorityClass: "boosted",
        volumePercent: 85,
        vibrationRepeats: 3,
        mechanicalLoopBoost: 2,
        speechRepeatCount: 2,
      },
      {
        title: "Retry alert C",
        dispatchKey: "2026-04-24:2026-04-23T22:05:00.000Z:stage-0",
        routeNumber: "700",
        stopName: "City Hall",
        createdAt: "2026-04-24T07:06:00+09:00",
        status: "FAILED",
        reason: "Provider temporary failure.",
        deliveryPriorityClass: "boosted",
        volumePercent: 85,
        vibrationRepeats: 3,
        mechanicalLoopBoost: 2,
        speechRepeatCount: 2,
      },
    ],
    retryQueue: [
      {
        title: "Retry queue A",
        dispatchKey: "2026-04-24:2026-04-23T22:03:00.000Z:stage-0",
        routeNumber: "1002",
        stopName: "Gwanghwamun",
        scheduledAt: "2026-04-24T07:04:10+09:00",
        deliveryPriorityClass: "boosted",
        volumePercent: 85,
        vibrationRepeats: 3,
        mechanicalLoopBoost: 2,
        speechRepeatCount: 2,
      },
      {
        title: "Retry queue B",
        dispatchKey: "2026-04-24:2026-04-23T22:04:00.000Z:stage-0",
        routeNumber: "1002",
        stopName: "Gwanghwamun",
        scheduledAt: "2026-04-24T07:05:10+09:00",
        deliveryPriorityClass: "boosted",
        volumePercent: 85,
        vibrationRepeats: 3,
        mechanicalLoopBoost: 2,
        speechRepeatCount: 2,
      },
      {
        title: "Retry queue C",
        dispatchKey: "2026-04-24:2026-04-23T22:05:00.000Z:stage-0",
        routeNumber: "700",
        stopName: "City Hall",
        scheduledAt: "2026-04-24T07:06:10+09:00",
        deliveryPriorityClass: "boosted",
        volumePercent: 85,
        vibrationRepeats: 3,
        mechanicalLoopBoost: 2,
        speechRepeatCount: 2,
      },
    ],
  });

  assert.equal(report.topAttentionCause?.label, "재시도 시각 지남");
  assert.equal(report.topAttentionCause?.outcomeMix?.[0]?.label, "RETRY PENDING");
  assert.equal(report.topAttentionCause?.outcomeMix?.[0]?.count, 3);
  assert.equal(report.topAttentionCause?.spreadSummary?.label, "MIXED");
  assert.equal(report.topAttentionCause?.topRouteStops?.length, 2);
  assert.equal(report.topAttentionCause?.topRouteStops?.[0]?.routeNumber, "1002");
  assert.equal(report.topAttentionCause?.topRouteStops?.[0]?.stopName, "Gwanghwamun");
  assert.equal(report.topAttentionCause?.topRouteStops?.[0]?.count, 2);
  assert.equal(report.topAttentionCause?.topRouteStops?.[1]?.routeNumber, "700");
  assert.equal(report.topAttentionCause?.topRouteStops?.[1]?.stopName, "City Hall");
  assert.equal(report.topAttentionCause?.topRouteStops?.[1]?.count, 1);
});

test("buildDeliveryIntensityReport keeps blocked ahead of failed inside the top issue outcome mix", () => {
  const report = buildDeliveryIntensityReport({
    now: new Date("2026-04-24T08:10:00+09:00"),
    timeZone: "Asia/Seoul",
    pushGatewayAttempts: [
      {
        title: "Blocked A",
        dispatchKey: "2026-04-24:2026-04-23T22:03:00.000Z:stage-0",
        routeNumber: "1002",
        stopName: "Gwanghwamun",
        createdAt: "2026-04-24T07:04:00+09:00",
        status: "BLOCKED",
        reason: "The token format is invalid.",
        deliveryPriorityClass: "boosted",
        volumePercent: 85,
        vibrationRepeats: 3,
        mechanicalLoopBoost: 2,
        speechRepeatCount: 2,
      },
      {
        title: "Blocked B",
        dispatchKey: "2026-04-24:2026-04-23T22:04:00.000Z:stage-0",
        routeNumber: "700",
        stopName: "City Hall",
        createdAt: "2026-04-24T07:05:00+09:00",
        status: "BLOCKED",
        reason: "The token format is invalid.",
        deliveryPriorityClass: "boosted",
        volumePercent: 85,
        vibrationRepeats: 3,
        mechanicalLoopBoost: 2,
        speechRepeatCount: 2,
      },
      {
        title: "Failed same cause wording not used",
        dispatchKey: "2026-04-24:2026-04-23T22:05:00.000Z:stage-0",
        routeNumber: "701",
        stopName: "Library",
        createdAt: "2026-04-24T07:06:00+09:00",
        status: "FAILED",
        reason: "The token format is invalid.",
        deliveryPriorityClass: "boosted",
        volumePercent: 84,
        vibrationRepeats: 3,
        mechanicalLoopBoost: 2,
        speechRepeatCount: 2,
      },
    ],
  });

  assert.equal(report.topAttentionCause?.label, "토큰 문제로 차단");
  assert.equal(report.topAttentionCause?.outcomeMix?.[0]?.label, "BLOCKED");
  assert.equal(report.topAttentionCause?.outcomeMix?.[0]?.count, 2);
  assert.equal(report.topAttentionCause?.spreadSummary?.label, "SPREADING");
});

test("buildDeliveryIntensityReport marks a single-pair issue cluster as concentrated", () => {
  const report = buildDeliveryIntensityReport({
    now: new Date("2026-04-24T08:10:00+09:00"),
    timeZone: "Asia/Seoul",
    pushGatewayAttempts: [
      {
        title: "Blocked only route",
        dispatchKey: "2026-04-24:2026-04-23T22:03:00.000Z:stage-0",
        routeNumber: "1002",
        stopName: "Gwanghwamun",
        createdAt: "2026-04-24T07:04:00+09:00",
        status: "BLOCKED",
        reason: "The token format is invalid.",
        deliveryPriorityClass: "boosted",
        volumePercent: 85,
        vibrationRepeats: 3,
        mechanicalLoopBoost: 2,
        speechRepeatCount: 2,
      },
      {
        title: "Blocked only route again",
        dispatchKey: "2026-04-24:2026-04-23T22:04:00.000Z:stage-0",
        routeNumber: "1002",
        stopName: "Gwanghwamun",
        createdAt: "2026-04-24T07:05:00+09:00",
        status: "BLOCKED",
        reason: "The token format is invalid.",
        deliveryPriorityClass: "boosted",
        volumePercent: 85,
        vibrationRepeats: 3,
        mechanicalLoopBoost: 2,
        speechRepeatCount: 2,
      },
    ],
  });

  assert.equal(report.topAttentionCause?.label, "토큰 문제로 차단");
  assert.equal(report.topAttentionCause?.routeStopCount, 1);
  assert.equal(report.topAttentionCause?.spreadSummary?.label, "CONCENTRATED");
});
