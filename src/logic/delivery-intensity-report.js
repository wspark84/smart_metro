const SOURCE_LABELS = {
  server_event: "서버 기록",
  dispatch_bundle: "알림 전송 묶음",
  dispatch_execution: "알림 전송 처리",
  push_attempt: "푸시 전송",
  retry_queue: "재시도 대기열",
};

const DELIVERY_OUTCOME_RANK = {
  delivered: 7,
  retry_pending: 6,
  failed: 5,
  blocked: 4,
  preview_ready: 3,
  simulated: 2,
  queued: 1,
  triggered: 0,
  unknown: -1,
};

const ATTENTION_OUTCOME_RANK = {
  blocked: 3,
  failed: 2,
  retry_pending: 1,
};

const ATTENTION_ACTION_LABELS = {
  blocked: "UNBLOCK PUSH PATH",
  failed: "CHECK LAST FAILURE",
  retry_pending: "WATCH NEXT RETRY",
};

const ATTENTION_OUTCOME_LABELS = {
  blocked: "BLOCKED",
  failed: "FAILED",
  retry_pending: "RETRY PENDING",
};

const ISSUE_SPREAD_LABELS = {
  concentrated: "CONCENTRATED",
  mixed: "MIXED",
  spreading: "SPREADING",
};

const ATTENTION_QUICK_ACTIONS = {
  blocked: {
    action: "register-device-token",
    buttonLabel: "현재 토큰 등록",
  },
  failed: {
    action: "run-push-gateway",
    buttonLabel: "전송 요청 모의 실행",
  },
  retry_pending: {
    action: "run-push-retry-simulation",
    buttonLabel: "대기 중인 재시도 시험",
  },
};

const ATTENTION_TARGETS = {
  blocked: {
    screen: "settings",
    panelId: "device-delivery-panel",
    panelItemId: "device-push-token-input",
    buttonLabel: "푸시 토큰 설정 열기",
  },
  failed: {
    screen: "home",
    panelId: "push-gateway-panel",
    panelItemKind: "push-attempt",
    buttonLabel: "실패한 전송 확인",
  },
  retry_pending: {
    screen: "home",
    panelId: "push-gateway-panel",
    panelItemKind: "retry-queue",
    buttonLabel: "재시도 대기열 열기",
  },
};

function normalizeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function resolveDateValue(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function getDateKeyInTimeZone(value, timeZone = "UTC") {
  const date = resolveDateValue(value);
  if (!date) {
    return "";
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value || "0000";
  const month = parts.find((part) => part.type === "month")?.value || "00";
  const day = parts.find((part) => part.type === "day")?.value || "00";
  return `${year}-${month}-${day}`;
}

function getPlaybackMetrics(source = {}) {
  const notificationSpec =
    source.notificationSpec && typeof source.notificationSpec === "object" && !Array.isArray(source.notificationSpec)
      ? source.notificationSpec
      : null;

  const volumePercent = Math.max(
    0,
    normalizeNumber(source.volumePercent ?? notificationSpec?.volumePercent, 0),
  );
  const vibrationRepeats = Math.max(
    0,
    normalizeNumber(source.vibrationRepeats ?? notificationSpec?.vibrationRepeats, 0),
  );
  const mechanicalLoopBoost = Math.max(
    0,
    normalizeNumber(source.mechanicalLoopBoost ?? notificationSpec?.mechanicalLoopBoost, 0),
  );
  const speechRepeatCount = Math.max(
    1,
    normalizeNumber(source.speechRepeatCount ?? notificationSpec?.speechRepeatCount, 1),
  );

  return {
    volumePercent,
    vibrationRepeats,
    mechanicalLoopBoost,
    speechRepeatCount,
    hasPlayback:
      volumePercent > 0 ||
      vibrationRepeats > 0 ||
      mechanicalLoopBoost > 0 ||
      speechRepeatCount > 1,
    notificationSpec,
  };
}

function buildIntensityScore({
  volumePercent = 0,
  vibrationRepeats = 0,
  mechanicalLoopBoost = 0,
  speechRepeatCount = 1,
} = {}) {
  const extraSpeechRepeats = Math.max(0, speechRepeatCount - 1);
  return Math.round(
    volumePercent +
      vibrationRepeats * 10 +
      mechanicalLoopBoost * 15 +
      extraSpeechRepeats * 15,
  );
}

function normalizeDeliveryPriorityRank(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "boosted") {
    return 2;
  }
  if (normalized === "precheck") {
    return 1;
  }
  return 0;
}

function extractAlertTriggerKeyFromDispatchKey(value) {
  const safe = String(value || "").trim();
  const match = /^(.*):stage-\d+$/.exec(safe);
  return match ? match[1] : safe || "";
}

function buildFallbackAlertKey({ routeNumber = "", stopName = "", title = "", createdAt = "" } = {}) {
  return [
    String(routeNumber || "").trim() || "unknown-route",
    String(stopName || "").trim() || "unknown-stop",
    String(title || "").trim() || "unknown-title",
    resolveDateValue(createdAt)?.toISOString() || "unknown-time",
  ].join("::");
}

function normalizeOutcomeStatus(value) {
  return String(value || "").trim().toUpperCase();
}

function describeDeliveryOutcome(signals) {
  const pushAttempts = signals.filter((signal) => signal.source === "push_attempt");
  const retryQueue = signals.filter((signal) => signal.source === "retry_queue");
  const dispatchExecutions = signals.filter((signal) => signal.source === "dispatch_execution");
  const dispatchBundles = signals.filter((signal) => signal.source === "dispatch_bundle");
  const serverEvents = signals.filter((signal) => signal.source === "server_event");
  const latestPushAttempt = pushAttempts[0] || null;

  if (pushAttempts.some((signal) => signal.outcomeStatus === "SENT")) {
    return {
      code: "delivered",
      label: "DELIVERED",
      copy: latestPushAttempt?.createdAt
        ? `푸시 요청 수락 기록: ${new Date(latestPushAttempt.createdAt).toISOString()}.`
        : "푸시 제공처가 전송 요청을 수락한 기록이 있습니다.",
    };
  }

  if (retryQueue.length) {
    const nextRetry = retryQueue
      .map((signal) => resolveDateValue(signal.createdAt))
      .filter(Boolean)
      .sort((left, right) => left.getTime() - right.getTime())[0];
    return {
      code: "retry_pending",
      label: "RETRY PENDING",
      copy: nextRetry
        ? `강화 재시도 예정: ${nextRetry.toISOString()}.`
        : "이 알림의 강화 재시도가 대기 중입니다.",
    };
  }

  if (pushAttempts.some((signal) => signal.outcomeStatus === "FAILED")) {
    return {
      code: "failed",
      label: "FAILED",
      copy: latestPushAttempt?.detail
        ? `최근 푸시 전송 실패: ${latestPushAttempt.detail}`
        : "최근 푸시 전송에 실패했으며 예정된 재시도가 없습니다.",
    };
  }

  if (pushAttempts.some((signal) => signal.outcomeStatus === "BLOCKED")) {
    return {
      code: "blocked",
      label: "BLOCKED",
      copy: latestPushAttempt?.detail
        ? `푸시 전송 차단: ${latestPushAttempt.detail}`
        : "토큰 또는 전송 설정 문제로 푸시 전송이 차단되었습니다.",
    };
  }

  if (pushAttempts.some((signal) => signal.outcomeStatus === "DRY_RUN_READY")) {
    return {
      code: "preview_ready",
      label: "PREVIEW ONLY",
      copy: "푸시 요청 미리보기까지 처리됐으나 실제 전송 모드는 아닙니다.",
    };
  }

  if (dispatchExecutions.length) {
    return {
      code: "simulated",
      label: "SIMULATED",
      copy: "전송 모의 실행까지 처리됐으며 실제 푸시 전송 결과는 없습니다.",
    };
  }

  if (dispatchBundles.length) {
    return {
      code: "queued",
      label: "QUEUED",
      copy: "전송 계획은 생성됐으나 이후 전송 결과는 없습니다.",
    };
  }

  if (serverEvents.length) {
    return {
      code: "triggered",
      label: "TRIGGERED",
      copy: "현재 서버의 알람 발생 기록만 있습니다.",
    };
  }

  return {
    code: "unknown",
    label: "UNKNOWN",
    copy: "이 알림에 연결된 전송 기록이 없습니다.",
  };
}

function buildAttentionActionCopy(alert) {
  const outcomeCode = String(alert?.deliveryOutcomeCode || "").trim().toLowerCase();
  const nextRetryAt = resolveDateValue(alert?.nextRetryAt);

  if (outcomeCode === "blocked") {
    return "기기 토큰, 알림 권한과 푸시 인증 설정을 확인하세요. 차단 원인을 해결해야 재시도가 가능합니다.";
  }

  if (outcomeCode === "failed") {
    return "최근 푸시 실패 내용을 확인하세요. 예정된 재시도가 없어 다음 알람 시간대 전에 직접 점검해야 합니다.";
  }

  if (outcomeCode === "retry_pending") {
    return nextRetryAt
      ? `휴대폰 연결을 유지하세요. 다음 푸시 재시도 예정: ${nextRetryAt.toISOString()}.`
      : "휴대폰의 네트워크 연결을 유지하고 재시도 대기열을 확인하세요.";
  }

  return "최근 알림 전송 기록을 확인하고 푸시 설정이 정상인지 점검하세요.";
}

function buildAttentionTarget(alert) {
  const outcomeCode = String(alert?.deliveryOutcomeCode || "").trim().toLowerCase();
  const base = ATTENTION_TARGETS[outcomeCode];
  if (!base) {
    return null;
  }

  if (outcomeCode === "retry_pending") {
    return {
      ...base,
      panelItemKey: String(alert?.latestRetryDispatchKey || "").trim(),
    };
  }

  if (outcomeCode === "failed") {
    return {
      ...base,
      panelItemKey: String(alert?.latestPushAttemptDispatchKey || "").trim(),
    };
  }

  return base;
}

function buildAttentionQuickAction(alert) {
  const outcomeCode = String(alert?.deliveryOutcomeCode || "").trim().toLowerCase();
  return ATTENTION_QUICK_ACTIONS[outcomeCode] || null;
}

function buildAttentionCause(alert) {
  const outcomeCode = String(alert?.deliveryOutcomeCode || "").trim().toLowerCase();
  const pushDetail = String(alert?.latestPushAttemptDetail || "").trim().toLowerCase();
  const retryDetail = String(alert?.latestRetryDetail || "").trim().toLowerCase();

  if (outcomeCode === "blocked") {
    if (pushDetail.includes("token")) {
      return {
        label: "토큰 문제로 차단",
        copy: "최근 전송이 기기 토큰 또는 토큰 형식 문제로 차단되었습니다.",
      };
    }

    if (
      pushDetail.includes("credential") ||
      pushDetail.includes("access token") ||
      pushDetail.includes("project id") ||
      pushDetail.includes("auth")
    ) {
      return {
        label: "인증 정보 없음",
        copy: "최근 전송이 인증 정보 또는 푸시 프로젝트 설정 누락으로 차단되었습니다.",
      };
    }

    return {
      label: "푸시 전송 차단",
      copy: "최근 요청은 전송을 시작하기 전에 차단되었습니다.",
    };
  }

  if (outcomeCode === "failed") {
    if (pushDetail.includes("temporary") || pushDetail.includes("429") || pushDetail.includes("5xx")) {
      return {
        label: "제공처 일시 오류",
        copy: "제공처의 일시 오류로 현재 전송을 완료하지 못했습니다.",
      };
    }

    if (pushDetail.includes("rejected")) {
      return {
        label: "제공처가 요청 거부",
        copy: "제공처가 요청을 거부해 알림 전송이 중단되었습니다.",
      };
    }

    return {
      label: "푸시 전송 실패",
      copy: "최근 전송에 실패했으며 진행 중인 재시도가 없습니다.",
    };
  }

  if (outcomeCode === "retry_pending") {
    if (alert?.attentionStatus?.isOverdue) {
      return {
        label: "재시도 시각 지남",
        copy: "예정된 시각이 지났지만 재시도가 아직 대기 중입니다.",
      };
    }

    if (retryDetail.includes("temporary")) {
      return {
        label: "일시 오류 재시도 대기",
        copy: "제공처의 일시 오류로 인한 재시도가 다음 실행을 기다립니다.",
      };
    }

    return {
      label: "재시도 대기",
      copy: "이 알림은 재시도 대기열에서 다음 전송을 기다립니다.",
    };
  }

  return null;
}

function formatShortRelativeTime(targetValue, nowValue) {
  const target = resolveDateValue(targetValue);
  const now = resolveDateValue(nowValue);
  if (!target || !now) {
    return "";
  }

  const diffMs = target.getTime() - now.getTime();
  const absMs = Math.abs(diffMs);
  const seconds = Math.max(1, Math.round(absMs / 1000));

  if (absMs < 1000) {
    return "지금";
  }
  if (seconds < 60) {
    return diffMs >= 0 ? `${seconds}초 후` : `${seconds}초 전`;
  }

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return diffMs >= 0 ? `${minutes}분 후` : `${minutes}분 전`;
  }

  const hours = Math.round(minutes / 60);
  return diffMs >= 0 ? `${hours}시간 후` : `${hours}시간 전`;
}

