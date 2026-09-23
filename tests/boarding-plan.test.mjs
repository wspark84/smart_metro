import test from 'node:test';
import assert from 'node:assert/strict';
import {buildBoardingPlan,validHeadway} from '../src/logic/boarding-plan.js';
import {formatClock} from '../src/logic/commute.js';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {DEFAULT_STATE,sanitizeState} from '../src/state.js';
import {projectDomainSnapshot,applyDomainSnapshotToState} from '../src/domain-model.js';
import {buildAlarmPlan} from '../src/server/alarm-plan.mjs';
import {reconcileAlarmRuntime} from '../src/server/alarm-runtime.mjs';
import {reconcileAlarmDelivery} from '../src/server/alarm-delivery.mjs';
import {reconcileDispatchQueue} from '../src/server/dispatch-engine.mjs';
import {isAlarmRefreshWindow} from '../src/server/alarm-arrival-refresh.mjs';
import {transitQueryKey,transitQueryForState} from '../src/logic/transit-journey.js';
const now=new Date('2026-09-23T08:20:00+09:00');
const route={durationAvailable:true,onboardToDestinationMin:34,boardingAccessMin:5};
const build=(overrides={})=>buildBoardingPlan({now,requiredArrivalTime:'10:00',route,arrivalsMin:[2,9],
  snapshot:{fetchedAt:now.toISOString(),arrivalsMin:[2,9]},officialHeadwayMin:7,...overrides});

function alarmState(at=now,arrivals=[2,9]) {
  const s=structuredClone(DEFAULT_STATE);
  Object.assign(s.live,{provider:'gyeonggi',stationId:'203000426',routeId:'241201001',order:'37',routeNumber:'1',
    snapshot:{fetchedAt:at.toISOString(),lineNumber:'1',arrivalsMin:arrivals,
      headway:{status:'ready',source:'경기도 버스노선 조회',weekday:{min:10,max:10}}}});
  s.user.requiredArrivalTime='10:00';
  s.commute.boardingAccessMin=5;s.commute.planningHeadwayMin=10;
  s.commute.planningBindingKey=JSON.stringify([s.live.provider,s.live.stationId,s.live.routeId,s.live.order]);
  s.commute.transitJourney={queryKey:transitQueryKey(transitQueryForState(s)),boardingConfirmed:true,
    compatible:true,onboardDurationSec:34*60,fetchedAt:at.toISOString()};
  return s;
}

test('departure alarms follow the same 09:14 deadline as home instead of the old 07:00 window',()=>{
  const s=alarmState();const p=buildAlarmPlan(s,now);
  assert.equal(p.mode,'departure-deadline');assert.equal(formatClock(new Date(p.departureAt)),'09:14');
  assert.deepEqual(p.allTriggers.map(t=>formatClock(new Date(t.triggerAt))),['08:54','09:04','09:09','09:11']);
  assert.deepEqual(p.allTriggers.map(t=>t.riskLevel),['GREEN','YELLOW','ORANGE','RED']);
  assert.ok(p.allTriggers.every(t=>t.source==='headway-estimate' && !t.lastChanceConfirmed));
  assert.match(p.nextTrigger.notificationSpec.body,/배차간격 예상.*09:14까지 집에서 출발/);
  assert.equal(reconcileAlarmRuntime(s,undefined,now).dueEvents.length,0);
  assert.equal(isAlarmRefreshWindow(s,now),true);
});

test('live last vehicle replaces forecast deadline and reminder copy',()=>{
  const at=new Date('2026-09-23T09:10:00+09:00');
  const p=buildAlarmPlan(alarmState(at,[12,22]),at);
  assert.equal(formatClock(new Date(p.departureAt)),'09:17');
  assert.equal(p.allTriggers[0].source,'live-snapshot');
  assert.equal(p.allTriggers[0].lastChanceConfirmed,true);
  assert.match(p.allTriggers[0].notificationSpec.body,/실시간 도착정보 기준.*09:17까지 집에서 출발/);
  assert.doesNotMatch(p.allTriggers[0].notificationSpec.body,/배차간격 예상/);
});

test('deadline movement does not duplicate stages and catches up only the most urgent stage',()=>{
  const at=new Date('2026-09-23T09:04:00+09:00');
  const s=alarmState(at,[5,15]);
  const first=reconcileAlarmRuntime(s,undefined,at);
  assert.equal(first.dueEvents.length,1);
  const nextAt=new Date('2026-09-23T09:05:00+09:00');
  const second=reconcileAlarmRuntime(alarmState(nextAt,[5,15]),first.runtime,nextAt);
  assert.equal(second.dueEvents.length,0); // New deadline is 09:15; 10-min stage already delivered.
  const lateAt=new Date('2026-09-23T09:11:00+09:00');
  const caught=reconcileAlarmRuntime(alarmState(lateAt,[8,18]),undefined,lateAt);
  assert.equal(caught.dueEvents.length,1);
  assert.equal(caught.dueEvents[0].notificationSpec.riskLevel,'RED');
  assert.equal(caught.runtime.firedTriggerKeys.length,4);
});

