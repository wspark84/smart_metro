import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";

import {
  FCM_MESSAGING_SCOPE,
  GOOGLE_OAUTH_TOKEN_URL,
  buildServiceAccountJwt,
  getFcmAuthConfig,
  readFcmAuthStatus,
  resolveFcmAccessToken,
} from "../src/server/fcm-auth.mjs";

function createServiceAccountEnv(overrides = {}) {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  return {
    FCM_PROJECT_ID: `demo-project-${randomUUID()}`,
    FCM_SERVICE_ACCOUNT_EMAIL: `buswakeup-${randomUUID()}@demo-project.iam.gserviceaccount.com`,
    FCM_SERVICE_ACCOUNT_PRIVATE_KEY_ID: randomUUID().replace(/-/g, ""),
    FCM_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey.export({
      type: "pkcs8",
      format: "pem",
    }),
    ...overrides,
  };
}

test("getFcmAuthConfig prefers the manual bearer token when it exists", () => {
  const config = getFcmAuthConfig({
    FCM_PROJECT_ID: "demo-project",
    FCM_ACCESS_TOKEN: "manual-token",
  });

  assert.equal(config.authStrategy, "manual-bearer");
  assert.equal(config.manualTokenConfigured, true);
  assert.equal(config.serviceAccountConfigured, false);
});

test("getFcmAuthConfig detects inline service account credentials", () => {
  const env = createServiceAccountEnv();
  const config = getFcmAuthConfig(env);

  assert.equal(config.authStrategy, "service-account-inline");
  assert.equal(config.serviceAccountConfigured, true);
  assert.equal(config.projectId.startsWith("demo-project-"), true);
  assert.match(config.serviceAccountEmail, /iam\.gserviceaccount\.com$/);
});

test("getFcmAuthConfig detects a service account file path", () => {
  const config = getFcmAuthConfig({
    FCM_PROJECT_ID: "demo-project",
    FCM_SERVICE_ACCOUNT_FILE: "C:\\secure\\buswakeup-service-account.json",
  });

  assert.equal(config.authStrategy, "service-account-file");
  assert.equal(config.serviceAccountConfigured, true);
  assert.equal(config.serviceAccountFileConfigured, true);
  assert.equal(config.serviceAccountFilePath, "C:\\secure\\buswakeup-service-account.json");
});

test("buildServiceAccountJwt creates the expected JWT claims for Google OAuth", () => {
  const env = createServiceAccountEnv();
  const jwtPayload = buildServiceAccountJwt(
    {
      clientEmail: env.FCM_SERVICE_ACCOUNT_EMAIL,
      privateKey: env.FCM_SERVICE_ACCOUNT_PRIVATE_KEY,
      privateKeyId: env.FCM_SERVICE_ACCOUNT_PRIVATE_KEY_ID,
    },
    new Date("2026-04-23T07:00:00+09:00"),
  );

  const [encodedHeader, encodedClaims, encodedSignature] = jwtPayload.jwt.split(".");
  const header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8"));
  const claims = JSON.parse(Buffer.from(encodedClaims, "base64url").toString("utf8"));

  assert.equal(header.alg, "RS256");
  assert.equal(header.typ, "JWT");
  assert.equal(header.kid, env.FCM_SERVICE_ACCOUNT_PRIVATE_KEY_ID);
  assert.equal(claims.iss, env.FCM_SERVICE_ACCOUNT_EMAIL);
  assert.equal(claims.scope, FCM_MESSAGING_SCOPE);
  assert.equal(claims.aud, GOOGLE_OAUTH_TOKEN_URL);
  assert.equal(claims.exp - claims.iat, 3600);
  assert.equal(encodedSignature.length > 10, true);
});

test("resolveFcmAccessToken returns the manual token immediately", async () => {
  const result = await resolveFcmAccessToken(
    {
      FCM_PROJECT_ID: "demo-project",
      FCM_ACCESS_TOKEN: "manual-token",
    },
    new Date("2026-04-23T07:00:00+09:00"),
  );

  assert.equal(result.status, "ready");
  assert.equal(result.accessToken, "manual-token");
  assert.equal(result.source, "env.FCM_ACCESS_TOKEN");
});

