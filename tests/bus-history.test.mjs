import test from 'node:test';
import assert from 'node:assert/strict';
import {detectPassage,addPassage,historyTimetable,upcomingFromHistory,dayTypeOf,passageTimetable,mergePassageDays} from '../src/logic/bus-history.js';
import {loadStoredTransit} from '../src/server/stored-transit.mjs';
import {buildJourneyOptionsPlan} from '../src/logic/journey-options.js';
import {buildHomeForecast} from '../src/server/mobile-api.mjs';

// 이노치 예상시간표: when buses actually passed the stop on earlier days of the
// same type, used while no live arrival is available (2026-11-08 request).
const kst = (date, clock) => new Date(`${date}T${clock}:00+09:00`);

test('a bus that was 2 minutes away and is now replaced by a later one has passed', () => {
  const prev = {fetchedAt:'2026-11-08T10:16:00Z', arrivalsMin:[2, 20]};
  assert.equal(detectPassage(prev, {fetchedAt:'2026-11-08T10:19:00Z', arrivalsMin:[17]}).toISOString(), '2026-11-08T10:18:00.000Z');
  // Same bus running late is not a passage.
  assert.equal(detectPassage(prev, {fetchedAt:'2026-11-08T10:17:00Z', arrivalsMin:[2]}), null);
  // Too far when last seen, or seen again too late, is not trusted.
  assert.equal(detectPassage({...prev, arrivalsMin:[9]}, {fetchedAt:'2026-11-08T10:19:00Z', arrivalsMin:[30]}), null);
  assert.equal(detectPassage(prev, {fetchedAt:'2026-11-08T10:40:00Z', arrivalsMin:[17]}), null);
});

test('passages build a timetable by day type: typical, earliest, latest; one-day sightings are left out', () => {
  let days = {};
  const add = (date, clock) => { days = addPassage(days, kst(date, clock), kst('2026-11-08', '18:00')) || days; };
  // Sundays (holiday type): ~19:18 on three Sundays, and a one-off on one.
  add('2026-10-18', '19:15'); add('2026-10-25', '19:18'); add('2026-11-01', '19:22'); add('2026-11-01', '20:40');
  // Same bus recorded twice within 3 minutes is one bus.
  assert.equal(addPassage(days, kst('2026-11-01', '19:23')), null);
  add('2026-11-05', '19:05'); // Thursday: weekday, not used on Sunday
  const rows = historyTimetable(days, {type:'holiday', today:'2026-11-08'});
  assert.deepEqual(rows, [{typical:1158, earliest:1155, latest:1162, days:3}]);
  assert.equal(dayTypeOf('2026-11-05'), 'weekday');
  assert.equal(dayTypeOf('2026-11-07'), 'saturday');
  assert.equal(dayTypeOf('2026-11-05', ['2026-11-05']), 'holiday');
  // Older than 10 weeks is dropped.
  const old = addPassage({'2026-08-01':[600]}, kst('2026-11-08', '19:00'), kst('2026-11-08', '19:00'));
  assert.equal(old['2026-08-01'], undefined);
});

test('the stop cache records passages from consecutive live checks', async () => {
  const binding = {provider:'gyeonggi', stationId:'203000426', routeId:'241201001', routeNumber:'1', order:'37'};
  let cache = {};
  const recorded = [];
  const check = async (at, minutes) => {
    const now = new Date(at);
    return loadStoredTransit(binding, {cache, now, saveCache:async next => { cache = next; },
      recordPassage:async (b, at) => { recorded.push([b.stationId, b.routeId, at.toISOString()]); return true; },
      loadPassages:async () => ({'2026-11-01':[1158]}),
      loadHeadway:async () => ({status:'ready', weekday:{min:10, max:20}}),
      loadArrival:async () => ({value:{arrivalsMin:minutes, lineNumber:'1'}, fetchedAt:now.toISOString(), cacheStatus:'live'})});
  };
  await check('2026-11-08T10:16:00Z', [2, 20]);
  const result = await check('2026-11-08T10:19:00Z', [17]);
  assert.deepEqual(cache.passages[0].days, {'2026-11-08':[1158]});
  // Saved to the shared DB with the stop ID, route ID and time.
  assert.deepEqual(recorded, [['203000426', '241201001', '2026-11-08T10:18:00.000Z']]);
  // Shared records (another Sunday) and this account's join into one timetable; today is left out.
  assert.equal(result.value.passageTimetable, null, 'one earlier Sunday is not enough yet');
  assert.deepEqual(mergePassageDays({'2026-11-01':[1158, 1160]}, {'2026-11-01':[1170]}), {'2026-11-01':[1158, 1170]});
});

