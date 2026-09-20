import test from "node:test";
import assert from "node:assert/strict";
import { createSupabaseGateway, getSupabaseConfig } from "../src/server/supabase-gateway.mjs";

const env = { SUPABASE_URL: "https://test-project.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" };
const response = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json", "X-Supabase-Api-Version": "2024-01-01" },
});

test("Supabase config is optional, but partial and secret-key configurations fail closed", () => {
  assert.deepEqual(getSupabaseConfig({}), { configured: false });
  assert.throws(() => getSupabaseConfig({ SUPABASE_URL: env.SUPABASE_URL }), { code: "SUPABASE_CONFIG_INCOMPLETE" });
  for (const key of ["sb_secret_do-not-echo", "eyJlegacy", "wrong"]) {
    assert.throws(() => getSupabaseConfig({ ...env, SUPABASE_PUBLISHABLE_KEY: key }), (error) =>
      error.code === "SUPABASE_KEY_INVALID" && !error.message.includes(key));
  }
  for (const url of ["http://test-project.supabase.co", "https://user:password@example.com", "https://example.com/path", "https://example.com/?secret=value"]) {
    assert.throws(() => getSupabaseConfig({ ...env, SUPABASE_URL: url }), { code: "SUPABASE_URL_INVALID" });
  }
  assert.equal(getSupabaseConfig({ ...env, SUPABASE_URL: `${env.SUPABASE_URL}/` }).url, env.SUPABASE_URL);
});

test("signup awaiting email verification must not be reported as authenticated", async () => {
  const gateway = createSupabaseGateway({ env, fetchImpl: async (url, options) => {
    assert.equal(new URL(url).pathname, "/auth/v1/signup");
    const body = JSON.parse(options.body);
    assert.equal(body.email, "owner@example.com");
    assert.equal(body.data.name, "Owner");
    assert.ok(options.signal);
    return response({ id: "user-1", email: body.email, identities: [], aud: "authenticated" });
  } });
  const result = await gateway.signUp({ name: " Owner ", email: " owner@example.com ", password: "test-password" });
  assert.equal(result.requiresEmailConfirmation, true);
  assert.equal(result.session, null);
});

test("signup validates name and password before making a network request", async () => {
  const gateway = createSupabaseGateway({ env, fetchImpl: () => assert.fail("Unexpected request") });
  await assert.rejects(gateway.signUp({ name: "", password: "long-password" }), { code: "INVALID_SIGNUP" });
  await assert.rejects(gateway.signUp({ name: "Owner", password: "short" }), { code: "INVALID_SIGNUP" });
});

test("auth errors are localized and arbitrary provider messages do not leak", async () => {
  const gateway = createSupabaseGateway({ env, fetchImpl: async () => response({
    code: "invalid_credentials", msg: "credentials with secret material",
  }, 400) });
  await assert.rejects(gateway.signIn({ email: "owner@example.com", password: "wrong" }), (error) =>
    error.code === "invalid_credentials" && !error.message.includes("secret"));
  const broken = createSupabaseGateway({ env, fetchImpl: async () => response({
    code: "unknown_failure", message: "private SQL and keys",
  }, 400) });
  await assert.rejects(broken.signIn({ email: "x@example.com", password: "wrong" }), (error) =>
    error.code === "SUPABASE_REQUEST_FAILED" && !error.message.includes("private"));
});

test("concurrent data reads use separate users' JWTs, not a shared admin key", async () => {
  const tokens = [];
  const gateway = createSupabaseGateway({ env, fetchImpl: async (url, options) => {
    const headers = new Headers(options.headers);
    tokens.push(headers.get("Authorization"));
    assert.equal(headers.get("apikey"), env.SUPABASE_PUBLISHABLE_KEY);
    assert.equal(new URL(url).searchParams.get("document_key"), "eq.app-state");
    return response([{ document_key: "app-state", payload: {}, revision: 1 }]);
  } });
  await Promise.all([gateway.readDocument("user-a-jwt", "app-state"), gateway.readDocument("user-b-jwt", "app-state")]);
  assert.deepEqual(tokens.sort(), ["Bearer user-a-jwt", "Bearer user-b-jwt"]);
});

test("document writes use a version-checked RPC and send no caller-specified owner ID", async () => {
  const gateway = createSupabaseGateway({ env, fetchImpl: async (url, options) => {
    assert.equal(new URL(url).pathname, "/rest/v1/rpc/save_smart_metro_document");
    assert.deepEqual(JSON.parse(options.body), { p_document_key: "app-state", p_payload: { ready: true }, p_expected_revision: 4 });
    return response({ document_key: "app-state", payload: { ready: true }, revision: 5 });
  } });
  assert.equal((await gateway.saveDocument("user-jwt", "app-state", { ready: true }, 4)).revision, 5);
});

test("unauthenticated, arbitrary-key and invalid-version reads/writes are blocked locally", async () => {
  const gateway = createSupabaseGateway({ env, fetchImpl: () => assert.fail("Unexpected request") });
  await assert.rejects(gateway.readDocument("", "app-state"), { code: "AUTH_REQUIRED" });
  await assert.rejects(gateway.readDocument("jwt", "../../auth/users.json"), { code: "INVALID_DOCUMENT_KEY" });
  await assert.rejects(gateway.saveDocument("jwt", "app-state", {}, -1), { code: "INVALID_REVISION" });
  await assert.rejects(gateway.saveDocument("jwt", "app-state", null, 0), { code: "INVALID_DOCUMENT" });
});

test("version conflicts return 409 rather than silently overwriting newer data", async () => {
  const gateway = createSupabaseGateway({ env, fetchImpl: async () => response({ code: "40001", message: "internal detail" }, 400) });
  await assert.rejects(gateway.saveDocument("jwt", "app-state", {}, 2), { code: "DOCUMENT_CONFLICT", statusCode: 409 });
});

test("unavailable workspace storage returns once instead of multiplying the request timeout", async () => {
  let calls = 0;
  const gateway = createSupabaseGateway({ env, fetchImpl: async () => {
    calls++;
    return response({ code: 'PGRST002', message: 'private database details' }, 503);
  } });
  await assert.rejects(gateway.readDocument('jwt', 'app-state'), { code: 'SUPABASE_REQUEST_FAILED' });
  assert.equal(calls, 1);
});
