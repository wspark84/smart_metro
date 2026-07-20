export async function loadDomainSnapshot() {
  const response = await fetch("/api/domain-snapshot");
  if (response.status === 404) {
    return null;
  }

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `Failed to load domain snapshot (${response.status}).`);
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
    throw new Error(payload.error || `Failed to sync domain snapshot (${response.status}).`);
  }

  return payload;
}
