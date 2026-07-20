import { sanitizeDeviceProfile } from "../device-profile.js";
import { analyzeDevicePushTarget, resolvePushAdapter } from "./device-token.mjs";

function buildPlatformHints(bundle, profile) {
  const notificationSpec = bundle?.notificationSpec || {};
  const deliveryPriorityClass = String(bundle?.deliveryPriorityClass || "normal").trim().toLowerCase();
  if (profile.platform === "ios") {
    return {
      interruptionLevel: notificationSpec.criticalBypass
        ? "critical"
        : deliveryPriorityClass === "boosted"
          ? "time-sensitive"
        : notificationSpec.fullScreen
          ? "time-sensitive"
          : "active",
      categoryId: "COMMUTE_ALARM",
    };
  }

  if (profile.platform === "web") {
    return {
      requireInteraction: Boolean(notificationSpec.fullScreen || bundle?.riskLevel === "RED"),
      renotify: Boolean(bundle?.stage),
    };
  }

  return {
    channelId:
      notificationSpec.fullScreen || bundle?.riskLevel === "RED" || deliveryPriorityClass === "boosted"
        ? "buswakeup-critical"
        : "buswakeup-morning",
    priority: notificationSpec.fullScreen || deliveryPriorityClass === "boosted" ? "max" : "high",
  };
}

function buildEnvelope(bundle, profile) {
  const notificationSpec = bundle?.notificationSpec || {};
  return {
    adapter: resolvePushAdapter(profile.platform, profile.pushToken),
    targetToken: profile.pushToken,
    message: {
      title: String(notificationSpec.title || bundle?.title || "Commute alarm"),
      body: String(notificationSpec.body || ""),
        data: {
          dispatchKey: String(bundle?.dispatchKey || ""),
          alertTriggerKey: String(bundle?.alertTriggerKey || ""),
          routeNumber: String(bundle?.routeNumber || ""),
          stopName: String(bundle?.stopName || ""),
          riskLevel: String(bundle?.riskLevel || ""),
          stage: String(bundle?.stage ?? 0),
          escalationLabel: String(bundle?.escalationLabel || ""),
          liveEtaGuardMode: String(bundle?.liveEtaGuardMode || ""),
          deliveryPriorityClass: String(bundle?.deliveryPriorityClass || "normal"),
          deliveryPriorityReason: String(bundle?.deliveryPriorityReason || ""),
          accuracyRiskBufferMin: String(bundle?.accuracyRiskBufferMin ?? 0),
          accuracySpreadMin:
            bundle?.accuracySpreadMin === null || bundle?.accuracySpreadMin === undefined
              ? ""
              : String(bundle.accuracySpreadMin),
          mechanicalLoopBoost: String(notificationSpec.mechanicalLoopBoost ?? 0),
          speechRepeatCount: String(notificationSpec.speechRepeatCount ?? 1),
        },
      sound: {
        presetId: String(notificationSpec.soundPresetId || "default"),
        volumePercent: Number(notificationSpec.volumePercent || 0),
        mechanicalTone: Boolean(notificationSpec.useMechanicalTone),
        loopBoost: Number(notificationSpec.mechanicalLoopBoost || 0),
      },
      interruption: {
        fullScreen: Boolean(notificationSpec.fullScreen),
        criticalBypass: Boolean(notificationSpec.criticalBypass),
        vibrationPattern: Array.isArray(notificationSpec.vibrationPattern) ? [...notificationSpec.vibrationPattern] : [],
        vibrationRepeats: Number(notificationSpec.vibrationRepeats || 0),
      },
      speech: {
        text: String(notificationSpec.spokenText || ""),
        volume: Number(notificationSpec.speechVolume || 0),
        rate: Number(notificationSpec.speechRate || 1),
        repeatCount: Number(notificationSpec.speechRepeatCount || 1),
      },
    },
    platformHints: buildPlatformHints(bundle, profile),
  };
}

