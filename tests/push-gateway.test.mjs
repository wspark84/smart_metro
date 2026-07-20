import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import webPush from "web-push";

import {
  buildPushGatewayPlan,
  createApnsAuthToken,
  classifyApnsProviderResponse,
  classifyFcmProviderResponse,
  classifyWebPushProviderResponse,
  getPushGatewayConfig,
  runPushGatewayDispatch,
} from "../src/server/push-gateway.mjs";

function buildPreview(overrides = {}) {
  return {
    status: "ready",
    reason: "Preview ready.",
    adapter: "fcm",
    title: "Bus 1002 in 4 min",
    dispatchKey: "2026-04-23:2026-04-22T22:00:00.000Z:stage-1",
    stage: 1,
    escalationLabel: "Escalated",
    riskLevel: "RED",
    liveEtaGuardMode: "conservative",
    deliveryPriorityClass: "normal",
    deliveryPriorityReason: "",
    accuracyRiskBufferMin: 2,
    accuracySpreadMin: 5,
    volumePercent: 100,
    vibrationRepeats: 5,
    mechanicalLoopBoost: 0,
    speechRepeatCount: 1,
    envelope: {
      targetToken: "demo-fcm-token",
      message: {
        title: "Bus 1002 in 4 min",
        body: "Catch this bus now.",
        data: {
          dispatchKey: "2026-04-23:2026-04-22T22:00:00.000Z:stage-1",
          alertTriggerKey: "2026-04-23:2026-04-22T22:00:00.000Z",
          routeNumber: "1002",
          stopName: "Gwanghwamun",
          riskLevel: "RED",
          stage: "1",
          escalationLabel: "Escalated",
          liveEtaGuardMode: "conservative",
          deliveryPriorityClass: "normal",
          deliveryPriorityReason: "",
          accuracyRiskBufferMin: "2",
          accuracySpreadMin: "5",
          mechanicalLoopBoost: "0",
          speechRepeatCount: "1",
        },
        sound: {
          presetId: "mechanical",
          volumePercent: 100,
          mechanicalTone: true,
          loopBoost: 0,
        },
        speech: {
          text: "This bus must be caught.",
          volume: 1,
          rate: 0.9,
          repeatCount: 1,
        },
      },
      platformHints: {
        channelId: "buswakeup-critical",
        priority: "max",
      },
    },
    ...overrides,
  };
}

test("getPushGatewayConfig reads provider modes from env", () => {
  const config = getPushGatewayConfig({
    PUSH_GATEWAY_MODE: "execute",
    FCM_PROJECT_ID: "demo-project",
    FCM_ACCESS_TOKEN: "token-123",
    APNS_BUNDLE_ID: "com.example.bus",
    APNS_AUTH_TOKEN: "apns-token",
    APNS_ENV: "development",
  });

  assert.equal(config.mode, "execute");
  assert.equal(config.adapters.fcm.configured, true);
  assert.equal(config.adapters.apns.environment, "development");
});

test("buildPushGatewayPlan creates a redacted FCM request preview", () => {
  const env = {
    FCM_PROJECT_ID: "demo-project",
    FCM_ACCESS_TOKEN: "token-1234567890",
  };
  const plan = buildPushGatewayPlan(
    buildPreview(),
    getPushGatewayConfig(env),
    env,
  );

  assert.equal(plan.status, "ready");
  assert.equal(plan.request.method, "POST");
  assert.match(plan.request.url, /fcm\.googleapis\.com/);
  assert.match(plan.request.headers.Authorization, /\.\.\./);
  assert.equal(plan.request.body.message.android.notification.channel_id, "buswakeup-critical");
  assert.equal(plan.request.body.message.android.notification.sound, "mechanical_alarm");
  assert.equal(plan.request.body.message.apns.payload.aps.sound, "mechanical_alarm.wav");
});

test("classifyFcmProviderResponse requests token re-registration for an unregistered device", () => {
  const classification = classifyFcmProviderResponse(
    404,
    JSON.stringify({
      error: {
        status: "NOT_FOUND",
        message: "Requested entity was not found.",
        details: [
          {
            "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError",
            errorCode: "UNREGISTERED",
          },
        ],
      },
    }),
  );

  assert.equal(classification.category, "TOKEN_UNREGISTERED");
  assert.equal(classification.retryable, false);
  assert.equal(classification.tokenAction, "RE_REGISTER");
  assert.match(classification.reason, /register the refreshed FCM token/i);
});

test("classifyFcmProviderResponse keeps temporary FCM failures retryable", () => {
  const classification = classifyFcmProviderResponse(
    503,
    JSON.stringify({
      error: {
        status: "UNAVAILABLE",
        message: "Service unavailable.",
      },
    }),
  );

  assert.equal(classification.category, "TRANSIENT_PROVIDER_FAILURE");
  assert.equal(classification.retryable, true);
  assert.equal(classification.tokenAction, "NONE");
});

