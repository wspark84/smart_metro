// Only provider metadata is accepted here; legacy user-entered values are ignored.
export function koreanServiceDate(now) {
  const date = new Date(now);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-CA', {
    timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',
  }).format(date) : null;
}

export function headwayRange(min, max = min) {
  const values = [min, max].map(value => {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 2 && n <= 180 ? n : null;
  }).filter(value => value !== null);
  return values.length ? {min:Math.min(...values),max:Math.max(...values)} : null;
}

export function selectBusHeadway(profile, now, holidayDates = []) {
  if (!profile || profile.status !== 'ready') return null;
  const date = koreanServiceDate(now);
  if (!date) return null;
  const day = new Date(`${date}T12:00:00+09:00`).getUTCDay();
  const holiday = holidayDates.includes(date);
  const type = holiday ? 'holiday' : day === 6 ? 'saturday' : day === 0 ? 'sunday' : 'weekday';
  const validRange = raw => raw && headwayRange(raw.min,raw.max);
  let range = validRange(profile[type]) || validRange(profile.allDays);
  const weekdayFallback = !range && ['saturday','sunday'].includes(type);
  if (weekdayFallback) range = validRange(profile.weekday);
  if (!range) return null;
  const dayLabel = ({weekday:'평일',saturday:'토요일',sunday:'일요일',holiday:'공휴일'})[type];
  const label = weekdayFallback ? `${dayLabel} 정보 없음 · 평일 배차간격 대체 예상`
    : validRange(profile[type]) ? dayLabel : '공식 제공 간격';
  // Midpoint of the published range, not an observed mean of actual arrivals.
  const minutes = (range.min + range.max) / 2;
  return {...range,minutes,source:profile.source,label,weekdayFallback,checkedAt:profile.checkedAt || profile.fetchedAt,
    fetchedAt:profile.fetchedAt,stale:profile.stale === true,lastChangedAt:profile.lastChangedAt,
    text:`${label} ${range.min === range.max ? range.max : `${range.min}~${range.max}`}분`};
}