test('no late catch-up reminder is sent one minute before departure or at departure',()=>{
  for (const [time,arrivals] of [['09:13:00',[6,16]],['09:14:00',[5,15]],['09:14:15',[4.75,14.75]]]) {
    const at=new Date(`2026-09-23T${time}+09:00`);
    assert.equal(reconcileAlarmRuntime(alarmState(at,arrivals),undefined,at).dueEvents.length,0);
  }
});

test('snooze, missing walking time, changed route and expired journey do not invent departure alerts',()=>{
  const s=alarmState();s.schedule.snoozeDate='2026-09-23';
  assert.equal(buildAlarmPlan(s,now).allTriggers.length,0);assert.equal(isAlarmRefreshWindow(s,now),false);
  delete s.schedule.snoozeDate;s.commute.boardingAccessMin=null;
  assert.equal(buildAlarmPlan(s,now).allTriggers.length,0);
  s.commute.boardingAccessMin=5;s.commute.transitJourney.fetchedAt='2026-09-23T07:00:00+09:00';
  assert.equal(buildAlarmPlan(s,now).allTriggers.length,0);
});

test('server remembers a recent anchor through a short provider outage but labels it estimated',()=>{
  const s=alarmState();const first=reconcileAlarmRuntime(s,undefined,now);
  s.live.snapshot=null;
  const after=reconcileAlarmRuntime(s,first.runtime,new Date(now.getTime()+3*60000));
  assert.equal(after.plan.departureAt,first.plan.departureAt);
  assert.equal(after.plan.nextTrigger.source,'headway-estimate');
  assert.equal(after.plan.nextTrigger.lastChanceConfirmed,false);
});

test('server reconstructs estimates from durable observation without prior process memory',()=>{
  const at=new Date('2026-09-23T09:00:00+09:00');
  const s=alarmState(at,[]);
  s.live.snapshot.liveStatus='unavailable';
  s.live.snapshot.lastObservation={fetchedAt:now.toISOString(),arrivalsMin:[2,9],lineNumber:'1'};
  const p=buildAlarmPlan(s,at);
  assert.equal(formatClock(new Date(p.departureAt)),'09:14');
  assert.ok(p.allTriggers.every(t=>t.source==='headway-estimate'));
  assert.match(p.allTriggers[0].message,/실시간 아님/);
});

test('push and spoken alerts retain departure wording, and obsolete queued alerts are cancelled',()=>{
  const at=new Date('2026-09-23T09:04:00+09:00');
  const first=reconcileAlarmRuntime(alarmState(at,[5,15]),undefined,at);
  const delivery=reconcileAlarmDelivery(undefined,first,at);
  const dispatched=reconcileDispatchQueue(undefined,delivery,{},at);
  assert.equal(dispatched.newBundles.length,1);
  assert.match(dispatched.newBundles[0].notificationSpec.spokenText,/09:14까지 집에서 출발/);
  assert.doesNotMatch(dispatched.newBundles[0].notificationSpec.spokenText,/이 버스 놓치면 지각이다/);
  const nextAt=new Date('2026-09-23T09:05:00+09:00');
  const moved=reconcileAlarmRuntime(alarmState(nextAt,[5,15]),first.runtime,nextAt);
  const cleared=reconcileAlarmDelivery(delivery,moved,nextAt);
  assert.equal(cleared.currentAlert,null);
  assert.equal(reconcileDispatchQueue(dispatched.queue,cleared,{},nextAt).queue.bundles.length,0);
});

