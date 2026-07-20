const BASE_ALERT_CONFIG = {
  GREEN: {
    label: "Relaxed",
    vibrationPattern: [200, 300, 200],
    vibrationRepeats: 1,
    volumePercent: 50,
    fullScreen: false,
    soundPresetId: "mechanical",
  },
  YELLOW: {
    label: "On time",
    vibrationPattern: [300, 200, 300, 200, 300],
    vibrationRepeats: 1,
    volumePercent: 60,
    fullScreen: false,
    soundPresetId: "mechanical",
  },
  ORANGE: {
    label: "Risk",
    vibrationPattern: [500, 150, 500, 150, 500, 150, 500],
    vibrationRepeats: 2,
    volumePercent: 80,
    fullScreen: false,
    soundPresetId: "mechanical",
  },
  RED: {
    label: "Late",
    vibrationPattern: [1000, 200],
    vibrationRepeats: 5,
    volumePercent: 100,
    fullScreen: true,
    soundPresetId: "mechanical",
  },
};

const CRITICAL_PHRASE = "이 버스 놓치면 지각이다.";

function clamp(number, min, max) {
  return Math.max(min, Math.min(max, number));
}

function buildRepeatedCriticalPhrase(repeatCount = 2) {
  return Array.from({ length: repeatCount }, () => CRITICAL_PHRASE).join(" ");
}

function buildAccuracyBufferCopy(accuracyRiskBufferMin = 0) {
  const riskBufferMin = Math.max(0, Number(accuracyRiskBufferMin) || 0);
  if (!riskBufferMin) {
    return "";
  }

  return `안전하게 판단하려고 지금은 ${riskBufferMin}분 더 일찍 움직이는 기준으로 계산 중입니다.`;
}

function buildHistoricalBiasCopy({
  historicalBiasLevel = "",
  historicalBiasRouteTraceCount = 0,
  historicalBiasWeekdayTraceCount = 0,
}) {
  const level = String(historicalBiasLevel || "").trim().toLowerCase();
  const routeTraceCount = Math.max(0, Number(historicalBiasRouteTraceCount) || 0);
  const weekdayTraceCount = Math.max(0, Number(historicalBiasWeekdayTraceCount) || 0);

  if (level === "high") {
    if (routeTraceCount && weekdayTraceCount) {
      return `이 노선과 정류장은 최근 7일 동안 ${routeTraceCount}번 흔들렸고, 같은 요일 시간대에도 ${weekdayTraceCount}번 흔들렸습니다. 평소에도 흔들리는 구간이라 지금은 더 보수적으로 보고 있습니다.`;
    }

    if (routeTraceCount) {
      return `이 노선과 정류장은 최근 7일 동안 실시간 도착 정보가 ${routeTraceCount}번 흔들렸습니다. 평소에도 흔들리는 구간이라 지금은 더 보수적으로 보고 있습니다.`;
    }

    return "이 구간은 최근 7일 동안 실시간 도착 정보가 자주 흔들렸습니다. 평소에도 흔들리는 구간이라 지금은 더 보수적으로 보고 있습니다.";
  }

  if (level === "elevated") {
    if (weekdayTraceCount) {
      return `이 시간대는 최근 같은 요일 시간대에 ${weekdayTraceCount}번 흔들렸습니다. 평소보다 조금 더 일찍 움직이는 기준으로 보고 있습니다.`;
    }

    if (routeTraceCount) {
      return `이 노선과 정류장은 최근 7일 동안 ${routeTraceCount}번 흔들렸습니다. 평소보다 조금 더 일찍 움직이는 기준으로 보고 있습니다.`;
    }

    return "이 구간은 최근에도 실시간 도착 정보가 흔들린 적이 있어 평소보다 조금 더 일찍 움직이는 기준으로 보고 있습니다.";
  }

  return "";
}

function buildStabilityPrecheckCopy(stabilityPrecheck = false, stabilityPrecheckLeadMin = 0) {
  if (!stabilityPrecheck) {
    return "";
  }

  const safeLeadMin = Math.max(0, Number(stabilityPrecheckLeadMin) || 0);
  if (!safeLeadMin) {
    return "?됱냼蹂대떎 紐⑥? ?ㅼ떆 ?쒖옉?섎뒗 ?덉젙 ?좎씠?낅땲??";
  }

  return `?됱냼蹂대떎 ${safeLeadMin}遺??먮━ ?쒗븷 ?ㅼ떆 ?뺤씤 ?뚮┝?낅땲??`;
}

