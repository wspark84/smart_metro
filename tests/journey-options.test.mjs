import test from 'node:test';
import assert from 'node:assert/strict';
import {buildJourneyOptionsPlan} from '../src/logic/journey-options.js';
import {buildAlarmPlan} from '../src/server/alarm-plan.mjs';
import {DEFAULT_STATE} from '../src/state.js';
import {transitQueryKey,transitQueryForState} from '../src/logic/transit-journey.js';
import {reconcileAlarmRuntime} from '../src/server/alarm-runtime.mjs';
import {isAlarmRefreshWindow} from '../src/server/alarm-arrival-refresh.mjs';
const now=new Date('2026-09-27T08:00:00+09:00');
const option=(id,duration,arrivals)=>({id,verified:true,fetchedAt:now.toISOString(),onboardDurationSec:duration*60,binding:{provider:'gyeonggi',routeNumber:id},snapshot:{fetchedAt:now.toISOString(),arrivalsMin:arrivals}});
test('compares route-specific durations and selects the latest feasible departure across routes',()=>{
 const plan=buildJourneyOptionsPlan({now,requiredArrivalTime:'09:00',boardingAccessMin:5,
  options:[option('A',45,[10,25]),option('B',20,[15,35,50])]});
 assert.equal(plan.risk.targetResult.routeNumber,'B');
 assert.equal(plan.risk.targetResult.arrivalMinutes,35);
 assert.equal(plan.risk.departure.remainingMin,30);
 assert.equal(plan.rows.find(r=>r.routeNumber==='A'&&r.arrivalMinutes===25).deltaMinutes,-10);
});
test('missing one route prevents a last-car confirmation and never borrows another route duration',()=>{
 const plan=buildJourneyOptionsPlan({now,requiredArrivalTime:'09:00',boardingAccessMin:5,
  options:[option('A',20,[30,50]),option('B',45,[])]});
 assert.equal(plan.coverageComplete,false);assert.equal(plan.risk.followingResult,null);
 assert.equal(plan.risk.lastChanceConfirmed,false);
});
test('a reachable alternative prevents urgent warning for a near-arriving vehicle',()=>{
 const plan=buildJourneyOptionsPlan({now,requiredArrivalTime:'09:00',boardingAccessMin:5,
  options:[option('A',40,[3,30]),option('B',20,[25,50])]});
 assert.equal(plan.urgentBoarding,false);assert.equal(plan.risk.targetResult.routeNumber,'B');
});

test('expired journey durations never produce a new on-time prediction',()=>{
 const stale={...option('A',20,[30]),fetchedAt:new Date(now-16*60_000).toISOString()};
 const plan=buildJourneyOptionsPlan({now,requiredArrivalTime:'09:00',boardingAccessMin:5,options:[stale]});
 assert.equal(plan.risk.targetResult.level,'UNKNOWN');assert.equal(plan.risk.departure,null);
});
test('server alarms and home choose the same multi-route deadline and reminder stages',()=>{
 const state=structuredClone(DEFAULT_STATE);
 Object.assign(state.live,{provider:'gyeonggi',stationName:'출발',stationId:'S'});
 Object.assign(state.commute,{routingMode:'all-routes',boardingAccessMin:5});
 state.user.requiredArrivalTime='09:00';state.schedule.repeatPreset='CUSTOM';state.schedule.daysOfWeek=[0,1,2,3,4,5,6];state.schedule.skipHolidays=false;
 const options=[option('A',45,[10,25]),option('B',20,[15,35,50])];
 state.commute.automaticOptions={queryKey:transitQueryKey(transitQueryForState(state)),options};
 const home=buildJourneyOptionsPlan({now,requiredArrivalTime:'09:00',boardingAccessMin:5,options});
 const alarm=buildAlarmPlan(state,now);
 assert.equal(alarm.departureAt,home.risk.departure.leaveAt.toISOString());
 assert.equal(alarm.route.number,'B');
 assert.deepEqual(alarm.allTriggers.map(t=>t.leadMinutes),[20,10,5,3]);
 state.user.workLocation={lat:37.1,lng:127.1};
 assert.equal(buildAlarmPlan(state,now).allTriggers.length,0);
});

test('automatic alarm worker needs no saved route and route switching does not duplicate a stage',()=>{
 const state=structuredClone(DEFAULT_STATE);
 Object.assign(state.live,{provider:'gyeonggi',stationName:'출발',stationId:'S',routeId:'',routeNumber:''});
 Object.assign(state.commute,{routingMode:'all-routes',boardingAccessMin:5});
 Object.assign(state.schedule,{repeatPreset:'CUSTOM',daysOfWeek:[0,1,2,3,4,5,6],skipHolidays:false});
 state.user.requiredArrivalTime='09:00';
 assert.equal(isAlarmRefreshWindow(state,now),true);
 // 25 minutes to the stop minus a 5-minute walk: the 20-minute reminder is due now.
 state.commute.automaticOptions={queryKey:transitQueryKey(transitQueryForState(state)),options:[option('A',20,[25])]};
 const first=reconcileAlarmRuntime(state,undefined,now);
 assert.equal(first.dueEvents.length,1);
 state.commute.automaticOptions.options=[option('B',15,[25])];
 const next=reconcileAlarmRuntime(state,first.runtime,now);
 assert.equal(next.plan.route.number,'B');assert.equal(next.dueEvents.length,0);
 state.schedule.snoozeDate='2026-09-27';
 assert.equal(isAlarmRefreshWindow(state,now),false);
});
