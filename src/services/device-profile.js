export async function loadDeviceProfile() {
  const response = await fetch("/api/device-profile");
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `Device profile load failed (${response.status}).`);
  }

  return payload;
}

export async function saveDeviceProfile(profile) {
  const response = await fetch("/api/device-profile", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(profile),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `Device profile save failed (${response.status}).`);
  }

  return payload;
}

export async function fetchDeviceTokenHealth() {
  const response = await fetch("/api/device-profile/token-health");
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `Device token health fetch failed (${response.status}).`);
  }

  return payload;
}

export async function registerDevicePushToken(profile) {
  const response = await fetch("/api/device-profile/register-token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(profile),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `Device token register failed (${response.status}).`);
  }

  return payload;
}

export async function fetchDispatchQueue(limit = 4) {
  const response = await fetch(`/api/dispatch-queue?limit=${encodeURIComponent(limit)}`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `Dispatch queue fetch failed (${response.status}).`);
  }

  return payload;
}

export async function fetchDispatchExecutions(limit = 4) {
  const response = await fetch(`/api/dispatch-executions?limit=${encodeURIComponent(limit)}`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `Dispatch execution fetch failed (${response.status}).`);
  }

  return payload;
}

export async function fetchPushPreview() {
  const response = await fetch("/api/push-preview");
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `Push preview fetch failed (${response.status}).`);
  }

  return payload;
}

export async function fetchPushGatewayConfig() {
  const response = await fetch("/api/push-gateway/config");
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `Push gateway config fetch failed (${response.status}).`);
  }

  return payload;
}

export async function fetchFcmAuthStatus() {
  const response = await fetch("/api/fcm-auth/status");
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `FCM auth status fetch failed (${response.status}).`);
  }

  return payload;
}

export async function fetchPushGatewayAttempts(limit = 4) {
  const response = await fetch(`/api/push-gateway/attempts?limit=${encodeURIComponent(limit)}`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `Push gateway attempts fetch failed (${response.status}).`);
  }

  return payload;
}

export async function runPushGatewayDispatch(dispatchKey = "") {
  const response = await fetch("/api/push-gateway/dispatch", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ dispatchKey }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `Push gateway dispatch failed (${response.status}).`);
  }

  return payload;
}

export async function runPushGatewayTestDispatch(payload = {}) {
  const response = await fetch("/api/push-gateway/test-dispatch", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || `Push gateway test dispatch failed (${response.status}).`);
  }

  return result;
}

export async function runPushGatewayRetrySimulation(payload = {}) {
  const response = await fetch("/api/push-gateway/retry-simulation", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || `Push gateway retry simulation failed (${response.status}).`);
  }

  return result;
}
