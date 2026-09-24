import { getNotificationSpec } from "../logic/notification-engine.js";
import { sanitizeDeviceProfile } from "../device-profile.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function extractDateKey(value) {
  const match = /^(\d{4}-\d{2}-\d{2}):/.exec(String(value || "").trim());
  return match ? match[1] : null;
}

function resolveBundleDateKey(bundle) {
  return extractDateKey(bundle?.dispatchKey) || extractDateKey(bundle?.alertTriggerKey) || null;
}

function inferQueueDateKey(queueState) {
  if (queueState?.dateKey) {
    return String(queueState.dateKey);
  }

  const bundleDateKey = Array.isArray(queueState?.bundles)
    ? queueState.bundles.map((bundle) => resolveBundleDateKey(bundle)).find(Boolean)
    : null;
  if (bundleDateKey) {
    return bundleDateKey;
  }

  return Array.isArray(queueState?.handledDispatchKeys)
    ? queueState.handledDispatchKeys.map((value) => extractDateKey(value)).find(Boolean) || null
    : null;
}

export function createDispatchQueueState() {
  return {
    dateKey: null,
    bundles: [],
    handledDispatchKeys: [],
    lastGeneratedAt: null,
  };
}

function buildChannel(channel, label, status, detail) {
  return {
    channel,
    label,
    status,
    detail,
  };
}

function buildDeliveryPriorityContext(alert) {
  return {
    deliveryPriorityClass: String(alert?.deliveryPriorityClass || "normal").trim().toLowerCase() || "normal",
    deliveryPriorityReason: String(alert?.deliveryPriorityReason || "").trim(),
  };
}

function summarizeChannels(channels) {
  return channels.reduce(
    (summary, channel) => {
      const key = String(channel.status || "UNKNOWN").toLowerCase();
      summary[key] = (summary[key] || 0) + 1;
      return summary;
    },
    { queued: 0, blocked: 0, disabled: 0, not_required: 0 },
  );
}

function normalizeDispatchContext(contextOrNow, maybeNow) {
  if (contextOrNow instanceof Date || typeof contextOrNow === "string" || typeof contextOrNow === "number") {
    return {
      notificationSettings: {},
      now: contextOrNow,
    };
  }

  if (contextOrNow && typeof contextOrNow === "object") {
    return {
      notificationSettings:
        contextOrNow.notificationSettings && typeof contextOrNow.notificationSettings === "object"
          ? contextOrNow.notificationSettings
          : {},
      dateKey: contextOrNow.dateKey ? String(contextOrNow.dateKey) : null,
      now: contextOrNow.now ?? maybeNow ?? new Date(),
    };
  }

  return {
    notificationSettings: {},
    dateKey: null,
    now: maybeNow ?? new Date(),
  };
}

function resolveNotificationSpec(alert, notificationSettings, now) {
  const referenceTime = alert?.activatedAt || alert?.createdAt || alert?.triggerAt || now;
  const secondsSinceTrigger = Math.max(0, Math.floor((new Date(now).getTime() - new Date(referenceTime).getTime()) / 1000));

  const spec = getNotificationSpec({
    riskLevel: alert?.riskLevel || alert?.notificationSpec?.riskLevel || "YELLOW",
    routeNumber: alert?.routeNumber || "",
    arrivalsMin: Array.isArray(alert?.arrivalsMin) ? alert.arrivalsMin : [],
    urgency: alert?.urgency || "",
    riskMessage: alert?.detail || "",
    deliveryPriorityClass: String(alert?.deliveryPriorityClass || "normal"),
    deliveryPriorityReason: String(alert?.deliveryPriorityReason || ""),
    secondsSinceTrigger,
    escalationEnabled: ['departure','early-arrival'].includes(alert?.triggerKind) ? false : notificationSettings?.escalationEnabled !== false,
    dndBypass: Boolean(notificationSettings?.dndBypass),
    preferredSoundPresetId: notificationSettings?.soundPresetId,
    preferredSpeechRate: notificationSettings?.ttsSpeed,
    vibrationStrength: notificationSettings?.vibrationStrength,
  });
  if (['departure','early-arrival'].includes(alert?.triggerKind) && alert.notificationSpec?.departureAt) {
    // Preserve the departure-focused wording through push/TTS escalation.
    for (const key of ['title','body','spokenText','alertPhraseKo','departureAt','departureEstimated','emergencyKey','emergencyContextKey','expiresAt'])
      spec[key] = alert.notificationSpec[key];
  }
  return spec;
}

