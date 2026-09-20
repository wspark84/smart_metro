import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateLateRisk,normalizeBoardingAccessMin,buildDepartureGuidance} from '../src/logic/commute.js';
import {DEFAULT_STATE,sanitizeState} from '../src/state.js';
import {projectDomainSnapshot,applyDomainSnapshotToState} from '../src/domain-model.js';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const now=new Date('2026-09-20T08:00:00+09:00');
const risk=(access,arrivals=[10,25],extra={})=>evaluateLateRisk({now,requiredArrivalTime:'09:00',busArrivalsMin:arrivals,route:{onboardToDestinationMin:45,boardingAccessMin:access,...extra}});

test('10 minutes until bus minus 5 minutes access means leave within 5 minutes',()=>{
  const result=risk(5);
  assert.equal(result.departure.remainingMin,5);
  assert.equal(result.departure.leaveAt.toISOString(),'2026-09-19T23:05:00.000Z');
  assert.match(result.message,/5분 안에 출발해야/);
  assert.equal(result.targetResult.arrivalMinutes,10);
  assert.equal(result.targetResult.arriveWorkAt.toISOString(),'2026-09-19T23:55:00.000Z');
  assert.equal(result.targetResult.arriveWorkAt.getTime(),risk(null).targetResult.arriveWorkAt.getTime());
});
test('subway uses the same manual departure calculation',()=>{
  assert.equal(risk(5,[10,25],{vehicleType:'SUBWAY'}).departure.remainingMin,5);
});
test('now and missed departure deadlines are distinguished without negative countdowns',()=>{
  assert.match(risk(10).departure.message,/지금 출발해야/);
  assert.equal(risk(11).departure.minutes,0);
  assert.equal(risk(11).targetResult.catchable,false);
  assert.match(risk(11).message,/탑승이 어려울 수/);
  assert.equal(risk(11).urgency,'HURRY');
});
test('seconds are never rounded into extra departure time',()=>{
  assert.equal(buildDepartureGuidance(9.9,5,now).minutes,4);
  assert.match(buildDepartureGuidance(5.2,5,now).message,/1분 안에 바로/);
});
test('blank means unset, zero is explicit; no automatic village bus buffer',()=>{
  for(const value of [null,undefined,'',-1,181,Infinity,NaN,2.5,true,{},'abc']) assert.equal(normalizeBoardingAccessMin(value),null);
  assert.equal(normalizeBoardingAccessMin('5'),5);
  assert.equal(risk(null).departure,null);
  assert.equal(risk(0).departure.remainingMin,10);
  assert.equal(risk(8).departure.remainingMin,2);
});
test('missing real arrival or route duration never invents a deadline',()=>{
  assert.equal(risk(5,[]).departure,null);
  assert.equal(risk(5,[10],{durationAvailable:false}).departure,null);
});
test('manual duration persists and legacy computed duration never enables it',()=>{
  const state=structuredClone(DEFAULT_STATE);state.commute.boardingAccessMin=8;
  assert.equal(applyDomainSnapshotToState(projectDomainSnapshot(state)).commute.boardingAccessMin,8);
  delete state.commute.boardingAccessMin;
  assert.equal(sanitizeState(state).commute.boardingAccessMin,null);
  state.commute.boardingAccessMin=Infinity;
  assert.equal(sanitizeState(state).commute.boardingAccessMin,null);
});

test('manual input saves only valid completed edits; clearing restores unset state',async()=>{
  const source=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
  const change=source.slice(source.indexOf('app.addEventListener("change"'));
  const start=change.indexOf('  if (path === "commute.boardingAccessMin")');
  const end=change.indexOf('\n  const value =',start);
  const script=`(()=>{${change.slice(start,end)}})()`;
  const state={commute:{boardingAccessMin:5}};
  let saves=0;
  const context=vm.createContext({state,path:'commute.boardingAccessMin',normalizeBoardingAccessMin,persist:()=>saves++,render(){},target:{value:'8',reportValidity:()=>true}});
  vm.runInContext(script,context);assert.equal(state.commute.boardingAccessMin,8);assert.equal(saves,1);
  context.target={value:'-3',reportValidity:()=>false};vm.runInContext(script,context);assert.equal(state.commute.boardingAccessMin,8);assert.equal(saves,1);
  context.target={value:'',reportValidity:()=>true};vm.runInContext(script,context);assert.equal(state.commute.boardingAccessMin,null);assert.equal(saves,2);
  assert.match(source,/if \(input && accessDraft !== null\) input.value = accessDraft/);
});
