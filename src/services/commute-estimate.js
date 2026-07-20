export async function fetchCommuteApiConfig() {
  const response = await fetch("/api/commute/config");
  if (!response.ok) {
    throw new Error(`Failed to load commute API config (${response.status}).`);
  }

  return response.json();
}

export async function fetchCommuteEstimate(payload) {
  const response = await fetch("/api/commute/estimate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload || {}),
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || `Commute estimate failed (${response.status}).`);
  }

  return result;
}
