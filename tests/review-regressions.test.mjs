import test from "node:test";
import assert from "node:assert/strict";
import { normalizeGyeonggiArrival, normalizeTagoArrival, normalizeSeoulArrival, parseSeoulArrivalXml } from "../src/server/bus-providers.mjs";
import { projectLiveArrivals, resolveCommuteStop } from "../src/logic/live-arrivals.js";
import { evaluateLateRisk, haversineDistanceMeters, estimateWalkMinutes } from "../src/logic/commute.js";
import { DEFAULT_STATE, sanitizeState } from "../src/state.js";
import { buildAlarmPlan } from "../src/server/alarm-plan.mjs";
import { reconcileAlarmRuntime } from "../src/server/alarm-runtime.mjs";
import { reconcileAlarmDelivery, applyAlarmDeliveryAction, createAlarmDeliveryState } from "../src/server/alarm-delivery.mjs";
import { getNotificationSpec } from "../src/logic/notification-engine.js";
import { estimateCommuteRoute } from "../src/server/route-providers.mjs";
import { projectDomainSnapshot, applyDomainSnapshotToState } from "../src/domain-model.js";
import { STOP_LIBRARY } from "../src/mock-data.js";
import { refreshAlarmArrivals } from "../src/server/alarm-arrival-refresh.mjs";

test('server alarm worker refreshes ETAs without an open browser and fails safely', async () => {
  const state = structuredClone(DEFAULT_STATE);
  state.live = {...state.live,provider:'gyeonggi',routeNumber:'9999',snapshot:null};
  const now = new Date('2026-09-09T07:00:00+09:00');
  const fresh = await refreshAlarmArrivals(state, now, async () => ({value:{lineNumber:'9999',arrivalsMin:[5]},fetchedAt:now.toISOString()}));
  assert.deepEqual(fresh.live.snapshot.arrivalsMin, [5]);
  assert.equal(state.live.snapshot, null);
  const failed = await refreshAlarmArrivals(state, now, async () => {throw new Error('provider down');});
  assert.equal(failed.live.snapshot, null);
  assert.equal(failed.live.status, 'error');
  state.schedule.snoozeDate = '2026-09-09';
  assert.equal(await refreshAlarmArrivals(state, now, async () => {assert.fail('must not fetch on a paused day');}), state);
});

test('registered stop coordinates survive domain storage and never fall back to demo coordinates', () => {
  const state = structuredClone(DEFAULT_STATE);
  state.live = {...state.live, provider:'gyeonggi', stationId:'real-stop', routeNumber:'9999'};
  state.commute.selectedStopId = 'real-stop';
  assert.equal(resolveCommuteStop(state, STOP_LIBRARY).lat, null);
  state.commute.stopLocation = {lat:37.12,lng:127.12};
  const restored = applyDomainSnapshotToState(projectDomainSnapshot(state), DEFAULT_STATE);
  assert.equal(restored.commute.selectedStopId, 'real-stop');
  assert.equal(resolveCommuteStop(restored, STOP_LIBRARY).lat, 37.12);
});

test('departure can be acknowledged before an alarm starts and is safe to repeat', () => {
  const now = new Date('2026-09-09T07:00:00+09:00');
  const result = applyAlarmDeliveryAction(createAlarmDeliveryState(), {type:'ACK_DEPARTED'}, now);
  assert.equal(result.currentAlert, null);
  assert.equal(result.lastAction, 'ACK_DEPARTED');
  assert.deepEqual(applyAlarmDeliveryAction(result, {type:'ACK_DEPARTED'}, now), result);
  assert.throws(() => applyAlarmDeliveryAction(result, {type:'SNOOZE_1M'}, now), /No active/);
});

test('a late runtime tick uses fresh ETAs measured after the scheduled trigger', () => {
  const state = structuredClone(DEFAULT_STATE);
  state.live = {...state.live,provider:'gyeonggi',routeNumber:'9999',snapshot:{lineNumber:'9999',arrivalsMin:[5,12],fetchedAt:'2026-09-09T07:00:20+09:00'}};
  const result = reconcileAlarmRuntime(state, undefined, new Date('2026-09-09T07:00:30+09:00'));
  assert.equal(result.dueEvents.length, 1);
  // A fresh arrival does not establish journey duration. Without a selected route, risk stays unknown.
  assert.equal(result.dueEvents[0].riskLevel, 'UNKNOWN');
  assert.ok(Math.abs(result.dueEvents[0].arrivalsMin[0] - (5-1/6)) < 0.001);
});

test('spoken alerts do not invent a second bus when only one ETA is available', () => {
  const spec = getNotificationSpec({routeNumber:'5',arrivalsMin:[5],riskLevel:'GREEN',urgency:'RELAXED'});
  assert.match(spec.spokenText, /다음 버스 도착 정보는 아직 없습니다/);
  assert.doesNotMatch(spec.spokenText, /-분|null|undefined/);
});

test('selected Gyeonggi route must not use a different route or a conflicting route number', () => {
  const payload = {response:{msgBody:{busArrivalList:[{routeId:'other',routeName:'5',predictTime1:3}]}}};
  assert.throws(() => normalizeGyeonggiArrival(payload, {routeId:'wanted',routeNumber:'5'}), /selected route/);
});

test('selected TAGO route must not use the first unrelated route', () => {
  assert.throws(() => normalizeTagoArrival({response:{body:{items:{item:[{routeno:'7',arrtime:180}]}}}}, '5'), /selected route/);
});

