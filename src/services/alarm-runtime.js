export async function fetchAlarmRuntimeStatus() {
  const response = await fetch("/api/alarm-runtime");
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `알람 상태 조회 실패 (응답 코드 ${response.status}).`);
  }

  return payload;
}

export async function fetchAlarmDeliveryState() {
  const response = await fetch("/api/alarm-delivery");
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `알람 전달 상태 조회 실패 (응답 코드 ${response.status}).`);
  }

  return payload;
}

export async function fetchAlarmEvents(limit = 8) {
  const response = await fetch(`/api/alarm-events?limit=${encodeURIComponent(limit)}`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `알람 기록 조회 실패 (응답 코드 ${response.status}).`);
  }

  return payload;
}

export async function createAlarmEvent(event) {
  const response = await fetch("/api/alarm-events", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(event),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `알람 기록 저장 실패 (응답 코드 ${response.status}).`);
  }

  return payload;
}

export async function sendAlarmDeliveryAction(type) {
  const response = await fetch("/api/alarm-delivery/actions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ type }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `알람 처리 실패 (응답 코드 ${response.status}).`);
  }

  return payload;
}