function buildAttentionStatus(alert, nowValue) {
  const outcomeCode = String(alert?.deliveryOutcomeCode || "").trim().toLowerCase();

  if (outcomeCode === "retry_pending") {
    const nextRetryAt = resolveDateValue(alert?.nextRetryAt);
    const now = resolveDateValue(nowValue);
    const relativeValue = formatShortRelativeTime(nextRetryAt, now);
    const isOverdue = nextRetryAt && now && nextRetryAt.getTime() < now.getTime();
    return {
      label: "다음 재시도",
      isOverdue: Boolean(isOverdue),
      value: isOverdue
        ? `${String(relativeValue || "").replace(/\s*전$/, "").trim()} 지남`
        : relativeValue || "-",
      copy: alert?.nextRetryAt
        ? isOverdue
          ? `${String(alert.nextRetryAt).trim()}로 예정된 재시도 시각이 지났습니다.`
          : `재시도 예정: ${String(alert.nextRetryAt).trim()}.`
        : "재시도가 대기 중이지만 예정 시각 정보가 없습니다.",
    };
  }

  if (outcomeCode === "failed") {
    return {
      label: "최근 실패",
      value: formatShortRelativeTime(alert?.latestAt, nowValue) || "-",
      copy: alert?.latestAt
        ? `최근 실패 시각: ${String(alert.latestAt).trim()}.`
        : "전송 실패 기록은 있으나 최근 실패 시각 정보가 없습니다.",
    };
  }

  if (outcomeCode === "blocked") {
    return {
      label: "최근 차단",
      value: formatShortRelativeTime(alert?.latestAt, nowValue) || "-",
      copy: alert?.latestAt
        ? `최근 차단 시각: ${String(alert.latestAt).trim()}.`
        : "전송 차단 기록은 있으나 최근 차단 시각 정보가 없습니다.",
    };
  }

  return null;
}