test('only one known arrival stays one arrival and missing times never become zero', () => {
  assert.deepEqual(normalizeGyeonggiArrival({response:{msgBody:{busArrivalList:[{routeId:'5',predictTime1:4}]}}}, {routeId:'5'}).arrivalsMin, [4]);
  const row = parseSeoulArrivalXml('<itemList><busRouteAbrv>5</busRouteAbrv><arrmsg1>5분 후</arrmsg1><arrmsg2>운행종료</arrmsg2></itemList>');
  assert.deepEqual(normalizeSeoulArrival(row).arrivalsMin, [5]);
});

test('ETA counts down from fetch time even when a stale cache response is served now', () => {
  assert.deepEqual(projectLiveArrivals({arrivalsMin:[5,15], fetchedAt:'2026-09-09T07:00:00+09:00', servedAt:'2026-09-09T07:02:00+09:00'}, new Date('2026-09-09T07:02:00+09:00')), [3,13]);
});

test('expired or passed ETAs never roll forward by an invented headway', () => {
  const snapshot = {arrivalsMin:[1], fetchedAt:'2026-09-09T07:00:00+09:00'};
  assert.deepEqual(projectLiveArrivals(snapshot, new Date('2026-09-09T07:02:00+09:00')), []);
  assert.deepEqual(projectLiveArrivals({...snapshot,arrivalsMin:[30]}, new Date('2026-09-09T07:03:00+09:00')), []);
  assert.deepEqual(projectLiveArrivals({arrivalsMin:[5]}, new Date()), []);
});

test('alarm plan uses registered route instead of the default demo bus', () => {
  const state = structuredClone(DEFAULT_STATE);
  state.live = {...state.live, provider:'gyeonggi',routeNumber:'9999', stationName:'실제 정류장',snapshot:null};
  const plan = buildAlarmPlan(state, new Date('2026-09-09T07:00:00+09:00'));
  assert.equal(plan.route.number, '9999');
  assert.equal(plan.stop.name, '실제 정류장');
  assert.equal(plan.allTriggers[0].source, 'live-unavailable');
  assert.equal(plan.allTriggers[0].riskLevel, 'UNKNOWN');
  assert.equal(plan.allTriggers[0].arrivalAtWork, null);
  assert.doesNotMatch(plan.allTriggers[0].notificationSpec.body, /정시 도착|지각이다/);
});

test('unknown second bus is not used to declare a must-catch condition', () => {
  const risk = evaluateLateRisk({requiredArrivalTime:'09:00',route:{homeToStopWalkMin:2,busRideMin:30,alightToWorkWalkMin:5},busArrivalsMin:[5],now:new Date('2026-09-09T08:00:00+09:00')});
  assert.equal(risk.results[1].level, 'UNKNOWN');
  assert.equal(risk.results[1].arriveWorkAt, null);
  assert.equal(risk.urgency, 'RELAXED');
});

test('a fractional minute late must never be rounded to on-time', () => {
  const risk = evaluateLateRisk({requiredArrivalTime:'09:00',route:{homeToStopWalkMin:2,busRideMin:30,alightToWorkWalkMin:5},busArrivalsMin:[25.2],now:new Date('2026-09-09T08:00:00+09:00')});
  assert.equal(risk.results[0].level, 'ORANGE');
  assert.match(risk.message, /늦을 것으로 예상/);
});

test('unknown and out-of-range coordinates cannot be interpreted as the Gulf of Guinea', async () => {
  assert.equal(haversineDistanceMeters({lat:null,lng:null},{lat:37,lng:127}), null);
  assert.equal(haversineDistanceMeters({lat:91,lng:127},{lat:37,lng:127}), null);
  assert.equal(estimateWalkMinutes(null), null);
  assert.equal(sanitizeState({user:{homeLocation:{lat:null,lng:null}}}).user.homeLocation.lat,null);
  await assert.rejects(estimateCommuteRoute({homeLocation:{lat:null,lng:null},stopLocation:{lat:37,lng:127}}),/valid homeLocation/);
});

test('deselecting the primary bus chooses a remaining selected bus', () => {
  const state = sanitizeState({commute:{selectedLineIds:['701'], primaryLineId:'1002'}});
  assert.equal(state.commute.primaryLineId,'701');
});

test('opening the app after the alarm window does not fire expired alarms', () => {
  const result = reconcileAlarmRuntime(structuredClone(DEFAULT_STATE),undefined,new Date('2026-09-09T12:00:00+09:00'));
  assert.equal(result.dueEvents.length,0);
});

test('today-only skip clears an existing alarm rather than allowing a snoozed alarm to resume', () => {
  const state = {currentAlert:{triggerKey:'old',status:'SNOOZED',snoozedUntil:'2026-09-09T07:01:00+09:00'}};
  assert.equal(reconcileAlarmDelivery(state,{plan:{todayStatus:{firing:false}},dueEvents:[]},new Date('2026-09-09T07:02:00+09:00')).currentAlert,null);
});

test('voice speed and vibration settings reach the notification spec', () => {
  const spec = getNotificationSpec({riskLevel:'GREEN',arrivalsMin:[5],preferredSpeechRate:1.3,vibrationStrength:50});
  assert.equal(spec.speechRate,1.3);
  assert.deepEqual(spec.vibrationPattern,[100,300,100]);
  assert.match(getNotificationSpec({riskLevel:'GREEN',arrivalsMin:[5],stabilityPrecheck:true,stabilityPrecheckLeadMin:10}).stabilityPrecheckText,/10분 일찍/);
});
