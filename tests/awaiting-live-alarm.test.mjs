import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_STATE} from '../src/state.js';
import {reconcileAlarmRuntime} from '../src/server/alarm-runtime.mjs';
import {reconcileAlarmDelivery} from '../src/server/alarm-delivery.mjs';
import {reconcileDispatchQueue} from '../src/server/dispatch-engine.mjs';
import {transitQueryKey,transitQueryForState} from '../src/logic/transit-journey.js';

// Bus still at the turnaround, too close to the goal for the interval to time
// the leave: one "not confirmed yet" notice, then one alert once live data
// times the leave.
function state(at,arrivals) {
  const s=structuredClone(DEFAULT_STATE);
  Object.assign(s.live,{provider:'gyeonggi',stationId:'203000426',routeId:'241201001',order:'37',routeNumber:'1',
    snapshot:{fetchedAt:at.toISOString(),lineNumber:'1',arrivalsMin:arrivals,liveStatus:'ready',
      headway:{status:'ready',source:'경기도 버스노선 조회',weekday:{min:10,max:45}}}});
  s.user.requiredArrivalTime='10:00';
  s.commute.boardingAccessMin=5;
  s.commute.planningBindingKey=JSON.stringify([s.live.provider,s.live.stationId,s.live.routeId,s.live.order]);
  s.commute.transitJourney={queryKey:transitQueryKey(transitQueryForState(s)),boardingConfirmed:true,
    compatible:true,onboardDurationSec:34*60,fetchedAt:at.toISOString()};
  return s;
}

test('awaiting live data: one notice, then one alert when live arrivals time the leave',()=>{
  const t1=new Date('2026-09-23T09:10:00+09:00');
  const first=reconcileAlarmRuntime(state(t1,[]),undefined,t1);
  assert.equal(first.plan.departureAt,null);
  assert.deepEqual(first.dueEvents.map(e=>e.triggerKind),['awaiting-live']);
  const delivery=reconcileAlarmDelivery(undefined,first,t1);
  const sent=reconcileDispatchQueue(undefined,delivery,{},t1);
  assert.equal(sent.newBundles.length,1);
  assert.equal(sent.newBundles[0].notificationSpec.title,'아직 실시간 정보가 확인되지 않았습니다');
  assert.equal(sent.newBundles[0].notificationSpec.body,'실시간 정보가 확인되는 대로 다시 알려드릴게요.');

  const t2=new Date('2026-09-23T09:11:00+09:00');
  const again=reconcileAlarmRuntime(state(t2,[]),first.runtime,t2);
  assert.equal(again.dueEvents.length,0,'said once');

  const t3=new Date('2026-09-23T09:12:00+09:00');
  const found=reconcileAlarmRuntime(state(t3,[8]),again.runtime,t3);
  assert.ok(found.plan.departureAt);
  assert.deepEqual(found.dueEvents.map(e=>e.triggerKind),['live-found']);
  assert.match(found.dueEvents[0].notificationSpec?.title || found.plan.emergencyTrigger.notificationSpec.title,/^실시간 정보 확인/);
});

test('a check that moves the leave time earlier and close rings at once (2026-11-10 대표)', () => {
  // 09:00: no live bus, an 08:56 sighting times buses every 10 min → leave 09:21.
  const t1 = new Date('2026-09-23T09:00:00+09:00');
  const s1 = state(t1, []);
  s1.live.snapshot.headway.weekday = {min:10, max:10};
  s1.live.snapshot.lastObservation = {fetchedAt:new Date('2026-09-23T08:55:00+09:00').toISOString(), arrivalsMin:[1], lineNumber:'1'};
  const first = reconcileAlarmRuntime(s1, undefined, t1);
  assert.ok(first.plan.departureAt);
  // 09:05: live data shows the buses earlier than estimated → leave time moves earlier.
  const t2 = new Date('2026-09-23T09:05:00+09:00');
  const s2 = state(t2, [9, 19]);
  s2.live.snapshot.headway.weekday = {min:10, max:10};
  const second = reconcileAlarmRuntime(s2, first.runtime, t2);
  assert.ok(Date.parse(second.plan.departureAt) <= Date.parse(first.plan.departureAt) - 2 * 60_000, 'earlier by 2+ min');
  assert.deepEqual(second.dueEvents.map(e => e.triggerKind), ['leave-earlier']);
  assert.match(second.plan.emergencyTrigger.notificationSpec.title, /앞당겨졌어요|뛰어나가세요/);
  // Rung once: the next check with the same time stays quiet.
  const t3 = new Date('2026-09-23T09:05:30+09:00');
  const third = reconcileAlarmRuntime(state(t3, [8.5, 18.5]), second.runtime, t3);
  assert.ok(!third.dueEvents.some(e => e.triggerKind === 'leave-earlier'));
});
