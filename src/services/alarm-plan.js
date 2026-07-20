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
    throw new Error(payload.error || `Alarm plan preview failed (${response.status}).`);
  }

  return payload;
}
