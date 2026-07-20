import test from "node:test";
import assert from "node:assert/strict";

import {
  analyzeDevicePushTarget,
  markDevicePushTokenInvalidated,
  registerDevicePushToken,
} from "../src/server/device-token.mjs";

test("analyzeDevicePushTarget marks a valid Android FCM token as ready", () => {
  const health = analyzeDevicePushTarget({
    platform: "android",
    pushEnabled: true,
    pushToken: "dQw4w9WgXcQ:APA91bExampleExampleExampleExampleToken1234567890",
  });

  assert.equal(health.adapter, "fcm");
  assert.equal(health.deliveryReadiness, "ready");
  assert.equal(health.formatStatus, "valid");
  assert.equal(health.tokenKind, "fcm-registration-token");
});

test("analyzeDevicePushTarget blocks malformed iOS APNs tokens", () => {
  const health = analyzeDevicePushTarget({
    platform: "ios",
    pushEnabled: true,
    pushToken: "not-a-real-apns-token",
  });

  assert.equal(health.adapter, "apns");
  assert.equal(health.deliveryReadiness, "blocked");
  assert.equal(health.formatStatus, "invalid");
  assert.match(health.reason, /APNs hexadecimal token or an FCM/i);
});

test("analyzeDevicePushTarget routes an iPhone FCM token through Firebase", () => {
  const health = analyzeDevicePushTarget({
    platform: "ios",
    pushEnabled: true,
    pushToken: "dQw4w9WgXcQ:APA91bExampleExampleExampleExampleToken1234567890",
  });

  assert.equal(health.adapter, "fcm");
  assert.equal(health.deliveryReadiness, "ready");
  assert.equal(health.tokenKind, "fcm-registration-token");
});

test("analyzeDevicePushTarget warns when a web subscription JSON is reduced to an endpoint", () => {
  const health = analyzeDevicePushTarget({
    platform: "web",
    pushEnabled: true,
    pushToken: JSON.stringify({
      endpoint: "https://fcm.googleapis.com/fcm/send/demo-subscription-endpoint",
      keys: {
        p256dh: "demo-p256dh",
        auth: "demo-auth",
      },
    }),
  });

  assert.equal(health.adapter, "web-push");
  assert.equal(health.deliveryReadiness, "warning");
  assert.equal(health.tokenKind, "web-push-subscription-json");
  assert.match(health.normalizedToken, /^https:\/\/fcm\.googleapis\.com/);
});

test("analyzeDevicePushTarget accepts a complete stored Web Push subscription", () => {
  const health = analyzeDevicePushTarget({
    platform: "web",
    pushEnabled: true,
    pushToken: "https://fcm.googleapis.com/fcm/send/demo-subscription-endpoint",
    webPushSubscription: {
      endpoint: "https://fcm.googleapis.com/fcm/send/demo-subscription-endpoint",
      keys: {
        p256dh: "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-ABC",
        auth: "AbCdEfGhIjKlMnOpQrStUv",
      },
    },
  });

  assert.equal(health.adapter, "web-push");
  assert.equal(health.deliveryReadiness, "ready");
  assert.equal(health.tokenKind, "web-push-subscription");
});

test("registerDevicePushToken normalizes and timestamps a fresh APNs token", () => {
  const registered = registerDevicePushToken(
    {
      platform: "ios",
      pushEnabled: true,
      pushToken: "",
      registeredAt: null,
    },
    {
      pushToken: "<0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF>",
    },
    new Date("2026-04-23T08:00:00+09:00"),
  );

  assert.equal(
    registered.profile.pushToken,
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  );
  assert.equal(registered.profile.registeredAt, "2026-04-22T23:00:00.000Z");
  assert.equal(registered.health.deliveryReadiness, "ready");
});

test("an invalidated FCM token stays blocked until the phone registers a valid token again", () => {
  const invalidated = markDevicePushTokenInvalidated(
    {
      platform: "android",
      pushEnabled: true,
      pushToken: "dQw4w9WgXcQ:APA91bExampleExampleExampleExampleToken1234567890",
    },
    {
      code: "UNREGISTERED",
      reason: "FCM reported that this device token is no longer registered.",
    },
    new Date("2026-04-24T07:00:00+09:00"),
  );

  const blocked = analyzeDevicePushTarget(invalidated);
  assert.equal(blocked.deliveryReadiness, "blocked");
  assert.equal(blocked.tokenInvalidationCode, "UNREGISTERED");
  assert.match(blocked.recommendedAction, /register its current FCM token/i);

  const refreshed = registerDevicePushToken(
    invalidated,
    {
      pushEnabled: true,
      pushToken: "dQw4w9WgXcQ:APA91bRefreshedExampleExampleExampleToken1234567890",
    },
    new Date("2026-04-24T07:05:00+09:00"),
  );
  assert.equal(refreshed.profile.pushTokenInvalidatedAt, null);
  assert.equal(refreshed.health.deliveryReadiness, "ready");
});
