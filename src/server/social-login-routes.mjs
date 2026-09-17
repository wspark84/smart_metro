import { createRequestAuth, getAuthOrigin, getSocialLoginConfig, isTrustedMutation, SOCIAL_PROVIDERS, toWorkspaceUser } from "./supabase-session.mjs";
import { fetchNaverUserInfo } from "./naver-userinfo.mjs";
import { sanitizeAuthUser } from "./auth-service.mjs";

const DISABLED = new Set([
  "/api/auth/register", "/api/auth/login", "/api/auth/email-status", "/api/auth/verify-email",
  "/api/auth/password-reset/request", "/api/auth/password-reset/confirm",
  "/api/account/password", "/api/account/email-verification",
]);

export function sendAuthJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store" });
  response.end(JSON.stringify(payload));
}

export async function handleSocialLoginRoute(request, response, readJsonBody, {
  env = process.env, createAuth = createRequestAuth, naverUserInfo = fetchNaverUserInfo,
} = {}) {
  const url = new URL(request.url, "http://internal");
  const path = url.pathname;
  const handled = path.startsWith("/api/auth/") || DISABLED.has(path) || path === "/api/account/profile";
  if (!handled) return false;
  try {
    if (DISABLED.has(path)) {
      sendAuthJson(response, 410, { error: "이메일 가입과 비밀번호 로그인은 사용하지 않습니다. 구글·카카오·네이버 로그인을 이용해 주세요." });
      return true;
    }
    if (path === "/api/auth/providers" && request.method === "GET") {
      sendAuthJson(response, 200, { config: getSocialLoginConfig(env) });
      return true;
    }
    if (path === "/api/auth/naver/userinfo" && request.method === "GET") {
      sendAuthJson(response, 200, await naverUserInfo(request.headers.authorization));
      return true;
    }
    if (!["GET", "HEAD"].includes(request.method) && !isTrustedMutation(request, env)) {
      sendAuthJson(response, 403, { error: "허용되지 않은 요청입니다. 서비스 화면에서 다시 시도해 주세요." });
      return true;
    }
    if (path === "/api/auth/oauth/start" && request.method === "POST") {
      const { provider } = await readJsonBody(request);
      if (!Object.hasOwn(SOCIAL_PROVIDERS, provider || "") || !getSocialLoginConfig(env).providers[provider].ready) {
        sendAuthJson(response, 400, { error: "아직 사용할 수 없는 로그인입니다. 다른 로그인 방법을 선택해 주세요." });
        return true;
      }
      const auth = createAuth(request, response, { env });
      const { data, error } = await auth.client.auth.signInWithOAuth({
        provider: SOCIAL_PROVIDERS[provider],
        options: { redirectTo: `${getAuthOrigin(env)}/api/auth/callback`, skipBrowserRedirect: true },
      });
      if (error || !data.url) throw new Error("OAuth start failed");
      sendAuthJson(response, 200, { ok: true, provider, authorizationUrl: data.url });
      return true;
    }
    if (path === "/api/auth/callback" && request.method === "GET") {
      const code = url.searchParams.get("code");
      if (!code || code.length > 4096 || url.searchParams.has("error")) throw new Error("OAuth callback rejected");
      const auth = createAuth(request, response, { env });
      const { error } = await auth.client.auth.exchangeCodeForSession(code);
      if (error || !await auth.resolve()) throw new Error("OAuth session rejected");
      response.writeHead(303, { Location: "/", "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" });
      response.end();
      return true;
    }
    if (path === "/api/auth/session" && request.method === "GET") {
      const auth = await createAuth(request, response, { env }).resolve();
      sendAuthJson(response, 200, { authenticated: Boolean(auth), user: auth ? sanitizeAuthUser(auth.user) : null, session: auth?.session || null });
      return true;
    }
    if (path === "/api/auth/logout" && request.method === "POST") {
      const auth = createAuth(request, response, { env });
      const { error } = await auth.signOut();
      if (error && ![401, 403, 404].includes(error.status)) throw new Error("Logout failed");
      sendAuthJson(response, 200, { ok: true });
      return true;
    }
    if (path === "/api/account/profile" && request.method === "PUT") {
      const auth = createAuth(request, response, { env });
      if (!await auth.resolve()) {
        sendAuthJson(response, 401, { error: "로그인이 필요합니다." });
        return true;
      }
      const payload = await readJsonBody(request);
      const name = String(payload.name || "").trim();
      if (!name || name.length > 80) {
        sendAuthJson(response, 400, { error: "이름은 1~80자로 입력해 주세요." });
        return true;
      }
      const { data, error } = await auth.updateProfile(name);
      if (error) throw new Error("Profile update failed");
      sendAuthJson(response, 200, { ok: true, user: sanitizeAuthUser(toWorkspaceUser(data.user)) });
      return true;
    }
    sendAuthJson(response, 404, { error: "지원하지 않는 로그인 경로입니다." });
  } catch (error) {
    if (path === "/api/auth/callback") {
      response.writeHead(303, { Location: "/?login_error=oauth_failed", "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" });
      response.end();
    } else {
      sendAuthJson(response, error.statusCode || 503, { error: "로그인 요청을 완료하지 못했습니다. 연결 설정을 확인하거나 잠시 후 다시 시도해 주세요." });
    }
  }
  return true;
}