function buildIssueSpreadSummary({ count = 0, routeStopCount = 0, topRouteStops = [] } = {}) {
  const totalCount = Math.max(0, Number(count) || 0);
  const totalRouteStops = Math.max(0, Number(routeStopCount) || 0);
  const topCount = Math.max(0, Number(topRouteStops?.[0]?.count) || 0);
  const share = totalCount > 0 ? topCount / totalCount : 0;

  if (totalRouteStops <= 1 || share >= 0.7) {
    return {
      code: "concentrated",
      label: ISSUE_SPREAD_LABELS.concentrated,
      copy:
        totalRouteStops <= 1
          ? "현재 이 문제는 한 노선·정류장 조합에 집중되어 있습니다."
          : "오늘 발생한 문제 대부분이 한 노선·정류장 조합에 집중되어 있습니다.",
    };
  }

  if (totalRouteStops >= 2 && share <= 0.5) {
    return {
      code: "spreading",
      label: ISSUE_SPREAD_LABELS.spreading,
      copy: "이 문제는 한 곳에 집중되지 않고 여러 노선·정류장에서 발생합니다.",
    };
  }

  return {
    code: "mixed",
    label: ISSUE_SPREAD_LABELS.mixed,
    copy: "여러 노선·정류장에서 발생하지만 특정 조합에 더 많이 집중되어 있습니다.",
  };
}

function normalizeIntensitySignal({
  source = "",
  title = "",
  detail = "",
  routeNumber = "",
  stopName = "",
  riskLevel = "",
  createdAt = "",
  dispatchKey = "",
  alertTriggerKey = "",
  triggerAt = "",
  dateKey = "",
  outcomeStatus = "",
  deliveryPriorityClass = "",
  deliveryPriorityReason = "",
  notificationSpec = null,
  volumePercent = 0,
  vibrationRepeats = 0,
  mechanicalLoopBoost = 0,
  speechRepeatCount = 1,
} = {}) {
  const safeCreatedAt = resolveDateValue(createdAt)?.toISOString() || null;
  const playback = getPlaybackMetrics({
    notificationSpec,
    volumePercent,
    vibrationRepeats,
    mechanicalLoopBoost,
    speechRepeatCount,
  });

  if (!playback.hasPlayback) {
    return null;
  }

  return {
    source,
    sourceLabel: SOURCE_LABELS[source] || "처리 기록",
    title: String(title || "").trim(),
    detail: String(detail || "").trim(),
    routeNumber: String(routeNumber || "").trim(),
    stopName: String(stopName || "").trim(),
    riskLevel: String(riskLevel || "").trim(),
    createdAt: safeCreatedAt,
    dispatchKey: String(dispatchKey || "").trim(),
    alertTriggerKey: String(alertTriggerKey || "").trim(),
    triggerAt: String(triggerAt || "").trim(),
    dateKey: String(dateKey || "").trim(),
    alertKey:
      String(alertTriggerKey || "").trim() ||
      extractAlertTriggerKeyFromDispatchKey(dispatchKey) ||
      (dateKey && triggerAt ? `${String(dateKey).trim()}:${String(triggerAt).trim()}` : "") ||
      buildFallbackAlertKey({ routeNumber, stopName, title, createdAt: safeCreatedAt }),
    outcomeStatus: normalizeOutcomeStatus(outcomeStatus),
    deliveryPriorityClass: String(deliveryPriorityClass || "").trim().toLowerCase() || "normal",
    deliveryPriorityReason: String(deliveryPriorityReason || "").trim(),
    volumePercent: playback.volumePercent,
    vibrationRepeats: playback.vibrationRepeats,
    mechanicalLoopBoost: playback.mechanicalLoopBoost,
    speechRepeatCount: playback.speechRepeatCount,
    intensityScore: buildIntensityScore(playback),
    notificationSpec: playback.notificationSpec,
  };
}

