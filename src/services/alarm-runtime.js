export async function fetchAlarmRuntimeStatus() {
  const response = await fetch("/api/alarm-runtime");
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `Alarm runtime fetch failed (${response.status}).`);
  }

  return payload;
}

export async function fetchAlarmDeliveryState() {
  const response = await fetch("/api/alarm-delivery");
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `Alarm delivery fetch failed (${response.status}).`);
  }

  return payload;
}

export async function fetchAlarmEvents(limit = 8) {
  const response = await fetch(`/api/alarm-events?limit=${encodeURIComponent(limit)}`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `Alarm event fetch failed (${response.status}).`);
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
    throw new Error(payload.error || `Alarm event create failed (${response.status}).`);
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
    throw new Error(payload.error || `Alarm delivery action failed (${response.status}).`);
  }

  return payload;
}
