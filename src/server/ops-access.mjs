// Launch hardening: operator-only tools, redacted diagnostics, push target
// allow-listing and per-user throttles. Nothing here reads request bodies.

// Comma-separated, verified e-mail addresses allowed to run diagnostics.
export function operatorEmails(env = process.env) {
  return new Set(String(env.SMART_METRO_OPERATOR_EMAILS || "")
    .split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
}

export function isOperator(user, env = process.env) {
  const email = String(user?.email || "").trim().toLowerCase();
  return Boolean(email) && user?.emailVerified !== false && operatorEmails(env).has(email);
}

// Developer simulations that write synthetic failures into account history.
export const OPERATOR_ONLY_PATHS = new Set([
  "/api/push-gateway/retry-simulation",
]);

const PRIVATE_FCM_FIELDS = ["serviceAccountEmail", "privateKeyId", "serviceAccountFilePath",
  "serviceAccountProjectId", "projectId", "tokenEndpoint", "scope"];

// Ordinary users only need to know whether push delivery is ready.
export function redactFcmAuthStatus(status, operator = false) {
  if (operator || !status || typeof status !== "object") return status;
  const safe = { ...status };
  for (const key of PRIVATE_FCM_FIELDS) delete safe[key];
  if (safe.reason) safe.reason = "푸시 인증 상태를 확인하지 못했습니다. 운영자에게 문의해 주세요.";
  return safe;
}

// Web Push endpoints come from the browser and are POSTed to by the server.
// Only the public push services of major browsers are accepted (SSRF guard).
const WEB_PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)notify\.windows\.com$/,
  /(^|\.)push\.apple\.com$/,
];

export function isAllowedWebPushEndpoint(endpoint) {
  try {
    const url = new URL(String(endpoint || "").trim());
    if (url.protocol !== "https:" || url.port || url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    return WEB_PUSH_HOSTS.some((pattern) => pattern.test(host));
  } catch {
    return false;
  }
}

// Best-effort per-instance throttle. Serverless instances do not share it,
// so it limits bursts; it is not a billing-grade quota.
export function createUserThrottle({ minIntervalMs, dailyMax, now = () => Date.now() }) {
  const seen = new Map();
  return function take(userId) {
    const id = String(userId || "");
    const current = now();
    const day = new Date(current + 9 * 3600_000).toISOString().slice(0, 10);
    const entry = seen.get(id);
    const record = entry && entry.day === day ? entry : { day, count: 0, last: 0 };
    if (record.last && current - record.last < minIntervalMs) {
      return { ok: false, retryAfterSec: Math.ceil((minIntervalMs - (current - record.last)) / 1000) };
    }
    if (record.count >= dailyMax) return { ok: false, retryAfterSec: null };
    record.count += 1;
    record.last = current;
    seen.set(id, record);
    if (seen.size > 5000) seen.delete(seen.keys().next().value);
    return { ok: true };
  };
}

export const MAX_PROBE_CANDIDATES = 4;
export const PROBE_PROVIDERS = new Set(["seoul", "gyeonggi", "tago", "subway"]);
