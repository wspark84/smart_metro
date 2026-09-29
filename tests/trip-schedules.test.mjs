import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_STATE,sanitizeState} from '../src/state.js';
import {projectDomainSnapshot,applyDomainSnapshotToState} from '../src/domain-model.js';
import {normalizeTripSchedules,tripScheduleState,scheduleValidation,scheduledReminderMinutes} from '../src/logic/trip-schedules.js';
import {shouldFireToday} from '../src/logic/commute.js';
import {transitQueryForState,transitQueryKey} from '../src/logic/transit-journey.js';
import {reconcileTripSchedules} from '../src/server/trip-schedule-runtime.mjs';
import {reconcileDispatchQueue} from '../src/server/dispatch-engine.mjs';
import {DEFAULT_DEVICE_PROFILE} from '../src/device-profile.js';
const now=new Date('2026-09-29T08:00:00+09:00');
const trip=(id='commute')=>({id,name:'출근',enabled:true,requiredArrivalTime:'09:00',boardingAccessMin:5,
  departure:{location:{lat:37.3,lng:127.1},live:{provider:'gyeonggi',stationId:'S',stationName:'출발'}},
  destination:{location:{lat:37.4,lng:127.2},address:'회사'},daysOfWeek:[1,2,3,4,5],alarmStartLeadMin:30,repeatIntervalMin:5,skipHolidays:true});
function options(state){return {queryKey:transitQueryKey(transitQueryForState(state)),fetchedAt:now.toISOString(),nextRefreshAt:new Date(+now+60_000).toISOString(),
 options:[{id:'1',verified:true,fetchedAt:now.toISOString(),onboardDurationSec:1200,binding:{provider:'gyeonggi',routeNumber:'1'},snapshot:{fetchedAt:now.toISOString(),arrivalsMin:[25]}}]};}
test('migration leaves home intact and creates no commute schedule',()=>{
 const old=structuredClone(DEFAULT_STATE);delete old.tripSchedules;const next=sanitizeState(old);
 assert.deepEqual(next.tripSchedules,[]);assert.deepEqual(next.user,old.user);assert.equal(next.commute.boardingAccessMin,old.commute.boardingAccessMin);
});
test('trip schedules round-trip through account domain without replacing home',()=>{
 const base=structuredClone(DEFAULT_STATE);base.tripSchedules=[trip()];
 const result=applyDomainSnapshotToState(projectDomainSnapshot(base),base);
 assert.deepEqual(result.tripSchedules,normalizeTripSchedules(base.tripSchedules));assert.deepEqual(result.user,base.user);
});
test('schedule state never mutates or borrows home route and snooze',()=>{
 const base=structuredClone(DEFAULT_STATE);base.schedule.snoozeDate='2026-09-29';const before=structuredClone(base);
 const projected=tripScheduleState(base,trip());assert.equal(projected.schedule.snoozeDate,undefined);assert.equal(shouldFireToday(projected.schedule,now),true);
 assert.equal(projected.user.workAddress,'회사');assert.equal(projected.live.snapshot,null);assert.equal(projected.commute.transitJourney,null);assert.deepEqual(base,before);
});
test('weekday holiday enabled and completed-day rules are independent',()=>{
 const t=trip(),base=structuredClone(DEFAULT_STATE);
 assert.equal(shouldFireToday(tripScheduleState(base,t).schedule,now,['2026-09-29']),false);
 t.skipHolidays=false;assert.equal(shouldFireToday(tripScheduleState(base,t).schedule,now,['2026-09-29']),true);
 t.enabled=false;assert.equal(shouldFireToday(tripScheduleState(base,t).schedule,now),false);
 t.enabled=true;t.snoozeDate='2026-09-29';assert.equal(shouldFireToday(tripScheduleState(base,t).schedule,now),false);
});
test('incomplete trip cannot arm and invalid start/interval are rejected',()=>{
 assert.notEqual(scheduleValidation({...trip(),departure:null}),'');assert.notEqual(scheduleValidation({...trip(),repeatIntervalMin:0}),'');
 assert.notEqual(scheduleValidation({...trip(),alarmStartLeadMin:999}),'');
 const normalized=normalizeTripSchedules([{...trip(),alarmStartLeadMin:999,repeatIntervalMin:0}])[0];
 assert.equal(normalized.alarmStartLeadMin,30);assert.equal(normalized.repeatIntervalMin,5);
 assert.equal(tripScheduleState(DEFAULT_STATE,{...trip(),destination:null}).schedule.enabled,false);
});
test('schedule worker produces selected stages even when home is paused',async()=>{
 const base=structuredClone(DEFAULT_STATE);base.schedule.snoozeDate='2026-09-29';base.tripSchedules=[trip()];
 const first=await reconcileTripSchedules(base,{},now,{refresh:async state=>options(state)});
 assert.deepEqual(first.results[0].result.plan.allTriggers.map(t=>t.leadMinutes),[30,25,20,15,10,5]);
 assert.equal(first.results[0].result.dueEvents.length,1);assert.match(first.results[0].delivery.currentAlert.triggerKey,/^trip:commute:/);
 const again=await reconcileTripSchedules(base,first.contexts,now,{refresh:()=>{throw Error('unexpected refresh');}});
 assert.equal(again.results[0].result.dueEvents.length,0);
});

