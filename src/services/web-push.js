function base64UrlToUint8Array(value) {
  const normalized = String(value || "")
    .trim()
    .replaceAll("-", "+")
    .replaceAll("_", "/");
  if (!normalized) {
    throw new Error("서버에 웹 푸시 공개 키가 설정되지 않았습니다.");
  }
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = window.atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function assertBrowserPushSupport() {
  if (!window.isSecureContext) {
    throw new Error("브라우저 푸시 알림은 보안 연결(HTTPS)에서만 사용할 수 있습니다.");
  }
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    throw new Error("이 브라우저는 웹 푸시 알림을 지원하지 않습니다.");
  }
}

export async function subscribeCurrentBrowserToPush() {
  assertBrowserPushSupport();
  const configResponse = await fetch("/api/push-gateway/config");
  const configPayload = await configResponse.json();
  if (!configResponse.ok) {
    throw new Error(configPayload.error || `웹 푸시 설정 조회 실패 (응답 코드 ${configResponse.status}).`);
  }

  const adapter = configPayload.config?.adapters?.["web-push"] || {};
  if (!adapter.configured || !adapter.publicKey) {
    throw new Error("서버의 웹 푸시 인증 설정이 필요합니다. 운영자에게 문의해 주세요.");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("브라우저 알림 권한이 허용되지 않았습니다. 사이트 알림 설정을 확인해 주세요.");
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
    throw new Error("브라우저 알림 구독 정보가 올바르지 않습니다. 다시 등록해 주세요.");
  }

  return {
    platform: "web",
    pushEnabled: true,
    pushToken: serialized.endpoint,
    webPushSubscription: serialized,
  };
}