function buildAccuracyWarningCopy({
  liveEtaDisagreementLevel = "",
  accuracySpreadMin = null,
  comparableProviderCount = 0,
  accuracyRiskBufferMin = 0,
}) {
  const level = String(liveEtaDisagreementLevel || "").trim().toLowerCase();
  const spread = Number(accuracySpreadMin);
  const safeSpread = Number.isFinite(spread) ? Math.round(spread * 10) / 10 : null;
  const providerCount = Math.max(0, Number(comparableProviderCount) || 0);
  const bufferCopy = buildAccuracyBufferCopy(accuracyRiskBufferMin);

  if (providerCount < 2) {
    return "";
  }

  if (level === "diverged" && safeSpread !== null) {
    return `실시간 도착 정보가 지금 ${safeSpread}분 정도 서로 다르게 들어오고 있습니다. 방금 다시 확인 중입니다.${bufferCopy ? ` ${bufferCopy}` : ""}`;
  }

  if (level === "watch" && safeSpread !== null) {
    return `실시간 도착 정보가 지금 ${safeSpread}분 정도 흔들리고 있습니다. 바로 다시 확인해 주세요.`;
  }

  return "";
}

export function composeAlertCopy({
  routeNumber,
  arrivalsMin,
  urgency,
  riskLevel,
  riskMessage = "",
  liveEtaDisagreementLevel = "",
  accuracySpreadMin = null,
  comparableProviderCount = 0,
  accuracyRiskBufferMin = 0,
  historicalBiasLevel = "",
  historicalBiasRouteTraceCount = 0,
  historicalBiasWeekdayTraceCount = 0,
  stabilityPrecheck = false,
  stabilityPrecheckLeadMin = 0,
}) {
  const [currentArrival, nextArrival] = Array.isArray(arrivalsMin) ? arrivalsMin : [];
  const lineLabel = `${routeNumber || "등록된"}번 버스`;
  const title = `${lineLabel} ${currentArrival ?? "-"}분 후 도착`;
  const criticalCondition = urgency === "MUST_CATCH" || urgency === "HURRY" || riskLevel === "RED";
  const repeatedCriticalPhrase = buildRepeatedCriticalPhrase(2);
  const stabilityPrecheckText = buildStabilityPrecheckCopy(stabilityPrecheck, stabilityPrecheckLeadMin);
  const accuracyWarningText = buildAccuracyWarningCopy({
    liveEtaDisagreementLevel,
    accuracySpreadMin,
    comparableProviderCount,
    accuracyRiskBufferMin,
  });
  const historicalBiasText = buildHistoricalBiasCopy({
    historicalBiasLevel,
    historicalBiasRouteTraceCount,
    historicalBiasWeekdayTraceCount,
  });

  let guidance = "지금 출발하면 정시 도착 가능성이 높습니다.";
  if (urgency === "MUST_CATCH") {
    guidance = `이번 버스를 꼭 타야 합니다. 다음 버스는 ${nextArrival ?? "-"}분 후 도착입니다.`;
  } else if (urgency === "HURRY" || riskLevel === "ORANGE") {
    guidance = "여유 시간이 거의 없습니다. 바로 이동해야 합니다.";
  } else if (riskLevel === "RED") {
    guidance = "이미 지각 위험이 높습니다. 즉시 이동해야 합니다.";
  } else if (urgency === "NEXT_ONLY") {
    guidance = "이번 버스는 놓친 상태입니다. 다음 버스를 바로 확인해야 합니다.";
  }

  if (stabilityPrecheckText) {
    guidance = `${stabilityPrecheckText} ${guidance}`.trim();
  }

  const body = criticalCondition
    ? `${repeatedCriticalPhrase} ${repeatedCriticalPhrase} 다음 버스는 ${nextArrival ?? "-"}분 후 도착입니다.`
    : `${guidance} 다음 버스는 ${nextArrival ?? "-"}분 후 도착입니다.`;
  const spokenLead = `${lineLabel} ${currentArrival ?? "-"}분 후 도착입니다.`;
  const spokenDetail = riskMessage || guidance;
  const spokenText = criticalCondition
    ? `${spokenLead} ${repeatedCriticalPhrase} ${spokenDetail}`
    : `${spokenLead} 다음 버스는 ${nextArrival ?? "-"}분 후 도착입니다. ${spokenDetail}`;
  const cautionaryNotes = [accuracyWarningText, historicalBiasText].filter(Boolean).join(" ");

  return {
    title: stabilityPrecheck ? `Stability precheck · ${title}` : title,
    body: cautionaryNotes ? `${body} ${cautionaryNotes}` : body,
    spokenText: cautionaryNotes ? `${spokenText} ${cautionaryNotes}` : spokenText,
    alertPhraseKo: criticalCondition ? repeatedCriticalPhrase : guidance,
    stabilityPrecheckText,
    accuracyWarningText,
    historicalBiasText,
  };
}

