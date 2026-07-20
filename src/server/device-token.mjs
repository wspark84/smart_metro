import { sanitizeDeviceProfile } from "../device-profile.js";

function looksLikeFcmRegistrationToken(value) {
  const token = String(value || "").trim();
  return !/\s/.test(token) && /^[A-Za-z0-9:_-]+$/.test(token) && token.length >= 32;
}

export function resolvePushAdapter(platform, rawToken = "") {
  if (platform === "ios") {
    // FlutterFire provides an FCM registration token on iPhone. Routing that
    // through FCM lets Firebase perform the APNs handoff after APNs is linked
    // in the Firebase console. Hex tokens keep the direct APNs dry-run path.
    return looksLikeFcmRegistrationToken(rawToken) ? "fcm" : "apns";
  }
  if (platform === "web") {
    return "web-push";
  }
  return "fcm";
}

export function maskPushToken(token) {
  const safe = String(token || "").trim();
  if (!safe) {
    return "";
  }
  if (safe.length <= 12) {
    return `${safe.slice(0, 4)}...${safe.slice(-2)}`;
  }
  return `${safe.slice(0, 6)}...${safe.slice(-4)}`;
}

function parseJsonToken(rawToken) {
  try {
    return JSON.parse(String(rawToken || "").trim());
  } catch {
    return null;
  }
}

function analyzeAndroidToken(rawToken) {
  const token = String(rawToken || "").trim();
  if (!token) {
    return {
      tokenPresent: false,
      normalizedToken: "",
      tokenKind: "missing",
      formatStatus: "missing",
      reason: "No Android push token has been provided yet.",
      recommendedAction: "Paste the FCM registration token from a real Android device.",
    };
  }

  if (/\s/.test(token)) {
    return {
      tokenPresent: true,
      normalizedToken: token,
      tokenKind: "android-token",
      formatStatus: "invalid",
      reason: "Android push tokens must not contain whitespace.",
      recommendedAction: "Paste the FCM registration token again without spaces or line breaks.",
    };
  }

  if (!/^[A-Za-z0-9:_-]+$/.test(token) || token.length < 32) {
    return {
      tokenPresent: true,
      normalizedToken: token,
      tokenKind: "android-token",
      formatStatus: "invalid",
      reason: "This Android token does not match the normal FCM registration-token format.",
      recommendedAction: "Replace it with the exact FCM token returned by the mobile app.",
    };
  }

  return {
    tokenPresent: true,
    normalizedToken: token,
    tokenKind: token.includes(":") ? "fcm-registration-token" : "android-push-token",
    formatStatus: "valid",
    reason: "The Android token looks usable for FCM delivery.",
    recommendedAction: "You can now run push preview or push gateway checks.",
  };
}

function analyzeIosToken(rawToken) {
  const normalizedToken = String(rawToken || "").replace(/[<>\s]/g, "").trim();
  if (!normalizedToken) {
    return {
      tokenPresent: false,
      normalizedToken: "",
      tokenKind: "missing",
      formatStatus: "missing",
      reason: "No iOS device token has been provided yet.",
      recommendedAction: "Paste the APNs device token from the iOS app.",
    };
  }

  if (/^[a-fA-F0-9]+$/.test(normalizedToken) && normalizedToken.length >= 64 && normalizedToken.length % 2 === 0) {
    return {
      tokenPresent: true,
      normalizedToken: normalizedToken.toLowerCase(),
      tokenKind: "apns-device-token",
      formatStatus: "valid",
      reason: "The iOS APNs token looks usable for direct APNs handoff.",
      recommendedAction: "You can now run APNs dry-run planning from the push gateway.",
    };
  }

  if (looksLikeFcmRegistrationToken(normalizedToken)) {
    return {
      tokenPresent: true,
      normalizedToken,
      tokenKind: "fcm-registration-token",
      formatStatus: "valid",
      reason: "The iPhone FCM registration token looks usable for Firebase-to-APNs delivery.",
      recommendedAction: "You can now run FCM delivery after APNs is linked in the Firebase console.",
    };
  }

  {
    return {
      tokenPresent: true,
      normalizedToken,
      tokenKind: "ios-push-token",
      formatStatus: "invalid",
      reason: "An iPhone push token must be a long APNs hexadecimal token or an FCM registration token.",
      recommendedAction: "Use the FCM registration token automatically issued by the iPhone app, or replace it with a full APNs token.",
    };
  }
}

