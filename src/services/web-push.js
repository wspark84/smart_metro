function base64UrlToUint8Array(value) {
  const normalized = String(value || "")
    .trim()
    .replaceAll("-", "+")
    .replaceAll("_", "/");
  if (!normalized) {
    throw new Error("The server did not provide a Web Push VAPID public key.");
  }
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = window.atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function assertBrowserPushSupport() {
  if (!window.isSecureContext) {
    throw new Error("Browser push requires HTTPS. Localhost is allowed only for local development.");
  }
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    throw new Error("This browser does not support service-worker Web Push.");
  }
}

export async function subscribeCurrentBrowserToPush() {
  assertBrowserPushSupport();
  const configResponse = await fetch("/api/push-gateway/config");
  const configPayload = await configResponse.json();
  if (!configResponse.ok) {
    throw new Error(configPayload.error || `Web Push config fetch failed (${configResponse.status}).`);
  }

  const adapter = configPayload.config?.adapters?.["web-push"] || {};
  if (!adapter.configured || !adapter.publicKey) {
    throw new Error("Web Push is not configured on the server. Set WEB_PUSH_VAPID_SUBJECT, PUBLIC_KEY, and PRIVATE_KEY first.");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notification permission was not granted in this browser.");
  }

  const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(adapter.publicKey),
    });
  }

  const serialized = subscription.toJSON();
  if (!serialized?.endpoint || !serialized?.keys?.p256dh || !serialized?.keys?.auth) {
    throw new Error("The browser returned an incomplete Web Push subscription.");
  }

  return {
    platform: "web",
    pushEnabled: true,
    pushToken: serialized.endpoint,
    webPushSubscription: serialized,
  };
}
