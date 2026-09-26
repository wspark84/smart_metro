import test from 'node:test';
import assert from 'node:assert/strict';
import {loadStoredTransit} from '../src/server/stored-transit.mjs';

const binding={provider:'gyeonggi',routeId:'r1',stationId:'s1',order:'3',routeNumber:'1'};
const start=new Date('2026-09-23T08:20:00+09:00');
const profile={status:'ready',source:'official',weekday:{min:10,max:15}};
function fixture() {
  let cache={},checks=0,arrival={value:{arrivalsMin:[2,9],lineNumber:'1'},fetchedAt:start.toISOString(),cacheStatus:'live'};
  let metadata=profile;
  return {
    get cache(){return cache;},get checks(){return checks;},
    set arrival(value){arrival=value;},set metadata(value){metadata=value;},
    run:(now=start,b=binding)=>loadStoredTransit(b,{now,cache:JSON.parse(JSON.stringify(cache)),
      loadArrival:async()=>{if(arrival instanceof Error)throw arrival;return arrival;},
      loadHeadway:async()=>{checks++;return metadata;},saveCache:async value=>{cache=JSON.parse(JSON.stringify(value));}}),
  };
}
test('daily metadata survives JSON persistence and empty real-time replies retain original anchor',async()=>{
  const f=fixture();await f.run();f.arrival=new Error('private upstream URL');
  const result=await f.run(new Date(start.getTime()+2*3600000));
  assert.equal(f.checks,1);assert.equal(result.value.headway.weekday.max,15);
  assert.deepEqual(result.value.arrivalsMin,[]);assert.equal(result.value.liveStatus,'unavailable');
  assert.equal(result.value.lastObservation.fetchedAt,start.toISOString());
  assert.doesNotMatch(JSON.stringify(result),/private upstream/);
});
test('Korean calendar day controls refresh; unchanged metadata retains change timestamp',async()=>{
  const f=fixture();await f.run();const changed=f.cache.headways[0].lastChangedAt;
  await f.run(new Date('2026-09-23T23:59:00+09:00'));assert.equal(f.checks,1);
  await f.run(new Date('2026-09-24T00:00:00+09:00'));assert.equal(f.checks,2);
  assert.equal(f.cache.headways[0].lastChangedAt,changed);
  f.metadata={...profile,weekday:{min:20,max:25}};
  await f.run(new Date('2026-09-25T08:00:00+09:00'));
  assert.equal(f.cache.headways[0].profile.weekday.max,25);
  assert.notEqual(f.cache.headways[0].lastChangedAt,changed);
});
test('failed daily check preserves official metadata and is not retried every arrival poll',async()=>{
  const f=fixture();await f.run();f.metadata={status:'unavailable'};
  const next=new Date('2026-09-24T08:00:00+09:00');
  const result=await f.run(next);await f.run(next);
  assert.equal(f.checks,2);assert.equal(result.value.headway.stale,true);
  assert.equal(result.value.headway.weekday.max,15);
});
test('new approval is picked up after five minutes, then success is reused for the day',async()=>{
  const f=fixture();f.metadata={status:'unavailable',message:'approval pending'};
  await f.run();await f.run(new Date(start.getTime()+4*60000));assert.equal(f.checks,1);
  f.metadata=profile;
  const result=await f.run(new Date(start.getTime()+5*60000));
  assert.equal(f.checks,2);assert.equal(result.value.headway.status,'ready');
  await f.run(new Date(start.getTime()+60*60000));assert.equal(f.checks,2);
});
test('legacy failed daily cache is retried immediately after upgrade',async()=>{
  let saved;
  const cache={headways:[{key:JSON.stringify(['tago','31010','GGB1']),checkedDate:'2026-09-23',
    checkedAt:start.toISOString(),refreshFailed:true,profile:null}]};
  const result=await loadStoredTransit({provider:'tago',cityCode:'31010',routeId:'GGB1'},
    {now:start,cache,loadArrival:async()=>null,loadHeadway:async()=>profile,saveCache:async v=>{saved=v;}});
  assert.equal(result.value.headway.status,'ready');assert.equal(saved.headways[0].retryPolicy,5);
});
test('anchors are isolated by stop and direction while headway is shared per route',async()=>{
  const f=fixture();await f.run();f.arrival=null;
  const result=await f.run(start,{...binding,order:'4'});
  assert.equal(result.value.lastObservation,null);assert.equal(f.checks,1);
  const restored=await f.run();assert.ok(restored.value.lastObservation);
});
test('stale and wrong-line arrivals never become saved actual observations',async()=>{
  const f=fixture();f.arrival={value:{arrivalsMin:[3],lineNumber:'2'},fetchedAt:start.toISOString()};
  assert.equal((await f.run()).value.lastObservation,null);
  f.arrival={value:{arrivalsMin:[3],lineNumber:'1'},fetchedAt:start.toISOString(),cacheStatus:'stale-fallback'};
  assert.equal((await f.run()).value.lastObservation,null);
});
test('storage failure propagates instead of falsely claiming a saved daily check',async()=>{
  await assert.rejects(loadStoredTransit(binding,{now:start,loadArrival:async()=>null,
    loadHeadway:async()=>profile,saveCache:async()=>{throw new Error('write conflict');}}),/write conflict/);
});

test('no-vehicle responses and timeouts are distinguished without leaking upstream credentials',async()=>{
  const f=fixture();f.arrival=new Error('Gyeonggi API returned no arrival rows.');
  assert.match((await f.run()).value.arrivalMessage,/도착 예정 차량을 반환하지 않았습니다/);
  f.arrival=Object.assign(new Error('secret URL'),{code:'UPSTREAM_TIMEOUT'});
  const timeout=await f.run();assert.match(timeout.value.arrivalMessage,/응답 시간이 초과/);
  assert.doesNotMatch(JSON.stringify(timeout),/secret URL/);
  f.arrival=new Error('Gyeonggi API request failed with 403.');
  assert.match((await f.run()).value.arrivalMessage,/응답 403/);
});
