export function cityDisplayName(city) {
  return String(city?.cityName || "").replace(/^경기\s+/, "경기도 ");
}

export function searchCityCandidates(cities, query) {
  const normalize = value => String(value || "").normalize("NFKC").replace(/\s+/g, "").toLowerCase();
  const term = normalize(query);
  if (!term) return [];
  return cities.filter(city => normalize(cityDisplayName(city)).includes(term))
    .sort((a,b) => Number(!a.available)-Number(!b.available) || cityDisplayName(a).localeCompare(cityDisplayName(b), "ko"));
}
