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
test('approved TAGO route metadata uses existing key and preserves weekday/weekend values',async()=>{
  const result=await fetchBusHeadway({provider:'tago',cityCode:'31010',routeId:'GGB1'},
    {env:{TAGO_SERVICE_KEY:'test-key'},fetchImpl:async url=>{
      assert.equal(url.pathname,'/1613000/BusRouteInfoInqireService/getRouteInfoIem');
      assert.equal(url.searchParams.get('cityCode'),'31010');assert.equal(url.searchParams.get('routeId'),'GGB1');
      assert.equal(url.searchParams.get('serviceKey'),'test-key');
      return {ok:true,text:async()=>JSON.stringify({response:{header:{resultCode:'00'},body:{items:{item:{
        routeid:'GGB1',intervaltime:12,intervalsattime:18,intervalsuntime:20}}}}})};
    }});
  assert.equal(result.status,'ready');assert.equal(result.weekday.max,12);assert.equal(result.saturday.max,18);
});
test('TAGO permission denial and absent intervals have distinct safe messages',async()=>{
  const binding={provider:'tago',cityCode:'31010',routeId:'GGB1'};
  const denied=await fetchBusHeadway(binding,{env:{TAGO_SERVICE_KEY:'secret'},fetchImpl:async()=>({ok:true,
    text:async()=>'<OpenAPI_ServiceResponse><returnReasonCode>20</returnReasonCode></OpenAPI_ServiceResponse>'})});
  assert.match(denied.message,/이용 권한/);
  const empty=await fetchBusHeadway(binding,{env:{TAGO_SERVICE_KEY:'secret'},fetchImpl:async()=>({ok:true,
    text:async()=>JSON.stringify({response:{header:{resultCode:'00'},body:{items:{item:{routeid:'GGB1'}}}}})})});
  assert.match(empty.message,/유효한 배차간격이 없습니다/);
});

test('TAGO reads XML errors even on HTTP 403 and distinguishes official error codes',async()=>{
  for(const [code,pattern] of [[20,/이용 권한/],[22,/한도/],[30,/인증키/],[31,/만료/],[32,/IP/],[12,/주소/]]) {
    let reads=0;
    const result=await fetchBusHeadway({provider:'tago',cityCode:'31010',routeId:'test'},
      {env:{TAGO_SERVICE_KEY:'secret'},fetchImpl:async()=>({ok:false,status:403,text:async()=>{
        reads++;return `<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>secret</returnAuthMsg><returnReasonCode>${code}</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>`;
      }})});
    assert.equal(reads,1);assert.match(result.message,pattern);assert.match(result.message,new RegExp(`TAGO ${code}`));
    assert.equal(result.message.includes('secret'),false);
    if(code!==20) assert.doesNotMatch(result.message,/이용 권한/);
  }
});
test('unstructured HTTP denial is not misreported as a TAGO approval failure',async()=>{
  const result=await fetchBusHeadway({provider:'tago',cityCode:'31010',routeId:'test'},
    {env:{TAGO_SERVICE_KEY:'secret'},fetchImpl:async()=>({ok:false,status:403,text:async()=>'<html>secret blocked</html>'})});
  assert.match(result.message,/HTTP 403/);assert.match(result.message,/코드 없음/);
  assert.doesNotMatch(result.message,/이용 권한|secret/);
});
test('JSON gateway errors preserve codes and body read failures never expose credentials',async()=>{
  const binding={provider:'tago',cityCode:'31010',routeId:'test'};
  const result=await fetchBusHeadway(binding,{env:{TAGO_SERVICE_KEY:'secret'},fetchImpl:async()=>({ok:false,status:400,
    text:async()=>JSON.stringify({response:{header:{resultCode:'30',resultMsg:'secret'}}})})});
  assert.match(result.message,/TAGO 30/);assert.doesNotMatch(result.message,/secret/);
  const unreadable=await fetchBusHeadway(binding,{env:{TAGO_SERVICE_KEY:'secret'},fetchImpl:async()=>({ok:false,status:403,
    text:async()=>{throw new Error('secret in upstream URL');}})});
  assert.doesNotMatch(unreadable.message,/secret|이용 권한/);
});