function buildDispatchKey(alert, notificationSpec) {
  return `${alert.triggerKey}:stage-${notificationSpec.stage}`;
}

function buildDispatchBundle(alert, deviceProfile, notificationSettings, now) {
  const profile = sanitizeDeviceProfile(deviceProfile);
  const notificationSpec = resolveNotificationSpec(alert, notificationSettings, now);
  const deliveryPriority = buildDeliveryPriorityContext(alert);
  const channels = [];

  channels.push(
    buildChannel(
      "push",
      "Push Notification",
      profile.pushEnabled ? (profile.pushToken ? "QUEUED" : "BLOCKED") : "DISABLED",
      profile.pushEnabled
        ? profile.pushToken
          ? deliveryPriority.deliveryPriorityClass === "boosted"
            ? "Push payload can be queued with boosted first-alarm priority for this unstable route."
            : "Push payload can be queued for the registered token."
          : "Push is enabled but no token is registered yet."
        : "Push delivery is turned off on this device.",
    ),
  );
  channels.push(
    buildChannel(
      "full_screen",
      "Full-screen Alarm",
      notificationSpec.fullScreen ? (profile.fullScreenEnabled ? "QUEUED" : "BLOCKED") : "NOT_REQUIRED",
      notificationSpec.fullScreen
        ? profile.fullScreenEnabled
          ? "The alert qualifies for a full-screen interruption."
          : "This alert wants full-screen mode but the device permission is still off."
        : "This alert does not require full-screen mode.",
    ),
  );
  channels.push(
    buildChannel(
      "dnd_bypass",
      "DND Override",
      notificationSpec.criticalBypass ? (profile.dndOverrideGranted ? "QUEUED" : "BLOCKED") : "NOT_REQUIRED",
      notificationSpec.criticalBypass
        ? profile.dndOverrideGranted
          ? "Do Not Disturb override has been granted for this device."
          : "The alert requests DND override but the device permission is still missing."
        : "This alert does not require DND override.",
    ),
  );
  channels.push(
    buildChannel(
      "sound",
      "Alarm Sound",
      profile.soundEnabled ? "QUEUED" : "DISABLED",
      profile.soundEnabled ? `Play preset ${notificationSpec.soundPresetId || "default"} at ${notificationSpec.volumePercent || 0}% volume.` : "Sound playback is disabled on this device.",
    ),
  );
  channels.push(
    buildChannel(
      "vibration",
      "Vibration",
      profile.vibrationEnabled ? "QUEUED" : "DISABLED",
      profile.vibrationEnabled
        ? `Run vibration pattern ${(notificationSpec.vibrationPattern || []).join("-")} x${notificationSpec.vibrationRepeats || 0}.`
        : "Vibration is disabled on this device.",
    ),
  );
  channels.push(
    buildChannel(
      "tts",
      "TTS Voice",
      profile.ttsEnabled ? "QUEUED" : "DISABLED",
      profile.ttsEnabled ? "Spoken guidance can be played on the device." : "TTS playback is disabled on this device.",
    ),
  );
  channels.push(
    buildChannel(
      "local_backup",
      "Local Backup Alarm",
      profile.localBackupEnabled ? "QUEUED" : "DISABLED",
      profile.localBackupEnabled
        ? profile.batteryOptimizationIgnored
          ? "Local fallback alarm is ready and battery optimization is already ignored."
          : "Local fallback alarm is ready, but battery optimization is still not ignored."
        : "Local fallback scheduling is disabled on this device.",
    ),
  );

  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    dispatchKey: buildDispatchKey(alert, notificationSpec),
    alertTriggerKey: alert.triggerKey,
    routeNumber: alert.routeNumber || "",
    stopName: alert.stopName || "",
    riskLevel: alert.riskLevel || "",
    title: notificationSpec.title || alert.title || "Alarm dispatch",
    createdAt: now.toISOString(),
    stage: notificationSpec.stage,
    escalationLabel: notificationSpec.escalationLabel,
    deliveryPriorityClass: deliveryPriority.deliveryPriorityClass,
    deliveryPriorityReason: deliveryPriority.deliveryPriorityReason,
    secondsSinceTrigger: notificationSpec.secondsSinceTrigger,
    liveEtaGuardMode: String(alert?.liveEtaGuardMode || ""),
    accuracyRiskBufferMin: Number.isFinite(Number(alert?.notificationSpec?.accuracyRiskBufferMin ?? alert?.accuracyRiskBufferMin))
      ? Math.max(0, Number(alert?.notificationSpec?.accuracyRiskBufferMin ?? alert?.accuracyRiskBufferMin))
      : 0,
    accuracySpreadMin: Number.isFinite(Number(alert?.notificationSpec?.accuracySpreadMin ?? alert?.accuracySpreadMin))
      ? Math.max(0, Number(alert?.notificationSpec?.accuracySpreadMin ?? alert?.accuracySpreadMin))
      : null,
    notificationSpec,
    deviceSnapshot: {
      deviceId: profile.deviceId,
      deviceName: profile.deviceName,
      platform: profile.platform,
    },
    summary: summarizeChannels(channels),
    channels,
  };
}

