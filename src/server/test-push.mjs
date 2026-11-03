import { sanitizeDeviceProfile } from "../device-profile.js";
import { analyzeDevicePushTarget, resolvePushAdapter } from "./device-token.mjs";

function buildPlatformHints(profile, riskLevel = "RED") {
  if (profile.platform === "ios") {
    return {
      interruptionLevel: riskLevel === "RED" ? "time-sensitive" : "active",
      categoryId: "COMMUTE_TEST",
    };
  }

  if (profile.platform === "web") {
    return {
      requireInteraction: riskLevel === "RED",
      renotify: true,
    };
  }

  return {
    channelId: riskLevel === "RED" ? "buswakeup-critical" : "buswakeup-morning",
    priority: riskLevel === "RED" ? "max" : "high",
  };
}

function buildTestNotificationPayload({
  routeNumber = "1002",
  stopName = "Registered stop",
  riskLevel = "RED",
  title = "",
  body = "",
  spokenText = "",
}) {
  const safeRisk = String(riskLevel || "RED").toUpperCase();
  const resolvedTitle = title || "[시험] 이노치 알람 점검";
  const resolvedBody =
    body ||
    (safeRisk === "RED"
      ? "알람 소리와 음성 안내가 들리면 정상이에요."
      : "알람 소리와 음성 안내가 들리면 정상이에요.");
  const resolvedSpeech =
    spokenText ||
    (safeRisk === "RED"
      ? "시험 알람입니다. 출발 시각이 되면 이렇게 남은 시간을 읽어 드려요."
      : "시험 알람입니다. 출발 시각이 되면 이렇게 남은 시간을 읽어 드려요.");

  return {
    riskLevel: safeRisk,
    title: resolvedTitle,
    body: resolvedBody,
    spokenText: resolvedSpeech,
    routeNumber: String(routeNumber || "1002"),
    stopName: String(stopName || "Registered stop"),
  };
}

export function buildTestPushPreview(deviceProfile, options = {}, now = new Date()) {
  const currentNow = now instanceof Date ? now : new Date(now);
  const profile = sanitizeDeviceProfile(deviceProfile);
  const targetHealth = analyzeDevicePushTarget(profile);
  const adapter = targetHealth.adapter || resolvePushAdapter(profile.platform, targetHealth.normalizedToken);
  const notification = buildTestNotificationPayload(options);
  const dispatchKey = `test:${currentNow.toISOString()}`;

  const previewBase = {
    adapter,
    target: {
      deviceId: profile.deviceId,
      deviceName: profile.deviceName,
      platform: profile.platform,
      tokenMasked: targetHealth.tokenMasked,
      tokenKind: targetHealth.tokenKind,
      deliveryReadiness: targetHealth.deliveryReadiness,
    },
    targetHealth,
    generatedAt: currentNow.toISOString(),
    title: notification.title,
    dispatchKey,
    routeNumber: notification.routeNumber,
    stopName: notification.stopName,
    stage: 0,
    escalationLabel: "Test",
    riskLevel: notification.riskLevel,
  };

  if (!profile.pushEnabled) {
    return {
      ...previewBase,
      status: "blocked",
      reason: "Push delivery is disabled on this device profile.",
      envelope: null,
    };
  }

  if (!targetHealth.tokenPresent || targetHealth.deliveryReadiness === "blocked") {
    return {
      ...previewBase,
      status: "blocked",
      reason: targetHealth.reason,
      envelope: null,
    };
  }

  return {
    ...previewBase,
    status: "ready",
    reason:
      targetHealth.deliveryReadiness === "warning"
        ? targetHealth.reason
        : "A manual test push envelope is ready for provider handoff.",
    envelope: {
      adapter,
      targetToken: targetHealth.normalizedToken,
      message: {
        title: notification.title,
        body: notification.body,
        data: {
          dispatchKey,
          alertTriggerKey: dispatchKey,
          routeNumber: notification.routeNumber,
          stopName: notification.stopName,
          riskLevel: notification.riskLevel,
          stage: "0",
          escalationLabel: "Test",
          testMessage: "true",
        },
        sound: {
          presetId: "mechanical",
          volumePercent: notification.riskLevel === "RED" ? 100 : 70,
          mechanicalTone: true,
        },
        interruption: {
          fullScreen: notification.riskLevel === "RED",
          criticalBypass: Boolean(profile.dndOverrideGranted && notification.riskLevel === "RED"),
          vibrationPattern: notification.riskLevel === "RED" ? [1000, 200] : [300, 200, 300],
          vibrationRepeats: notification.riskLevel === "RED" ? 3 : 1,
        },
        speech: {
          text: notification.spokenText,
          volume: 1,
          rate: 0.95,
        },
      },
      platformHints: buildPlatformHints(profile, notification.riskLevel),
    },
  };
}