export function getNotificationSpec({
  riskLevel,
  routeNumber,
  arrivalsMin,
  urgency,
  riskMessage = "",
  liveEtaDisagreementLevel = "",
  accuracySpreadMin = null,
  comparableProviderCount = 0,
  accuracyRiskBufferMin = 0,
  historicalBiasLevel = "",
  historicalBiasRouteTraceCount = 0,
  historicalBiasWeekdayTraceCount = 0,
  stabilityPrecheck = false,
  stabilityPrecheckLeadMin = 0,
  deliveryPriorityClass = "normal",
  deliveryPriorityReason = "",
  secondsSinceTrigger = 0,
  escalationEnabled = true,
  dndBypass = false,
  preferredSoundPresetId = "",
}) {
  const base = BASE_ALERT_CONFIG[riskLevel] || BASE_ALERT_CONFIG.YELLOW;
  const normalizedDeliveryPriorityClass = String(deliveryPriorityClass || "normal").trim().toLowerCase() || "normal";
  const reinforcedDelivery = normalizedDeliveryPriorityClass === "boosted";
  const stage =
    escalationEnabled && secondsSinceTrigger >= 30 && riskLevel === "RED"
      ? 2
      : escalationEnabled && secondsSinceTrigger >= 15
        ? 1
        : 0;

  const stageVolumePercent = base.volumePercent + (stage >= 1 ? 10 : 0) + (stage >= 2 ? 10 : 0);
  const reinforcedVolumeFloor = riskLevel === "GREEN" ? 75 : riskLevel === "YELLOW" ? 85 : base.volumePercent;
  const volumePercent = clamp(
    reinforcedDelivery ? Math.max(stageVolumePercent, reinforcedVolumeFloor) : stageVolumePercent,
    0,
    100,
  );

  const stageVibrationRepeats = base.vibrationRepeats + (stage >= 1 ? 1 : 0) + (stage >= 2 ? 2 : 0);
  const reinforcedVibrationFloor = riskLevel === "GREEN" ? 2 : riskLevel === "YELLOW" ? 3 : base.vibrationRepeats;
  const vibrationRepeats = reinforcedDelivery
    ? Math.max(stageVibrationRepeats, reinforcedVibrationFloor)
    : stageVibrationRepeats;
  const fullScreen = base.fullScreen || (stage >= 2 && riskLevel === "RED");
  const criticalBypass = Boolean(dndBypass && (riskLevel === "RED" || stage >= 1));
  const escalationLabel = stage === 0 ? "Initial" : stage === 1 ? "Escalated" : "Critical";
  const criticalCondition = urgency === "MUST_CATCH" || urgency === "HURRY" || riskLevel === "RED";
  const mechanicalLoopBoost = reinforcedDelivery ? 2 : 0;
  const speechRepeatCount = reinforcedDelivery ? 2 : 1;

  return {
    riskLevel,
    riskLabel: base.label,
    secondsSinceTrigger,
    stage,
    escalationLabel,
    vibrationPattern: base.vibrationPattern,
    vibrationRepeats,
    volumePercent,
    soundPresetId: preferredSoundPresetId || base.soundPresetId,
    fullScreen,
    criticalBypass,
    speechVolume: criticalCondition || reinforcedDelivery ? 1 : 0.85,
    speechRate: criticalCondition ? 0.9 : reinforcedDelivery ? 0.95 : 1,
    speechRepeatCount,
    useMechanicalTone: true,
    mechanicalLoopBoost,
    deliveryPriorityClass: normalizedDeliveryPriorityClass,
    deliveryPriorityReason: String(deliveryPriorityReason || ""),
    reinforcedDelivery,
    liveEtaDisagreementLevel: String(liveEtaDisagreementLevel || "").trim().toLowerCase() || "unknown",
    accuracySpreadMin: Number.isFinite(Number(accuracySpreadMin)) ? Math.round(Number(accuracySpreadMin) * 10) / 10 : null,
    comparableProviderCount: Math.max(0, Number(comparableProviderCount) || 0),
    accuracyRiskBufferMin: Math.max(0, Number(accuracyRiskBufferMin) || 0),
    historicalBiasLevel: String(historicalBiasLevel || "").trim().toLowerCase() || "none",
    historicalBiasRouteTraceCount: Math.max(0, Number(historicalBiasRouteTraceCount) || 0),
    historicalBiasWeekdayTraceCount: Math.max(0, Number(historicalBiasWeekdayTraceCount) || 0),
    stabilityPrecheck: Boolean(stabilityPrecheck),
    stabilityPrecheckLeadMin: Math.max(0, Number(stabilityPrecheckLeadMin) || 0),
    ...composeAlertCopy({
      routeNumber,
      arrivalsMin,
      urgency,
      riskLevel,
      riskMessage,
      liveEtaDisagreementLevel,
      accuracySpreadMin,
      comparableProviderCount,
      accuracyRiskBufferMin,
      historicalBiasLevel,
      historicalBiasRouteTraceCount,
      historicalBiasWeekdayTraceCount,
      stabilityPrecheck,
      stabilityPrecheckLeadMin,
    }),
  };
}

export function buildEscalationTimeline(context) {
  return [0, 15, 30].map((secondsSinceTrigger) =>
    getNotificationSpec({
      ...context,
      secondsSinceTrigger,
    }),
  );
}
