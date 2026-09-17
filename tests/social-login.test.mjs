import test from "node:test";
import assert from "node:assert/strict";
import { createRequestAuth, getSocialLoginConfig, isTrustedMutation, getAuthOrigin } from "../src/server/supabase-session.mjs";
import { handleSocialLoginRoute } from "../src/server/social-login-routes.mjs";
import { fetchNaverUserInfo } from "../src/server/naver-userinfo.mjs";

const env = { SUPABASE_URL: "https://test.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test", APP_BASE_URL: "https://smart-metro.vercel.app", SUPABASE_AUTH_PROVIDERS: "google,kakao,naver" };
function response() {
  return { headers: {}, status: 0, body: "", setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, writeHead(s, h = {}) { this.status = s; Object.entries(h).forEach(([k, v]) => this.setHeader(k, v)); }, end(v) { this.body = v; } };
}
const request = (url, method = "GET", headers = {}) => ({ url, method, headers });
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "X-Supabase-Api-Version": "2024-01-01" } });

test("only explicitly enabled social providers are advertised; keys are never exposed", () => {
  assert.deepEqual(Object.keys(getSocialLoginConfig(env).providers), ["google", "kakao", "naver"]);
  assert.equal(getSocialLoginConfig({ ...env, SUPABASE_AUTH_PROVIDERS: "google" }).providers.naver.ready, false);
  assert.equal(getSocialLoginConfig({}).providers.google.ready, false);
  assert.ok(!JSON.stringify(getSocialLoginConfig(env)).includes("sb_publishable"));
});

test("unsafe origins fail closed; cookie-free bearer API calls remain possible", () => {
  assert.equal(isTrustedMutation(request("/", "POST", { origin: env.APP_BASE_URL }), env), true);
  assert.equal(isTrustedMutation(request("/", "POST", { origin: "https://evil.test", authorization: "Bearer token" }), env), false);
  assert.equal(isTrustedMutation(request("/", "POST"), env), false);
  assert.equal(isTrustedMutation(request("/", "POST", { authorization: "Bearer token" }), env), true);
  assert.throws(() => getAuthOrigin({ APP_BASE_URL: "https://example.com/path" }));
  assert.throws(() => getAuthOrigin({ APP_BASE_URL: "http://localhost:4173", VERCEL: "1" }));
});

test("password signup/login/reset routes are disabled even with no Supabase configuration", async () => {
  for (const path of ["/api/auth/register", "/api/auth/login", "/api/auth/password-reset/request", "/api/account/password", "/api/account/email-verification"]) {
    const res = response();
    assert.equal(await handleSocialLoginRoute(request(path, "POST"), res, () => assert.fail(), { env: {} }), true);
    assert.equal(res.status, 410);
  }
});

test("OAuth starts with the correct provider and fixed callback, never caller redirect", async () => {
  for (const provider of ["google", "kakao", "naver"]) {
    const res = response();
    await handleSocialLoginRoute(request("/api/auth/oauth/start", "POST", { origin: env.APP_BASE_URL }), res,
      async () => ({ provider, redirectTo: "https://evil.test" }), { env,
        createAuth: () => ({ client: { auth: { async signInWithOAuth(input) {
          assert.equal(input.provider, provider === "naver" ? "custom:naver" : provider);
          assert.equal(input.options.redirectTo, `${env.APP_BASE_URL}/api/auth/callback`);
          return { data: { url: "https://test.supabase.co/auth/v1/authorize" } };
        } } } }),
      });
    assert.equal(res.status, 200);
  }
});