export function reconcileDispatchQueue(queueState, deliveryState, deviceProfile, contextOrNow = new Date(), maybeNow) {
  const context = normalizeDispatchContext(contextOrNow, maybeNow);
  const currentNow = context.now instanceof Date ? context.now : new Date(context.now);
  const next = {
    ...createDispatchQueueState(),
    ...(queueState && typeof queueState === "object" ? clone(queueState) : {}),
    bundles: Array.isArray(queueState?.bundles) ? [...queueState.bundles] : [],
    handledDispatchKeys: Array.isArray(queueState?.handledDispatchKeys)
      ? [...new Set(queueState.handledDispatchKeys.map((value) => String(value || "").trim()).filter(Boolean))]
      : Array.isArray(queueState?.handledAlertKeys)
        ? [...new Set(queueState.handledAlertKeys.map((value) => String(value || "").trim()).filter(Boolean))]
      : [],
  };
  const storedDateKey = inferQueueDateKey(next);
  const originalBundleCount = next.bundles.length;
  const originalHandledCount = next.handledDispatchKeys.length;

  if (context.dateKey) {
    next.bundles = next.bundles.filter((bundle) => {
      const bundleDateKey = resolveBundleDateKey(bundle);
      return !bundleDateKey || bundleDateKey === context.dateKey;
    });
    next.handledDispatchKeys = next.handledDispatchKeys.filter((key) => {
      const keyDateKey = extractDateKey(key);
      return !keyDateKey || keyDateKey === context.dateKey;
    });
  }
  if ((originalBundleCount !== next.bundles.length || originalHandledCount !== next.handledDispatchKeys.length) && !next.bundles.length) {
    next.lastGeneratedAt = null;
  }
  next.dateKey = context.dateKey || storedDateKey || null;
  const currentAlert = deliveryState?.currentAlert;
  next.bundles = next.bundles.filter(bundle => !bundle.notificationSpec?.departureAt ||
    (currentAlert?.status === 'ACTIVE' && bundle.alertTriggerKey === currentAlert.triggerKey &&
      bundle.notificationSpec.departureAt === currentAlert.notificationSpec?.departureAt));
  const newBundles = [];

  if (currentAlert?.triggerKey && currentAlert.status === "ACTIVE") {
    const bundle = buildDispatchBundle(currentAlert, deviceProfile, context.notificationSettings, currentNow);
    if (!next.handledDispatchKeys.includes(bundle.dispatchKey)) {
      next.bundles = [bundle, ...next.bundles].slice(0, 60);
      next.handledDispatchKeys.push(bundle.dispatchKey);
      next.lastGeneratedAt = currentNow.toISOString();
      newBundles.push(bundle);
    }
  }

  next.handledDispatchKeys = [...new Set(next.handledDispatchKeys)].slice(-240);
  return {
    queue: next,
    newBundles,
  };
}
