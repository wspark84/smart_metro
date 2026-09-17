export async function fetchHolidayApiConfig() {
  const response = await fetch("/api/holidays/config");
  if (!response.ok) {
    throw new Error(`공휴일 연결 설정 조회 실패 (응답 코드 ${response.status}).`);
  }

  return response.json();
}

export async function fetchOfficialHolidays(year) {
  const params = new URLSearchParams();
  params.set("year", String(year ?? "").trim());

  const response = await fetch(`/api/holidays?${params.toString()}`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `공휴일 조회 실패 (응답 코드 ${response.status}).`);
  }

  return payload;
}
