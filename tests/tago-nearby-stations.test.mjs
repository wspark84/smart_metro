import test from 'node:test';
import assert from 'node:assert/strict';
import { searchTagoNearbyStations } from '../src/server/tago-api.mjs';
import { transitLookup } from '../src/server/transit-lookups.mjs';
import { searchLiveStationRoutes, fetchLiveArrival } from '../src/server/bus-providers.mjs';

const station = {nodeid:'OFFICIAL-1',nodenm:'같은 이름 정류장',citycode:31010,gpslati:37.28,gpslong:127.06};
const binding = {serviceKey:'fixture-key',lat:37.28,lng:127.06};
const reply = (item,extra={}) => ({ok:true,status:200,text:async()=>JSON.stringify({response:{header:{resultCode:'00'},body:{items:{item},pageNo:1,numOfRows:100,totalCount:Array.isArray(item)?item.length:1,...extra}}})});

test('nearby search uses official GPS operation and preserves each station city, including across borders',async()=>{
  const rows = await searchTagoNearbyStations({...binding,fetchImpl:async url=>{
    assert.equal(url.pathname,'/1613000/BusSttnInfoInqireService/getCrdntPrxmtSttnList');
    assert.equal(url.searchParams.get('gpsLati'),'37.28');
    assert.equal(url.searchParams.get('gpsLong'),'127.06');
    assert.equal(url.searchParams.has('cityCode'),false);
    assert.equal(url.searchParams.has('nodeNo'),false);
    return reply([station,{...station,nodeid:'OFFICIAL-2',citycode:31020,gpslong:127.061}]);
  }});
  assert.deepEqual(rows.map(row=>[row.nodeId,row.cityCode]),[['OFFICIAL-1','31010'],['OFFICIAL-2','31020']]);
  assert.equal(rows[0].stationNumber,'');
  assert.equal(rows[0].posX,'127.06');
  assert.equal(rows[0].posY,'37.28');
});

test('nearby search validates coordinates without sending requests or inventing a location',async()=>{
  const fetchImpl=async()=>assert.fail('must not request invalid coordinates');
  for (const invalid of [null,undefined,'', ' ',true,{},NaN,Infinity,91,-91]) {
    await assert.rejects(searchTagoNearbyStations({...binding,lat:invalid,fetchImpl}),/검색 위치/);
  }
  for (const invalid of [null,'',181,-181]) {
    await assert.rejects(searchTagoNearbyStations({...binding,lng:invalid,fetchImpl}),/검색 위치/);
  }
  await assert.rejects(searchTagoNearbyStations({...binding,lat:0,lng:0,fetchImpl}),/검색 위치/);
});

test('nearby results include all pages, deduplicate exact stations, and retain opposite stops',async()=>{
  const rows=await searchTagoNearbyStations({...binding,fetchImpl:async url=>{
    const pageNo=Number(url.searchParams.get('pageNo'));
    return reply(pageNo===1?[station,station]:[{...station,nodeid:'OPPOSITE'}],{pageNo,numOfRows:2,totalCount:3});
  }});
  assert.deepEqual(rows.map(row=>row.nodeId),['OFFICIAL-1','OPPOSITE']);
});

test('nearby cache shares only identical coordinates and empty results stay empty',async()=>{
  let calls=0;
  const fetchImpl=async()=>{calls++;return reply([]);};
  assert.deepEqual(await searchTagoNearbyStations({...binding,fetchImpl}),[]);
  await searchTagoNearbyStations({...binding,fetchImpl});
  assert.equal(calls,1);
  await searchTagoNearbyStations({...binding,lat:37.29,fetchImpl});
  assert.equal(calls,2);
});

test('missing official city or station IDs fail explicitly instead of guessing current city',async()=>{
  await assert.rejects(searchTagoNearbyStations({...binding,fetchImpl:async()=>reply({...station,citycode:undefined})}),/도시코드/);
  await assert.rejects(searchTagoNearbyStations({...binding,fetchImpl:async()=>reply({...station,nodeid:''})}),/고유번호/);
  await assert.rejects(searchTagoNearbyStations({...binding,fetchImpl:async()=>reply([station,{...station,citycode:31020}])}),/도시 정보가 일치/);
});

test('nearby lookup carries official city and node into routes and arrivals, not submitted name-search city',async()=>{
  const originalFetch=globalThis.fetch,originalKey=process.env.TAGO_SERVICE_KEY;
  try {
    process.env.TAGO_SERVICE_KEY='fixture-key';
    globalThis.fetch=async url=>{
      if(url.pathname.endsWith('/getCrdntPrxmtSttnList')) return reply(station);
      assert.equal(url.searchParams.get('cityCode'),'31010');
      if(url.pathname.endsWith('/getSttnThrghRouteList')) {
        assert.equal(url.searchParams.get('nodeid'),'OFFICIAL-1');
        return reply({routeid:'ROUTE-1',routeno:'1'});
      }
      assert.equal(url.searchParams.get('nodeId'),'OFFICIAL-1');
      assert.equal(url.searchParams.get('routeId'),'ROUTE-1');
      return reply({...station,routeid:'ROUTE-1',routeno:'1',arrtime:120});
    };
    const result=await transitLookup(new URL('https://example.test/api/bus/nearby-stations?provider=tago&lat=37.28&lng=127.06&cityCode=999'));
    assert.equal(result.radiusMeters,500);assert.equal(result.source,'live');
    const selected=result.stations[0];
    const {routes}=await searchLiveStationRoutes({provider:'tago',cityCode:selected.cityCode,nodeId:selected.nodeId});
    const arrival=await fetchLiveArrival({provider:'tago',cityCode:selected.cityCode,nodeId:selected.nodeId,routeId:routes[0].routeId});
    assert.deepEqual(arrival.arrivalsMin,[2]);
    await assert.rejects(transitLookup(new URL('https://example.test/api/bus/nearby-stations?provider=subway&lat=37.28&lng=127.06')),/전국 버스/);
  } finally {
    globalThis.fetch=originalFetch;
    if(originalKey===undefined) delete process.env.TAGO_SERVICE_KEY; else process.env.TAGO_SERVICE_KEY=originalKey;
  }
});