export function buildPushPreview(bundle, deviceProfile, now = new Date()) {
  const currentNow = now instanceof Date ? now : new Date(now);
  const profile = sanitizeDeviceProfile(deviceProfile);
  const targetHealth = analyzeDevicePushTarget(profile);
  const normalizedProfile = {
    ...profile,
    pushToken: targetHealth.normalizedToken,
  };
  const adapter = targetHealth.adapter || resolvePushAdapter(profile.platform, targetHealth.normalizedToken);
  const target = {
    deviceId: profile.deviceId,
    deviceName: profile.deviceName,
    platform: profile.platform,
    tokenMasked: targetHealth.tokenMasked,
    tokenKind: targetHealth.tokenKind,
    deliveryReadiness: targetHealth.deliveryReadiness,
  };

  if (!bundle) {
    return {
      status: "idle",
      reason: "No dispatch bundle is queued right now.",
      adapter,
      target,
      targetHealth,
      generatedAt: currentNow.toISOString(),
      envelope: null,
      title: "",
      dispatchKey: "",
      routeNumber: "",
      stopName: "",
      riskLevel: "",
    };
  }

  if (!profile.pushEnabled) {
    return {
      status: "blocked",
      reason: "Push delivery is disabled on this device profile.",
      adapter,
      target,
      targetHealth,
      generatedAt: currentNow.toISOString(),
      envelope: null,
      title: String(bundle.title || "Commute alarm"),
      dispatchKey: String(bundle.dispatchKey || ""),
      routeNumber: String(bundle.routeNumber || ""),
      stopName: String(bundle.stopName || ""),
      riskLevel: String(bundle.riskLevel || ""),
      stage: Number(bundle.stage ?? 0),
      escalationLabel: String(bundle.escalationLabel || ""),
    };
  }

  if (!targetHealth.tokenPresent) {
    return {
      status: "blocked",
      reason: targetHealth.reason,
      adapter,
      target,
      targetHealth,
      generatedAt: currentNow.toISOString(),
      envelope: null,
      title: String(bundle.title || "Commute alarm"),
      dispatchKey: String(bundle.dispatchKey || ""),
      routeNumber: String(bundle.routeNumber || ""),
      stopName: String(bundle.stopName || ""),
      riskLevel: String(bundle.riskLevel || ""),
      stage: Number(bundle.stage ?? 0),
      escalationLabel: String(bundle.escalationLabel || ""),
    };
  }

  if (targetHealth.deliveryReadiness === "blocked") {
    return {
      status: "blocked",
      reason: targetHealth.reason,
      adapter,
      target,
      targetHealth,
      generatedAt: currentNow.toISOString(),
      envelope: null,
      title: String(bundle.title || "Commute alarm"),
      dispatchKey: String(bundle.dispatchKey || ""),
      routeNumber: String(bundle.routeNumber || ""),
      stopName: String(bundle.stopName || ""),
      riskLevel: String(bundle.riskLevel || ""),
      stage: Number(bundle.stage ?? 0),
      escalationLabel: String(bundle.escalationLabel || ""),
    };
  }

  return {
    status: "ready",
    reason:
      targetHealth.deliveryReadiness === "warning"
        ? targetHealth.reason
        : "A provider-specific adapter envelope is ready for the next push integration step.",
    adapter,
    target,
    targetHealth,
    generatedAt: currentNow.toISOString(),
    envelope: buildEnvelope(bundle, normalizedProfile),
    title: String(bundle.title || "Commute alarm"),
    dispatchKey: String(bundle.dispatchKey || ""),
    routeNumber: String(bundle.routeNumber || ""),
    stopName: String(bundle.stopName || ""),
    stage: Number(bundle.stage ?? 0),
    escalationLabel: String(bundle.escalationLabel || ""),
    riskLevel: String(bundle.riskLevel || ""),
    liveEtaGuardMode: String(bundle.liveEtaGuardMode || ""),
    deliveryPriorityClass: String(bundle.deliveryPriorityClass || "normal"),
    deliveryPriorityReason: String(bundle.deliveryPriorityReason || ""),
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
    accuracyRiskBufferMin: Number.isFinite(Number(bundle.accuracyRiskBufferMin))
      ? Math.max(0, Number(bundle.accuracyRiskBufferMin))
      : 0,
    accuracySpreadMin: Number.isFinite(Number(bundle.accuracySpreadMin)) ? Number(bundle.accuracySpreadMin) : null,
  };
}
