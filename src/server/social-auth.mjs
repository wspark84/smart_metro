import { createPrivateKey, createPublicKey, randomBytes, randomUUID, sign, verify } from "node:crypto";
import { fetchWithTimeout } from "./upstream-fetch.mjs";
const GOOGLE_SCOPE = "openid email profile";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const APPLE_AUTH_URL = "https://appleid.apple.com/auth/authorize";
const APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token";
const APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys";
const OAUTH_STATE_TTL_MINUTES = 10;

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function parseBase64UrlJson(value, label) {
  const padded = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const normalized = padded.padEnd(Math.ceil(padded.length / 4) * 4, "=");
  try {
    return JSON.parse(Buffer.from(normalized, "base64").toString("utf8"));
  } catch {
    throw new Error(`The Apple ID token ${label} could not be decoded.`);
  }
}

function parseJwt(token) {
  const segments = String(token || "").split(".");
  if (segments.length !== 3 || segments.some((segment) => !segment)) {
    throw new Error("The Apple ID token is not a signed JWT.");
  }

  return {
    segments,
    header: parseBase64UrlJson(segments[0], "header"),
    payload: parseBase64UrlJson(segments[1], "payload"),
    signature: Buffer.from(segments[2].replace(/-/g, "+").replace(/_/g, "/"), "base64"),
  };
}

function isExpectedAudience(audience, clientId) {
  if (Array.isArray(audience)) {
    return audience.includes(clientId);
  }

  return audience === clientId;
}

export async function verifyAppleIdToken(config, idToken, expectedNonce, options = {}) {
  const provider = config?.providers?.apple;
  if (!provider?.ready) {
    throw new Error(provider?.reason || "Apple OAuth is not configured.");
  }

  const { fetchImpl = fetch, now = new Date() } = options;
  const { segments, header, payload, signature } = parseJwt(idToken);
  if (header?.alg !== "RS256" || !String(header?.kid || "").trim()) {
    throw new Error("The Apple ID token uses an unsupported signing key.");
  }

  const keysResponse = await fetchWithTimeout(APPLE_JWKS_URL, {}, { fetchImpl });
  const keyPayload = await keysResponse.json();
  if (!keysResponse.ok || !Array.isArray(keyPayload?.keys)) {
    throw new Error("Apple signing keys could not be loaded.");
  }

  const signingKey = keyPayload.keys.find((key) => key?.kid === header.kid && key?.kty === "RSA" && key?.use === "sig");
  if (!signingKey) {
    throw new Error("The Apple ID token signing key is unavailable.");
  }

  let publicKey;
  try {
    publicKey = createPublicKey({ key: signingKey, format: "jwk" });
  } catch {
    throw new Error("The Apple ID token signing key is invalid.");
  }

  const signatureIsValid = verify("RSA-SHA256", Buffer.from(`${segments[0]}.${segments[1]}`), publicKey, signature);
  if (!signatureIsValid) {
    throw new Error("The Apple ID token signature is invalid.");
  }

  const nowSeconds = Math.floor(now.getTime() / 1000);
  const expectedClientId = String(provider.clientId || "").trim();
  if (payload?.iss !== "https://appleid.apple.com") {
    throw new Error("The Apple ID token issuer is invalid.");
  }
  if (!isExpectedAudience(payload?.aud, expectedClientId)) {
    throw new Error("The Apple ID token audience is invalid.");
  }
  if (!Number.isFinite(Number(payload?.exp)) || Number(payload.exp) <= nowSeconds) {
    throw new Error("The Apple ID token has expired.");
  }
  if (expectedNonce && String(payload?.nonce || "") !== String(expectedNonce)) {
    throw new Error("The Apple ID token nonce is invalid.");
  }
  if (!String(payload?.sub || "").trim()) {
    throw new Error("The Apple ID token does not identify a user.");
  }

  return payload;
}

export function getAppBaseUrl(env = {}, port = 4173) {
  const value = String(env.APP_BASE_URL || "").trim();
  if (value) {
    return value.replace(/\/+$/, "");
  }

  return `http://127.0.0.1:${port}`;
}

function isHttpsPublicUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol !== "https:") {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase();
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
      return false;
    }

    return !/^\d+\.\d+\.\d+\.\d+$/.test(hostname);
  } catch {
    return false;
  }
}

