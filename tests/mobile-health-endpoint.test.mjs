import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildMobileHealthPayload } from "../src/server/mobile-health.mjs";

const SERVER_PATH = "C:\\Users\\User\\.gemini\\AI coding\\smart_bus\\server.mjs";

test("mobile health endpoint is exposed for real-device reachability checks", async () => {
  const serverSource = await readFile(SERVER_PATH, "utf8");

  assert.match(serverSource, /"\/api\/mobile\/health"/);
  assert.match(serverSource, /requestUrl\.pathname === "\/api\/mobile\/health"/);
  assert.match(serverSource, /buildMobileHealthPayload/);
  assert.match(serverSource, /"\/api\/healthz"/);
  assert.match(serverSource, /sendLivenessResponse/);
});

test("mobile health payload reads FCM and APNs settings from the gateway adapters", async () => {
  const health = await buildMobileHealthPayload(
    {
      PUSH_GATEWAY_MODE: "preview",
    },
    new Date("2026-04-23T07:40:00+09:00"),
  );

  assert.equal(health.ok, true);
  assert.equal(health.product, "BusWakeUp");
  assert.deepEqual(health.launchFocus, ["seoul", "gyeonggi"]);
  assert.equal(health.pushGateway.adapter, "preview");
  assert.equal(health.pushGateway.executeSupported, false);
  assert.equal(health.pushGateway.authStrategy, "none");
  assert.equal(health.pushGateway.accessTokenStatus, "blocked");
});

test("mobile health marks FCM execution ready only after Firebase credentials are configured", async () => {
  const health = await buildMobileHealthPayload(
    {
      PUSH_GATEWAY_MODE: "execute",
      FCM_PROJECT_ID: "buswakeup-test",
      FCM_ACCESS_TOKEN: "diagnostic-token",
    },
    new Date("2026-04-23T07:40:00+09:00"),
  );

  assert.equal(health.pushGateway.adapter, "fcm");
  assert.equal(health.pushGateway.executeSupported, true);
  assert.equal(health.pushGateway.authStrategy, "manual-bearer");
  assert.equal(health.pushGateway.accessTokenStatus, "ready");
});
