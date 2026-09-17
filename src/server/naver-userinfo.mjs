// Naver nests its profile under response; Supabase custom OAuth expects flat
// standard claims. Never assert email ownership that Naver did not verify.
export async function fetchNaverUserInfo(authorization, fetchImpl = globalThis.fetch) {
  if (!/^Bearer [A-Za-z0-9._~+\/-]+=*$/.test(String(authorization || "")) || authorization.length > 8192) {
    throw Object.assign(new Error("유효한 네이버 인증이 필요합니다."), { statusCode: 401 });
  }
  const response = await fetchImpl("https://openapi.naver.com/v1/nid/me", {
    headers: { Authorization: authorization, Accept: "application/json" },
    signal: AbortSignal.timeout(10000), redirect: "error",
  });
  if (!response.ok) throw Object.assign(new Error("네이버 인증을 확인하지 못했습니다."), { statusCode: 401 });
  const data = await response.json();
  if (data.resultcode !== "00" || typeof data.response?.id !== "string" || !data.response.id) {
    throw Object.assign(new Error("네이버 사용자 정보를 확인하지 못했습니다."), { statusCode: 401 });
  }
  // Deliberately omit email. Set email_optional=true on custom:naver. This avoids
  // confirmation mail and unsafe automatic linking to a different provider.
  return { sub: data.response.id, name: String(data.response.nickname || data.response.name || "네이버 사용자") };
}
