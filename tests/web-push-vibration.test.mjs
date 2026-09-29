import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import webPush from "web-push";
import { buildPushGatewayPlan, getPushGatewayConfig } from "../src/server/push-gateway.mjs";

function payloadFor(vibrationEnabled) {
  const keys = webPush.generateVAPIDKeys();
  const env = { WEB_PUSH_VAPID_SUBJECT: "mailto:test@example.com", WEB_PUSH_VAPID_PUBLIC_KEY: keys.publicKey, WEB_PUSH_VAPID_PRIVATE_KEY: keys.privateKey };
  return buildPushGatewayPlan({ status: "ready", adapter: "web-push", envelope: { message: { interruption: { vibrationPattern: [500, 200, 500], vibrationRepeats: 2 } } } }, getPushGatewayConfig(env), env, {
    platform: "web", vibrationEnabled,
    webPushSubscription: { endpoint: "https://fcm.googleapis.com/fcm/send/test", keys: { p256dh: keys.publicKey, auth: Buffer.alloc(16, 7).toString("base64url") } },
  }).request.body;
}

function notificationOptions(payload) {
  const listeners = {};
  let options;
  runInNewContext(readFileSync(new URL("../sw.js", import.meta.url), "utf8"), { self: {
    addEventListener: (type, handler) => { listeners[type] = handler; },
    registration: { showNotification: (_title, value) => { options = value; return Promise.resolve(); } },
  } });
  listeners.push({ data: { json: () => payload }, waitUntil() {} });
  return JSON.parse(JSON.stringify(options));
}

test("web push carries repeated vibration from server through notification display", () => {
  const payload = payloadFor(true);
  assert.deepEqual(payload.vibrate, [500, 200, 500, 200, 500, 200, 500]);
  assert.deepEqual(notificationOptions(payload).vibrate, payload.vibrate);
});

test("web push respects explicitly disabled vibration", () => {
  const payload = payloadFor(false);
  assert.deepEqual(payload.vibrate, []);
  assert.deepEqual(notificationOptions(payload).vibrate, []);
});

test("service worker supplies vibration for old server payloads and validates patterns", () => {
  assert.deepEqual(notificationOptions({}).vibrate, [400, 200, 400]);
  assert.deepEqual(notificationOptions({ vibrate: [-1, "bad", 50000] }).vibrate, [0, 0, 10000]);
});