function analyzeWebToken(rawToken, webPushSubscription = null) {
  const storedSubscription =
    webPushSubscription && typeof webPushSubscription === "object" && /^https:\/\/.+/i.test(String(webPushSubscription.endpoint || ""))
      ? webPushSubscription
      : null;
  if (storedSubscription) {
    const hasKeys = Boolean(storedSubscription.keys?.p256dh && storedSubscription.keys?.auth);
    return {
      tokenPresent: true,
      normalizedToken: String(storedSubscription.endpoint).trim(),
      tokenKind: hasKeys ? "web-push-subscription" : "web-push-endpoint",
      formatStatus: hasKeys ? "valid" : "warning",
      reason: hasKeys
        ? "A complete Web Push subscription is stored and ready for VAPID delivery."
        : "The web endpoint is stored but its encryption keys are missing.",
      recommendedAction: hasKeys
        ? "You can now run Web Push delivery after VAPID credentials are configured."
        : "Subscribe again in the browser so the encryption keys can be saved.",
    };
  }
  const trimmed = String(rawToken || "").trim();
  if (!trimmed) {
    return {
      tokenPresent: false,
      normalizedToken: "",
      tokenKind: "missing",
      formatStatus: "missing",
      reason: "No web push subscription or endpoint has been provided yet.",
      recommendedAction: "Paste a Web Push subscription JSON object or endpoint URL.",
    };
  }

  const parsed = parseJsonToken(trimmed);
  if (parsed && typeof parsed === "object" && typeof parsed.endpoint === "string" && parsed.endpoint.trim()) {
    return {
      tokenPresent: true,
      normalizedToken: parsed.endpoint.trim(),
      tokenKind: "web-push-subscription-json",
      formatStatus: "warning",
      reason: "The subscription JSON was reduced to its endpoint because this prototype still stores a generic token only.",
      recommendedAction: "For full Web Push delivery later, store the complete subscription object with keys.",
    };
  }

  if (/^https:\/\/.+/i.test(trimmed)) {
    return {
      tokenPresent: true,
      normalizedToken: trimmed,
      tokenKind: "web-push-endpoint",
      formatStatus: "warning",
      reason: "The endpoint is usable for preview, but a full Web Push subscription is still needed for production delivery.",
      recommendedAction: "Keep the endpoint for preview and add a full subscription object in a later phase.",
    };
  }

  if (/\s/.test(trimmed) || trimmed.length < 16) {
    return {
      tokenPresent: true,
      normalizedToken: trimmed,
      tokenKind: "web-push-token",
      formatStatus: "invalid",
      reason: "This web token is too short or contains spaces.",
      recommendedAction: "Paste a full endpoint URL or subscription JSON from the browser.",
    };
  }

  return {
    tokenPresent: true,
    normalizedToken: trimmed,
    tokenKind: "web-push-token",
    formatStatus: "warning",
    reason: "The prototype can preview this token, but production Web Push still needs a full subscription object.",
    recommendedAction: "Use this for preview only and plan to store endpoint plus keys later.",
  };
}

function analyzeTokenByPlatform(platform, rawToken, webPushSubscription = null) {
  if (platform === "ios") {
    return analyzeIosToken(rawToken);
  }
  if (platform === "web") {
    return analyzeWebToken(rawToken, webPushSubscription);
  }
  return analyzeAndroidToken(rawToken);
}

