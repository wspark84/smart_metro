const SOURCE_LABELS = {
  server_event: "Server event",
  dispatch_bundle: "Dispatch bundle",
  dispatch_execution: "Dispatch execution",
  push_attempt: "Push gateway",
  retry_queue: "Retry queue",
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
    buttonLabel: "Register Current Token",
  },
  failed: {
    action: "run-push-gateway",
    buttonLabel: "Run Gateway Dry Run",
  },
  retry_pending: {
    action: "run-push-retry-simulation",
    buttonLabel: "Run Due Retry Demo",
  },
};

const ATTENTION_TARGETS = {
  blocked: {
    screen: "settings",
    panelId: "device-delivery-panel",
    panelItemId: "device-push-token-input",
    buttonLabel: "Open Push Token",
  },
  failed: {
    screen: "home",
    panelId: "push-gateway-panel",
    panelItemKind: "push-attempt",
    buttonLabel: "Open Failed Attempt",
  },
  retry_pending: {
    screen: "home",
    panelId: "push-gateway-panel",
    panelItemKind: "retry-queue",
    buttonLabel: "Open Retry Queue",
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
        ? `The push gateway recorded a SENT handoff at ${new Date(latestPushAttempt.createdAt).toISOString()}.`
        : "The push gateway recorded a successful SENT handoff.",
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
        ? `A stronger retry is still queued for ${nextRetry.toISOString()}.`
        : "A stronger retry is still queued for this alert.",
    };
  }

  if (pushAttempts.some((signal) => signal.outcomeStatus === "FAILED")) {
    return {
      code: "failed",
      label: "FAILED",
      copy: latestPushAttempt?.detail
        ? `The latest push handoff failed: ${latestPushAttempt.detail}`
        : "The latest push handoff failed and no retry is currently queued.",
    };
  }

  if (pushAttempts.some((signal) => signal.outcomeStatus === "BLOCKED")) {
    return {
      code: "blocked",
      label: "BLOCKED",
      copy: latestPushAttempt?.detail
        ? `The push handoff is blocked: ${latestPushAttempt.detail}`
        : "The push handoff is blocked by token or gateway configuration.",
    };
  }

  if (pushAttempts.some((signal) => signal.outcomeStatus === "DRY_RUN_READY")) {
    return {
      code: "preview_ready",
      label: "PREVIEW ONLY",
      copy: "This alert reached the push preview layer, but the gateway is still in preview mode.",
    };
  }

  if (dispatchExecutions.length) {
    return {
      code: "simulated",
      label: "SIMULATED",
      copy: "This alert reached dispatch execution simulation, but no real push outcome is recorded yet.",
    };
  }

  if (dispatchBundles.length) {
    return {
      code: "queued",
      label: "QUEUED",
      copy: "This alert reached dispatch planning, but no downstream delivery result is stored yet.",
    };
  }

  if (serverEvents.length) {
    return {
      code: "triggered",
      label: "TRIGGERED",
      copy: "Only the server-side alarm trigger has been recorded so far.",
    };
  }

  return {
    code: "unknown",
    label: "UNKNOWN",
    copy: "No delivery trace is connected to this alert yet.",
  };
}

