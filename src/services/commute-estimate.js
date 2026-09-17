export async function fetchCommuteApiConfig() {
  const response = await fetch("/api/commute/config");
  if (!response.ok) {
    throw new Error(`이동 경로 연결 설정 조회 실패 (응답 코드 ${response.status}).`);
  }

  return response.json();
}

export async function fetchCommuteEstimate(payload) {
  const response = await fetch("/api/commute/transit", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload || {}),
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || `이동 경로 조회 실패 (응답 코드 ${response.status}).`);
  }

  return result;
}