function normalizeApplePrivateKey(rawValue) {
  return String(rawValue || "").replace(/\\n/g, "\n").trim();
}

export function getSocialAuthConfig(env = {}, port = 4173) {
  const baseUrl = getAppBaseUrl(env, port);
  const googleClientId = String(env.GOOGLE_CLIENT_ID || "").trim();
  const googleClientSecret = String(env.GOOGLE_CLIENT_SECRET || "").trim();
  const appleServiceId = String(env.APPLE_SERVICE_ID || "").trim();
  const appleTeamId = String(env.APPLE_TEAM_ID || "").trim();
  const appleKeyId = String(env.APPLE_KEY_ID || "").trim();
  const applePrivateKey = normalizeApplePrivateKey(env.APPLE_PRIVATE_KEY || "");

  const googleReady = Boolean(googleClientId && googleClientSecret);
  const appleBaseUrlReady = isHttpsPublicUrl(baseUrl);
  const appleReady = Boolean(appleServiceId && appleTeamId && appleKeyId && applePrivateKey && appleBaseUrlReady);

  return {
    baseUrl,
    providers: {
      google: {
        id: "google",
        label: "Google",
        ready: googleReady,
        reason: googleReady ? "Google OAuth credentials are configured." : "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first.",
        clientId: googleClientId || null,
        clientSecret: googleClientSecret || null,
        callbackUrl: `${baseUrl}/api/auth/oauth/google/callback`,
      },
      apple: {
        id: "apple",
        label: "Apple",
        ready: appleReady,
        reason: appleReady
          ? "Apple OAuth credentials are configured."
          : !appleBaseUrlReady
            ? "Apple requires a public HTTPS APP_BASE_URL and does not accept localhost redirect URIs."
            : "Set APPLE_SERVICE_ID, APPLE_TEAM_ID, APPLE_KEY_ID, and APPLE_PRIVATE_KEY first.",
        clientId: appleServiceId || null,
        teamId: appleTeamId || null,
        keyId: appleKeyId || null,
        privateKey: applePrivateKey || null,
        callbackUrl: `${baseUrl}/api/auth/oauth/apple/callback`,
      },
    },
  };
}

export function createOAuthStateRecord(provider, now = new Date(), redirectAfterAuth = "/#/home") {
  return {
    id: randomUUID(),
    provider: String(provider || "").trim().toLowerCase(),
    state: randomBytes(24).toString("hex"),
    nonce: randomBytes(16).toString("hex"),
    redirectAfterAuth: String(redirectAfterAuth || "/#/home").trim() || "/#/home",
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + OAUTH_STATE_TTL_MINUTES * 60 * 1000).toISOString(),
  };
}

export function pruneExpiredOAuthStates(records, now = new Date()) {
  const nowTime = now.getTime();
  return Array.isArray(records)
    ? records.filter((record) => {
        const expiresAt = Date.parse(record?.expiresAt || "");
        return Number.isFinite(expiresAt) && expiresAt > nowTime;
      })
    : [];
}

export function consumeOAuthStateRecord(records, stateValue, provider, now = new Date()) {
  const safeRecords = pruneExpiredOAuthStates(records, now);
  const normalizedProvider = String(provider || "").trim().toLowerCase();
  const normalizedState = String(stateValue || "").trim();
  const matched = safeRecords.find(
    (record) => record.provider === normalizedProvider && record.state === normalizedState,
  );

  return {
    stateRecord: matched || null,
    remainingRecords: safeRecords.filter((record) => record !== matched),
  };
}

