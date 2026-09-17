export async function fetchPlaceApiConfig() {
  const response = await fetch("/api/places/config");
  if (!response.ok) {
    throw new Error(`장소 검색 설정 조회 실패 (응답 코드 ${response.status}).`);
  }

  return response.json();
}

export async function searchAddressPlaces(query) {
  const params = new URLSearchParams();
  params.set("query", String(query || "").trim());
  const response = await fetch(`/api/places/search?${params.toString()}`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `주소 검색 실패 (응답 코드 ${response.status}).`);
  }

  return payload;
}
