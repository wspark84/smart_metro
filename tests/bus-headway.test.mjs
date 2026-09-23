import test from 'node:test';
import assert from 'node:assert/strict';
import {headwayRange,selectBusHeadway} from '../src/logic/bus-headway.js';
import {fetchBusHeadway,normalizeGyeonggiHeadway,normalizeTagoHeadway,normalizeSeoulHeadway} from '../src/server/bus-headway.mjs';

const row={routeId:'241201001',peekAlloc:8,nPeekAlloc:12,satPeekAlloc:15,satNPeekAlloc:20,
  sunPeekAlloc:18,sunNPeekAlloc:25,wePeekAlloc:20,weNPeekAlloc:30};
const gg={response:{msgHeader:{resultCode:0},msgBody:{busRouteInfoItem:row}}};
const profile={status:'ready',...normalizeGyeonggiHeadway(gg,row.routeId)};

test('Gyeonggi official intervals select Korean weekday, Saturday, Sunday and holiday',()=>{
  assert.equal(selectBusHeadway(profile,new Date('2026-09-23T08:00:00+09:00')).minutes,12);
  assert.equal(selectBusHeadway(profile,new Date('2026-09-26T00:30:00+09:00')).minutes,20);
  assert.equal(selectBusHeadway(profile,new Date('2026-09-27T08:00:00+09:00')).minutes,25);
  assert.equal(selectBusHeadway(profile,new Date('2026-09-23T08:00:00+09:00'),['2026-09-23']).minutes,30);
  assert.match(selectBusHeadway(profile,new Date('2026-09-23T08:00:00+09:00')).text,/8~12분/);
});

test('missing weekend metadata never falls back to weekday; malformed intervals cannot invent service',()=>{
  assert.equal(selectBusHeadway({...profile,saturday:null},new Date('2026-09-26T08:00:00+09:00')),null);
  for(const value of [null,'',0,-1,'10~20','1일 8회',181]) assert.equal(headwayRange(value),null);
  assert.deepEqual(headwayRange('',12),{min:12,max:12});
  assert.throws(()=>normalizeGyeonggiHeadway(gg,'wrong'));
});

test('TAGO and Seoul use exact selected route IDs and provider fields',()=>{
  const tago=normalizeTagoHeadway(JSON.stringify({response:{header:{resultCode:'00'},body:{items:{item:{routeid:'DJB1',intervaltime:10,intervalsattime:15,intervalsuntime:20}}}}}),'DJB1');
  assert.deepEqual(tago.saturday,{min:15,max:15});
  assert.equal(tago.holiday,null);
  const seoul=normalizeSeoulHeadway('<headerCd>0</headerCd><itemList><busRouteId>100</busRouteId><term>9</term></itemList>','100');
  assert.deepEqual(seoul.allDays,{min:9,max:9});
  assert.throws(()=>normalizeSeoulHeadway('<headerCd>0</headerCd><itemList><busRouteId>999</busRouteId><term>9</term></itemList>','100'));
});

test('official metadata fetch is bounded, coalesced and cached by route and credential',async()=>{
  let calls=0;
  const fetchImpl=async url=>{calls++;assert.match(String(url),/getBusRouteInfoItemv2/);assert.equal(url.searchParams.get('routeId'),row.routeId);return {ok:true,json:async()=>gg};};
  const options={env:{GYEONGGI_SERVICE_KEY:'test-key'},fetchImpl};
  const binding={provider:'gyeonggi',routeId:row.routeId};
  const results=await Promise.all([fetchBusHeadway(binding,options),fetchBusHeadway(binding,options)]);
  assert.equal(calls,1);assert.equal(results[0].weekday.max,12);
  results[0].weekday.max=100;
  assert.equal((await fetchBusHeadway(binding,options)).weekday.max,12);
});

test('missing approval/provider errors do not leak keys or disable arrival processing',async()=>{
  const result=await fetchBusHeadway({provider:'tago',routeId:'DJB1',cityCode:'25'},
    {env:{TAGO_SERVICE_KEY:'secret-test-key'},fetchImpl:async()=>{throw new Error('url contains secret-test-key');}});
  assert.equal(result.status,'unavailable');assert.equal(JSON.stringify(result).includes('secret-test-key'),false);
});
