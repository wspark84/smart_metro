import { createSign, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fetchWithTimeout } from "./upstream-fetch.mjs";

export const FCM_MESSAGING_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
export const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

const tokenCache = {
  fingerprint: "",
  accessToken: "",
  expiresAtMs: 0,
};

function base64UrlEncode(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function normalizePrivateKey(value) {
  return String(value || "").replace(/\\n/g, "\n").trim();
}

function parseServiceAccountJson(rawJson) {
  try {
    const parsed = JSON.parse(String(rawJson || ""));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

function getInlineServiceAccount(env) {
  const jsonPayload = parseServiceAccountJson(env.FCM_SERVICE_ACCOUNT_JSON);
  if (jsonPayload) {
    return {
      clientEmail: String(jsonPayload.client_email || "").trim(),
      privateKey: normalizePrivateKey(jsonPayload.private_key),
      privateKeyId: String(jsonPayload.private_key_id || "").trim(),
      projectId: String(jsonPayload.project_id || "").trim(),
    };
  }

  return {
    clientEmail: String(env.FCM_SERVICE_ACCOUNT_EMAIL || "").trim(),
    privateKey: normalizePrivateKey(env.FCM_SERVICE_ACCOUNT_PRIVATE_KEY),
    privateKeyId: String(env.FCM_SERVICE_ACCOUNT_PRIVATE_KEY_ID || "").trim(),
    projectId: String(env.FCM_SERVICE_ACCOUNT_PROJECT_ID || env.FCM_PROJECT_ID || "").trim(),
  };
}

async function getFileServiceAccount(env, fileReader = readFile) {
  const filePath = String(env.FCM_SERVICE_ACCOUNT_FILE || "").trim();
  if (!filePath) {
    return null;
  }

  const rawJson = await fileReader(filePath, "utf8");
  const jsonPayload = parseServiceAccountJson(rawJson);
  if (!jsonPayload) {
    throw new Error("FCM service account file does not contain valid JSON.");
  }

  return {
    clientEmail: String(jsonPayload.client_email || "").trim(),
    privateKey: normalizePrivateKey(jsonPayload.private_key),
    privateKeyId: String(jsonPayload.private_key_id || "").trim(),
    projectId: String(jsonPayload.project_id || "").trim(),
  };
}

export function getFcmAuthConfig(env = process.env) {
  const manualToken = String(env.FCM_ACCESS_TOKEN || "").trim();
  const projectId = String(env.FCM_PROJECT_ID || "").trim();
  const serviceAccount = getInlineServiceAccount(env);
  const serviceAccountInlineConfigured = Boolean(serviceAccount.clientEmail && serviceAccount.privateKey);
  const serviceAccountFileConfigured = Boolean(String(env.FCM_SERVICE_ACCOUNT_FILE || "").trim());
  const authStrategy = manualToken
    ? "manual-bearer"
    : serviceAccountInlineConfigured
      ? "service-account-inline"
      : serviceAccountFileConfigured
        ? "service-account-file"
        : "none";

  return {
    projectId,
    authStrategy,
    tokenEndpoint: GOOGLE_OAUTH_TOKEN_URL,
    scope: FCM_MESSAGING_SCOPE,
    manualTokenConfigured: Boolean(manualToken),
    serviceAccountConfigured: serviceAccountInlineConfigured || serviceAccountFileConfigured,
    serviceAccountInlineConfigured,
    serviceAccountFileConfigured,
    serviceAccountFilePath: String(env.FCM_SERVICE_ACCOUNT_FILE || "").trim(),
    serviceAccountEmail: serviceAccount.clientEmail,
    serviceAccountProjectId: serviceAccount.projectId,
    privateKeyId: serviceAccount.privateKeyId,
  };
}

async function resolveServiceAccount(env = process.env, fileReader = readFile) {
  const inlineServiceAccount = getInlineServiceAccount(env);
  if (inlineServiceAccount.clientEmail && inlineServiceAccount.privateKey) {
    return {
      ...inlineServiceAccount,
      source: "inline",
    };
  }

  const fileServiceAccount = await getFileServiceAccount(env, fileReader);
  if (fileServiceAccount?.clientEmail && fileServiceAccount?.privateKey) {
    return {
      ...fileServiceAccount,
      source: "file",
    };
  }

  return null;
}

function buildServiceAccountFingerprint(serviceAccount, projectId) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        clientEmail: serviceAccount.clientEmail,
        privateKeyId: serviceAccount.privateKeyId,
        projectId,
      }),
    )
    .digest("hex");
}

