// Shared by browser and worker: changing the timer must not multiply upstream calls.
// Tiers by minutes left until the leave-home time (대표 결정 2026-11-03):
//   > 120: no call until 120 minutes before   60–120: every 15 minutes
//   30–60: every 5 minutes                    ≤ 30 until the leave time: every 30 seconds
//   after the leave time, or when it is unknown: no automatic call (the app offers a
//   manual refresh instead).
export function transitRefreshInterval(remainingMin) {
  if (!Number.isFinite(remainingMin) || remainingMin < 0) return null;
  if (remainingMin > 60) return 15 * 60_000;
  if (remainingMin > 30) return 5 * 60_000;
  return 30_000;
}

// Next KST midnight: automatic checks resume with the next service day.
export function nextServiceDayStart(checkedAt) {
  const checked = Date.parse(checkedAt);
  const kst = new Date(checked + 9 * 3600_000);
  return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() + 1) - 9 * 3600_000).toISOString();
}

export function nextTransitRefreshAt(checkedAt, departureAt) {
  const checked=Date.parse(checkedAt), departure=Date.parse(departureAt);
  if (!Number.isFinite(checked)) return null;
  const remaining=(departure-checked)/60_000;
  const interval=transitRefreshInterval(remaining);
  if (interval===null) return nextServiceDayStart(checkedAt);
  if (remaining>120) return new Date(departure-120*60_000).toISOString();
  let next=checked+interval;
  // Wake exactly at a faster tier boundary, not one interval after it.
  if (remaining>60) next=Math.min(next,departure-60*60_000);
  else if (remaining>30) next=Math.min(next,departure-30*60_000);
  return new Date(next).toISOString();
}

// Automatic checks are paused (departed, or leave time unknown) until a person asks.
export const automaticRefreshPaused = (options, now = new Date()) =>
  Boolean(options?.nextRefreshAt) && Date.parse(options.nextRefreshAt) > now.getTime() &&
  Date.parse(options.nextRefreshAt) === Date.parse(nextServiceDayStart(options.updatedAt || options.fetchedAt));