test('alarm start and interval generate descending reminders strictly before departure',()=>{
 assert.deepEqual(scheduledReminderMinutes({alarmStartLeadMin:60,repeatIntervalMin:15}),[60,45,30,15]);
 assert.deepEqual(scheduledReminderMinutes({alarmStartLeadMin:120,repeatIntervalMin:30}),[120,90,60,30]);
 const everyMinute=scheduledReminderMinutes({alarmStartLeadMin:30,repeatIntervalMin:1});
 assert.equal(everyMinute.length,30);assert.equal(everyMinute.at(-1),1);
 assert.deepEqual(scheduledReminderMinutes({alarmStartLeadMin:30,repeatIntervalMin:10}),[30,20,10]);
});

test('old commute schedules migrate to 30-minute start and 5-minute repeat without home changes',()=>{
 const old=trip();delete old.alarmStartLeadMin;delete old.repeatIntervalMin;old.reminderMinutes=[20,5];
 const normalized=normalizeTripSchedules([old])[0];
 assert.equal(normalized.alarmStartLeadMin,30);assert.equal(normalized.repeatIntervalMin,5);
});

test('one-minute schedule reminders are delivered before departure and completed trips stay quiet',async()=>{
 const base=structuredClone(DEFAULT_STATE);base.tripSchedules=[{...trip(),repeatIntervalMin:1}];
 const late=new Date(+now+19*60_000);
 const result=await reconcileTripSchedules(base,{},late,{refresh:async state=>{
   const value=options(state);value.fetchedAt=late.toISOString();value.nextRefreshAt=new Date(+late+60_000).toISOString();
   value.options[0].fetchedAt=late.toISOString();value.options[0].snapshot={fetchedAt:late.toISOString(),arrivalsMin:[6]};return value;
 }});
 assert.equal(result.results[0].result.dueEvents.length,1);
 assert.match(result.results[0].result.dueEvents[0].triggerLabel,/1분 전/);
 assert.ok(result.results[0].delivery.currentAlert);
 base.tripSchedules[0].snoozeDate='2026-09-29';
 const stopped=await reconcileTripSchedules(base,result.contexts,late);
 assert.equal(stopped.results[0].result.dueEvents.length,0);
 assert.equal(stopped.results[0].delivery.currentAlert,null);
});
test('simultaneous schedules keep separate dispatch bundles and home reconcile cannot cancel them',async()=>{
 const base=structuredClone(DEFAULT_STATE);base.tripSchedules=[trip('a'),trip('b')];
 const previous=Object.fromEntries(base.tripSchedules.map(t=>[t.id,{runtime:{automaticOptions:options(tripScheduleState(base,t))}}]));
 const result=await reconcileTripSchedules(base,previous,now);
 let queue;
 for(const item of result.results)queue=reconcileDispatchQueue(queue,item.delivery,DEFAULT_DEVICE_PROFILE,{tripId:item.trip.id,dateKey:'2026-09-29'},now).queue;
 assert.equal(queue.bundles.length,2);assert.notEqual(queue.bundles[0].alertTriggerKey,queue.bundles[1].alertTriggerKey);
 queue=reconcileDispatchQueue(queue,{currentAlert:null},DEFAULT_DEVICE_PROFILE,{dateKey:'2026-09-29'},now).queue;
 assert.equal(queue.bundles.length,2);
 const tomorrow=reconcileDispatchQueue(queue,{currentAlert:null},DEFAULT_DEVICE_PROFILE,{dateKey:'2026-09-30'},new Date(+now+86400000)).queue;
 assert.equal(tomorrow.bundles.length,0);
});
test('deleting a schedule drops its private runtime context',async()=>{
 const result=await reconcileTripSchedules({...DEFAULT_STATE,tripSchedules:[]},{removed:{runtime:{}}},now);assert.deepEqual(result.contexts,{});
});