function buildSignals(input = {}) {
  const events = Array.isArray(input.events) ? input.events : [];
  const dispatchBundles = Array.isArray(input.dispatchBundles) ? input.dispatchBundles : [];
  const dispatchExecutions = Array.isArray(input.dispatchExecutions) ? input.dispatchExecutions : [];
  const pushGatewayAttempts = Array.isArray(input.pushGatewayAttempts) ? input.pushGatewayAttempts : [];
  const retryQueue = Array.isArray(input.retryQueue) ? input.retryQueue : [];

  return [
    ...events.map((item) =>
      normalizeIntensitySignal({
        source: "server_event",
        title: item.title || item.kind,
        detail: item.detail,
        routeNumber: item.routeNumber,
        stopName: item.stopName,
        riskLevel: item.riskLevel || item.level,
        createdAt: item.createdAt,
        triggerAt: item.triggerAt,
        dateKey: item.dateKey,
        deliveryPriorityClass: item.deliveryPriorityClass,
        deliveryPriorityReason: item.deliveryPriorityReason,
        notificationSpec: item.notificationSpec,
        volumePercent: item.volumePercent,
        vibrationRepeats: item.vibrationRepeats,
        mechanicalLoopBoost: item.mechanicalLoopBoost,
        speechRepeatCount: item.speechRepeatCount,
        outcomeStatus: item.kind === "ALARM_TRIGGERED" || item.kind === "ALARM_PRECHECK" ? "TRIGGERED" : "",
      }),
    ),
    ...dispatchBundles.map((item) =>
      normalizeIntensitySignal({
        source: "dispatch_bundle",
        title: item.title,
        routeNumber: item.routeNumber,
        stopName: item.stopName,
        riskLevel: item.riskLevel,
        createdAt: item.createdAt,
        dispatchKey: item.dispatchKey,
        alertTriggerKey: item.alertTriggerKey,
        deliveryPriorityClass: item.deliveryPriorityClass,
        deliveryPriorityReason: item.deliveryPriorityReason,
        notificationSpec: item.notificationSpec,
        outcomeStatus: "QUEUED",
      }),
    ),
    ...dispatchExecutions.map((item) =>
      normalizeIntensitySignal({
        source: "dispatch_execution",
        title: item.title,
        routeNumber: item.routeNumber,
        stopName: item.stopName,
        riskLevel: item.riskLevel,
        createdAt: item.executedAt || item.createdAt,
        dispatchKey: item.dispatchKey,
        alertTriggerKey: item.alertTriggerKey,
        deliveryPriorityClass: item.deliveryPriorityClass,
        deliveryPriorityReason: item.deliveryPriorityReason,
        volumePercent: item.volumePercent,
        vibrationRepeats: item.vibrationRepeats,
        mechanicalLoopBoost: item.mechanicalLoopBoost,
        speechRepeatCount: item.speechRepeatCount,
        outcomeStatus: "SIMULATED",
      }),
    ),
    ...pushGatewayAttempts.map((item) =>
      normalizeIntensitySignal({
        source: "push_attempt",
        title: item.title,
        detail: item.reason,
        routeNumber: item.routeNumber,
        stopName: item.stopName,
        riskLevel: item.riskLevel,
        createdAt: item.createdAt,
        dispatchKey: item.dispatchKey,
        deliveryPriorityClass: item.deliveryPriorityClass,
        deliveryPriorityReason: item.deliveryPriorityReason,
        volumePercent: item.volumePercent,
        vibrationRepeats: item.vibrationRepeats,
        mechanicalLoopBoost: item.mechanicalLoopBoost,
        speechRepeatCount: item.speechRepeatCount,
        outcomeStatus: item.status,
      }),
    ),
    ...retryQueue.map((item) =>
      normalizeIntensitySignal({
        source: "retry_queue",
        title: item.title,
        detail: item.reason,
        routeNumber: item.routeNumber,
        stopName: item.stopName,
        riskLevel: item.riskLevel,
        createdAt: item.scheduledAt || item.createdAt,
        dispatchKey: item.dispatchKey,
        deliveryPriorityClass: item.deliveryPriorityClass,
        deliveryPriorityReason: item.deliveryPriorityReason,
        volumePercent: item.volumePercent,
        vibrationRepeats: item.vibrationRepeats,
        mechanicalLoopBoost: item.mechanicalLoopBoost,
        speechRepeatCount: item.speechRepeatCount,
        outcomeStatus: "RETRY_PENDING",
      }),
    ),
  ]
    .filter(Boolean)
    .sort((left, right) => {
      if (right.intensityScore !== left.intensityScore) {
        return right.intensityScore - left.intensityScore;
      }
      const priorityDelta =
        normalizeDeliveryPriorityRank(right.deliveryPriorityClass) -
        normalizeDeliveryPriorityRank(left.deliveryPriorityClass);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }
      const leftTime = resolveDateValue(left.createdAt)?.getTime() || 0;
      const rightTime = resolveDateValue(right.createdAt)?.getTime() || 0;
      return rightTime - leftTime;
    });
}

function summarizeRouteStopIntensity(signals) {
  const routeStopMap = new Map();

  for (const signal of signals) {
    const routeKey = signal.routeNumber || "unknown-route";
    const stopKey = signal.stopName || "unknown-stop";
    const key = `${routeKey}::${stopKey}`;
    const current = routeStopMap.get(key) || {
      routeNumber: signal.routeNumber,
      stopName: signal.stopName,
      count: 0,
      boostedCount: 0,
      totalScore: 0,
      maxScore: 0,
      latestAt: null,
    };

    current.count += 1;
    current.totalScore += signal.intensityScore;
    current.maxScore = Math.max(current.maxScore, signal.intensityScore);
    current.boostedCount += signal.deliveryPriorityClass === "boosted" ? 1 : 0;

    if (!current.latestAt || (signal.createdAt && new Date(signal.createdAt).getTime() > new Date(current.latestAt).getTime())) {
      current.latestAt = signal.createdAt;
    }

    routeStopMap.set(key, current);
  }

  return Array.from(routeStopMap.values())
    .map((entry) => ({
      routeNumber: entry.routeNumber,
      stopName: entry.stopName,
      count: entry.count,
      boostedCount: entry.boostedCount,
      averageScore: Math.round((entry.totalScore / entry.count) * 10) / 10,
      maxScore: entry.maxScore,
      latestAt: entry.latestAt,
    }))
    .sort((left, right) => {
      if (right.maxScore !== left.maxScore) {
        return right.maxScore - left.maxScore;
      }
      if (right.boostedCount !== left.boostedCount) {
        return right.boostedCount - left.boostedCount;
      }
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return (resolveDateValue(right.latestAt)?.getTime() || 0) - (resolveDateValue(left.latestAt)?.getTime() || 0);
    });
}

