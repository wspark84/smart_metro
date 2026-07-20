import { randomUUID } from "node:crypto";

import { sanitizeDeviceProfile } from "../device-profile.js";
import { dateOnlyKey } from "../logic/commute.js";

const SIMULATED_TOKENS = {
  android: "dQw4w9WgXcQ:APA91bSimulationTokenExampleExampleExample1234567890",
  ios: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
  web: JSON.stringify({
    endpoint: "https://example.push.service.invalid/subscriptions/demo-token",
    keys: {
      p256dh: "BCdEFGhIJkLmNoPQRsTuVwXyZ0123456789abcdefghijklmnopqrstuvwxyzABCD",
      auth: "demoauthkey1234",
    },
  }),
};

export function isSimulationDispatchKey(dispatchKey) {
  return String(dispatchKey || "").includes(":simulation-");
}

function clampRiskLevel(value) {
  const safe = String(value || "RED").trim().toUpperCase();
  return ["GREEN", "YELLOW", "ORANGE", "RED"].includes(safe) ? safe : "RED";
}

function buildSimulationReason(outcome, adapter) {
  if (outcome === "success") {
    return `Simulation: ${adapter.toUpperCase()} accepted the retried request.`;
  }
  if (outcome === "hard-failure") {
    return `Simulation: ${adapter.toUpperCase()} rejected the request with HTTP 400, so auto retry is disabled.`;
  }
  return `Simulation: ${adapter.toUpperCase()} returned HTTP 503, so the server scheduled an automatic retry.`;
}

function buildSimulationStatusCode(outcome) {
  if (outcome === "success") {
    return 200;
  }
  if (outcome === "hard-failure") {
    return 400;
  }
  return 503;
}

export function createSimulationDeviceProfile(deviceProfile = {}) {
  const baseProfile = sanitizeDeviceProfile(deviceProfile);
  const platform = String(baseProfile.platform || "android").trim() || "android";

  return sanitizeDeviceProfile({
    ...baseProfile,
    deviceName: `${baseProfile.deviceName || "Primary Phone"} (Simulation)`,
    pushEnabled: true,
    pushToken: SIMULATED_TOKENS[platform] || SIMULATED_TOKENS.android,
    fullScreenEnabled: true,
    dndOverrideGranted: true,
    batteryOptimizationIgnored: true,
    localBackupEnabled: true,
    soundEnabled: true,
    vibrationEnabled: true,
    ttsEnabled: true,
    updatedAt: new Date().toISOString(),
  });
}

export function buildRetrySimulationBundle(options = {}, now = new Date()) {
  const currentNow = now instanceof Date ? now : new Date(now);
  const routeNumber = String(options.routeNumber || "1002").trim() || "1002";
  const stopName = String(options.stopName || "Registered stop").trim() || "Registered stop";
  const riskLevel = clampRiskLevel(options.riskLevel);
  const stage = Number.isFinite(Number(options.stage)) ? Number(options.stage) : 0;
  const escalationLabel = String(options.escalationLabel || "Simulation").trim() || "Simulation";
  const title = String(options.title || `[Simulation] ${routeNumber} retry path`).trim() || `[Simulation] ${routeNumber} retry path`;
  const dateKey = dateOnlyKey(currentNow);
  const triggerAt = new Date(currentNow.getTime() - 60_000).toISOString();
  const dispatchKey = `${dateKey}:${triggerAt}:stage-${stage}:simulation-${randomUUID().slice(0, 8)}`;

  return {
    id: `simulation-bundle-${randomUUID().slice(0, 8)}`,
    dispatchKey,
    alertTriggerKey: `${dateKey}:${triggerAt}`,
    routeNumber,
    stopName,
    riskLevel,
    title,
    createdAt: currentNow.toISOString(),
    stage,
    escalationLabel,
    notificationSpec: {
      title,
      body: `${routeNumber} retry simulation is active for ${stopName}.`,
      spokenText: `${routeNumber} retry simulation is active.`,
      soundPresetId: "mechanical",
      volumePercent: riskLevel === "RED" ? 100 : 70,
      vibrationPattern: riskLevel === "RED" ? [1000, 200] : [300, 200, 300],
      vibrationRepeats: riskLevel === "RED" ? 3 : 1,
      fullScreen: riskLevel === "RED",
      criticalBypass: false,
      speechVolume: 1,
      speechRate: 0.9,
      useMechanicalTone: true,
    },
  };
}

export function buildRetrySimulationQueueState(bundle, now = new Date()) {
  const currentNow = now instanceof Date ? now : new Date(now);
  const dateKey = String(bundle?.dispatchKey || "").slice(0, 10) || dateOnlyKey(currentNow);
  return {
    dateKey,
    bundles: bundle ? [bundle] : [],
    handledDispatchKeys: [],
    lastGeneratedAt: currentNow.toISOString(),
  };
}

