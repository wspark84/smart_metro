// 이노치 예상시간표: when buses actually passed a stop, learned from the live
// arrivals the app already checks, grouped by day type like a timetable
// ("보통 19:18 · 빠르면 19:15 · 늦으면 19:22"). Used only while no live
// arrival is available; live data always wins.
import {koreanServiceDate} from './bus-headway.js';

export const HISTORY_DAYS = 70;         // ~10 weeks, like a published timetable
const MAX_PER_DAY = 120;
const SAME_BUS_GAP_MIN = 3;             // two records closer than this are one bus
const CLUSTER_GAP_MIN = 5;              // the same daily trip varies within this
const MIN_DAYS = 2;                     // a time seen on one day only is not a timetable

const minuteOfDay = (date) => {
  const [h, m] = new Intl.DateTimeFormat('en-GB', {timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hour12:false})
    .format(date).split(':').map(Number);
  return (h % 24) * 60 + m;
};

/** weekday / saturday / holiday (Sundays and public holidays). */
export function dayTypeOf(date, holidays = []) {
  if (holidays.includes(date)) return 'holiday';
  const day = new Date(`${date}T12:00:00+09:00`).getUTCDay();
  return day === 0 ? 'holiday' : day === 6 ? 'saturday' : 'weekday';
}

/** The bus that was next (and close) in `previous` is gone from `current`:
 *  it passed the stop. Returns when, or null. */
export function detectPassage(previous, current) {
  const prevAt = Date.parse(previous?.fetchedAt || ''), curAt = Date.parse(current?.fetchedAt || '');
  const prevFirst = previous?.arrivalsMin?.[0], curFirst = current?.arrivalsMin?.[0];
  if (![prevAt, curAt, prevFirst, curFirst].every(Number.isFinite)) return null;
  const gap = (curAt - prevAt) / 60000;
  // Close to the stop when last seen, and seen again soon after.
  if (prevFirst > 4 || gap <= 0 || gap > 8) return null;
  const prevEta = prevAt + prevFirst * 60000, curEta = curAt + curFirst * 60000;
  // The first bus now is a later one, not the same bus running late.
  if (curEta - prevEta < SAME_BUS_GAP_MIN * 60000) return null;
  return new Date(Math.max(prevAt, Math.min(prevEta, curAt)));
}

/** Adds one passage to the per-day lists ({ 'YYYY-MM-DD': [minute, ...] }),
 *  dropping days older than HISTORY_DAYS. Returns the new lists, or null when
 *  nothing changed (same bus already recorded). */
export function addPassage(days = {}, at, now = at) {
  const date = koreanServiceDate(at);
  if (!date) return null;
  const minute = minuteOfDay(at);
  const list = Array.isArray(days[date]) ? days[date] : [];
  if (list.some((value) => Math.abs(value - minute) < SAME_BUS_GAP_MIN)) return null;
  const cutoff = koreanServiceDate(new Date(new Date(now).getTime() - HISTORY_DAYS * 86400000));
  const next = Object.fromEntries(Object.entries(days).filter(([day, values]) => day >= cutoff && Array.isArray(values)));
  next[date] = [...list, minute].sort((a, b) => a - b).slice(-MAX_PER_DAY);
  return next;
}

/** Timetable rows for one day type, earlier days only (not today):
 *  [{typical, earliest, latest, days}] in minutes of the day. */
export function historyTimetable(days = {}, {type, today, holidays = []} = {}) {
  const points = [];
  for (const [date, values] of Object.entries(days || {})) {
    if (date === today || !Array.isArray(values) || dayTypeOf(date, holidays) !== type) continue;
    for (const value of values) if (Number.isFinite(value)) points.push({date, value});
  }
  points.sort((a, b) => a.value - b.value);
  const clusters = [];
  for (const point of points) {
    const last = clusters.at(-1);
    if (last && point.value - last.at(-1).value <= CLUSTER_GAP_MIN) last.push(point); else clusters.push([point]);
  }
  return clusters.map((cluster) => {
    const values = cluster.map((p) => p.value);
    return {typical:values[Math.floor((values.length - 1) / 2)], earliest:values[0], latest:values.at(-1),
      days:new Set(cluster.map((p) => p.date)).size};
  }).filter((row) => row.days >= MIN_DAYS && row.latest - row.earliest <= 20);
}

/** Today's rows as minutes from `now` (a row is kept until its latest time). */
export function upcomingFromHistory(days, now, holidays = []) {
  const today = koreanServiceDate(now);
  if (!today) return [];
  const rows = historyTimetable(days, {type:dayTypeOf(today, holidays), today, holidays});
  const current = minuteOfDay(new Date(now)) + new Date(now).getUTCSeconds() / 60;
  return rows.map((row) => ({...row, earliestMin:row.earliest - current, latestMin:row.latest - current, typicalMin:row.typical - current}))
    .filter((row) => row.latestMin >= 0);
}
