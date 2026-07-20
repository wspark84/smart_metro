import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";

import {
  buildAppleAuthorizationUrl,
  buildGoogleAuthorizationUrl,
  consumeOAuthStateRecord,
  createOAuthStateRecord,
  getSocialAuthConfig,
  pruneExpiredOAuthStates,
  verifyAppleIdToken,
} from "../src/server/social-auth.mjs";

function base64Url(value) {
  const input = Buffer.isBuffer(value) ? value : typeof value === "string" ? value : JSON.stringify(value);
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createSignedAppleIdToken(privateKey, payload) {
  const header = { alg: "RS256", kid: "apple-test-key", typ: "JWT" };
  const signingInput = `${base64Url(header)}.${base64Url(payload)}`;
  const signature = sign("RSA-SHA256", Buffer.from(signingInput), privateKey);
  return `${signingInput}.${base64Url(signature)}`;
}

test("getSocialAuthConfig reports Google ready and Apple blocked on localhost", () => {
  const config = getSocialAuthConfig(
    {
      APP_BASE_URL: "http://127.0.0.1:4173",
      GOOGLE_CLIENT_ID: "google-client-id",
      GOOGLE_CLIENT_SECRET: "google-client-secret",
      APPLE_SERVICE_ID: "com.example.web",
      APPLE_TEAM_ID: "TEAM123",
      APPLE_KEY_ID: "KEY123",
      APPLE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----",
    },
    4173,
  );

  assert.equal(config.providers.google.ready, true);
  assert.equal(config.providers.apple.ready, false);
  assert.match(config.providers.apple.reason, /public HTTPS APP_BASE_URL/i);
});

test("oauth state helpers create, consume, and prune state records", () => {
  const now = new Date("2026-05-13T00:00:00.000Z");
  const record = createOAuthStateRecord("google", now, "/#/home");
  const expired = {
    ...record,
    id: "expired",
    state: "expired-state",
    expiresAt: "2026-05-12T23:59:00.000Z",
  };
  const pruned = pruneExpiredOAuthStates([expired, record], now);
  assert.equal(pruned.length, 1);

  const consumed = consumeOAuthStateRecord(pruned, record.state, "google", now);
  assert.equal(consumed.stateRecord?.provider, "google");
  assert.equal(consumed.remainingRecords.length, 0);
});

test("authorization URL builders include provider-specific parameters", () => {
  const googleConfig = getSocialAuthConfig(
    {
      APP_BASE_URL: "http://127.0.0.1:4173",
      GOOGLE_CLIENT_ID: "google-client-id",
      GOOGLE_CLIENT_SECRET: "google-client-secret",
    },
    4173,
  );
  const appleConfig = getSocialAuthConfig(
    {
      APP_BASE_URL: "https://buswake.example.com",
      APPLE_SERVICE_ID: "com.example.web",
      APPLE_TEAM_ID: "TEAM123",
      APPLE_KEY_ID: "KEY123",
      APPLE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----",
    },
    4173,
  );
  const record = createOAuthStateRecord("google", new Date("2026-05-13T00:00:00.000Z"));
  const googleUrl = new URL(buildGoogleAuthorizationUrl(googleConfig, record));
  const appleUrl = new URL(buildAppleAuthorizationUrl(appleConfig, record));

  assert.equal(googleUrl.origin, "https://accounts.google.com");
  assert.equal(googleUrl.searchParams.get("client_id"), "google-client-id");
  assert.equal(googleUrl.searchParams.get("scope"), "openid email profile");
  assert.equal(appleUrl.origin, "https://appleid.apple.com");
  assert.equal(appleUrl.searchParams.get("response_mode"), "form_post");
  assert.equal(appleUrl.searchParams.get("nonce"), record.nonce);
});

test("verifyAppleIdToken accepts only a signed, current token for this client and nonce", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const config = getSocialAuthConfig({
    APP_BASE_URL: "https://buswake.example.com",
    APPLE_SERVICE_ID: "com.example.web",
    APPLE_TEAM_ID: "TEAM123",
    APPLE_KEY_ID: "KEY123",
    APPLE_PRIVATE_KEY: "test-private-key",
  });
  const now = new Date("2026-05-13T00:00:00.000Z");
  const token = createSignedAppleIdToken(privateKey, {
    iss: "https://appleid.apple.com",
    aud: "com.example.web",
    exp: Math.floor(now.getTime() / 1000) + 60,
    nonce: "expected-nonce",
    sub: "apple-subject-1",
    email: "apple@example.com",
    email_verified: "true",
  });
  const fetchImpl = async () =>
    new Response(JSON.stringify({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "apple-test-key", use: "sig" }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  const profile = await verifyAppleIdToken(config, token, "expected-nonce", { fetchImpl, now });
  assert.equal(profile.sub, "apple-subject-1");

  await assert.rejects(
    () => verifyAppleIdToken(config, token, "wrong-nonce", { fetchImpl, now }),
    /nonce is invalid/i,
  );
});
