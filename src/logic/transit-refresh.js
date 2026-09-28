// Shared by browser and worker: changing the timer must not multiply upstream calls.
export function transitRefreshInterval(remainingMin) {
  if (!Number.isFinite(remainingMin)) return 30_000;
  if (remainingMin > 60) return 5 * 60_000;
  if (remainingMin > 30) return 60_000;
  return 30_000;
}

export function nextTransitRefreshAt(checkedAt, departureAt) {
  const checked=Date.parse(checkedAt), departure=Date.parse(departureAt);
  if (!Number.isFinite(checked)) return null;
  const remaining=(departure-checked)/60_000;
  let next=checked+transitRefreshInterval(remaining);
  // Wake exactly at a faster tier boundary, not five minutes after it.
  if (remaining>60) next=Math.min(next,departure-60*60_000);
  else if (remaining>30) next=Math.min(next,departure-30*60_000);
  return new Date(next).toISOString();
}