function summarizeAlertLeaders(signals) {
  const alertMap = new Map();

  for (const signal of signals) {
    const key = signal.alertKey;
    const current = alertMap.get(key) || {
      alertKey: key,
      routeNumber: signal.routeNumber,
      stopName: signal.stopName,
      title: signal.title,
      riskLevel: signal.riskLevel,
      count: 0,
      boostedCount: 0,
      maxScore: 0,
      topSignal: signal,
      latestAt: signal.createdAt,
      signals: [],
    };

    current.count += 1;
    current.boostedCount += signal.deliveryPriorityClass === "boosted" ? 1 : 0;
    current.signals.push(signal);

    if (signal.intensityScore > current.maxScore) {
      current.maxScore = signal.intensityScore;
      current.topSignal = signal;
    } else if (
      signal.intensityScore === current.maxScore &&
      (resolveDateValue(signal.createdAt)?.getTime() || 0) > (resolveDateValue(current.topSignal?.createdAt)?.getTime() || 0)
    ) {
      current.topSignal = signal;
    }

    if ((resolveDateValue(signal.createdAt)?.getTime() || 0) > (resolveDateValue(current.latestAt)?.getTime() || 0)) {
      current.latestAt = signal.createdAt;
    }

    alertMap.set(key, current);
  }

  return Array.from(alertMap.values())
    .map((entry) => {
      const sortedSignals = [...entry.signals].sort(
        (left, right) =>
          (resolveDateValue(right.createdAt)?.getTime() || 0) - (resolveDateValue(left.createdAt)?.getTime() || 0),
      );
      const deliveryOutcome = describeDeliveryOutcome(sortedSignals);
      const latestPushAttemptSignal = sortedSignals.find((signal) => signal.source === "push_attempt") || null;
      const latestRetrySignal = sortedSignals.find((signal) => signal.source === "retry_queue") || null;
      const nextRetryAt = sortedSignals
        .filter((signal) => signal.source === "retry_queue")
        .map((signal) => resolveDateValue(signal.createdAt))
        .filter(Boolean)
        .sort((left, right) => left.getTime() - right.getTime())[0];

      return {
        alertKey: entry.alertKey,
        routeNumber: entry.routeNumber,
        stopName: entry.stopName,
        title: entry.title,
        riskLevel: entry.riskLevel,
        count: entry.count,
        boostedCount: entry.boostedCount,
        maxScore: entry.maxScore,
        latestAt: entry.latestAt,
        topSignal: entry.topSignal,
        deliveryOutcomeCode: deliveryOutcome.code,
        deliveryOutcomeLabel: deliveryOutcome.label,
        deliveryOutcomeCopy: deliveryOutcome.copy,
        nextRetryAt: nextRetryAt?.toISOString() || "",
        latestPushAttemptDispatchKey: String(latestPushAttemptSignal?.dispatchKey || "").trim(),
        latestPushAttemptDetail: String(latestPushAttemptSignal?.detail || "").trim(),
        latestRetryDispatchKey: String(latestRetrySignal?.dispatchKey || "").trim(),
        latestRetryDetail: String(latestRetrySignal?.detail || "").trim(),
      };
    })
    .sort((left, right) => {
      if (right.maxScore !== left.maxScore) {
        return right.maxScore - left.maxScore;
      }
      const outcomeDelta =
        (DELIVERY_OUTCOME_RANK[right.deliveryOutcomeCode] || -1) -
        (DELIVERY_OUTCOME_RANK[left.deliveryOutcomeCode] || -1);
      if (outcomeDelta !== 0) {
        return outcomeDelta;
      }
      if (right.boostedCount !== left.boostedCount) {
        return right.boostedCount - left.boostedCount;
      }
      return (resolveDateValue(right.latestAt)?.getTime() || 0) - (resolveDateValue(left.latestAt)?.getTime() || 0);
    });
}

function summarizeDeliveryOutcomeBreakdown(alertLeaders) {
  const safeAlerts = Array.isArray(alertLeaders) ? alertLeaders : [];
  const counts = {
    delivered: 0,
    retry_pending: 0,
    failed: 0,
    blocked: 0,
    preview_ready: 0,
    simulated: 0,
    queued: 0,
    triggered: 0,
    unknown: 0,
  };

  for (const alert of safeAlerts) {
    const key = String(alert?.deliveryOutcomeCode || "unknown").trim().toLowerCase();
    counts[key] = (counts[key] || 0) + 1;
  }

  const pushVisibleCount =
    counts.delivered +
    counts.retry_pending +
    counts.failed +
    counts.blocked +
    counts.preview_ready;
  const upstreamOnlyCount =
    counts.simulated +
    counts.queued +
    counts.triggered +
    counts.unknown;
  const needsAttentionCount = counts.retry_pending + counts.failed + counts.blocked;
  const deliveredRatePercent = pushVisibleCount
    ? Math.round((counts.delivered / pushVisibleCount) * 100)
    : 0;

  return {
    ...counts,
    pushVisibleCount,
    upstreamOnlyCount,
    needsAttentionCount,
    deliveredRatePercent,
  };
}

