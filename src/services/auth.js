async function parsePayload(response, fallbackMessage) {
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || fallbackMessage);
  }

  return payload;
}

export async function fetchAuthSession() {
  const response = await fetch("/api/auth/session");
  return parsePayload(response, `로그인 상태 확인 실패 (응답 코드 ${response.status}).`);
}

export async function fetchAuthProviders() {
  const response = await fetch("/api/auth/providers");
  return parsePayload(response, `로그인 제공처 조회 실패 (응답 코드 ${response.status}).`);
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
  const response = await fetch("/api/auth/oauth/start", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });

  return parsePayload(response, `소셜 로그인 연결 실패 (응답 코드 ${response.status}).`);
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
