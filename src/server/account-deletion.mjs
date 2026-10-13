import { createClient } from "@supabase/supabase-js";
import { createPlaySubscriptions } from "./play-subscription.mjs";

// Store policy (Google Play / App Store): users must be able to delete their
// account and its data from inside the app and from the web. Every user table
// references auth.users(id) ON DELETE CASCADE, so deleting the auth user removes
// documents, alarm jobs and stored purchase tokens in one database operation.

export const DELETE_CONFIRMATION = "탈퇴";
const fail = (statusCode, code, message) => Object.assign(new Error(message), { statusCode, code });

export function createAdminDeleter(env = process.env, fetchImpl = globalThis.fetch) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (url, options = {}) => fetchImpl(url, { ...options, signal: AbortSignal.timeout(15000) }) },
  });
  return async (userId) => {
    const { error } = await admin.auth.admin.deleteUser(userId, false);
    if (error && error.status !== 404) throw fail(503, "DELETE_FAILED", "계정을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  };
}

export async function deleteAccount({ userId, input, deleteUser, subscriptionStatus }) {
  if (!userId) throw fail(401, "LOGIN_REQUIRED", "로그인이 필요합니다.");
  if (String(input?.confirm || "").trim() !== DELETE_CONFIRMATION) {
    throw fail(400, "CONFIRMATION_REQUIRED", `확인을 위해 '${DELETE_CONFIRMATION}'를 입력해 주세요.`);
  }
  if (!deleteUser) throw fail(503, "DELETE_NOT_CONFIGURED", "탈퇴 처리 설정이 완료되지 않았습니다. 고객센터로 문의해 주세요.");
  // Deleting the account does not cancel a Google Play / App Store subscription.
  // Unknown billing state is treated like an active one so users are always told.
  let subscription;
  try { subscription = await subscriptionStatus(userId); } catch { subscription = { active: true, unknown: true }; }
  if (subscription?.active && input?.acknowledgeSubscription !== true) {
    throw fail(409, "SUBSCRIPTION_ACTIVE",
      "구독은 탈퇴만으로 해지되지 않습니다. Google Play(또는 App Store)의 구독 관리에서 먼저 해지한 뒤 탈퇴해 주세요. 해지 확인 후 다시 진행하면 탈퇴됩니다.");
  }
  await deleteUser(userId);
  return { ok: true, deletedAt: new Date().toISOString() };
}

// Expire every Supabase auth cookie (including chunked ".0", ".1" parts).
export function expiredAuthCookies(cookieHeader = "", secure = true) {
  const names = String(cookieHeader).split(";").map((part) => part.split("=")[0].trim())
    .filter((name) => /^smart-metro-auth(\.\d+)?$/.test(name) || /^smart-metro-auth-code-verifier$/.test(name));
  return [...new Set(names)].map((name) =>
    `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`);
}

export function defaultSubscriptionStatus(env = process.env) {
  return (userId) => createPlaySubscriptions({ env }).status(userId);
}
