export async function loadDomainSnapshot() {
  const response = await fetch("/api/domain-snapshot");
  if (response.status === 404) {
    return null;
  }

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `계정 설정 조회 실패 (응답 코드 ${response.status}).`);
  }

  return payload;
}

export async function syncDomainSnapshot(state) {
  const response = await fetch("/api/domain-sync", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ state }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `계정 설정 저장 실패 (응답 코드 ${response.status}).`);
  }

  return payload;
}
