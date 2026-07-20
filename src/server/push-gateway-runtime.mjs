import { randomUUID } from "node:crypto";

import { createPushGatewayState } from "./push-gateway-store.mjs";
import { runPushGatewayDispatch, getPushGatewayConfig } from "./push-gateway.mjs";
import { buildPushPreview } from "./push-preview.mjs";

const RETRY_PROFILES = {
  standard: {
    key: "standard",
    label: "Standard retry",
    delaysMs: [30_000, 120_000, 300_000],
  },
  boosted: {
    key: "boosted",
    label: "Boosted first-alarm retry",
    delaysMs: [10_000, 30_000, 90_000],
  },
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function extractDateKey(value) {
  const safe = String(value || "").trim();
  const dispatchMatch = /^(\d{4}-\d{2}-\d{2}):/.exec(safe);
  if (dispatchMatch) {
    return dispatchMatch[1];
  }

  const testMatch = /^test:(\d{4}-\d{2}-\d{2})T/.exec(safe);
  if (testMatch) {
    return testMatch[1];
  }

  const isoMatch = /^(\d{4}-\d{2}-\d{2})/.exec(safe);
  return isoMatch ? isoMatch[1] : null;
}

function resolveAttemptDateKey(attempt) {
  return extractDateKey(attempt?.dispatchKey) || extractDateKey(attempt?.createdAt) || null;
}

function resolveQueueDateKey(queueState) {
  if (queueState?.dateKey) {
    return String(queueState.dateKey);
  }

  if (!Array.isArray(queueState?.bundles)) {
    return null;
  }

  return (
    queueState.bundles
      .map((bundle) => extractDateKey(bundle?.dispatchKey) || extractDateKey(bundle?.createdAt))
      .find(Boolean) || null
  );
}

function inferGatewayDateKey(gatewayState) {
  if (gatewayState?.dateKey) {
    return String(gatewayState.dateKey);
  }

  if (Array.isArray(gatewayState?.attempts)) {
    const attemptDateKey = gatewayState.attempts.map((attempt) => resolveAttemptDateKey(attempt)).find(Boolean);
    if (attemptDateKey) {
      return attemptDateKey;
    }
  }

  return Array.isArray(gatewayState?.handledDispatchKeys)
    ? gatewayState.handledDispatchKeys.map((value) => extractDateKey(value)).find(Boolean) || null
    : null;
}

function normalizeGatewayState(gatewayState) {
  return {
    ...createPushGatewayState(),
    ...(gatewayState && typeof gatewayState === "object" ? clone(gatewayState) : {}),
    attempts: Array.isArray(gatewayState?.attempts) ? [...gatewayState.attempts] : [],
    handledDispatchKeys: Array.isArray(gatewayState?.handledDispatchKeys)
      ? [...new Set(gatewayState.handledDispatchKeys.map((value) => String(value || "").trim()).filter(Boolean))]
      : [],
    retryQueue: Array.isArray(gatewayState?.retryQueue) ? [...gatewayState.retryQueue] : [],
  };
}

function normalizeRetryQueue(retryQueue, dateKey) {
  const items = Array.isArray(retryQueue) ? retryQueue : [];
  return items.filter((item) => {
    const itemDateKey = extractDateKey(item?.dispatchKey) || extractDateKey(item?.scheduledAt);
    return !dateKey || !itemDateKey || itemDateKey === dateKey;
  });
}

function normalizeDeliveryPriorityClass(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || "normal";
}

function getRetryProfileForPriorityClass(deliveryPriorityClass) {
  return normalizeDeliveryPriorityClass(deliveryPriorityClass) === "boosted"
    ? RETRY_PROFILES.boosted
    : RETRY_PROFILES.standard;
}

function classifyRetryDecision(attempt) {
  const status = String(attempt?.status || "").trim().toUpperCase();
  const responseStatusCode = Number(attempt?.response?.statusCode || 0);
  const providerRetryable = attempt?.response?.retryable;

  if (status !== "FAILED") {
    return {
      retryable: false,
      reason:
        status === "BLOCKED"
          ? "The provider handoff is blocked by configuration or token issues, so automatic retry is disabled."
          : status === "SENT"
            ? "The provider already accepted the request, so no retry is needed."
            : status === "DRY_RUN_READY"
              ? "Preview-mode handoffs do not enter the automatic retry queue."
              : "This push attempt does not qualify for automatic retry.",
    };
  }

  if (!responseStatusCode) {
    return {
      retryable: true,
      reason: "The handoff failed before the provider returned an HTTP status, so the server will retry automatically.",
    };
  }

  if (typeof providerRetryable === "boolean") {
    return {
      retryable: providerRetryable,
      reason: providerRetryable
        ? String(attempt?.response?.reason || "The provider marked this failure as temporary, so the server will retry automatically.")
        : String(attempt?.response?.reason || "The provider marked this failure as permanent, so automatic retry is disabled."),
    };
  }

  if (responseStatusCode === 429 || responseStatusCode >= 500) {
    return {
      retryable: true,
      reason: `The provider returned HTTP ${responseStatusCode}, so the server will retry automatically.`,
    };
  }

  return {
    retryable: false,
    reason: `The provider returned HTTP ${responseStatusCode}, so automatic retry is disabled until configuration is corrected.`,
  };
}

function buildRetryItem(attempt, currentNow) {
  const deliveryPriorityClass = normalizeDeliveryPriorityClass(attempt?.deliveryPriorityClass);
  const retryProfile = getRetryProfileForPriorityClass(deliveryPriorityClass);
  const previousRetryAttempt = Number(attempt?.retryAttempt || 0);
  const nextRetryAttempt = previousRetryAttempt + 1;
  if (nextRetryAttempt > retryProfile.delaysMs.length) {
    return null;
  }

  const delayMs = retryProfile.delaysMs[nextRetryAttempt - 1];
  const scheduledAt = new Date(currentNow.getTime() + delayMs).toISOString();
  return {
    id: randomUUID(),
    dispatchKey: String(attempt?.dispatchKey || ""),
    routeNumber: String(attempt?.routeNumber || ""),
    stopName: String(attempt?.stopName || ""),
    riskLevel: String(attempt?.riskLevel || ""),
    liveEtaGuardMode: String(attempt?.liveEtaGuardMode || ""),
    accuracyRiskBufferMin: Number.isFinite(Number(attempt?.accuracyRiskBufferMin))
      ? Math.max(0, Number(attempt.accuracyRiskBufferMin))
      : 0,
    accuracySpreadMin: Number.isFinite(Number(attempt?.accuracySpreadMin))
      ? Math.max(0, Number(attempt.accuracySpreadMin))
      : null,
    volumePercent: Number.isFinite(Number(attempt?.volumePercent)) ? Math.max(0, Number(attempt.volumePercent)) : 0,
    vibrationRepeats: Number.isFinite(Number(attempt?.vibrationRepeats))
      ? Math.max(0, Number(attempt.vibrationRepeats))
      : 0,
    mechanicalLoopBoost: Number.isFinite(Number(attempt?.mechanicalLoopBoost))
      ? Math.max(0, Number(attempt.mechanicalLoopBoost))
      : 0,
    speechRepeatCount: Number.isFinite(Number(attempt?.speechRepeatCount))
      ? Math.max(1, Number(attempt.speechRepeatCount))
      : 1,
    title: String(attempt?.title || ""),
    stage: Number.isFinite(Number(attempt?.stage)) ? Number(attempt.stage) : 0,
    escalationLabel: String(attempt?.escalationLabel || ""),
    deliveryPriorityClass,
    deliveryPriorityReason: String(attempt?.deliveryPriorityReason || ""),
    retryProfileKey: retryProfile.key,
    retryProfileLabel: retryProfile.label,
    retryAttempt: nextRetryAttempt,
    retryDelayMs: delayMs,
    scheduledAt,
    lastAttemptId: String(attempt?.id || ""),
    reason: String(attempt?.retryReason || ""),
  };
}

export function buildRetryPolicySummary(retryQueue) {
  const queue = Array.isArray(retryQueue) ? retryQueue : [];
  const sortedQueue = [...queue].sort((left, right) =>
    String(left?.scheduledAt || "").localeCompare(String(right?.scheduledAt || "")),
  );
  const nextRetryAt = queue
    .map((item) => String(item?.scheduledAt || "").trim())
    .filter(Boolean)
    .sort()[0] || null;
  const nextRetryItem = sortedQueue[0] || null;
  const priorityBackoffSeconds = Object.fromEntries(
    Object.entries(RETRY_PROFILES).map(([key, profile]) => [key, profile.delaysMs.map((delay) => Math.round(delay / 1000))]),
  );
  const boostedPendingRetries = queue.filter(
    (item) => normalizeDeliveryPriorityClass(item?.deliveryPriorityClass) === "boosted",
  ).length;
  const activeRetryProfiles = [
    ...new Set(
      queue
        .map((item) => getRetryProfileForPriorityClass(item?.deliveryPriorityClass).key)
        .filter(Boolean),
    ),
  ];

  return {
    maxAutomaticRetries: Math.max(...Object.values(RETRY_PROFILES).map((profile) => profile.delaysMs.length)),
    backoffSeconds: priorityBackoffSeconds.standard,
    priorityBackoffSeconds,
    activeRetryProfiles,
    pendingRetries: queue.length,
    boostedPendingRetries,
    nextRetryAt,
    nextRetryDeliveryPriorityClass: nextRetryItem
      ? normalizeDeliveryPriorityClass(nextRetryItem.deliveryPriorityClass)
      : null,
    };
}

export function summarizePushGatewayState(gatewayState, limit = 4) {
  const safeLimit = Math.max(Number(limit) || 1, 1);
  const safeState = normalizeGatewayState(gatewayState);

  return {
    attempts: safeState.attempts.slice(0, safeLimit),
    total: safeState.attempts.length,
    handledDispatchKeys: safeState.handledDispatchKeys.length,
    retryQueue: safeState.retryQueue.slice(0, safeLimit),
    retryPolicy: buildRetryPolicySummary(safeState.retryQueue),
    dateKey: safeState.dateKey,
    lastAttemptAt: safeState.lastAttemptAt,
  };
}

function decorateAttempt(attempt, preview, origin, now, dateKey, retryContext = null) {
  const messageData = preview?.envelope?.message?.data || {};
  const currentNow = now instanceof Date ? now : new Date(now);
  const retryDecision = classifyRetryDecision(attempt);
  const retryAttempt = Number(retryContext?.retryAttempt ?? attempt?.retryAttempt ?? 0);
  const deliveryPriorityClass = normalizeDeliveryPriorityClass(
    retryContext?.deliveryPriorityClass ?? attempt?.deliveryPriorityClass ?? preview?.deliveryPriorityClass ?? messageData.deliveryPriorityClass,
  );
  const retryProfile = getRetryProfileForPriorityClass(deliveryPriorityClass);

  return {
    ...attempt,
    origin,
    dateKey: dateKey || resolveAttemptDateKey(attempt) || currentNow.toISOString().slice(0, 10),
    routeNumber: String(attempt?.routeNumber || preview?.routeNumber || messageData.routeNumber || ""),
    stopName: String(attempt?.stopName || preview?.stopName || messageData.stopName || ""),
    riskLevel: String(attempt?.riskLevel || preview?.riskLevel || ""),
    targetReadiness: String(attempt?.targetReadiness || preview?.targetHealth?.deliveryReadiness || ""),
    tokenKind: String(preview?.targetHealth?.tokenKind || ""),
    liveEtaGuardMode: String(attempt?.liveEtaGuardMode || preview?.liveEtaGuardMode || ""),
    deliveryPriorityClass,
    deliveryPriorityReason: String(
      retryContext?.deliveryPriorityReason ??
        attempt?.deliveryPriorityReason ??
        preview?.deliveryPriorityReason ??
        messageData.deliveryPriorityReason ??
        "",
    ),
    accuracyRiskBufferMin: Number.isFinite(Number(attempt?.accuracyRiskBufferMin ?? preview?.accuracyRiskBufferMin))
      ? Math.max(0, Number(attempt?.accuracyRiskBufferMin ?? preview?.accuracyRiskBufferMin))
      : 0,
    accuracySpreadMin: Number.isFinite(Number(attempt?.accuracySpreadMin ?? preview?.accuracySpreadMin))
      ? Math.max(0, Number(attempt?.accuracySpreadMin ?? preview?.accuracySpreadMin))
      : null,
    volumePercent: Number.isFinite(Number(attempt?.volumePercent ?? preview?.volumePercent))
      ? Math.max(0, Number(attempt?.volumePercent ?? preview?.volumePercent))
      : 0,
    vibrationRepeats: Number.isFinite(Number(attempt?.vibrationRepeats ?? preview?.vibrationRepeats))
      ? Math.max(0, Number(attempt?.vibrationRepeats ?? preview?.vibrationRepeats))
      : 0,
    mechanicalLoopBoost: Number.isFinite(Number(attempt?.mechanicalLoopBoost ?? preview?.mechanicalLoopBoost))
      ? Math.max(0, Number(attempt?.mechanicalLoopBoost ?? preview?.mechanicalLoopBoost))
      : 0,
    speechRepeatCount: Number.isFinite(Number(attempt?.speechRepeatCount ?? preview?.speechRepeatCount))
      ? Math.max(1, Number(attempt?.speechRepeatCount ?? preview?.speechRepeatCount))
      : 1,
    retryAttempt,
    retryProfileKey: String(retryContext?.retryProfileKey || retryProfile.key),
    retryProfileLabel: String(retryContext?.retryProfileLabel || retryProfile.label),
    retryable: retryDecision.retryable,
    retryReason: retryDecision.reason,
    nextRetryAt: retryContext?.nextRetryAt || null,
  };
}

async function executePushAttempt({
  bundle,
  deviceProfile,
  currentNow,
  gatewayConfig,
  dateKey,
  env,
  dispatchRunner,
  origin,
  retryItem = null,
}) {
  const preview = buildPushPreview(bundle, deviceProfile, currentNow);
  const attempt = await dispatchRunner(preview, gatewayConfig, currentNow, env, deviceProfile);
  const decoratedAttempt = decorateAttempt(attempt, preview, origin, currentNow, dateKey, retryItem);
  const retryItemCandidate = decoratedAttempt.retryable ? buildRetryItem(decoratedAttempt, currentNow) : null;
  if (retryItemCandidate) {
    decoratedAttempt.nextRetryAt = retryItemCandidate.scheduledAt;
  }

  return {
    preview,
    attempt: decoratedAttempt,
    retryItem: retryItemCandidate,
  };
}

export function recordPushGatewayAttempt(gatewayState, attempt, options = {}) {
  const currentNow = options.now instanceof Date ? options.now : new Date(options.now || new Date());
  const next = normalizeGatewayState(gatewayState);
  const origin = String(options.origin || attempt?.origin || "manual").trim().toLowerCase() || "manual";
  const dateKey = String(options.dateKey || resolveAttemptDateKey(attempt) || currentNow.toISOString().slice(0, 10));
  const decoratedAttempt = decorateAttempt(attempt, options.preview || null, origin, currentNow, dateKey, options.retryItem || null);

  if (dateKey) {
    next.dateKey = dateKey;
  } else if (!next.dateKey) {
    next.dateKey = inferGatewayDateKey(next);
  }

  next.attempts = [decoratedAttempt, ...next.attempts].slice(0, 120);
  next.retryQueue = normalizeRetryQueue(next.retryQueue, next.dateKey);
  next.lastAttemptAt = decoratedAttempt.createdAt || currentNow.toISOString();

  if (options.retryItem) {
    next.retryQueue = [...next.retryQueue, options.retryItem]
      .sort((left, right) => String(left.scheduledAt || "").localeCompare(String(right.scheduledAt || "")))
      .slice(0, 120);
  }

  if (options.markHandled && options.handledDispatchKey) {
    next.handledDispatchKeys = [...new Set([...next.handledDispatchKeys, String(options.handledDispatchKey)])].slice(-240);
  } else {
    next.handledDispatchKeys = [...new Set(next.handledDispatchKeys)].slice(-240);
  }

  return next;
}

export async function reconcilePushGatewayState(
  gatewayState,
  queueState,
  deviceProfile,
  now = new Date(),
  env = process.env,
  runtimeOptions = {},
) {
  const currentNow = now instanceof Date ? now : new Date(now);
  const next = normalizeGatewayState(gatewayState);
  const queueDateKey = resolveQueueDateKey(queueState);
  const storedDateKey = inferGatewayDateKey(next);
  const originalAttemptCount = next.attempts.length;
  const originalHandledCount = next.handledDispatchKeys.length;
  const dispatchRunner = typeof runtimeOptions.dispatchRunner === "function" ? runtimeOptions.dispatchRunner : runPushGatewayDispatch;

  if (queueDateKey) {
    next.attempts = next.attempts.filter((attempt) => {
      const attemptDateKey = resolveAttemptDateKey(attempt);
      return !attemptDateKey || attemptDateKey === queueDateKey;
    });
    next.handledDispatchKeys = next.handledDispatchKeys.filter((dispatchKey) => {
      const handledDateKey = extractDateKey(dispatchKey);
      return !handledDateKey || handledDateKey === queueDateKey;
    });
    next.retryQueue = normalizeRetryQueue(next.retryQueue, queueDateKey);

    if (
      (storedDateKey !== queueDateKey ||
        originalAttemptCount !== next.attempts.length ||
        originalHandledCount !== next.handledDispatchKeys.length) &&
      !next.attempts.length
    ) {
      next.lastAttemptAt = null;
    }

    next.dateKey = queueDateKey;
  } else if (!next.dateKey) {
    next.dateKey = storedDateKey || null;
    next.retryQueue = normalizeRetryQueue(next.retryQueue, next.dateKey);
  }

  const gatewayConfig = getPushGatewayConfig(env);
  const scheduledRetries = [];
  const dueRetryItems = [];
  const remainingRetryQueue = [];

  for (const retryItem of next.retryQueue) {
    const scheduledAt = new Date(String(retryItem?.scheduledAt || ""));
    if (!Number.isNaN(scheduledAt.getTime()) && scheduledAt.getTime() <= currentNow.getTime()) {
      dueRetryItems.push(retryItem);
    } else {
      remainingRetryQueue.push(retryItem);
    }
  }
  next.retryQueue = remainingRetryQueue;

  const newAttempts = [];

  for (const retryItem of dueRetryItems) {
    const bundle = Array.isArray(queueState?.bundles)
      ? queueState.bundles.find((candidate) => String(candidate?.dispatchKey || "") === String(retryItem?.dispatchKey || ""))
      : null;
    if (!bundle) {
      continue;
    }

    const execution = await executePushAttempt({
      bundle,
      deviceProfile,
      currentNow,
      gatewayConfig,
      dateKey: next.dateKey || queueDateKey,
      env,
      dispatchRunner,
      origin: "retry",
      retryItem,
    });

    next.attempts = [execution.attempt, ...next.attempts].slice(0, 120);
    next.lastAttemptAt = execution.attempt.createdAt || currentNow.toISOString();
    newAttempts.push(execution.attempt);

    if (execution.retryItem) {
      next.retryQueue = [...next.retryQueue, execution.retryItem]
        .sort((left, right) => String(left.scheduledAt || "").localeCompare(String(right.scheduledAt || "")))
        .slice(0, 120);
      scheduledRetries.push(execution.retryItem);
    }
  }

  const pendingBundles = Array.isArray(queueState?.bundles)
    ? queueState.bundles.filter((bundle) => {
        const dispatchKey = String(bundle?.dispatchKey || "").trim();
        return dispatchKey && !next.handledDispatchKeys.includes(dispatchKey);
      })
    : [];

  for (const bundle of pendingBundles) {
    const execution = await executePushAttempt({
      bundle,
      deviceProfile,
      currentNow,
      gatewayConfig,
      dateKey: next.dateKey || queueDateKey,
      env,
      dispatchRunner,
      origin: "auto",
    });

    const dispatchKey = String(bundle?.dispatchKey || "").trim();
    next.attempts = [execution.attempt, ...next.attempts].slice(0, 120);
    next.lastAttemptAt = execution.attempt.createdAt || currentNow.toISOString();
    next.handledDispatchKeys = [...new Set([...next.handledDispatchKeys, dispatchKey])].slice(-240);
    newAttempts.push(execution.attempt);

    if (execution.retryItem) {
      next.retryQueue = [...next.retryQueue, execution.retryItem]
        .sort((left, right) => String(left.scheduledAt || "").localeCompare(String(right.scheduledAt || "")))
        .slice(0, 120);
      scheduledRetries.push(execution.retryItem);
    }
  }

  return {
    state: next,
    newAttempts,
    scheduledRetries,
    retryPolicy: buildRetryPolicySummary(next.retryQueue),
  };
}