function summarizeAttentionAlerts(alertLeaders, options = {}) {
  const safeAlerts = Array.isArray(alertLeaders) ? alertLeaders : [];
  const safeNow = resolveDateValue(options.now) || new Date();
  return safeAlerts
    .filter((alert) => ATTENTION_OUTCOME_RANK[String(alert?.deliveryOutcomeCode || "").trim().toLowerCase()])
    .sort((left, right) => {
      const attentionDelta =
        (ATTENTION_OUTCOME_RANK[String(right?.deliveryOutcomeCode || "").trim().toLowerCase()] || 0) -
        (ATTENTION_OUTCOME_RANK[String(left?.deliveryOutcomeCode || "").trim().toLowerCase()] || 0);
      if (attentionDelta !== 0) {
        return attentionDelta;
      }
      if ((right.maxScore || 0) !== (left.maxScore || 0)) {
        return (right.maxScore || 0) - (left.maxScore || 0);
      }
      return (resolveDateValue(right.latestAt)?.getTime() || 0) - (resolveDateValue(left.latestAt)?.getTime() || 0);
    })
    .map((alert) => {
      const attentionStatus = buildAttentionStatus(alert, safeNow);
      return {
        ...alert,
        attentionActionLabel:
          ATTENTION_ACTION_LABELS[String(alert?.deliveryOutcomeCode || "").trim().toLowerCase()] || "CHECK ALERT PATH",
        attentionActionCopy: buildAttentionActionCopy(alert),
        attentionTarget: buildAttentionTarget(alert),
        attentionQuickAction: buildAttentionQuickAction(alert),
        attentionStatus,
        attentionCause: buildAttentionCause({
          ...alert,
          attentionStatus,
        }),
      };
    });
}

function summarizeAttentionCauseBreakdown(attentionAlerts, options = {}) {
  const safeAlerts = Array.isArray(attentionAlerts) ? attentionAlerts : [];
  const safeNow = resolveDateValue(options.now) || new Date();
  const causeMap = new Map();

  for (const alert of safeAlerts) {
    const cause = alert?.attentionCause;
    if (!cause?.label) {
      continue;
    }

    const key = String(cause.label).trim();
    const current = causeMap.get(key) || {
      label: key,
      copy: String(cause.copy || "").trim(),
      count: 0,
      highestOutcomeRank: 0,
      highestOutcomeLabel: "",
      outcomeCounts: {
        blocked: 0,
        failed: 0,
        retry_pending: 0,
      },
      latestAt: "",
      routeStopKeys: new Set(),
      routeStopMap: new Map(),
      representativeAlert: null,
    };

    const outcomeRank = ATTENTION_OUTCOME_RANK[String(alert?.deliveryOutcomeCode || "").trim().toLowerCase()] || 0;
    const outcomeCode = String(alert?.deliveryOutcomeCode || "").trim().toLowerCase();
    current.count += 1;
    current.highestOutcomeRank = Math.max(current.highestOutcomeRank, outcomeRank);
    if (outcomeRank >= current.highestOutcomeRank) {
      current.highestOutcomeLabel = String(alert?.deliveryOutcomeLabel || "").trim() || current.highestOutcomeLabel;
    }
    if (Object.prototype.hasOwnProperty.call(current.outcomeCounts, outcomeCode)) {
      current.outcomeCounts[outcomeCode] += 1;
    }

    const latestAtMs = resolveDateValue(alert?.latestAt)?.getTime() || 0;
    const currentLatestAtMs = resolveDateValue(current.latestAt)?.getTime() || 0;
    if (latestAtMs >= currentLatestAtMs) {
      current.latestAt = String(alert?.latestAt || "").trim();
    }

    const routeStopKey = `${String(alert?.routeNumber || "").trim()}::${String(alert?.stopName || "").trim()}`;
    if (routeStopKey !== "::") {
      current.routeStopKeys.add(routeStopKey);
      const routeStopEntry = current.routeStopMap.get(routeStopKey) || {
        routeNumber: String(alert?.routeNumber || "").trim(),
        stopName: String(alert?.stopName || "").trim(),
        count: 0,
        latestAt: "",
      };
      routeStopEntry.count += 1;
      if (latestAtMs >= (resolveDateValue(routeStopEntry.latestAt)?.getTime() || 0)) {
        routeStopEntry.latestAt = String(alert?.latestAt || "").trim();
      }
      current.routeStopMap.set(routeStopKey, routeStopEntry);
    }

    const representative = current.representativeAlert;
    const representativeOutcomeRank =
      ATTENTION_OUTCOME_RANK[String(representative?.deliveryOutcomeCode || "").trim().toLowerCase()] || 0;
    const representativeLatestAtMs = resolveDateValue(representative?.latestAt)?.getTime() || 0;
    const representativeScore = Number(representative?.maxScore || 0);
    const alertScore = Number(alert?.maxScore || 0);
    if (
      !representative ||
      outcomeRank > representativeOutcomeRank ||
      (outcomeRank === representativeOutcomeRank && latestAtMs > representativeLatestAtMs) ||
      (outcomeRank === representativeOutcomeRank &&
        latestAtMs === representativeLatestAtMs &&
        alertScore > representativeScore)
    ) {
      current.representativeAlert = alert;
    }

    causeMap.set(key, current);
  }

  const causes = Array.from(causeMap.values())
    .map((entry) => {
      const representativeAlert = entry.representativeAlert || null;
      const representativeStatus = representativeAlert ? buildAttentionStatus(representativeAlert, safeNow) : null;
      const outcomeMix = Object.entries(entry.outcomeCounts)
        .filter(([, count]) => Number(count) > 0)
        .map(([code, count]) => ({
          code,
          label: ATTENTION_OUTCOME_LABELS[code] || String(code || "").toUpperCase(),
          count,
          rank: ATTENTION_OUTCOME_RANK[code] || 0,
        }))
        .sort((left, right) => {
          if (right.rank !== left.rank) {
            return right.rank - left.rank;
          }
          if (right.count !== left.count) {
            return right.count - left.count;
          }
          return left.label.localeCompare(right.label);
        });
      const topRouteStops = Array.from(entry.routeStopMap.values())
        .sort((left, right) => {
          if (right.count !== left.count) {
            return right.count - left.count;
          }
          const latestDelta =
            (resolveDateValue(right.latestAt)?.getTime() || 0) - (resolveDateValue(left.latestAt)?.getTime() || 0);
          if (latestDelta !== 0) {
            return latestDelta;
          }
          return `${left.routeNumber} ${left.stopName}`.localeCompare(`${right.routeNumber} ${right.stopName}`);
        })
        .map((item) => ({
          routeNumber: item.routeNumber,
          stopName: item.stopName,
          count: item.count,
          latestAt: item.latestAt,
        }));
      const routeStopCount = entry.routeStopKeys.size;
      const spreadSummary = buildIssueSpreadSummary({
        count: entry.count,
        routeStopCount,
        topRouteStops,
      });
      return {
        label: entry.label,
        copy: entry.copy,
        count: entry.count,
        highestOutcomeRank: entry.highestOutcomeRank,
        highestOutcomeLabel: entry.highestOutcomeLabel,
        latestAt: entry.latestAt,
        routeStopCount,
        deliveryOutcomeCode: String(representativeAlert?.deliveryOutcomeCode || "").trim().toLowerCase(),
        deliveryOutcomeLabel: String(representativeAlert?.deliveryOutcomeLabel || "").trim(),
        representativeRouteNumber: String(representativeAlert?.routeNumber || "").trim(),
        representativeStopName: String(representativeAlert?.stopName || "").trim(),
        attentionActionLabel:
          ATTENTION_ACTION_LABELS[String(representativeAlert?.deliveryOutcomeCode || "").trim().toLowerCase()] ||
          "CHECK ALERT PATH",
        attentionActionCopy: representativeAlert ? buildAttentionActionCopy(representativeAlert) : "",
        attentionTarget: representativeAlert ? buildAttentionTarget(representativeAlert) : null,
        attentionQuickAction: representativeAlert ? buildAttentionQuickAction(representativeAlert) : null,
        attentionStatus: representativeStatus,
        spreadSummary,
        outcomeMix,
        topRouteStops,
      };
    })
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      if (right.highestOutcomeRank !== left.highestOutcomeRank) {
        return right.highestOutcomeRank - left.highestOutcomeRank;
      }
      const latestDelta =
        (resolveDateValue(right.latestAt)?.getTime() || 0) - (resolveDateValue(left.latestAt)?.getTime() || 0);
      if (latestDelta !== 0) {
        return latestDelta;
      }
      return left.label.localeCompare(right.label);
    });

  return {
    topCause: causes[0] || null,
    causes,
  };
}

