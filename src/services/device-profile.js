export async function loadDeviceProfile() {
  const response = await fetch("/api/device-profile");
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `기기 설정 조회 실패 (응답 코드 ${response.status}).`);
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
    throw new Error(payload.error || `기기 설정 저장 실패 (응답 코드 ${response.status}).`);
  }

  return payload;
}

export async function fetchDeviceTokenHealth() {
  const response = await fetch("/api/device-profile/token-health");
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `기기 토큰 상태 조회 실패 (응답 코드 ${response.status}).`);
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
    throw new Error(payload.error || `기기 토큰 등록 실패 (응답 코드 ${response.status}).`);
  }

  return payload;
}

export async function fetchDispatchQueue(limit = 4) {
  const response = await fetch(`/api/dispatch-queue?limit=${encodeURIComponent(limit)}`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `알림 대기열 조회 실패 (응답 코드 ${response.status}).`);
  }

  return payload;
}

export async function fetchDispatchExecutions(limit = 4) {
  const response = await fetch(`/api/dispatch-executions?limit=${encodeURIComponent(limit)}`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `알림 처리 결과 조회 실패 (응답 코드 ${response.status}).`);
  }

  return payload;
}

export async function fetchPushPreview() {
  const response = await fetch("/api/push-preview");
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `푸시 요청 미리보기 실패 (응답 코드 ${response.status}).`);
  }

  return payload;
}

export async function fetchPushGatewayConfig() {
  const response = await fetch("/api/push-gateway/config");
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `푸시 설정 조회 실패 (응답 코드 ${response.status}).`);
  }

  return payload;
}

export async function fetchFcmAuthStatus() {
  const response = await fetch("/api/fcm-auth/status");
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `구글 푸시 인증 상태 조회 실패 (응답 코드 ${response.status}).`);
  }

  return payload;
}

export async function fetchPushGatewayAttempts(limit = 4) {
  const response = await fetch(`/api/push-gateway/attempts?limit=${encodeURIComponent(limit)}`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `푸시 전송 기록 조회 실패 (응답 코드 ${response.status}).`);
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
    throw new Error(payload.error || `푸시 알림 전송 실패 (응답 코드 ${response.status}).`);
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
    throw new Error(result.error || `시험 푸시 전송 실패 (응답 코드 ${response.status}).`);
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
    throw new Error(result.error || `푸시 재시도 시험 실패 (응답 코드 ${response.status}).`);
  }

  return result;
}