export function buildServiceAccountJwt(serviceAccount, now = new Date()) {
  const currentNow = now instanceof Date ? now : new Date(now);
  const issuedAtSeconds = Math.floor(currentNow.getTime() / 1000);
  const expiresAtSeconds = issuedAtSeconds + 3600;
  const header = {
    alg: "RS256",
    typ: "JWT",
  };
  if (serviceAccount.privateKeyId) {
    header.kid = serviceAccount.privateKeyId;
  }

  const claims = {
    iss: serviceAccount.clientEmail,
    scope: FCM_MESSAGING_SCOPE,
    aud: GOOGLE_OAUTH_TOKEN_URL,
    iat: issuedAtSeconds,
    exp: expiresAtSeconds,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedClaims = base64UrlEncode(JSON.stringify(claims));
  const signingInput = `${encodedHeader}.${encodedClaims}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(serviceAccount.privateKey);

  return {
    jwt: `${signingInput}.${base64UrlEncode(signature)}`,
    issuedAtSeconds,
    expiresAtSeconds,
  };
}

async function requestServiceAccountAccessToken(serviceAccount, fetchImpl, now) {
  const { jwt } = buildServiceAccountJwt(serviceAccount, now);
  const response = await fetchWithTimeout(
    GOOGLE_OAUTH_TOKEN_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }).toString(),
    },
    { fetchImpl },
  );
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error_description || payload.error || `OAuth token request failed (${response.status}).`);
  }

  return {
    accessToken: String(payload.access_token || "").trim(),
    expiresInSeconds: Number(payload.expires_in || 0),
    tokenType: String(payload.token_type || "").trim(),
  };
}

export async function resolveFcmAccessToken(env = process.env, now = new Date(), fetchImpl = fetch, fileReader = readFile) {
  const authConfig = getFcmAuthConfig(env);
  if (authConfig.manualTokenConfigured) {
    return {
      status: "ready",
      accessToken: String(env.FCM_ACCESS_TOKEN || "").trim(),
      source: "env.FCM_ACCESS_TOKEN",
      expiresAt: null,
      cacheStatus: "manual",
      projectId: authConfig.projectId,
    };
  }

  const serviceAccount = await resolveServiceAccount(env, fileReader);
  if (!serviceAccount) {
    return {
      status: "blocked",
      accessToken: "",
      source: "",
      expiresAt: null,
      cacheStatus: "none",
      projectId: authConfig.projectId,
      reason: "FCM access token or service account credentials are missing.",
    };
  }

  if (!authConfig.projectId) {
    return {
      status: "blocked",
      accessToken: "",
      source: "",
      expiresAt: null,
      cacheStatus: "none",
      projectId: "",
      reason: "FCM project id is missing.",
    };
  }

  const currentNow = now instanceof Date ? now : new Date(now);
  const fingerprint = buildServiceAccountFingerprint(serviceAccount, authConfig.projectId);
  if (
    tokenCache.fingerprint === fingerprint &&
    tokenCache.accessToken &&
    tokenCache.expiresAtMs - TOKEN_REFRESH_BUFFER_MS > currentNow.getTime()
  ) {
    return {
      status: "ready",
      accessToken: tokenCache.accessToken,
      source: serviceAccount.source === "file" ? "service-account-file-cache" : "service-account-cache",
      expiresAt: new Date(tokenCache.expiresAtMs).toISOString(),
      cacheStatus: "hit",
      projectId: authConfig.projectId,
    };
  }

  const tokenPayload = await requestServiceAccountAccessToken(serviceAccount, fetchImpl, currentNow);
  const expiresAtMs = currentNow.getTime() + tokenPayload.expiresInSeconds * 1000;
  tokenCache.fingerprint = fingerprint;
  tokenCache.accessToken = tokenPayload.accessToken;
  tokenCache.expiresAtMs = expiresAtMs;

  return {
    status: "ready",
    accessToken: tokenPayload.accessToken,
    source: serviceAccount.source === "file" ? "service-account-file-oauth" : "service-account-oauth",
    expiresAt: new Date(expiresAtMs).toISOString(),
    cacheStatus: "miss",
    projectId: authConfig.projectId,
  };
}

export async function readFcmAuthStatus(env = process.env, now = new Date(), fetchImpl = fetch, fileReader = readFile) {
  const authConfig = getFcmAuthConfig(env);
  const currentNow = now instanceof Date ? now : new Date(now);
  const status = {
    ...authConfig,
    checkedAt: currentNow.toISOString(),
    accessTokenStatus: "idle",
    accessTokenSource: "",
    accessTokenExpiresAt: null,
    accessTokenCacheStatus: "none",
    reason: "",
  };

  if (authConfig.manualTokenConfigured) {
    status.accessTokenStatus = "ready";
    status.accessTokenSource = "env.FCM_ACCESS_TOKEN";
    status.accessTokenCacheStatus = "manual";
    return status;
  }

  try {
    const tokenResolution = await resolveFcmAccessToken(env, currentNow, fetchImpl, fileReader);
    status.accessTokenStatus = tokenResolution.status;
    status.accessTokenSource = tokenResolution.source;
    status.accessTokenExpiresAt = tokenResolution.expiresAt;
    status.accessTokenCacheStatus = tokenResolution.cacheStatus;
    status.reason = tokenResolution.reason || "";
    status.projectId = tokenResolution.projectId || status.projectId;
    return status;
  } catch (error) {
    status.accessTokenStatus = "error";
    status.reason = error instanceof Error ? error.message : "Unknown FCM auth status error.";
    return status;
  }
}
