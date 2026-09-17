export async function loadRemoteAppState() {
  const response = await fetch("/api/app-state");
  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`설정 조회 실패 (응답 코드 ${response.status}).`);
  }

  return response.json();
}

export async function saveRemoteAppState(state) {
  const response = await fetch("/api/app-state", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(state),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `설정 저장 실패 (응답 코드 ${response.status}).`);
  }

  return payload;
}
