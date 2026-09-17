export async function fetchAlarmPlanPreview(state, now) {
  const response = await fetch("/api/alarm-plan", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      state,
      now,
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `알람 계획 조회 실패 (응답 코드 ${response.status}).`);
  }

  return payload;
}
