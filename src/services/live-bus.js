export async function fetchBusApiConfig() {
  const response = await fetch("/api/bus/config");
  if (!response.ok) {
    throw new Error(`Failed to load API config (${response.status}).`);
  }

  return response.json();
}

export async function fetchTagoCityList() {
  const response = await fetch("/api/bus/cities?provider=tago&service=stops");
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "TAGO 도시목록 조회에 실패했습니다.");
  return payload;
}

export async function fetchLiveArrivals(binding) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(binding)) {
    if (value !== null && value !== undefined && String(value).trim() !== "") {
      params.set(key, String(value).trim());
    }
  }

  const response = await fetch(`/api/bus/arrivals?${params.toString()}`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `Live bus fetch failed (${response.status}).`);
  }

  return payload;
}

export async function searchLiveStations(binding) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(binding)) {
    if (value !== null && value !== undefined && String(value).trim() !== "") {
      params.set(key, String(value).trim());
    }
  }

  const response = await fetch(`/api/bus/stations?${params.toString()}`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `Live station search failed (${response.status}).`);
  }

  return payload;
}

export async function searchLiveStationRoutes(binding) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(binding)) {
    if (value !== null && value !== undefined && String(value).trim() !== "") {
      params.set(key, String(value).trim());
    }
  }

  const response = await fetch(`/api/bus/station-routes?${params.toString()}`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `Live station-route search failed (${response.status}).`);
  }

  return payload;
}

export async function fetchBusAccuracySummary(filters = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== null && value !== undefined && String(value).trim() !== "") {
      params.set(key, String(value).trim());
    }
  }

  const query = params.toString();
  const response = await fetch(`/api/bus/accuracy${query ? `?${query}` : ""}`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `Bus accuracy summary fetch failed (${response.status}).`);
  }

  return payload;
}

export async function fetchBusAccuracyLeaderboard(filters = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== null && value !== undefined && String(value).trim() !== "") {
      params.set(key, String(value).trim());
    }
  }

  const query = params.toString();
  const response = await fetch(`/api/bus/accuracy/leaderboard${query ? `?${query}` : ""}`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `Bus accuracy leaderboard fetch failed (${response.status}).`);
  }

  return payload;
}

export async function runBusAccuracyProbe(payload) {
  const response = await fetch("/api/bus/accuracy/probe", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || `Bus accuracy probe failed (${response.status}).`);
  }

  return result;
}

export async function recordActualBusArrival(payload) {
  const response = await fetch("/api/bus/accuracy/actual-arrival", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || `Actual bus arrival logging failed (${response.status}).`);
  }

  return result;
}

export async function runBusAccuracyAutoProbe() {
  const response = await fetch("/api/bus/accuracy/auto-probe", {
    method: "POST",
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || `Automatic bus accuracy probe failed (${response.status}).`);
  }

  return result;
}