function buildAttentionActionCopy(alert) {
  const outcomeCode = String(alert?.deliveryOutcomeCode || "").trim().toLowerCase();
  const nextRetryAt = resolveDateValue(alert?.nextRetryAt);

  if (outcomeCode === "blocked") {
    return "Check the device token, notification permission, and push gateway credentials now. A blocked alert will not recover with retry until the delivery path is unblocked.";
  }

  if (outcomeCode === "failed") {
    return "Check the latest push failure detail now. This alert failed without a queued retry, so it needs manual follow-up before the next commute window.";
  }

  if (outcomeCode === "retry_pending") {
    return nextRetryAt
      ? `Keep the device reachable and watch the next retry at ${nextRetryAt.toISOString()}. This alert is still waiting for another push handoff.`
      : "Keep the device reachable and watch the retry queue. This alert is still waiting for another push handoff.";
  }

  return "Review the latest delivery trace for this alert and confirm that the push path is still healthy.";
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
  const attentionStatusValue = String(alert?.attentionStatus?.value || "").trim().toLowerCase();

  if (outcomeCode === "blocked") {
    if (pushDetail.includes("token")) {
      return {
        label: "Token blocked",
        copy: "The latest blocked handoff points to a device-token or token-format problem.",
      };
    }

    if (
      pushDetail.includes("credential") ||
      pushDetail.includes("access token") ||
      pushDetail.includes("project id") ||
      pushDetail.includes("auth")
    ) {
      return {
        label: "Credentials missing",
        copy: "The latest blocked handoff points to missing gateway credentials or push-project configuration.",
      };
    }

    return {
      label: "Push path blocked",
      copy: "The latest handoff is blocked before delivery can start.",
    };
  }

  if (outcomeCode === "failed") {
    if (pushDetail.includes("temporary") || pushDetail.includes("429") || pushDetail.includes("5xx")) {
      return {
        label: "Temporary provider failure",
        copy: "The provider reported a temporary failure and the current handoff did not complete.",
      };
    }

    if (pushDetail.includes("rejected")) {
      return {
        label: "Provider rejected request",
        copy: "The provider rejected the current handoff request, so this alert stopped at the gateway stage.",
      };
    }

    return {
      label: "Push handoff failed",
      copy: "The latest provider handoff failed and no active retry is attached to this alert.",
    };
  }

  if (outcomeCode === "retry_pending") {
    if (attentionStatusValue.startsWith("overdue")) {
      return {
        label: "Retry overdue",
        copy: "A retry is still pending even though its scheduled replay time has already passed.",
      };
    }

    if (retryDetail.includes("temporary")) {
      return {
        label: "Waiting on temporary-failure retry",
        copy: "The queued retry came from a temporary provider failure and is waiting for the next replay.",
      };
    }

    return {
      label: "Queued retry pending",
      copy: "The alert is still waiting in the retry queue for another push handoff.",
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
    return "now";
  }
  if (seconds < 60) {
    return diffMs >= 0 ? `in ${seconds}s` : `${seconds}s ago`;
  }

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return diffMs >= 0 ? `in ${minutes}m` : `${minutes}m ago`;
  }

  const hours = Math.round(minutes / 60);
  return diffMs >= 0 ? `in ${hours}h` : `${hours}h ago`;
}

function buildAttentionStatus(alert, nowValue) {
  const outcomeCode = String(alert?.deliveryOutcomeCode || "").trim().toLowerCase();

  if (outcomeCode === "retry_pending") {
    const nextRetryAt = resolveDateValue(alert?.nextRetryAt);
    const now = resolveDateValue(nowValue);
    const relativeValue = formatShortRelativeTime(nextRetryAt, now);
    const isOverdue = nextRetryAt && now && nextRetryAt.getTime() < now.getTime();
    return {
      label: "Next retry",
      value: isOverdue
        ? `overdue by ${String(relativeValue || "").replace(/\s*ago$/, "").trim()}`
        : relativeValue || "-",
      copy: alert?.nextRetryAt
        ? isOverdue
          ? `Queued retry was scheduled for ${String(alert.nextRetryAt).trim()} and is now overdue.`
          : `Queued retry is scheduled for ${String(alert.nextRetryAt).trim()}.`
        : "A retry is pending, but the scheduled time is missing.",
    };
  }

  if (outcomeCode === "failed") {
    return {
      label: "Last failure",
      value: formatShortRelativeTime(alert?.latestAt, nowValue) || "-",
      copy: alert?.latestAt
        ? `Latest failed handoff was recorded at ${String(alert.latestAt).trim()}.`
        : "A failed handoff is recorded, but the latest failure time is missing.",
    };
  }

  if (outcomeCode === "blocked") {
    return {
      label: "Last blocked",
      value: formatShortRelativeTime(alert?.latestAt, nowValue) || "-",
      copy: alert?.latestAt
        ? `Latest blocked handoff was recorded at ${String(alert.latestAt).trim()}.`
        : "A blocked handoff is recorded, but the latest blocked time is missing.",
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
          ? "This issue is currently concentrated in one commute pair."
          : "Most of today's issue volume is concentrated in one commute pair.",
    };
  }

  if (totalRouteStops >= 2 && share <= 0.5) {
    return {
      code: "spreading",
      label: ISSUE_SPREAD_LABELS.spreading,
      copy: "This issue is spread across several commute pairs rather than one dominant route-stop pair.",
    };
  }

  return {
    code: "mixed",
    label: ISSUE_SPREAD_LABELS.mixed,
    copy: "This issue is shared across multiple commute pairs, but one route-stop pair still leads the cluster.",
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
    sourceLabel: SOURCE_LABELS[source] || "Trace",
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
