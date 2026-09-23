import { addMinutes, combineDateAndTime, mergeHolidayDates, shouldFireToday } from '../logic/commute.js';
import { isLiveConfigured } from '../logic/live-arrivals.js';
import { departurePlanningEnabled } from '../logic/boarding-plan.js';
import { transitQueryKey, transitQueryForState } from '../logic/transit-journey.js';

// The alarm worker must fetch its own ETAs; an open browser is not a scheduler.
export function isAlarmRefreshWindow(state, now) {
  if (!isLiveConfigured(state)) return false;
  const holidays = mergeHolidayDates(state.holidayDates,
    (state.officialHolidays || []).filter((item) => item.isHoliday).map((item) => item.date));
  if (!shouldFireToday(state.schedule, now, holidays)) return false;
  if (departurePlanningEnabled(state)) {
    const journey = state.commute.transitJourney;
    if (!journey?.boardingConfirmed || journey.queryKey !== transitQueryKey(transitQueryForState(state))) return false;
    const duration = Number(journey.onboardDurationSec)/60;
    if (!Number.isFinite(duration) || duration <= 0) return false;
    const goal = combineDateAndTime(now,state.user.requiredArrivalTime);
    const latest = addMinutes(goal,-duration-Number(state.commute.boardingAccessMin || 0));
    return now >= addMinutes(latest,-90) && now <= addMinutes(goal,1.5);
  }
  const start = combineDateAndTime(now, state.schedule.startTime);
  let end = combineDateAndTime(now, state.schedule.endTime);
  if (end < start) end = addMinutes(end, 24 * 60);
  return now >= addMinutes(start, -10) && now <= addMinutes(end, 1.5);
}

export async function refreshAlarmArrivals(state, now, loadArrival) {
  if (!isAlarmRefreshWindow(state, now)) return state;
  const age = now.getTime() - Date.parse(state.live.snapshot?.fetchedAt || '');
  if (age >= 0 && age < 30_000 &&
      String(state.live.snapshot?.lineNumber) === String(state.live.routeNumber)) return state;
  try {
    const result = await loadArrival(state.live);
    return {...state, live:{...state.live, snapshot:{...result.value, fetchedAt:result.fetchedAt},
      status:'ready', lastSyncedAt:result.fetchedAt, lastError:''}};
  } catch (error) {
    return {...state, live:{...state.live, snapshot:null, status:'error',
      lastError:error instanceof Error ? error.message : '실시간 버스 도착정보 조회에 실패했습니다.'}};
  }
}
