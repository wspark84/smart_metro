import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverJourneyOptions,refreshJourneyOptions,verifyBoardingDirection} from '../src/server/automatic-journeys.mjs';
import {transitQueryKey} from '../src/logic/transit-journey.js';

const query={provider:'gyeonggi',stationId:'123',stationName:'출발정류장',stopLocation:{lat:37.3,lng:127.1},workLocation:{lat:37.4,lng:127.2}};
const path=(id,number='10',transfers=0)=>({id,boardingStation:'출발정류장',nextStation:'다음정류장',vehicleType:'BUS',firstVehicles:[{name:number}],transfers,onboardDurationSec:1800,steps:[{type:'BUS',durationSec:900},{type:'WALKING',durationSec:300},{type:'SUBWAY',durationSec:600}]});
test('discovers multiple direct and transfer options without saving a fixed bus',async()=>{
 const result=await discoverJourneyOptions(query,{
  lookup:async()=>({provider:'gyeonggi',routes:[{routeId:'r10',routeNumber:'10',stationId:''},{routeId:'r20',routeNumber:'20'}]}),
  journeys:async()=>({routes:[path('direct'),path('transfer','20',1),{...path('opposite','10'),nextStation:'반대정류장'}]}),
  verify:async(binding,p)=>{assert.equal(binding.stationId,'123');return p.id!=='opposite';}
 });
 assert.equal(result.queryKey,transitQueryKey(query));assert.equal(result.options.length,2);
 assert.equal(result.options[1].transfers,1);assert.equal(result.options[1].onboardDurationSec,1800);
 assert.equal(result.unverifiedCount,1);
});
test('official route sequence rejects the opposite next stop and ambiguous stop occurrence',async()=>{
 const binding={provider:'gyeonggi',stationId:'123',routeId:'r10'};
 const check=rows=>verifyBoardingDirection(binding,path('x'),{env:{GYEONGGI_SERVICE_KEY:'test'},fetchImpl:async()=>({ok:true,json:async()=>({response:{msgHeader:{resultCode:0},msgBody:{busRouteStationList:rows}}})})});
 const rows=[{stationId:'123',stationName:'출발정류장',stationSeq:1},{stationId:'124',stationName:'다음정류장',stationSeq:2}];
 assert.equal(await check(rows),true);
 assert.equal(await check([{...rows[0]}, {...rows[1],stationName:'반대정류장'}]),false);
 assert.equal(await check([...rows,{...rows[0],stationSeq:3}]),false);
});
test('refresh shares arrivals only within the same vehicle binding, not across different routes',async()=>{
 const now=new Date('2026-09-27T08:00:00+09:00');let calls=0;
 const binding={provider:'gyeonggi',stationId:'123',routeId:'r10'};
 const previous={queryKey:transitQueryKey(query),fetchedAt:now.toISOString(),options:[{id:'a',binding},{id:'b',binding},{id:'c',binding:{...binding,routeId:'r20'}}]};
 const result=await refreshJourneyOptions(query,{now,previous,discover:()=>{throw Error('cache ignored');},loadArrival:async b=>{calls++;return {value:{arrivalsMin:[b.routeId==='r10'?5:10]},fetchedAt:now.toISOString()};}});
 assert.equal(calls,2);assert.deepEqual(result.options.map(o=>o.snapshot.arrivalsMin),[[5],[5],[10]]);
});
test('changed destination forces rediscovery and does not reuse previous route metadata',async()=>{
 const now=new Date();let discovered=false;
 const result=await refreshJourneyOptions({...query,workLocation:{lat:37.5,lng:127.4}},{now,previous:{queryKey:transitQueryKey(query),fetchedAt:now.toISOString(),options:[]},discover:async q=>{discovered=true;return {queryKey:transitQueryKey(q),options:[]};}});
 assert.equal(discovered,true);assert.notEqual(result.queryKey,transitQueryKey(query));
});
