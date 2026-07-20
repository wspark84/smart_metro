async function parsePayload(response, fallbackMessage) {
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || fallbackMessage);
  }

  return payload;
}

export async function fetchAuthSession() {
  const response = await fetch("/api/auth/session");
  return parsePayload(response, `Auth session fetch failed (${response.status}).`);
}

export async function fetchAuthProviders() {
  const response = await fetch("/api/auth/providers");
  return parsePayload(response, `Auth providers fetch failed (${response.status}).`);
}

export async function registerAuth(payload) {
  const response = await fetch("/api/auth/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });

  return parsePayload(response, `Auth register failed (${response.status}).`);
}

export async function loginAuth(payload) {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });

  return parsePayload(response, `Auth login failed (${response.status}).`);
}

export async function logoutAuth() {
  const response = await fetch("/api/auth/logout", {
    method: "POST",
  });

  return parsePayload(response, `Auth logout failed (${response.status}).`);
}

export async function requestPasswordReset(payload) {
  const response = await fetch("/api/auth/password-reset/request", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });

  return parsePayload(response, `Password reset request failed (${response.status}).`);
}

export async function confirmPasswordReset(payload) {
  const response = await fetch("/api/auth/password-reset/confirm", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });

  return parsePayload(response, `Password reset failed (${response.status}).`);
}

export async function startSocialAuth(payload) {
  const response = await fetch("/api/auth/oauth/start", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });

  return parsePayload(response, `Social auth start failed (${response.status}).`);
}

export async function fetchAccountSummary() {
  const response = await fetch("/api/account");
  return parsePayload(response, `Account summary fetch failed (${response.status}).`);
}

export async function updateAccountProfile(payload) {
  const response = await fetch("/api/account/profile", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });

  return parsePayload(response, `Account profile update failed (${response.status}).`);
}

export async function updateAccountPassword(payload) {
  const response = await fetch("/api/account/password", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });

  return parsePayload(response, `Account password update failed (${response.status}).`);
}

export async function resendAccountEmailVerification() {
  const response = await fetch("/api/account/email-verification", {
    method: "POST",
  });

  return parsePayload(response, `Email verification request failed (${response.status}).`);
}
