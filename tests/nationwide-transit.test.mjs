import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchUnifiedBusCities,searchUnifiedBusStations} from '../src/server/unified-bus.mjs';
import {searchSubwayStations} from '../src/server/subway-providers.mjs';
import {refreshJourneyOptions} from '../src/server/automatic-journeys.mjs';

test('national bus coverage checks stop and arrival services independently',async()=>{
  const calls=[];
  const catalog=await fetchUnifiedBusCities({env:{TAGO_SERVICE_KEY:'test'},loadTagoCities:async({service})=>{
    calls.push(service);
    return service==='stops'?[{cityCode:'21',cityName:'부산광역시'},{cityCode:'22',cityName:'대구광역시'}]:[{cityCode:'21',cityName:'부산광역시'}];
  }});
  assert.deepEqual(calls.sort(),['arrivals','stops']);
  assert.equal(catalog.cities.find(c=>c.cityCode==='21').arrivalSupport,'available');
  assert.equal(catalog.cities.find(c=>c.cityCode==='22').arrivalSupport,'unavailable');
  const result=await searchUnifiedBusStations({cityId:'tago:22',keyword:'중앙'},{loadCities:async()=>catalog,search:async()=>({stations:[]})});
  assert.match(result.warnings.join(' '),/실시간/);
});

test('arrival coverage failure is unknown, not unsupported, and does not hide cities',async()=>{
  const result=await fetchUnifiedBusCities({env:{TAGO_SERVICE_KEY:'test'},loadTagoCities:async({service})=>{
    if(service==='arrivals')throw Error('secret');
    return [{cityCode:'24',cityName:'광주광역시'}];
  }});
  const city=result.cities.find(c=>c.cityCode==='24');
  assert.equal(city.available,true);assert.equal(city.arrivalSupport,'unknown');
  assert.doesNotMatch(JSON.stringify(result),/secret/);
});

test('national subway search reads subsequent pages and separates regional line labels',async()=>{
  const pages=[];
  const result=await searchSubwayStations('중앙',{KAKAO_LOCAL_REST_API_KEY:'test'},async url=>{
    const page=Number(new URL(url).searchParams.get('page'));pages.push(page);
    return {ok:true,json:async()=>({meta:{is_end:page===2},documents:[{id:String(page),category_group_code:'SW8',
      place_name:page===1?'중앙역 부산 1호선':'중앙역 동해선',category_name:page===1?'교통 > 지하철 > 부산1호선':'교통 > 지하철 > 동해선',x:'129.03',y:'35.1'}]})};
  });
  assert.deepEqual(pages,[1,2]);
  assert.deepEqual(result.map(s=>s.stationName),['중앙','중앙']);
  assert.deepEqual(result.map(s=>s.lineName),['부산 1호선','동해선']);
});

test('same route and stop IDs in different cities never share arrival snapshots',async()=>{
  const calls=[];
  const result=await refreshJourneyOptions({provider:'tago'}, {discover:async()=>({options:['21','22'].map(cityCode=>({
    id:cityCode,binding:{provider:'tago',cityCode,nodeId:'stop',routeId:'route'}}))}),
    loadArrival:async binding=>{calls.push(binding.cityCode);return {value:{arrivalsMin:[Number(binding.cityCode)]}};}});
  assert.deepEqual(calls,['21','22']);
  assert.deepEqual(result.options.map(o=>o.snapshot.arrivalsMin[0]),[21,22]);
});

test('national city support follows official lists without a capital-region allowlist',async()=>{
  const names=['부산광역시','대구광역시','인천광역시','광주광역시','대전광역시','울산광역시','세종특별자치시','제주시','춘천시','청주시','전주시','창원시'];
  // Synthetic IDs: test fixtures are not an administrative code reference.
  const rows=names.map((cityName,i)=>({cityCode:`test-${i}`,cityName}));
  const result=await fetchUnifiedBusCities({env:{TAGO_SERVICE_KEY:'test'},loadTagoCities:async()=>rows});
  for(const row of rows) {
    const city=result.cities.find(c=>c.cityCode===row.cityCode);
    assert.equal(city.cityName,row.cityName);assert.equal(city.arrivalSupport,'available');
  }
});

test('Seoul direct connection remains available when TAGO has only static Seoul data',async()=>{
  const result=await fetchUnifiedBusCities({env:{TAGO_SERVICE_KEY:'test',SEOUL_OPEN_API_KEY:'test'},
    loadTagoCities:async({service})=>service==='stops'?[{cityCode:'11',cityName:'서울특별시'}]:[]});
  assert.equal(result.cities.find(c=>c.id==='seoul').arrivalSupport,'available');
});

test('subway search pagination is bounded and subsequent page failures are not concealed',async()=>{
  let calls=0;
  const fetchImpl=async()=>{calls++;return {ok:true,json:async()=>({meta:{is_end:false},documents:[{
    id:String(calls),place_name:'사상역 부산김해경전철',category_group_code:'SW8',x:'128.99',y:'35.16'}]})};};
  const result=await searchSubwayStations('사상',{KAKAO_LOCAL_REST_API_KEY:'test'},fetchImpl);
  assert.equal(calls,3);assert.equal(result.length,3);assert.equal(result[0].lineName,'부산김해경전철');
  calls=0;
  await assert.rejects(searchSubwayStations('사상',{KAKAO_LOCAL_REST_API_KEY:'test'},async(...args)=>
    calls===1?{ok:false,status:503}:fetchImpl(...args)),/503/);
});