test('the final three-minute alert cannot retry at one minute or re-escalate after thirty seconds',()=>{
  const at=new Date('2026-09-23T09:11:00+09:00');
  const first=reconcileAlarmRuntime(alarmState(at,[8,18]),undefined,at);
  const delivery=reconcileAlarmDelivery(undefined,first,at);
  const sent=reconcileDispatchQueue(undefined,delivery,{},at);
  assert.equal(sent.newBundles.length,1);
  const after30=reconcileDispatchQueue(sent.queue,delivery,{},new Date(at.getTime()+30000));
  assert.equal(after30.newBundles.length,0);
  const nextAt=new Date('2026-09-23T09:13:00+09:00');
  const next=reconcileAlarmRuntime(alarmState(nextAt,[6,16]),first.runtime,nextAt);
  const cleared=reconcileAlarmDelivery(delivery,next,nextAt);
  assert.equal(cleared.currentAlert,null);
  assert.equal(reconcileDispatchQueue(after30.queue,cleared,{},nextAt).queue.bundles.length,0);
});
test('10:00 target chooses a later estimated catchable bus, not the early 08:29 bus',()=>{
  const p=build({officialHeadwayMin:10});
  assert.equal(formatClock(p.risk.targetResult.arriveWorkAt),'09:53');
  assert.equal(formatClock(p.risk.departure.leaveAt),'09:14');
  assert.equal(p.risk.targetResult.estimated,true);
  assert.equal(p.risk.lastChanceConfirmed,false);
  assert.equal(p.estimatedLast,true);
  assert.equal(p.rows[1].deltaMinutes,57);
});
test('missed first bus does not suppress later estimates',()=>{
  const p=build({arrivalsMin:[2],officialHeadwayMin:10,snapshot:{fetchedAt:now.toISOString(),arrivalsMin:[2]}});
  assert.ok(p.risk.departure.remainingMin>0);
  assert.equal(p.rows[0].catchable,false);
});
test('bus estimates never use a manual value or an observed vehicle gap instead of official metadata',()=>{
  assert.equal(build({officialHeadwayMin:null,headwayMin:10}).interval,null);
  assert.equal(build({officialHeadwayMin:null,allowObservedHeadway:true}).intervalSource,'최근 두 차량의 도착 간격');
  assert.equal(build({officialHeadwayMin:15}).intervalSource,'공식 배차간격');
});
test('fresh live observations replace the old anchor and are never labelled estimated',()=>{
  const p=build({arrivalsMin:[8,20],officialHeadwayMin:12,snapshot:{fetchedAt:now.toISOString(),arrivalsMin:[8,20]}});
  assert.deepEqual(p.rows.slice(0,2).map(r=>[r.arrivalMinutes,r.estimated]),[[8,false],[20,false]]);
  assert.equal(p.rows[2].arrivalMinutes,32);
});
test('short outage retains explicitly estimated future departures, not stale live ETAs',()=>{
  const p=build({now:new Date(now.getTime()+3*60000),arrivalsMin:[]});
  assert.ok(p.rows.length>0);assert.ok(p.rows.every(r=>r.estimated));
});
test('no headway or no anchor never invents bus departures',()=>{
  const p=build({arrivalsMin:[2],snapshot:null,officialHeadwayMin:null});
  assert.equal(p.rows.length,1);assert.equal(p.risk.departure,null);
  assert.equal(formatClock(p.latestBoardAt),'09:26');
  assert.equal(build({arrivalsMin:[],snapshot:null,officialHeadwayMin:10}).rows.length,0);
});
test('stale anchor, unknown journey and past target disable extrapolation',()=>{
  assert.equal(build({arrivalsMin:[],now:new Date(now.getTime()+24*60*60000)}).rows.length,0);
  assert.ok(build({arrivalsMin:[],now:new Date(now.getTime()+31*60000)}).rows.every(row=>row.estimated));
  assert.equal(build({route:{...route,durationAvailable:false}}).hasEstimates,false);
  assert.equal(build({requiredArrivalTime:'07:00'}).hasEstimates,false);
});
test('invalid intervals are rejected and horizon stays bounded',()=>{
  for(const v of ['',null,0,-1,1,181,Infinity,'abc'])assert.equal(validHeadway(v),null);
  const plan=build({requiredArrivalTime:'23:59',officialHeadwayMin:2});
  assert.equal(plan.hasEstimates,true);
  assert.ok(plan.rows.length<=724);
});

test('planning headways survive both persistence formats',()=>{
  const state=structuredClone(DEFAULT_STATE);
  state.commute.planningHeadwayMin=10;state.commute.planningOfficialHeadwayMin=12;
  const restored=applyDomainSnapshotToState(projectDomainSnapshot(sanitizeState(state)));
  assert.equal(restored.commute.planningHeadwayMin,10);
  assert.equal(restored.commute.planningOfficialHeadwayMin,12);
});

