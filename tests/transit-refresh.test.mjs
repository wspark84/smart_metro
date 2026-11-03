import test from 'node:test';
import assert from 'node:assert/strict';
import {transitRefreshInterval,nextTransitRefreshAt} from '../src/logic/transit-refresh.js';
import {refreshJourneyOptions} from '../src/server/automatic-journeys.mjs';
import {transitQueryKey} from '../src/logic/transit-journey.js';

test('refresh tiers follow the minutes left until leaving home',()=>{
  assert.equal(transitRefreshInterval(121),900000);
  assert.equal(transitRefreshInterval(61),900000);
  assert.equal(transitRefreshInterval(60),300000);
  assert.equal(transitRefreshInterval(31),300000);
  assert.equal(transitRefreshInterval(30),30000,'last 30 minutes: real-time can jump');
  assert.equal(transitRefreshInterval(0),30000);
  assert.equal(transitRefreshInterval(-0.1),null,'after the leave time: no calls');
  assert.equal(transitRefreshInterval(NaN),null,'unknown: manual refresh only');
});
test('next check waits for each tier boundary and stops for the day after leaving',()=>{
  const checked='2026-09-28T06:00:00+09:00';
  assert.equal(nextTransitRefreshAt(checked,'2026-09-28T08:30:00+09:00'),'2026-09-27T21:30:00.000Z','no call until 2 hours before');
  assert.equal(nextTransitRefreshAt('2026-09-28T07:00:00+09:00','2026-09-28T08:30:00+09:00'),'2026-09-27T22:15:00.000Z','15 minutes');
  assert.equal(nextTransitRefreshAt('2026-09-28T07:25:00+09:00','2026-09-28T08:30:00+09:00'),'2026-09-27T22:30:00.000Z','stops at the 60-minute boundary');
  assert.equal(nextTransitRefreshAt('2026-09-28T07:40:00+09:00','2026-09-28T08:30:00+09:00'),'2026-09-27T22:45:00.000Z','5 minutes');
  assert.equal(nextTransitRefreshAt('2026-09-28T08:10:00+09:00','2026-09-28T08:30:00+09:00'),'2026-09-27T23:10:30.000Z','30 seconds');
  assert.equal(nextTransitRefreshAt('2026-09-28T08:31:00+09:00','2026-09-28T08:30:00+09:00'),'2026-09-28T15:00:00.000Z','departed: next service day');
  assert.equal(nextTransitRefreshAt('2026-09-28T08:31:00+09:00',null),'2026-09-28T15:00:00.000Z','unknown: next service day');
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
test('without a leave time: wait for the 2-hour mark when far away, stop when close',async()=>{
  const query={provider:'gyeonggi',stationId:'123'};
  const options=[{id:'a',binding:{provider:'gyeonggi',routeId:'r1'},onboardDurationSec:1800}];
  const discover=async()=>({queryKey:transitQueryKey(query),fetchedAt:new Date().toISOString(),options});
  const planning={requiredArrivalTime:'09:00',boardingAccessMin:5};
  const loadArrival=async()=>{throw new Error('down');};
  // Expected leave ≈ 09:00 − 30 − 5 − 10 = 08:15.
  const early=await refreshJourneyOptions(query,{now:new Date('2026-11-03T03:00:00+09:00'),planning,discover,loadArrival});
  assert.equal(early.autoRefresh,'scheduled');
  assert.equal(early.nextRefreshAt,new Date('2026-11-03T06:15:00+09:00').toISOString());
  const close=await refreshJourneyOptions(query,{now:new Date('2026-11-03T07:00:00+09:00'),planning,discover,loadArrival});
  assert.equal(close.autoRefresh,'unknown');
  assert.equal(close.nextRefreshAt,new Date('2026-11-04T00:00:00+09:00').toISOString(),'manual refresh only until tomorrow');
});
test('after the leave time no provider is called, even though a later bus exists',async()=>{
  const query={provider:'gyeonggi',stationId:'123'};
  const now=new Date('2026-11-03T08:16:00+09:00');
  const previous={queryKey:transitQueryKey(query),planningKey:JSON.stringify(['09:00',5]),fetchedAt:'2026-11-03T08:14:30+09:00',
    updatedAt:'2026-11-03T08:14:30+09:00',departureAt:new Date('2026-11-03T08:15:00+09:00').toISOString(),
    nextRefreshAt:new Date('2026-11-03T08:15:00+09:00').toISOString(),options:[{id:'a',binding:{routeId:'r1'}}]};
  let calls=0;
  const result=await refreshJourneyOptions(query,{now,previous,planning:{requiredArrivalTime:'09:00',boardingAccessMin:5},
    loadArrival:async()=>{calls++;return {value:{}};},discover:async()=>{calls++;return previous;}});
  assert.equal(calls,0);
  assert.equal(result.autoRefresh,'departed');
  assert.equal(result.nextRefreshAt,new Date('2026-11-04T00:00:00+09:00').toISOString());
});
