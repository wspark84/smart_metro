import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isOperator, redactFcmAuthStatus, isAllowedWebPushEndpoint, createUserThrottle, OPERATOR_ONLY_PATHS } from "../src/server/ops-access.mjs";

const env = { SMART_METRO_OPERATOR_EMAILS: " Ops@Example.com, second@example.com " };

test("operator list is explicit, case-insensitive and empty by default", () => {
  assert.equal(isOperator({ email: "ops@example.com", emailVerified: true }, env), true);
  assert.equal(isOperator({ email: "ops@example.com", emailVerified: false }, env), false);
  assert.equal(isOperator({ email: "user@example.com" }, env), false);
  assert.equal(isOperator({ email: "ops@example.com" }, {}), false);
  assert.equal(isOperator(null, env), false);
  assert.ok(OPERATOR_ONLY_PATHS.has("/api/push-gateway/retry-simulation"));
});

test("FCM status hides service-account identity from ordinary users", () => {
  const status = { authStrategy: "service-account-inline", serviceAccountConfigured: true, accessTokenStatus: "error",
    serviceAccountEmail: "fcm@project.iam.gserviceaccount.com", privateKeyId: "abc123", projectId: "p",
    serviceAccountFilePath: "/secret.json", serviceAccountProjectId: "p", reason: "invalid_grant for fcm@project" };
  const safe = redactFcmAuthStatus(status, false);
  for (const key of ["serviceAccountEmail", "privateKeyId", "projectId", "serviceAccountFilePath", "serviceAccountProjectId"]) assert.equal(key in safe, false);
  assert.doesNotMatch(JSON.stringify(safe), /gserviceaccount|abc123|invalid_grant/);
  assert.equal(safe.accessTokenStatus, "error");
  assert.deepEqual(redactFcmAuthStatus(status, true), status);
});

test("web push endpoints are limited to browser push services", () => {
  for (const ok of ["https://fcm.googleapis.com/fcm/send/abc", "https://updates.push.services.mozilla.com/wpush/v2/x",
    "https://web.push.apple.com/QW", "https://wns2-par02p.notify.windows.com/w/?token=1"]) assert.equal(isAllowedWebPushEndpoint(ok), true, ok);
  for (const bad of ["http://fcm.googleapis.com/x", "https://169.254.169.254/latest", "https://localhost/x",
    "https://fcm.googleapis.com.evil.com/x", "https://fcm.googleapis.com:8443/x", "https://user:pw@fcm.googleapis.com/x",
    "https://evilpush.apple.com.attacker.net/", "javascript:alert(1)", "", null]) assert.equal(isAllowedWebPushEndpoint(bad), false, String(bad));
});

test("test push throttle enforces interval and daily cap per user", () => {
  let now = Date.parse("2026-10-13T00:00:00Z");
  const take = createUserThrottle({ minIntervalMs: 30_000, dailyMax: 2, now: () => now });
  assert.equal(take("a").ok, true);
  assert.equal(take("a").ok, false);
  assert.equal(take("b").ok, true);
  now += 31_000; assert.equal(take("a").ok, true);
  now += 31_000; const capped = take("a"); assert.equal(capped.ok, false); assert.equal(capped.retryAfterSec, null);
  now += 24 * 3600_000; assert.equal(take("a").ok, true);
});

test("server wires the launch hardening into risky endpoints", async () => {
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(server, /OPERATOR_ONLY_PATHS\.has\(requestUrl\.pathname\) && !isOperator/);
  assert.match(server, /redactFcmAuthStatus\(await readFcmAuthStatus/);
  assert.match(server, /testPushThrottle\(activeUserContext\.user\?\.id\)/);
  assert.match(server, /operator \? rawPayload : \{ riskLevel: rawPayload\?\.riskLevel \}/);
  assert.match(server, /candidates\.length > MAX_PROBE_CANDIDATES/);
  const gateway = await readFile(new URL("../src/server/push-gateway.mjs", import.meta.url), "utf8");
  assert.match(gateway, /isAllowedWebPushEndpoint\(subscription\.endpoint\)/);
});
