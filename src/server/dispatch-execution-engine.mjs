import { sanitizeDeviceProfile } from "../device-profile.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function extractDateKey(value) {
  const match = /^(\d{4}-\d{2}-\d{2}):/.exec(String(value || "").trim());
  return match ? match[1] : null;
}

function resolveAttemptDateKey(attempt) {
  return extractDateKey(attempt?.dispatchKey) || extractDateKey(attempt?.alertTriggerKey) || null;
}

function inferExecutionDateKey(executionState) {
  if (executionState?.dateKey) {
    return String(executionState.dateKey);
  }

  return Array.isArray(executionState?.attempts)
    ? executionState.attempts.map((attempt) => resolveAttemptDateKey(attempt)).find(Boolean) || null
    : null;
}

function inferQueueDateKey(queueState) {
  if (queueState?.dateKey) {
    return String(queueState.dateKey);
  }

  return Array.isArray(queueState?.bundles)
    ? queueState.bundles
        .map((bundle) => extractDateKey(bundle?.dispatchKey) || extractDateKey(bundle?.alertTriggerKey))
        .find(Boolean) || null
    : null;
}

export function createDispatchExecutionState() {
  return {
    dateKey: null,
    attempts: [],
    handledBundleIds: [],
    lastExecutedAt: null,
  };
}

function summarizeExecutionChannels(channels) {
  return channels.reduce(
    (summary, channel) => {
      const key = String(channel.executionStatus || "SKIPPED").toLowerCase();
      summary[key] = (summary[key] || 0) + 1;
      return summary;
    },
    { simulated_sent: 0, skipped: 0, failed: 0 },
  );
}

function getExecutionStatus(queueStatus) {
  const normalized = String(queueStatus || "").trim().toUpperCase();
  if (normalized === "QUEUED") {
    return "SIMULATED_SENT";
  }
  if (normalized === "BLOCKED") {
    return "FAILED";
  }
  return "SKIPPED";
}

function buildExecutionDetail(channel, executionStatus, profile) {
  if (executionStatus === "SIMULATED_SENT") {
    if (channel.channel === "push") {
      return profile.platform === "ios"
        ? "Simulated APNs delivery accepted the payload for the registered device token."
        : "Simulated FCM delivery accepted the payload for the registered device token.";
    }
    if (channel.channel === "full_screen") {
      return "Simulated full-screen interruption was scheduled for the active alarm.";
    }
    if (channel.channel === "dnd_bypass") {
      return "Simulated critical-alert bypass was accepted for this alarm.";
    }
    if (channel.channel === "local_backup") {
      return profile.batteryOptimizationIgnored
        ? "Simulated local backup alarm was armed with battery optimization already ignored."
        : "Simulated local backup alarm was armed, but battery optimization may still reduce reliability.";
    }
    if (channel.channel === "tts") {
      return "Simulated TTS playback was queued for the spoken commute guidance.";
    }
    if (channel.channel === "vibration") {
      return "Simulated vibration pattern was handed to the device alarm channel.";
    }
    if (channel.channel === "sound") {
      return "Simulated sound playback was queued with the configured volume preset.";
    }
  }

  if (executionStatus === "FAILED") {
    return `Dispatch failed because the channel stayed blocked. ${channel.detail || ""}`.trim();
  }

  return `Dispatch was skipped. ${channel.detail || ""}`.trim();
}

function buildExecutionChannel(channel, profile) {
  const executionStatus = getExecutionStatus(channel.status);
  return {
    channel: channel.channel,
    label: channel.label,
    queueStatus: channel.status,
    executionStatus,
    detail: buildExecutionDetail(channel, executionStatus, profile),
  };
}

