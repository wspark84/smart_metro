export async function fetchPlaceApiConfig() {
  const response = await fetch("/api/places/config");
  if (!response.ok) {
    throw new Error(`Failed to load place API config (${response.status}).`);
  }

  return response.json();
}

export async function searchAddressPlaces(query) {
  const params = new URLSearchParams();
  params.set("query", String(query || "").trim());
  const response = await fetch(`/api/places/search?${params.toString()}`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `Address search failed (${response.status}).`);
  }

  return payload;
}
