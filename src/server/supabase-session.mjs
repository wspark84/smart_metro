import { createServerClient, parseCookieHeader, serializeCookieHeader } from "@supabase/ssr";
import { getSupabaseConfig } from "./supabase-gateway.mjs";

export const SOCIAL_PROVIDERS = Object.freeze({ google: "google", kakao: "kakao", naver: "custom:naver" });

export function getSocialLoginConfig(env = process.env) {
  let configured = false;
  try { configured = getSupabaseConfig(env).configured; } catch { /* Fail closed. */ }
  const enabled = new Set(String(env.SUPABASE_AUTH_PROVIDERS || "").split(",").map((s) => s.trim()));
  return {
    mode: "social-only",
    providers: Object.fromEntries(Object.keys(SOCIAL_PROVIDERS).map((provider) => [provider, {
      ready: configured && enabled.has(provider),
      reason: configured && enabled.has(provider) ? "" : "로그인 연결을 준비 중입니다.",
    }])),
  };
}

export function getAuthOrigin(env = process.env) {
  const url = new URL(env.APP_BASE_URL || "http://localhost:4173");
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      (url.protocol !== "https:" && !(local && url.protocol === "http:" && !env.VERCEL))) {
    throw new Error("APP_BASE_URL에는 서비스의 HTTPS 주소를 설정해야 합니다.");
  }
  return url.origin;
}

export function isTrustedMutation(request, env = process.env) {
  const origin = request.headers.origin;
  // Native clients use bearer tokens instead of browser cookies.
  if (!origin) return /^Bearer [^\s]+$/.test(request.headers.authorization || "");
  return origin === getAuthOrigin(env);
}

export function toWorkspaceUser(user) {
  const identities = user.identities || [];
  return {
    id: user.id,
    email: user.email || "",
    emailVerified: Boolean(user.email_confirmed_at),
    name: user.user_metadata?.name || user.user_metadata?.full_name || user.user_metadata?.nickname || "사용자",
    providers: Object.fromEntries(identities.map((identity) => [identity.provider.replace(/^custom:/, ""), {}])),
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}

export function createRequestAuth(request, response, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const config = getSupabaseConfig(env);
  if (!config.configured) throw Object.assign(new Error("Supabase 로그인 설정이 필요합니다."), { statusCode: 503 });
  const jar = new Map(parseCookieHeader(request.headers.cookie || "").map(({ name, value }) => [name, value]));
  const pending = new Map();
  const client = createServerClient(config.url, config.publishableKey, {
    cookieOptions: { name: "smart-metro-auth", httpOnly: true, secure: getAuthOrigin(env).startsWith("https:"), sameSite: "lax", path: "/" },
    global: { fetch: (url, options = {}) => fetchImpl(url, { ...options, signal: AbortSignal.timeout(15000) }) },
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll(cookies) {
        for (const { name, value, options } of cookies) {
          jar.set(name, value);
          pending.set(name, serializeCookieHeader(name, value, { ...options, httpOnly: true }));
        }
        response.setHeader("Set-Cookie", [...pending.values()]);
        response.setHeader("Cache-Control", "private, no-store");
      },
    },
  });
  let resolved;
  const bearer = /^Bearer ([^\s]+)$/.exec(request.headers.authorization || "")?.[1];
  const bearerRequest = async (path, method, body) => {
    const result = await fetchImpl(`${config.url}/auth/v1/${path}`, {
      method, headers: { apikey: config.publishableKey, Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000), redirect: "error",
    });
    if (!result.ok) throw Object.assign(new Error("인증 요청을 완료하지 못했습니다."), { statusCode: result.status === 401 ? 401 : 503 });
    return result.status === 204 ? null : result.json();
  };
  return {
    client,
    async signOut() {
      if (bearer) { await bearerRequest("logout?scope=local", "POST"); return { error: null }; }
      return client.auth.signOut({ scope: "local" });
    },
    async updateProfile(name) {
      if (bearer) return { data: { user: await bearerRequest("user", "PUT", { data: { name } }) }, error: null };
      return client.auth.updateUser({ data: { name } });
    },
    async resolve() {
      if (resolved !== undefined) return resolved;
      const { data, error } = await client.auth.getUser(bearer);
      if (error) {
        if (error.name === "AuthSessionMissingError" || [400, 401, 403].includes(error.status)) return (resolved = null);
        throw Object.assign(new Error("로그인 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요."), { statusCode: 503 });
      }
      if (!data.user || !data.user.identities?.some((identity) => Object.values(SOCIAL_PROVIDERS).includes(identity.provider))) return (resolved = null);
      const sessionResult = bearer ? null : await client.auth.getSession();
      const token = bearer || sessionResult?.data.session?.access_token;
      if (!token) return (resolved = null);
      const expiresAt = sessionResult?.data.session?.expires_at;
      resolved = {
        user: toWorkspaceUser(data.user), accessToken: token,
        session: { id: "", expiresAt: expiresAt ? new Date(expiresAt * 1000).toISOString() : null, updatedAt: new Date().toISOString() },
      };
      return resolved;
    },
  };
}
