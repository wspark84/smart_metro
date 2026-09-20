import { createClient } from "@supabase/supabase-js";

function failure(code, message, statusCode = 503) {
  return Object.assign(new Error(message), { code, statusCode });
}

export function getSupabaseConfig(env = process.env) {
  const url = String(env.SUPABASE_URL || "").trim();
  const publishableKey = String(env.SUPABASE_PUBLISHABLE_KEY || "").trim();
  if (!url && !publishableKey) return { configured: false };
  if (!url || !publishableKey) {
    throw failure("SUPABASE_CONFIG_INCOMPLETE", "Supabase 주소와 공개용 키를 모두 설정해야 합니다.");
  }
  let parsed;
  try { parsed = new URL(url); } catch { /* Report a safe error below. */ }
  if (!parsed || parsed.protocol !== "https:" || parsed.username || parsed.password ||
      parsed.search || parsed.hash || !["", "/"].includes(parsed.pathname)) {
    throw failure("SUPABASE_URL_INVALID", "Supabase 프로젝트의 HTTPS 주소를 확인해 주세요.");
  }
  if (!publishableKey.startsWith("sb_publishable_")) {
    throw failure("SUPABASE_KEY_INVALID", "공개용 키에는 sb_publishable_로 시작하는 키를 입력해 주세요.");
  }
  return { configured: true, url: parsed.origin, publishableKey };
}

function providerFailure(error) {
  // Never return provider diagnostics: these can include SQL, URLs or user data.
  const messages = {
    invalid_credentials: "이메일 또는 비밀번호가 맞지 않습니다.",
    email_not_confirmed: "이메일 인증을 완료한 뒤 로그인해 주세요.",
    over_email_send_rate_limit: "인증 메일 발송 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.",
    email_address_not_authorized: "현재 메일 발송 설정으로는 이 주소에 보낼 수 없습니다. 운영용 SMTP 설정이 필요합니다.",
    weak_password: "더 안전한 비밀번호를 입력해 주세요.",
    user_already_exists: "이미 가입된 이메일입니다. 로그인 또는 비밀번호 재설정을 이용해 주세요.",
  };
  if (["PT409", "40001", "23505"].includes(error?.code)) {
    return failure("DOCUMENT_CONFLICT", "다른 요청에서 설정이 변경됐습니다. 새로 불러온 뒤 다시 저장해 주세요.", 409);
  }
  const code = Object.hasOwn(messages, error?.code || "") ? error.code : "SUPABASE_REQUEST_FAILED";
  return failure(code, messages[code] || "Supabase 요청을 완료하지 못했습니다. 연결 및 권한 설정을 확인해 주세요.", messages[code] ? 400 : 503);
}

function unwrap(result) {
  if (result.error) {
    // Codes/status only: never log database messages, tokens or document bodies.
    const code = /^[A-Za-z0-9_]{1,40}$/.test(result.error.code || "") ? result.error.code : "UNKNOWN";
    console.error("[workspace-storage]", JSON.stringify({ code, status: Number(result.status) || 0 }));
    throw providerFailure(result.error);
  }
  return result.data;
}

export function createSupabaseGateway({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const config = getSupabaseConfig(env);
  if (!config.configured) throw failure("SUPABASE_NOT_CONFIGURED", "Supabase 연결 설정이 필요합니다.");
  const boundedFetch = (input, options = {}) => fetchImpl(input, {
    ...options,
    signal: options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000),
  });
  // A fresh, non-persistent client per operation prevents cross-user sessions
  // from leaking between requests on a warm Vercel function instance.
  const client = (token) => createClient(config.url, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: boundedFetch,
      ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
    },
  });
  const safely = async (operation) => {
    try { return unwrap(await operation()); }
    catch (error) {
      if (error?.statusCode) throw error;
      throw failure("SUPABASE_UNAVAILABLE", "인증 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
  };
  const authenticatedClient = (accessToken) => {
    if (!accessToken || typeof accessToken !== "string") {
      throw failure("AUTH_REQUIRED", "로그인이 필요합니다.", 401);
    }
    return client(accessToken);
  };
  return {
    async signUp({ email, password, name }) {
      if (!String(name || "").trim() || String(password || "").length < 8) {
        throw failure("INVALID_SIGNUP", "이름과 8자 이상의 비밀번호를 입력해 주세요.", 400);
      }
      const data = await safely(() => client().auth.signUp({
        email: String(email || "").trim(), password,
        options: { data: { name: String(name).trim() } },
      }));
      return { ...data, requiresEmailConfirmation: !data.session };
    },
    signIn({ email, password }) {
      return safely(() => client().auth.signInWithPassword({ email: String(email || "").trim(), password }));
    },
    refresh(refreshToken) {
      if (!refreshToken) throw failure("AUTH_REQUIRED", "다시 로그인해 주세요.", 401);
      return safely(() => client().auth.refreshSession({ refresh_token: refreshToken }));
    },
    getUser(accessToken) {
      return safely(() => authenticatedClient(accessToken).auth.getUser(accessToken));
    },
    async readDocument(accessToken, key) {
      validateDocumentKey(key);
      // RLS derives the owner from the verified JWT, never a caller-supplied ID.
      return safely(() => authenticatedClient(accessToken).from("smart_metro_documents")
        .select("document_key,payload,revision").eq("document_key", key).maybeSingle().retry(false));
    },
    async saveDocument(accessToken, key, payload, expectedRevision) {
      validateDocumentKey(key);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
        throw failure("INVALID_REVISION", "저장 버전이 올바르지 않습니다.", 400);
      }
      if (payload === undefined || payload === null || typeof payload !== "object") {
        throw failure("INVALID_DOCUMENT", "저장할 데이터가 올바르지 않습니다.", 400);
      }
      return safely(() => authenticatedClient(accessToken).rpc("save_smart_metro_document", {
        p_document_key: key, p_payload: payload, p_expected_revision: expectedRevision,
      }));
    },
    async saveDocuments(accessToken, documents) {
      if (!Array.isArray(documents) || !documents.length || documents.length > SUPABASE_DOCUMENT_KEYS.length) {
        throw failure("INVALID_DOCUMENT", "저장할 데이터가 올바르지 않습니다.", 400);
      }
      const keys = new Set();
      for (const document of documents) {
        validateDocumentKey(document.document_key);
        if (keys.has(document.document_key) || !Number.isSafeInteger(document.expected_revision) ||
            document.expected_revision < 0 || !document.payload || typeof document.payload !== "object") {
          throw failure("INVALID_DOCUMENT", "저장할 데이터가 올바르지 않습니다.", 400);
        }
        keys.add(document.document_key);
      }
      return safely(() => authenticatedClient(accessToken).rpc("save_smart_metro_documents", { p_documents: documents }));
    },
  };
}

export const SUPABASE_DOCUMENT_KEYS = Object.freeze([
  "app-state", "domain-store", "device-profile", "bus-accuracy", "bus-accuracy-runtime",
  "alarm-runtime", "alarm-delivery", "alarm-events", "dispatch-queue", "dispatch-executions",
  "push-gateway-state",
]);

function validateDocumentKey(key) {
  if (!SUPABASE_DOCUMENT_KEYS.includes(key)) {
    throw failure("INVALID_DOCUMENT_KEY", "지원하지 않는 저장 항목입니다.", 400);
  }
}