test("PKCE verifier is a secure HttpOnly cookie, with no filesystem storage", async () => {
  const res = response();
  const auth = createRequestAuth(request("/"), res, { env, fetchImpl: () => assert.fail("start requires no remote request") });
  const { data, error } = await auth.client.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${env.APP_BASE_URL}/api/auth/callback`, skipBrowserRedirect: true } });
  assert.equal(error, null);
  assert.equal(new URL(data.url).searchParams.get("code_challenge_method"), "s256");
  const cookies = res.headers["set-cookie"].join(";");
  assert.match(cookies, /code-verifier/);
  assert.match(cookies, /HttpOnly/);
  assert.match(cookies, /Secure/);
  assert.match(cookies, /SameSite=Lax/);
});

test("callback failures use a fixed safe redirect and never echo codes or upstream diagnostics", async () => {
  const res = response();
  await handleSocialLoginRoute(request("/api/auth/callback?code=private&next=https://evil.test"), res, async () => ({}), {
    env, createAuth: () => ({ client: { auth: { exchangeCodeForSession: async () => ({ error: { message: "secret SQL" } }) } } }),
  });
  assert.equal(res.status, 303);
  assert.equal(res.headers.location, "/?login_error=oauth_failed");
  assert.ok(!JSON.stringify(res).includes("secret SQL"));
});

test("server verifies bearer identity remotely and rejects email-only users", async () => {
  const create = (provider) => createRequestAuth(request("/", "GET", { authorization: "Bearer jwt" }), response(), {
    env, fetchImpl: async (url, options) => {
      assert.equal(new URL(url).pathname, "/auth/v1/user");
      assert.equal(new Headers(options.headers).get("Authorization"), "Bearer jwt");
      return json({ id: "user-a", identities: [{ provider }], user_metadata: { name: "사용자" } });
    },
  });
  assert.equal((await create("google").resolve()).user.id, "user-a");
  assert.equal(await create("email").resolve(), null);
  assert.equal(await createRequestAuth(request("/"), response(), { env, fetchImpl: () => assert.fail() }).resolve(), null);
});

test("Naver profile adapter verifies token with Naver and omits unverified email", async () => {
  const data = await fetchNaverUserInfo("Bearer naver-token", async (url, options) => {
    assert.equal(url, "https://openapi.naver.com/v1/nid/me");
    assert.equal(options.headers.Authorization, "Bearer naver-token");
    assert.equal(options.redirect, "error");
    return json({ resultcode: "00", response: { id: "naver-id", nickname: "대표", email: "unverified@example.com" } });
  });
  assert.deepEqual(data, { sub: "naver-id", name: "대표" });
  await assert.rejects(fetchNaverUserInfo("invalid", () => assert.fail()), { statusCode: 401 });
  await assert.rejects(fetchNaverUserInfo("Bearer invalid", async () => json({ resultcode: "024" })), { statusCode: 401 });
});

test("real SDK PKCE exchange restores a verified cookie session without exposing credentials", async () => {
  const user = { id: "user-a", identities: [{ provider: "google" }], user_metadata: { name: "사용자" }, aud: "authenticated" };
  const now = Math.floor(Date.now() / 1000);
  const token = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: user.id, exp: now + 3600, iat: now })).toString("base64url")}.testsignature`;
  const startResponse = response();
  const start = createRequestAuth(request("/"), startResponse, { env });
  await start.client.auth.signInWithOAuth({ provider: "google", options: { skipBrowserRedirect: true } });
  const cookieHeader = (res) => res.headers["set-cookie"].map((cookie) => cookie.split(";")[0]).join("; ");
  const callbackResponse = response();
  const callback = createRequestAuth(request("/api/auth/callback", "GET", { cookie: cookieHeader(startResponse) }), callbackResponse, {
    env, fetchImpl: async (url, options) => {
      if (new URL(url).pathname === "/auth/v1/token") {
        const body = JSON.parse(options.body);
        assert.equal(body.auth_code, "single-use-code");
        assert.ok(body.code_verifier.length >= 43);
        return json({ access_token: token, refresh_token: "refresh-secret", token_type: "bearer", expires_in: 3600, user });
      }
      assert.equal(new URL(url).pathname, "/auth/v1/user");
      return json(user);
    },
  });
  assert.equal((await callback.client.auth.exchangeCodeForSession("single-use-code")).error, null);
  assert.equal((await callback.resolve()).user.id, user.id);
  const restored = createRequestAuth(request("/api/auth/session", "GET", { cookie: cookieHeader(callbackResponse) }), response(), {
    env, fetchImpl: async (url, options) => {
      assert.equal(new URL(url).pathname, "/auth/v1/user");
      assert.equal(new Headers(options.headers).get("Authorization"), `Bearer ${token}`);
      return json(user);
    },
  });
  const restoredAuth = await restored.resolve();
  assert.equal(restoredAuth.user.id, user.id);
  assert.equal(restoredAuth.session.id, "");
  assert.ok(!JSON.stringify(restoredAuth.session).includes("refresh-secret"));
});

test("logout and profile updates support verified native bearer sessions", async () => {
  const requests = [];
  const auth = createRequestAuth(request("/", "POST", { authorization: "Bearer native-token" }), response(), {
    env, fetchImpl: async (url, options) => {
      requests.push([new URL(url).pathname, options.method]);
      assert.equal(options.headers.Authorization, "Bearer native-token");
      if (options.method === "PUT") {
        assert.deepEqual(JSON.parse(options.body), { data: { name: "변경 이름" } });
        return json({ id: "user-a", user_metadata: { name: "변경 이름" } });
      }
      return new Response(null, { status: 204 });
    },
  });
  assert.equal((await auth.updateProfile("변경 이름")).data.user.user_metadata.name, "변경 이름");
  assert.equal((await auth.signOut()).error, null);
  assert.deepEqual(requests, [["/auth/v1/user", "PUT"], ["/auth/v1/logout", "POST"]]);
});