test("buildPushGatewayPlan carries boosted delivery priority into the provider request body", () => {
  const env = {
    FCM_PROJECT_ID: "demo-project",
    FCM_ACCESS_TOKEN: "token-1234567890",
  };
  const plan = buildPushGatewayPlan(
    buildPreview({
      riskLevel: "YELLOW",
      deliveryPriorityClass: "boosted",
      deliveryPriorityReason: "high-watch-first-main-alarm",
      volumePercent: 85,
      vibrationRepeats: 3,
      mechanicalLoopBoost: 2,
      speechRepeatCount: 2,
      envelope: {
        ...buildPreview().envelope,
        message: {
          ...buildPreview().envelope.message,
          data: {
            ...buildPreview().envelope.message.data,
            deliveryPriorityClass: "boosted",
            deliveryPriorityReason: "high-watch-first-main-alarm",
            mechanicalLoopBoost: "2",
            speechRepeatCount: "2",
          },
          sound: {
            ...buildPreview().envelope.message.sound,
            volumePercent: 85,
            loopBoost: 2,
          },
          interruption: {
            vibrationRepeats: 3,
          },
          speech: {
            ...buildPreview().envelope.message.speech,
            repeatCount: 2,
          },
        },
        platformHints: {
          channelId: "buswakeup-critical",
          priority: "max",
        },
      },
    }),
    getPushGatewayConfig(env),
    env,
  );

  assert.equal(plan.request.body.message.data.deliveryPriorityClass, "boosted");
  assert.equal(plan.request.body.message.data.deliveryPriorityReason, "high-watch-first-main-alarm");
  assert.equal(plan.request.body.message.data.mechanicalLoopBoost, "2");
  assert.equal(plan.request.body.message.data.speechRepeatCount, "2");
});

test("buildPushGatewayPlan prepares an executable APNs provider request", () => {
  const env = {
    APNS_BUNDLE_ID: "com.example.bus",
    APNS_AUTH_TOKEN: "apns-token-123",
    APNS_ENV: "development",
  };
  const plan = buildPushGatewayPlan(
    buildPreview({ adapter: "apns" }),
    getPushGatewayConfig(env),
    env,
  );

  assert.equal(plan.status, "ready");
  assert.equal(plan.executeSupported, true);
  assert.equal(plan.request.method, "POST");
  assert.match(plan.request.url, /development\.push\.apple\.com/);
});