export function buildDeliveryIntensityReport(input = {}) {
  const timeZone = String(input.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const safeNow = resolveDateValue(input.now) || new Date();
  const todayDateKey = getDateKeyInTimeZone(safeNow, timeZone);
  const allSignals = buildSignals(input);
  const signals = allSignals.filter((signal) => getDateKeyInTimeZone(signal.createdAt, timeZone) === todayDateKey);
  const alertLeaders = summarizeAlertLeaders(signals);
  const attentionAlerts = summarizeAttentionAlerts(alertLeaders, { now: safeNow });
  const attentionCauseBreakdown = summarizeAttentionCauseBreakdown(attentionAlerts, { now: safeNow });
  const outcomeBreakdown = summarizeDeliveryOutcomeBreakdown(alertLeaders);
  const routeStopLeaders = summarizeRouteStopIntensity(signals);
  const sourceBreakdown = Array.from(
    signals.reduce((map, signal) => {
      const current = map.get(signal.source) || {
        source: signal.source,
        sourceLabel: signal.sourceLabel,
        count: 0,
        maxScore: 0,
      };
      current.count += 1;
      current.maxScore = Math.max(current.maxScore, signal.intensityScore);
      map.set(signal.source, current);
      return map;
    }, new Map()).values(),
  ).sort((left, right) => {
    if (right.maxScore !== left.maxScore) {
      return right.maxScore - left.maxScore;
    }
    return right.count - left.count;
  });

  const totalSignals = signals.length;
  const totalScore = signals.reduce((sum, signal) => sum + signal.intensityScore, 0);

  return {
    generatedAt: safeNow.toISOString(),
    timeZone,
    dateKey: todayDateKey,
    totalSignals,
    boostedCount: signals.filter((signal) => signal.deliveryPriorityClass === "boosted").length,
    averageScore: totalSignals ? Math.round((totalScore / totalSignals) * 10) / 10 : 0,
    maxScore: signals[0]?.intensityScore || 0,
    topSignal: signals[0] || null,
    topAlert: alertLeaders[0] || null,
    alertLeaders,
    topAttentionAlert: attentionAlerts[0] || null,
    attentionAlerts,
    topAttentionCause: attentionCauseBreakdown.topCause,
    attentionCauseBreakdown: attentionCauseBreakdown.causes,
    outcomeBreakdown,
    topRouteStop: routeStopLeaders[0] || null,
    sourceBreakdown,
    routeStopLeaders,
    signals,
  };
}