export function buildRetrySimulationQueueFromItems(retryQueue = [], now = new Date()) {
  const currentNow = now instanceof Date ? now : new Date(now);
  const bundles = (Array.isArray(retryQueue) ? retryQueue : [])
    .map((item, index) => {
      const dispatchKey = String(item?.dispatchKey || "").trim();
      if (!dispatchKey) {
        return null;
      }

      const routeNumber = String(item?.routeNumber || "1002").trim() || "1002";
      const stopName = String(item?.stopName || "Registered stop").trim() || "Registered stop";
      const riskLevel = clampRiskLevel(item?.riskLevel);
      const stage = Number.isFinite(Number(item?.stage)) ? Number(item.stage) : 0;
      const escalationLabel = String(item?.escalationLabel || "Retry").trim() || "Retry";
      const title = String(item?.title || `[Simulation] ${routeNumber} retry ${Number(item?.retryAttempt || 0)}`).trim();
      return {
        id: `simulation-retry-bundle-${index + 1}`,
        dispatchKey,
        alertTriggerKey: dispatchKey.includes(":stage-") ? dispatchKey.split(":stage-")[0] : dispatchKey,
        routeNumber,
        stopName,
        riskLevel,
        title: title || `[Simulation] ${routeNumber} retry`,
        createdAt: String(item?.scheduledAt || currentNow.toISOString()),
        stage,
        escalationLabel,
        notificationSpec: {
          title: title || `[Simulation] ${routeNumber} retry`,
          body: `${routeNumber} retry simulation is replaying for ${stopName}.`,
          spokenText: `${routeNumber} retry simulation is replaying.`,
          soundPresetId: "mechanical",
          volumePercent: riskLevel === "RED" ? 100 : 70,
          vibrationPattern: riskLevel === "RED" ? [1000, 200] : [300, 200, 300],
          vibrationRepeats: riskLevel === "RED" ? 3 : 1,
          fullScreen: riskLevel === "RED",
          criticalBypass: false,
          speechVolume: 1,
          speechRate: 0.9,
          useMechanicalTone: true,
        },
      };
    })
    .filter(Boolean);

  return {
    dateKey: bundles[0]?.dispatchKey?.slice(0, 10) || dateOnlyKey(currentNow),
    bundles,
    handledDispatchKeys: [],
    lastGeneratedAt: currentNow.toISOString(),
  };
}

export function createSimulationDispatchRunner(outcome = "retryable-failure") {
  const safeOutcome = ["success", "hard-failure"].includes(String(outcome || "").trim()) ? String(outcome).trim() : "retryable-failure";

  return async (preview, _gatewayConfig, now = new Date()) => {
    const currentNow = now instanceof Date ? now : new Date(now);
    const messageData = preview?.envelope?.message?.data || {};
    const adapter = String(preview?.adapter || "fcm").trim() || "fcm";
    const statusCode = buildSimulationStatusCode(safeOutcome);

    return {
      id: randomUUID(),
      createdAt: currentNow.toISOString(),
      adapter,
      previewStatus: String(preview?.status || "ready"),
      dispatchKey: String(preview?.dispatchKey || ""),
      title: String(preview?.title || "[Simulation] Push attempt"),
      stage: Number(preview?.stage ?? 0),
      escalationLabel: String(preview?.escalationLabel || "Simulation"),
      riskLevel: String(preview?.riskLevel || "RED"),
      routeNumber: String(messageData.routeNumber || preview?.routeNumber || ""),
      stopName: String(messageData.stopName || preview?.stopName || ""),
      targetReadiness: String(preview?.targetHealth?.deliveryReadiness || "ready"),
      mode: "simulate",
      request: null,
      status: safeOutcome === "success" ? "SENT" : "FAILED",
      reason: buildSimulationReason(safeOutcome, adapter),
      response: {
        statusCode,
        bodyExcerpt:
          safeOutcome === "success"
            ? "Simulated provider acceptance."
            : safeOutcome === "hard-failure"
              ? "Simulated hard provider rejection."
              : "Simulated transient provider outage.",
        simulated: true,
      },
    };
  };
}

export function pruneSimulationGatewayState(gatewayState = {}) {
  const attempts = Array.isArray(gatewayState?.attempts)
    ? gatewayState.attempts.filter((attempt) => !isSimulationDispatchKey(attempt?.dispatchKey))
    : [];
  const handledDispatchKeys = Array.isArray(gatewayState?.handledDispatchKeys)
    ? gatewayState.handledDispatchKeys.filter((dispatchKey) => !isSimulationDispatchKey(dispatchKey))
    : [];
  const retryQueue = Array.isArray(gatewayState?.retryQueue)
    ? gatewayState.retryQueue.filter((item) => !isSimulationDispatchKey(item?.dispatchKey))
    : [];

  return {
    ...gatewayState,
    attempts,
    handledDispatchKeys,
    retryQueue,
    lastAttemptAt: attempts[0]?.createdAt || null,
  };
}