test("resolveFcmAccessToken mints and caches a service-account token", async () => {
  const env = createServiceAccountEnv();
  let fetchCount = 0;
  const fakeFetch = async () => {
    fetchCount += 1;
    return {
      ok: true,
      async json() {
        return {
          access_token: "ya29.auto-token",
          expires_in: 3600,
          token_type: "Bearer",
        };
      },
    };
  };

  const first = await resolveFcmAccessToken(env, new Date("2026-04-23T07:00:00+09:00"), fakeFetch);
  const second = await resolveFcmAccessToken(env, new Date("2026-04-23T07:10:00+09:00"), fakeFetch);

  assert.equal(first.status, "ready");
  assert.equal(first.source, "service-account-oauth");
  assert.equal(second.status, "ready");
  assert.equal(second.source, "service-account-cache");
  assert.equal(fetchCount, 1);
});

test("resolveFcmAccessToken can mint and cache a token from a service account file", async () => {
  const env = createServiceAccountEnv({
    FCM_SERVICE_ACCOUNT_EMAIL: "",
    FCM_SERVICE_ACCOUNT_PRIVATE_KEY: "",
    FCM_SERVICE_ACCOUNT_PRIVATE_KEY_ID: "",
    FCM_SERVICE_ACCOUNT_FILE: "C:\\secure\\buswakeup-service-account.json",
  });
  const filePayload = JSON.stringify({
    type: "service_account",
    project_id: env.FCM_PROJECT_ID,
    private_key_id: randomUUID().replace(/-/g, ""),
    private_key: createServiceAccountEnv().FCM_SERVICE_ACCOUNT_PRIVATE_KEY,
    client_email: `buswakeup-file-${randomUUID()}@demo-project.iam.gserviceaccount.com`,
  });
  let fetchCount = 0;
  const fakeFetch = async () => {
    fetchCount += 1;
    return {
      ok: true,
      async json() {
        return {
          access_token: "ya29.file-token",
          expires_in: 3600,
          token_type: "Bearer",
        };
      },
    };
  };
  const fakeFileReader = async () => filePayload;

  const first = await resolveFcmAccessToken(
    env,
    new Date("2026-04-23T07:20:00+09:00"),
    fakeFetch,
    fakeFileReader,
  );
  const second = await resolveFcmAccessToken(
    env,
    new Date("2026-04-23T07:30:00+09:00"),
    fakeFetch,
    fakeFileReader,
  );

  assert.equal(first.status, "ready");
  assert.equal(first.source, "service-account-file-oauth");
  assert.equal(first.cacheStatus, "miss");
  assert.equal(second.status, "ready");
  assert.equal(second.source, "service-account-file-cache");
  assert.equal(second.cacheStatus, "hit");
  assert.equal(fetchCount, 1);
});

test("readFcmAuthStatus reports file-backed token health", async () => {
  const env = createServiceAccountEnv({
    FCM_SERVICE_ACCOUNT_EMAIL: "",
    FCM_SERVICE_ACCOUNT_PRIVATE_KEY: "",
    FCM_SERVICE_ACCOUNT_PRIVATE_KEY_ID: "",
    FCM_SERVICE_ACCOUNT_FILE: "C:\\secure\\buswakeup-service-account.json",
  });
  const filePayload = JSON.stringify({
    type: "service_account",
    project_id: env.FCM_PROJECT_ID,
    private_key_id: randomUUID().replace(/-/g, ""),
    private_key: createServiceAccountEnv().FCM_SERVICE_ACCOUNT_PRIVATE_KEY,
    client_email: `buswakeup-health-${randomUUID()}@demo-project.iam.gserviceaccount.com`,
  });
  const fakeFetch = async () => ({
    ok: true,
    async json() {
      return {
        access_token: "ya29.health-token",
        expires_in: 3600,
        token_type: "Bearer",
      };
    },
  });
  const fakeFileReader = async () => filePayload;

  const status = await readFcmAuthStatus(
    env,
    new Date("2026-04-23T07:40:00+09:00"),
    fakeFetch,
    fakeFileReader,
  );

  assert.equal(status.authStrategy, "service-account-file");
  assert.equal(status.accessTokenStatus, "ready");
  assert.equal(status.accessTokenSource, "service-account-file-oauth");
  assert.equal(status.accessTokenCacheStatus, "miss");
  assert.equal(status.projectId, env.FCM_PROJECT_ID);
});
