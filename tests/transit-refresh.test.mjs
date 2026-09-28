import test from 'node:test';
import assert from 'node:assert/strict';
import {transitRefreshInterval,nextTransitRefreshAt} from '../src/logic/transit-refresh.js';
import {refreshJourneyOptions} from '../src/server/automatic-journeys.mjs';
import {transitQueryKey} from '../src/logic/transit-journey.js';

test('refresh tiers include exact 60 and 30 minute boundaries',()=>{
  assert.equal(transitRefreshInterval(61),300000);
  assert.equal(transitRefreshInterval(60),60000);
  assert.equal(transitRefreshInterval(31),60000);
  assert.equal(transitRefreshInterval(30),30000);
  assert.equal(transitRefreshInterval(-1),30000);
  assert.equal(transitRefreshInterval(NaN),30000);
});
test('next check does not skip a faster tier boundary',()=>{
  const checked='2026-09-28T08:00:00+09:00';
  assert.equal(nextTransitRefreshAt(checked,'2026-09-28T09:01:00+09:00'),'2026-09-27T23:01:00.000Z');
  assert.equal(nextTransitRefreshAt(checked,'2026-09-28T10:00:00+09:00'),'2026-09-27T23:05:00.000Z');
});
test('server reuses durable result until due, but goal changes invalidate the wait',async()=>{
  const query={provider:'gyeonggi',stationId:'123'};
  const now=new Date('2026-09-28T08:00:00+09:00');
  const planning={requiredArrivalTime:'10:00',boardingAccessMin:3};
  const previous={queryKey:transitQueryKey(query),planningKey:JSON.stringify(['10:00',3]),
    fetchedAt:now.toISOString(),nextRefreshAt:new Date(+now+300000).toISOString(),
    options:[{id:'a',binding:{routeId:'r1'}}]};
  let arrivals=0,discoveries=0;
  const args={now,previous,planning,loadArrival:async()=>{arrivals++;return {value:{},fetchedAt:now.toISOString()};},
    discover:async()=>{discoveries++;return previous;}};
  assert.equal(await refreshJourneyOptions(query,args),previous);assert.equal(arrivals,0);
  await refreshJourneyOptions(query,{...args,planning:{...planning,requiredArrivalTime:'09:00'}});
  assert.equal(arrivals,1);assert.equal(discoveries,0);
});
test('static metadata is reused within the Korean date and refreshed the next day',async()=>{
  const query={provider:'gyeonggi',stationId:'123'};let discoveries=0;
  const previous={queryKey:transitQueryKey(query),fetchedAt:'2026-09-28T01:00:00+09:00',options:[{binding:{routeId:'r1'}}]};
  const args={previous,loadArrival:async()=>({value:{}}),discover:async()=>{discoveries++;return {...previous,options:[]};}};
  await refreshJourneyOptions(query,{...args,now:new Date('2026-09-28T23:59:00+09:00')});assert.equal(discoveries,0);
  await refreshJourneyOptions(query,{...args,now:new Date('2026-09-29T00:00:00+09:00')});assert.equal(discoveries,1);
});
