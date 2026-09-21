// Names only. Never manufacture city codes or translate provider station IDs.
export const GYEONGGI_CITIES = '수원시 성남시 의정부시 안양시 부천시 광명시 평택시 동두천시 안산시 고양시 과천시 구리시 남양주시 오산시 시흥시 군포시 의왕시 하남시 용인시 파주시 이천시 안성시 김포시 화성시 광주시 양주시 포천시 여주시 연천군 가평군 양평군'.split(' ');

export function normalizeGyeonggiCity(name) {
  const label=String(name || '').replace(/^경기도\s*/, '').trim();
  // GBIS uses short labels like 수원. Unknown regions must not match a city.
  return GYEONGGI_CITIES.find(city=>label===city || label===city.replace(/[시군]$/, '')) || '';
}