async function view(overrides={}) {
  let source=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
  const bindings={};
  for(const match of source.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*"([^"]+)";/g)) {
    const module=await import(new URL('../src/'+match[2].replace(/^\.\//,''),import.meta.url));
    for(const name of match[1].split(',').map(v=>v.trim()).filter(Boolean))bindings[name]=module[name];
  }
  const handlers={};const app={innerHTML:'',addEventListener(name,fn){handlers[name]=fn;},querySelector(){return null;},querySelectorAll(){return [];}};
  const context=vm.createContext({...bindings,...overrides,URL,Intl,Date,console,setTimeout(){},clearTimeout(){},
    document:{querySelector(){return app;},querySelectorAll(){return [];},visibilityState:'visible'},
    window:{location:{hash:'#/home'},addEventListener(){},setInterval(){},setTimeout(){},clearTimeout(){},requestAnimationFrame(){}}});
  source=source.replace(/import\s*\{[\s\S]*?\}\s*from\s*"[^"]+";/g,'').replace(/\nbootstrap\(\);/,'');
  vm.runInContext(source,context);
  vm.runInContext('authMeta.status="authenticated";authMeta.user={id:"test",name:"테스트",providers:["google"]};',context);
  return {context,app,handlers,run:code=>vm.runInContext(code,context)};
}

test('home input remains a draft through refresh until the completion button is used',async()=>{
  const v=await view();
  v.handlers.input({target:{dataset:{tripField:'access',field:'commute.boardingAccessMin'},value:'5'}});
  v.handlers.input({target:{dataset:{tripField:'target',field:'user.requiredArrivalTime'},value:'10:00'}});
  assert.equal(v.run('state.commute.boardingAccessMin'),null);
  assert.equal(v.run('state.user.requiredArrivalTime'),'09:00');
  v.run('render()');
  assert.match(v.app.innerHTML,/value="10:00" data-trip-field="target"/);
  assert.match(v.app.innerHTML,/아직 적용되지 않았습니다/);
  assert.match(v.app.innerHTML,/정보 입력 완료/);
  assert.doesNotMatch(v.app.innerHTML,/data-trip-field="headway"|예상 계산용 배차간격/);
  assert.match(v.app.innerHTML,/공식 API에서 자동으로 조회/);
});

test('completion waits for server acknowledgement before applying fields and reporting saved',async()=>{
  let release;const calls=[];
  const v=await view({saveRemoteAppState:async s=>{calls.push(['state',s]);await new Promise(r=>release=r);},
    syncDomainSnapshot:async s=>{calls.push(['domain',s]);},saveState(){}});
  v.run('getHomeTripDraft();homeTripDraft.access="5";homeTripDraft.target="10:00";homeTripDraft.headway="10";homeTripDraft.dirty=true;render=()=>{};queueAlarmPlanRefresh=()=>{};refreshVisibleTransit=async()=>{};');
  const saving=v.run('submitHomeTrip()');
  assert.equal(v.run('homeTripSave.status'),'saving');
  assert.equal(v.run('state.user.requiredArrivalTime'),'09:00');
  release();await saving;
  assert.equal(v.run('homeTripSave.status'),'saved');
  assert.equal(v.run('state.user.requiredArrivalTime'),'10:00');
  assert.equal(v.run('state.commute.boardingAccessMin'),5);
  assert.equal(calls.length,2);
  assert.equal(calls[1][1].commute.planningHeadwayMin,null);
});

test('failed completion retains draft and never claims server save succeeded',async()=>{
  const v=await view({saveRemoteAppState:async()=>{throw new Error('offline');}});
  v.run('getHomeTripDraft();homeTripDraft.access="5";homeTripDraft.target="10:00";homeTripDraft.dirty=true;render=()=>{};');
  await v.run('submitHomeTrip()');
  assert.equal(v.run('homeTripSave.status'),'error');
  assert.equal(v.run('homeTripDraft.target'),'10:00');
  assert.equal(v.run('state.user.requiredArrivalTime'),'09:00');
});

test('logout during a save cannot send the next write using another account',async()=>{
  let release;let domainWrites=0;
  const v=await view({saveRemoteAppState:async()=>new Promise(r=>release=r),syncDomainSnapshot:async()=>domainWrites++});
  v.run('getHomeTripDraft();homeTripDraft.access="5";homeTripDraft.dirty=true;render=()=>{};');
  const saving=v.run('submitHomeTrip()');
  v.run('authMeta.user={id:"another-account"};');release();await saving;
  assert.equal(domainWrites,0);
  assert.equal(v.run('state.commute.boardingAccessMin'),null);
});

test('invalid input never sends a save; estimated rows show explicit sources and slack',async()=>{
  let writes=0;const v=await view({saveRemoteAppState:async()=>writes++});
  v.run('getHomeTripDraft();homeTripDraft.access="-1";');await v.run('submitHomeTrip()');
  assert.equal(writes,0);assert.equal(v.run('homeTripSave.status'),'error');
  v.context.plan=build({officialHeadwayMin:10});v.context.clock=now;
  const html=v.run('renderHomeTimetable({homePlan:plan,risk:plan.risk,now:clock,stop:{name:"정류장"}},"1번","")');
  assert.match(html,/57분 여유/);assert.match(html,/배차간격 기준 예상 · 실시간 아님/);assert.match(html,/실시간/);
});