test("createApnsAuthToken signs a current ES256 token from the Apple .p8 settings", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const now = new Date("2026-05-13T00:00:00.000Z");
  const env = {
    APNS_BUNDLE_ID: "com.example.bus",
    APNS_TEAM_ID: "TEAM123456",
    APNS_KEY_ID: "KEY1234567",
    APNS_PRIVATE_KEY: privateKey.export({ format: "pem", type: "pkcs8" }),
  };
  const token = createApnsAuthToken(env, now);
  const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
  const header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8"));
  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));

  assert.deepEqual(header, { alg: "ES256", kid: "KEY1234567" });
  assert.deepEqual(payload, { iss: "TEAM123456", iat: Math.floor(now.getTime() / 1000) });
  assert.equal(
    verify("sha256", Buffer.from(`${encodedHeader}.${encodedPayload}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(encodedSignature, "base64url")),
    true,
  );
  assert.equal(getPushGatewayConfig(env).adapters.apns.credentialSource, "env.APNS_TEAM_ID + env.APNS_KEY_ID + env.APNS_PRIVATE_KEY");
});

test("APNs and Web Push provider replies classify expired subscriptions for re-registration", () => {
  const apns = classifyApnsProviderResponse(410, JSON.stringify({ reason: "Unregistered" }));
  const web = classifyWebPushProviderResponse(410, "Gone");

  assert.equal(apns.tokenAction, "RE_REGISTER");
  assert.equal(apns.retryable, false);
  assert.equal(web.tokenAction, "RE_REGISTER");
  assert.equal(web.retryable, false);
});

test("buildPushGatewayPlan prepares an encrypted Web Push request only with VAPID and a complete subscription", () => {
  const keys = webPush.generateVAPIDKeys();
  const env = {
    WEB_PUSH_VAPID_SUBJECT: "mailto:ops@example.com",
    WEB_PUSH_VAPID_PUBLIC_KEY: keys.publicKey,
    WEB_PUSH_VAPID_PRIVATE_KEY: keys.privateKey,
  };
  const plan = buildPushGatewayPlan(
    buildPreview({ adapter: "web-push" }),
    getPushGatewayConfig(env),
    env,
    {
      platform: "web",
      pushEnabled: true,
      webPushSubscription: {
        endpoint: "https://fcm.googleapis.com/fcm/send/demo-subscription-endpoint",
        keys: {
          p256dh: keys.publicKey,
          auth: Buffer.alloc(16, 7).toString("base64url"),
        },
      },
    },
  );

  assert.equal(plan.status, "ready");
  assert.equal(plan.executeSupported, true);
  assert.equal(plan.request.adapter, "web-push");
  assert.match(plan.request.url, /^https:\/\/fcm\.googleapis\.com/);
  assert.equal(plan.request.body.title, "Bus 1002 in 4 min");
});

test("runPushGatewayDispatch returns dry-run-ready when preview mode is active", async () => {
  const env = {
    PUSH_GATEWAY_MODE: "preview",
    FCM_PROJECT_ID: "demo-project",
    FCM_ACCESS_TOKEN: "token-123",
  };
  const attempt = await runPushGatewayDispatch(
    buildPreview(),
    getPushGatewayConfig(env),
    new Date("2026-04-23T07:00:00+09:00"),
    env,
  );

  assert.equal(attempt.status, "DRY_RUN_READY");
  assert.equal(attempt.adapter, "fcm");
  assert.equal(attempt.mode, "preview");
  assert.equal(attempt.liveEtaGuardMode, "conservative");
  assert.equal(attempt.deliveryPriorityClass, "normal");
  assert.equal(attempt.accuracyRiskBufferMin, 2);
  assert.equal(attempt.accuracySpreadMin, 5);
  assert.equal(attempt.volumePercent, 100);
  assert.equal(attempt.vibrationRepeats, 5);
  assert.equal(attempt.mechanicalLoopBoost, 0);
  assert.equal(attempt.speechRepeatCount, 1);
});

test("runPushGatewayDispatch blocks when the provider credentials are missing", async () => {
  const attempt = await runPushGatewayDispatch(
    buildPreview(),
    getPushGatewayConfig({}),
    new Date("2026-04-23T07:00:00+09:00"),
    {},
  );

  assert.equal(attempt.status, "BLOCKED");
  assert.match(attempt.reason, /missing/i);
});

test("runPushGatewayDispatch returns dry-run-ready for a manual test preview in preview mode", async () => {
  const env = {
    PUSH_GATEWAY_MODE: "preview",
    FCM_PROJECT_ID: "demo-project",
    FCM_ACCESS_TOKEN: "token-123",
  };
  const attempt = await runPushGatewayDispatch(
    buildPreview({
      title: "[Test] 1002 push path check",
      dispatchKey: "test:2026-04-24T00:00:00.000Z",
      stage: 0,
      escalationLabel: "Test",
      envelope: {
        targetToken: "demo-fcm-token",
        message: {
          title: "[Test] 1002 push path check",
          body: "Test push body",
          data: {
            dispatchKey: "test:2026-04-24T00:00:00.000Z",
            alertTriggerKey: "test:2026-04-24T00:00:00.000Z",
            routeNumber: "1002",
            stopName: "Gwanghwamun",
            riskLevel: "RED",
            stage: "0",
            escalationLabel: "Test",
          },
          sound: {
            presetId: "mechanical",
            volumePercent: 100,
            mechanicalTone: true,
          },
          speech: {
            text: "Test push body",
            volume: 1,
            rate: 1,
          },
        },
        platformHints: {
          channelId: "buswakeup-critical",
          priority: "max",
        },
      },
    }),
    getPushGatewayConfig(env),
    new Date("2026-04-24T09:00:00+09:00"),
    env,
  );

  assert.equal(attempt.status, "DRY_RUN_READY");
  assert.equal(attempt.title, "[Test] 1002 push path check");
  assert.equal(attempt.dispatchKey, "test:2026-04-24T00:00:00.000Z");
});

test("runPushGatewayDispatch returns blocked when the preview itself is already blocked", async () => {
  const attempt = await runPushGatewayDispatch(
    {
      status: "blocked",
      reason: "The token format is invalid.",
      adapter: "fcm",
      title: "[Test] blocked preview",
      dispatchKey: "test:blocked",
      routeNumber: "1002",
      stopName: "Gwanghwamun",
      stage: 0,
      escalationLabel: "Test",
      riskLevel: "RED",
      envelope: null,
    },
    getPushGatewayConfig({}),
    new Date("2026-04-24T09:05:00+09:00"),
    {},
  );

  assert.equal(attempt.status, "BLOCKED");
  assert.equal(attempt.title, "[Test] blocked preview");
  assert.equal(attempt.routeNumber, "1002");
  assert.equal(attempt.stopName, "Gwanghwamun");
  assert.match(attempt.reason, /invalid/i);
});