function buildExecutionAttempt(bundle, deviceProfile, now) {
  const profile = sanitizeDeviceProfile(deviceProfile);
  const channels = Array.isArray(bundle.channels)
    ? bundle.channels.map((channel) => buildExecutionChannel(channel, profile))
    : [];

  return {
    id: `${bundle.id || "bundle"}-execution`,
    bundleId: String(bundle.id || ""),
    dispatchKey: String(bundle.dispatchKey || ""),
    alertTriggerKey: String(bundle.alertTriggerKey || ""),
    title: String(bundle.title || "Dispatch execution"),
    routeNumber: String(bundle.routeNumber || ""),
    stopName: String(bundle.stopName || ""),
    riskLevel: String(bundle.riskLevel || ""),
    stage: Number(bundle.stage ?? 0),
    escalationLabel: String(bundle.escalationLabel || ""),
    deliveryPriorityClass: String(bundle.deliveryPriorityClass || ""),
    deliveryPriorityReason: String(bundle.deliveryPriorityReason || ""),
    secondsSinceTrigger: Number(bundle.secondsSinceTrigger ?? 0),
    liveEtaGuardMode: String(bundle.liveEtaGuardMode || ""),
    accuracyRiskBufferMin: Number.isFinite(Number(bundle.accuracyRiskBufferMin))
      ? Math.max(0, Number(bundle.accuracyRiskBufferMin))
      : 0,
    accuracySpreadMin: Number.isFinite(Number(bundle.accuracySpreadMin))
      ? Math.max(0, Number(bundle.accuracySpreadMin))
      : null,
    volumePercent: Number.isFinite(Number(bundle.notificationSpec?.volumePercent))
      ? Number(bundle.notificationSpec.volumePercent)
      : 0,
    vibrationRepeats: Number.isFinite(Number(bundle.notificationSpec?.vibrationRepeats))
      ? Number(bundle.notificationSpec.vibrationRepeats)
      : 0,
    mechanicalLoopBoost: Number.isFinite(Number(bundle.notificationSpec?.mechanicalLoopBoost))
      ? Number(bundle.notificationSpec.mechanicalLoopBoost)
      : 0,
    speechRepeatCount: Number.isFinite(Number(bundle.notificationSpec?.speechRepeatCount))
      ? Number(bundle.notificationSpec.speechRepeatCount)
      : 1,
    bundleCreatedAt: bundle.createdAt ? String(bundle.createdAt) : null,
    executedAt: now.toISOString(),
    deviceSnapshot:
      bundle.deviceSnapshot && typeof bundle.deviceSnapshot === "object" && !Array.isArray(bundle.deviceSnapshot)
        ? clone(bundle.deviceSnapshot)
        : {
            deviceId: profile.deviceId,
            deviceName: profile.deviceName,
            platform: profile.platform,
          },
    summary: summarizeExecutionChannels(channels),
    channels,
  };
}

export function reconcileDispatchExecutions(executionState, queueState, deviceProfile, now = new Date()) {
  const currentNow = now instanceof Date ? now : new Date(now);
  const next = {
    ...createDispatchExecutionState(),
    ...(executionState && typeof executionState === "object" ? clone(executionState) : {}),
    attempts: Array.isArray(executionState?.attempts) ? [...executionState.attempts] : [],
    handledBundleIds: Array.isArray(executionState?.handledBundleIds)
      ? [...new Set(executionState.handledBundleIds.map((value) => String(value || "").trim()).filter(Boolean))]
      : [],
  };
  const queueDateKey = inferQueueDateKey(queueState);
  const storedDateKey = inferExecutionDateKey(next);
  const originalAttemptCount = next.attempts.length;

  if (queueDateKey) {
    next.attempts = next.attempts.filter((attempt) => {
      const attemptDateKey = resolveAttemptDateKey(attempt);
      return !attemptDateKey || attemptDateKey === queueDateKey;
    });

    if (storedDateKey !== queueDateKey || originalAttemptCount !== next.attempts.length) {
      next.handledBundleIds = [];
      if (!next.attempts.length) {
        next.lastExecutedAt = null;
      }
    }

    next.dateKey = queueDateKey;
  }

  const pendingBundles = Array.isArray(queueState?.bundles)
    ? queueState.bundles.filter((bundle) => {
        const bundleId = String(bundle?.id || "").trim();
        return bundleId && !next.handledBundleIds.includes(bundleId);
      })
    : [];

  const newAttempts = pendingBundles.map((bundle) => buildExecutionAttempt(bundle, deviceProfile, currentNow));
  if (newAttempts.length) {
    next.attempts = [...newAttempts, ...next.attempts].slice(0, 120);
    next.handledBundleIds = [...next.handledBundleIds, ...pendingBundles.map((bundle) => String(bundle.id))].slice(-240);
    next.lastExecutedAt = currentNow.toISOString();
  }

  return {
    executions: next,
    newAttempts,
  };
}