test('with no live data, the plan uses the learned timetable, labelled as such', () => {
  const days = {'2026-10-25':[1155, 1185], '2026-11-01':[1158, 1190], '2026-10-18':[1162, 1188]};
  const now = kst('2026-11-08', '19:00');
  const headway = {status:'ready', source:'경기도 버스노선 조회', sunday:{min:18, max:50}, weekday:{min:13, max:45}, saturday:{min:18, max:50}};
  const option = {id:'o1', binding:{provider:'gyeonggi', routeNumber:'1'}, onboardDurationSec:2080, verified:true,
    fetchedAt:now.toISOString(), dailyMetadataDate:'2026-11-08',
    snapshot:{headway, provider:'gyeonggi', fetchedAt:now.toISOString(), liveStatus:'ready', arrivalsMin:[], cacheStatus:'live',
      passageTimetable:passageTimetable(days, now)}};
  assert.equal(upcomingFromHistory(passageTimetable(days, now), now).length, 2);
  // Goal 20:00: the ~19:18 bus (19:15~19:22) + 34.7 min ride arrives by ~19:57.
  const plan = buildJourneyOptionsPlan({requiredArrivalTime:'20:00', boardingAccessMin:5, options:[option], now, holidays:[]});
  assert.equal(plan.risk.targetResult.historyPlan, true);
  // At the stop by the earliest time seen (19:15): leave at 19:10.
  assert.equal(new Date(plan.risk.departure.leaveAt).toISOString(), kst('2026-11-08', '19:10').toISOString());
  const state = {user:{requiredArrivalTime:'20:00', workLocation:{lat:37.39, lng:127.11}, workAddress:'판교'},
    commute:{boardingAccessMin:5, stopLocation:{lat:37.27, lng:127.05}},
    live:{provider:'gyeonggi', stationId:'203000426', stationName:'더샵', nodeId:''}};
  const forecast = buildHomeForecast({state, automatic:{options:[option]}, now});
  assert.equal(forecast.status, 'ready');
  assert.equal(forecast.basis, 'history');
  // Judged on time by the latest time seen (19:22 + 34.7 min = 19:56:40).
  assert.ok(forecast.slackMinutes >= 3 && forecast.slackMinutes <= 4, String(forecast.slackMinutes));
});

test('after the leave time, the stop of the bus to take is checked once a minute until it has passed', async () => {
  const {refreshJourneyOptions} = await import('../src/server/automatic-journeys.mjs');
  const {transitQueryKey} = await import('../src/logic/transit-journey.js');
  const query = {origin:{lat:37.27, lng:127.05}, destination:{lat:37.39, lng:127.11}};
  const planning = {requiredArrivalTime:'20:00', boardingAccessMin:5};
  const binding = {provider:'gyeonggi', stationId:'203000426', routeId:'241201001', routeNumber:'1'};
  const previous = {queryKey:transitQueryKey(query), planningKey:JSON.stringify(['20:00', 5]), fetchedAt:'2026-11-08T10:00:00Z',
    options:[{id:'o1'}], departureAt:'2026-11-08T10:10:00Z', nextRefreshAt:'2026-11-08T10:10:00Z',
    watchBinding:binding, watchUntil:'2026-11-08T10:23:00Z'};
  const calls = [];
  const loadArrival = async (b) => { calls.push(b.stationId); return {value:{arrivalsMin:[3]}}; };
  const during = await refreshJourneyOptions(query, {previous, planning, loadArrival, now:new Date('2026-11-08T10:12:00Z'),
    discover:async () => { throw new Error('no route search'); }});
  assert.deepEqual(calls, ['203000426']);
  assert.equal(during.autoRefresh, 'departed');
  assert.equal(during.departureAt, previous.departureAt, 'the plan and alarms stay as told');
  assert.equal(during.nextRefreshAt, '2026-11-08T10:13:00.000Z');
  const after = await refreshJourneyOptions(query, {previous:during, planning, loadArrival, now:new Date('2026-11-08T10:23:30Z'),
    discover:async () => { throw new Error('no route search'); }});
  assert.equal(calls.length, 1, 'stops once the bus has passed');
  assert.equal(after.nextRefreshAt, '2026-11-08T15:00:00.000Z');
});

test('a normal check remembers which stop to watch and until when', async () => {
  const {refreshJourneyOptions} = await import('../src/server/automatic-journeys.mjs');
  const {transitQueryKey} = await import('../src/logic/transit-journey.js');
  const query = {origin:{lat:37.27, lng:127.05}, destination:{lat:37.39, lng:127.11}};
  const binding = {provider:'gyeonggi', stationId:'203000426', routeId:'241201001', routeNumber:'1'};
  const now = new Date('2026-11-08T10:00:00Z');
  const previous = {queryKey:transitQueryKey(query), fetchedAt:now.toISOString(),
    options:[{id:'o1', binding, onboardDurationSec:2080, verified:true, fetchedAt:now.toISOString()}]};
  const result = await refreshJourneyOptions(query, {previous, planning:{requiredArrivalTime:'20:00', boardingAccessMin:5}, now, force:true,
    loadArrival:async () => ({value:{arrivalsMin:[12], liveStatus:'ready', fetchedAt:now.toISOString()}, fetchedAt:now.toISOString(), cacheStatus:'live'})});
  assert.ok(result.departureAt, 'a leave time');
  assert.deepEqual(result.watchBinding, binding);
  // Bus in 12 minutes, watched until 8 minutes after it.
  assert.equal(result.watchUntil, '2026-11-08T10:20:00.000Z');
});