export function analyzeDevicePushTarget(deviceProfile) {
  const profile = sanitizeDeviceProfile(deviceProfile);
  const tokenAnalysis = analyzeTokenByPlatform(profile.platform, profile.pushToken, profile.webPushSubscription);
  const adapter = resolvePushAdapter(profile.platform, tokenAnalysis.normalizedToken);

  let deliveryReadiness = "ready";
  let reason = tokenAnalysis.reason;
  let recommendedAction = tokenAnalysis.recommendedAction;

  if (!profile.pushEnabled) {
    deliveryReadiness = "disabled";
    reason = "Push delivery is disabled on this device profile.";
    recommendedAction = "Turn on Push Delivery after you finish registering the device token.";
  } else if (!tokenAnalysis.tokenPresent) {
    deliveryReadiness = "blocked";
    reason = "Push delivery is enabled but no device token is registered yet.";
    recommendedAction = tokenAnalysis.recommendedAction;
  } else if (tokenAnalysis.formatStatus === "invalid") {
    deliveryReadiness = "blocked";
    reason = tokenAnalysis.reason;
    recommendedAction = tokenAnalysis.recommendedAction;
  } else if (tokenAnalysis.formatStatus === "warning") {
    deliveryReadiness = "warning";
  }

  if (profile.pushTokenInvalidatedAt) {
    deliveryReadiness = "blocked";
    reason = profile.pushTokenInvalidationReason || "FCM marked this device token as no longer registered.";
    recommendedAction = "Open BusWakeUp on this phone and register its current FCM token again.";
  }

  return {
    adapter,
    platform: profile.platform,
    pushEnabled: profile.pushEnabled,
    tokenPresent: tokenAnalysis.tokenPresent,
    normalizedToken: tokenAnalysis.normalizedToken,
    tokenMasked: maskPushToken(tokenAnalysis.normalizedToken),
    tokenKind: tokenAnalysis.tokenKind,
    formatStatus: tokenAnalysis.formatStatus,
    deliveryReadiness,
    tokenInvalidatedAt: profile.pushTokenInvalidatedAt,
    tokenInvalidationCode: profile.pushTokenInvalidationCode,
    reason,
    recommendedAction,
  };
}

export function markDevicePushTokenInvalidated(deviceProfile, details = {}, now = new Date()) {
  const currentNow = now instanceof Date ? now : new Date(now);
  const profile = sanitizeDeviceProfile(deviceProfile);
  if (!profile.pushToken) {
    return profile;
  }

  return sanitizeDeviceProfile({
    ...profile,
    pushTokenInvalidatedAt: currentNow.toISOString(),
    pushTokenInvalidationCode: String(details?.code || "UNREGISTERED").trim() || "UNREGISTERED",
    pushTokenInvalidationReason:
      String(details?.reason || "").trim() ||
      "FCM marked this device token as no longer registered. Register the current token again on this phone.",
    updatedAt: currentNow.toISOString(),
  });
}

export function registerDevicePushToken(deviceProfile, patch = {}, now = new Date()) {
  const currentNow = now instanceof Date ? now : new Date(now);
  const previousProfile = sanitizeDeviceProfile(deviceProfile);
  const patchHasPushToken = Object.prototype.hasOwnProperty.call(patch || {}, "pushToken");
  const nextProfile = sanitizeDeviceProfile({
    ...previousProfile,
    ...(patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {}),
    updatedAt: currentNow.toISOString(),
  });

  const previousInvalidation = {
    pushTokenInvalidatedAt: nextProfile.pushTokenInvalidatedAt,
    pushTokenInvalidationCode: nextProfile.pushTokenInvalidationCode,
    pushTokenInvalidationReason: nextProfile.pushTokenInvalidationReason,
  };
  if (patchHasPushToken) {
    nextProfile.pushTokenInvalidatedAt = null;
    nextProfile.pushTokenInvalidationCode = "";
    nextProfile.pushTokenInvalidationReason = "";
  }
  const initialHealth = analyzeDevicePushTarget(nextProfile);

  if (patchHasPushToken && (!initialHealth.tokenPresent || initialHealth.formatStatus === "invalid")) {
    nextProfile.pushTokenInvalidatedAt = previousInvalidation.pushTokenInvalidatedAt;
    nextProfile.pushTokenInvalidationCode = previousInvalidation.pushTokenInvalidationCode;
    nextProfile.pushTokenInvalidationReason = previousInvalidation.pushTokenInvalidationReason;
  }

  nextProfile.pushToken = initialHealth.normalizedToken;
  if (Object.prototype.hasOwnProperty.call(patch || {}, "pushEnabled")) {
    nextProfile.pushEnabled = Boolean(patch.pushEnabled);
  }

  const tokenChanged = initialHealth.normalizedToken !== previousProfile.pushToken;
  if (initialHealth.tokenPresent && (!nextProfile.registeredAt || tokenChanged)) {
    nextProfile.registeredAt = currentNow.toISOString();
  }

  const health = analyzeDevicePushTarget(nextProfile);
  return {
    profile: nextProfile,
    health,
  };
}
