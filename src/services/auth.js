async function parsePayload(response, fallbackMessage) {
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || fallbackMessage);
  }

  return payload;
}

async function requestAuthJson(path, options, fallbackMessage) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(path, { ...options, signal: controller.signal });
    return await parsePayload(response, fallbackMessage);
  } catch (error) {
    if (controller.signal.aborted) throw new Error("로그인 연결이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchAuthSession() {
  return requestAuthJson("/api/auth/session", {}, "로그인 상태를 확인하지 못했습니다.");
}

export async function fetchAuthProviders() {
  return requestAuthJson("/api/auth/providers", {}, "로그인 제공처를 확인하지 못했습니다.");
}

export async function registerAuth(payload) {
  const response = await fetch("/api/auth/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });

  return parsePayload(response, `회원 가입 실패 (응답 코드 ${response.status}).`);
}

export async function loginAuth(payload) {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });

  return parsePayload(response, `로그인 실패 (응답 코드 ${response.status}).`);
}

export async function logoutAuth() {
  const response = await fetch("/api/auth/logout", {
    method: "POST",
  });

  return parsePayload(response, `로그아웃 실패 (응답 코드 ${response.status}).`);
}

export async function requestPasswordReset(payload) {
  const response = await fetch("/api/auth/password-reset/request", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });

  return parsePayload(response, `비밀번호 재설정 요청 실패 (응답 코드 ${response.status}).`);
}

export async function confirmPasswordReset(payload) {
  const response = await fetch("/api/auth/password-reset/confirm", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });

  return parsePayload(response, `비밀번호 재설정 실패 (응답 코드 ${response.status}).`);
}

export async function startSocialAuth(payload) {
  return requestAuthJson("/api/auth/oauth/start", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  }, "소셜 로그인에 연결하지 못했습니다.");
}

export async function fetchAccountSummary() {
  const response = await fetch("/api/account");
  return parsePayload(response, `계정 정보 조회 실패 (응답 코드 ${response.status}).`);
}

export async function updateAccountProfile(payload) {
  const response = await fetch("/api/account/profile", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });

  return parsePayload(response, `프로필 저장 실패 (응답 코드 ${response.status}).`);
}

export async function updateAccountPassword(payload) {
  const response = await fetch("/api/account/password", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });

  return parsePayload(response, `비밀번호 변경 실패 (응답 코드 ${response.status}).`);
}

export async function resendAccountEmailVerification() {
  const response = await fetch("/api/account/email-verification", {
    method: "POST",
  });

  return parsePayload(response, `이메일 인증 요청 실패 (응답 코드 ${response.status}).`);
}
