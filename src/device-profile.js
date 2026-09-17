export const DEFAULT_DEVICE_PROFILE = {
  deviceId: "primary-device",
  deviceName: "기본 휴대폰",
  platform: "android",
  pushEnabled: false,
  pushToken: "",
  webPushSubscription: null,
  fullScreenEnabled: false,
  dndOverrideGranted: false,
  batteryOptimizationIgnored: false,
  localBackupEnabled: true,
  soundEnabled: true,
  vibrationEnabled: true,
  ttsEnabled: true,
  pushTokenInvalidatedAt: null,
  pushTokenInvalidationCode: "",
  pushTokenInvalidationReason: "",
  registeredAt: null,
  updatedAt: null,
};

const PLATFORM_OPTIONS = new Set(["android", "ios", "web"]);

function normalizeWebPushKey(value) {
  const key = String(value || "").trim();
  return /^[A-Za-z0-9_-]{8,}$/.test(key) ? key : "";
}

export function sanitizeWebPushSubscription(subscription) {
  const candidate = subscription && typeof subscription === "object" && !Array.isArray(subscription) ? subscription : null;
  const endpoint = String(candidate?.endpoint || "").trim();
  if (!/^https:\/\/.+/i.test(endpoint)) {
    return null;
  }

  const p256dh = normalizeWebPushKey(candidate?.keys?.p256dh);
  const auth = normalizeWebPushKey(candidate?.keys?.auth);
  return {
    endpoint,
    expirationTime: Number.isFinite(Number(candidate?.expirationTime)) ? Number(candidate.expirationTime) : null,
    keys: {
      p256dh,
      auth,
    },
  };
}

export function sanitizeDeviceProfile(profile) {
  const incoming = profile && typeof profile === "object" && !Array.isArray(profile) ? profile : {};
  const safe = {
    ...DEFAULT_DEVICE_PROFILE,
    ...incoming,
  };

  safe.deviceId = String(safe.deviceId || DEFAULT_DEVICE_PROFILE.deviceId).trim() || DEFAULT_DEVICE_PROFILE.deviceId;
  safe.deviceName = String(safe.deviceName || DEFAULT_DEVICE_PROFILE.deviceName).trim() || DEFAULT_DEVICE_PROFILE.deviceName;
  safe.platform = PLATFORM_OPTIONS.has(String(safe.platform || "").trim()) ? String(safe.platform).trim() : "android";
  safe.pushEnabled = Boolean(safe.pushEnabled);
  safe.pushToken = String(safe.pushToken || "").trim();
  safe.webPushSubscription = sanitizeWebPushSubscription(safe.webPushSubscription);
  safe.fullScreenEnabled = Boolean(safe.fullScreenEnabled);
  safe.dndOverrideGranted = Boolean(safe.dndOverrideGranted);
  safe.batteryOptimizationIgnored = Boolean(safe.batteryOptimizationIgnored);
  safe.localBackupEnabled = Boolean(safe.localBackupEnabled);
  safe.soundEnabled = Boolean(safe.soundEnabled);
  safe.vibrationEnabled = Boolean(safe.vibrationEnabled);
  safe.ttsEnabled = Boolean(safe.ttsEnabled);
  safe.pushTokenInvalidatedAt = safe.pushTokenInvalidatedAt ? String(safe.pushTokenInvalidatedAt) : null;
  safe.pushTokenInvalidationCode = String(safe.pushTokenInvalidationCode || "").trim();
  safe.pushTokenInvalidationReason = String(safe.pushTokenInvalidationReason || "").trim();
  safe.registeredAt = safe.registeredAt ? String(safe.registeredAt) : null;
  safe.updatedAt = safe.updatedAt ? String(safe.updatedAt) : null;

  return safe;
}