export function buildGoogleAuthorizationUrl(config, stateRecord) {
  const provider = config?.providers?.google;
  if (!provider?.ready) {
    throw new Error(provider?.reason || "Google OAuth is not configured.");
  }

  const params = new URLSearchParams({
    client_id: provider.clientId,
    redirect_uri: provider.callbackUrl,
    response_type: "code",
    scope: GOOGLE_SCOPE,
    state: stateRecord.state,
    access_type: "offline",
    prompt: "consent",
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export function buildAppleAuthorizationUrl(config, stateRecord) {
  const provider = config?.providers?.apple;
  if (!provider?.ready) {
    throw new Error(provider?.reason || "Apple OAuth is not configured.");
  }

  const params = new URLSearchParams({
    client_id: provider.clientId,
    redirect_uri: provider.callbackUrl,
    response_type: "code",
    response_mode: "form_post",
    scope: "name email",
    state: stateRecord.state,
    nonce: stateRecord.nonce,
  });

  return `${APPLE_AUTH_URL}?${params.toString()}`;
}

export async function exchangeGoogleCodeForProfile(config, code, fetchImpl = fetch) {
  const provider = config?.providers?.google;
  if (!provider?.ready) {
    throw new Error(provider?.reason || "Google OAuth is not configured.");
  }

  const tokenResponse = await fetchWithTimeout(
    GOOGLE_TOKEN_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        code: String(code || "").trim(),
        client_id: String(config.providers.google.clientId || ""),
        client_secret: String(config.providers.google.clientSecret || ""),
        redirect_uri: provider.callbackUrl,
        grant_type: "authorization_code",
      }),
    },
    { fetchImpl },
  );
  const tokenPayload = await tokenResponse.json();
  if (!tokenResponse.ok) {
    throw new Error(tokenPayload.error_description || tokenPayload.error || "Google token exchange failed.");
  }

  const userInfoResponse = await fetchWithTimeout(
    GOOGLE_USERINFO_URL,
    {
      headers: {
        Authorization: `Bearer ${tokenPayload.access_token}`,
      },
    },
    { fetchImpl },
  );
  const userInfo = await userInfoResponse.json();
  if (!userInfoResponse.ok) {
    throw new Error(userInfo.error_description || userInfo.error || "Google user profile fetch failed.");
  }

  return {
    provider: "google",
    subject: String(userInfo.sub || "").trim(),
    email: String(userInfo.email || "").trim().toLowerCase(),
    emailVerified: Boolean(userInfo.email_verified),
    name: String(userInfo.name || userInfo.given_name || userInfo.email || "").trim(),
  };
}

export async function buildAppleClientSecret(config, now = new Date()) {
  const provider = config?.providers?.apple;
  if (!provider?.ready) {
    throw new Error(provider?.reason || "Apple OAuth is not configured.");
  }

  const header = {
    alg: "ES256",
    kid: String(provider.keyId || "").trim(),
  };
  const issuedAt = Math.floor(now.getTime() / 1000);
  const payload = {
    iss: String(provider.teamId || "").trim(),
    iat: issuedAt,
    exp: issuedAt + 60 * 60 * 24 * 180,
    aud: "https://appleid.apple.com",
    sub: String(provider.clientId || "").trim(),
  };
  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  const signature = sign("sha256", Buffer.from(signingInput), createPrivateKey(String(provider.privateKey || "")));
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

export async function exchangeAppleCodeForProfile(config, code, userPayload = "", options = {}) {
  const provider = config?.providers?.apple;
  if (!provider?.ready) {
    throw new Error(provider?.reason || "Apple OAuth is not configured.");
  }

  const { expectedNonce = "", fetchImpl = fetch, now = new Date() } = options;
  const clientSecret = await buildAppleClientSecret(config, now);
  const tokenResponse = await fetchWithTimeout(
    APPLE_TOKEN_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: String(code || "").trim(),
        client_id: String(provider.clientId || ""),
        client_secret: clientSecret,
        redirect_uri: provider.callbackUrl,
      }),
    },
    { fetchImpl },
  );
  const tokenPayload = await tokenResponse.json();
  if (!tokenResponse.ok) {
    throw new Error(tokenPayload.error || "Apple token exchange failed.");
  }

  const idPayload = await verifyAppleIdToken(config, tokenPayload.id_token, expectedNonce, { fetchImpl, now });
  let userData = {};
  if (userPayload) {
    try {
      userData = JSON.parse(String(userPayload || ""));
    } catch {
      userData = {};
    }
  }

  const firstName = String(userData?.name?.firstName || "").trim();
  const lastName = String(userData?.name?.lastName || "").trim();
  const displayName = `${firstName} ${lastName}`.trim();

  return {
    provider: "apple",
    subject: String(idPayload.sub || "").trim(),
    email: String(idPayload.email || userData?.email || "").trim().toLowerCase(),
    emailVerified: String(idPayload.email_verified || "").toLowerCase() === "true",
    name: displayName || String(userData?.email || idPayload.email || "Apple User").trim(),
  };
}
