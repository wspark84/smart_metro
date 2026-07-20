export async function fetchHolidayApiConfig() {
  const response = await fetch("/api/holidays/config");
  if (!response.ok) {
    throw new Error(`Failed to load holiday API config (${response.status}).`);
  }

  return response.json();
}

export async function fetchOfficialHolidays(year) {
  const params = new URLSearchParams();
  params.set("year", String(year ?? "").trim());

  const response = await fetch(`/api/holidays?${params.toString()}`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `Holiday sync failed (${response.status}).`);
  }

  return payload;
}
