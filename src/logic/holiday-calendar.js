export function koreanCalendarMonth(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Date(date.getTime() + 9 * 60 * 60_000).toISOString().slice(0, 7);
}

export function holidayRefreshDue(checkedAt, failed, now = new Date()) {
  if (!checkedAt || !koreanCalendarMonth(checkedAt)) return true;
  if (failed) return now.getTime() - Date.parse(checkedAt) >= 60 * 60_000;
  return koreanCalendarMonth(checkedAt) !== koreanCalendarMonth(now);
}
