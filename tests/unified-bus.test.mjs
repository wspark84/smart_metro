import test from 'node:test';
import assert from 'node:assert/strict';
import {buildBusCities,fetchUnifiedBusCities,searchUnifiedBusStations,GYEONGGI_CITIES} from '../src/server/unified-bus.mjs';
import {normalizeGyeonggiStations,parseSeoulStationSearchXml,normalizeSeoulStations,searchLiveStationRoutes,fetchLiveArrival} from '../src/server/bus-providers.mjs';
import {stationSearchQueries,stationSelectionKey} from '../src/logic/station-search.js';

const cities=[{cityCode:'31010',cityName:'수원시'},{cityCode:'31250',cityName:'광주시'},{cityCode:'24',cityName:'광주광역시'},{cityCode:'25',cityName:'대전광역시'}];
const configured={seoul:true,gyeonggi:true,tago:true};
const catalog={cities:buildBusCities(cities,configured),warnings:[]};
test('city catalog combines Seoul and 31 Gyeonggi municipalities with automatic TAGO codes, without confusing Gwangju',()=>{
  assert.equal(GYEONGGI_CITIES.length,31);
  assert.deepEqual(catalog.cities.find(c=>c.id==='gg:수원시').providers,['gyeonggi','tago']);
  assert.equal(catalog.cities.find(c=>c.id==='gg:광주시').cityCode,'31250');
  assert.equal(catalog.cities.find(c=>c.id==='tago:24').cityName,'광주광역시');
  assert.equal(catalog.cities.filter(c=>c.cityCode==='31010').length,1);
  assert.equal(catalog.cities[0].id,'seoul');
});
test('missing regional keys do not get treated as TAGO permission; unconnected cities are disabled',()=>{
  const result=buildBusCities(cities,{tago:true});
  assert.deepEqual(result.find(c=>c.id==='gg:수원시').providers,['tago']);
  assert.equal(result.find(c=>c.id==='seoul').available,false);
  assert.equal(result.find(c=>c.id==='gg:연천군').available,false);
});
test('TAGO city failure is explicit while regional cities remain available',async()=>{
  const result=await fetchUnifiedBusCities({env:{TAGO_SERVICE_KEY:'test',GYEONGGI_SERVICE_KEY:'test'},fetchImpl:async()=>({ok:false,status:403})});
  assert.equal(result.warnings.length,1);
  assert.equal(result.cities.find(c=>c.id==='gg:수원시').available,true);
  assert.equal(result.cities.find(c=>c.id==='gg:수원시').cityCode,'');
});
test('combined search retains source-specific IDs and filters other or unknown GBIS cities',async()=>{
  const calls=[];
  const result=await searchUnifiedBusStations({cityId:'gg:수원시',keyword:'광교'}, {loadCities:async()=>catalog,search:async binding=>{
    calls.push(binding);
    return {stations:binding.provider==='gyeonggi' ? [
      {stationId:'123',stationName:'광교',regionName:'수원시'},
      {stationId:'456',stationName:'광교',regionName:'용인시'},
      {stationId:'789',stationName:'광교',regionName:''}
    ]:[{stationId:'123',nodeId:'123',stationName:'광교',cityCode:'31010'}]};
  }});
  assert.equal(calls.length,2);
  assert.ok(calls.every(c=>c.cityCode==='31010'));
  assert.deepEqual(result.stations.map(stationSelectionKey),['gyeonggi:123','tago:123']);
  assert.equal(result.stations[0].cityCode,'31010');
});
test('partial provider outage returns usable results with warning, complete outage fails, empty success remains empty',async()=>{
  const options={loadCities:async()=>catalog,search:async ({provider})=>{
    if(provider==='gyeonggi')throw new Error('private credentials must not leak');
    return {stations:[{stationId:'official'}]};
  }};
  const partial=await searchUnifiedBusStations({cityId:'gg:수원시',keyword:'광교'},options);
  assert.equal(partial.stations.length,1);assert.equal(partial.warnings.length,1);
  assert.doesNotMatch(JSON.stringify(partial),/private credentials/);
  await assert.rejects(searchUnifiedBusStations({cityId:'gg:수원시',keyword:'광교'},{...options,search:async()=>{throw Error('private');}}),/모두 실패/);
  const empty=await searchUnifiedBusStations({cityId:'gg:수원시',keyword:'없음'},{...options,search:async()=>({stations:[]})});
  assert.deepEqual(empty.stations,[]);assert.deepEqual(empty.warnings,[]);
});

test('GBIS short region names match only the selected Gyeonggi municipality',async()=>{
  for (const cityName of GYEONGGI_CITIES) {
    const shortName=cityName.replace(/[시군]$/, '');
    const result=await searchUnifiedBusStations({cityId:`gg:${cityName}`,keyword:'04413'}, {
      loadCities:async()=>catalog,
      search:async ({provider})=>({stations:provider==='gyeonggi' ? [
        {stationId:'short',regionName:shortName},
        {stationId:'full',regionName:cityName},
        {stationId:'prefixed',regionName:`경기도 ${shortName}`},
        {stationId:'other',regionName:cityName==='수원시'?'용인':'수원'},
        {stationId:'unknown',regionName:''},
        {stationId:'ambiguous',regionName:`${shortName}광역시`},
        {stationId:'partial',regionName:shortName.slice(0,1)},
      ]:[]}),
    });
    assert.deepEqual(result.stations.map(s=>s.stationId),['short','full','prefixed'],cityName);
  }
});
test('invalid city cannot inject arbitrary provider or city code into upstream calls',async()=>{
  const options={loadCities:async()=>catalog,search:()=>assert.fail('must not query')};
  await assert.rejects(searchUnifiedBusStations({cityId:'unknown',cityCode:'31010',keyword:'광교'},options),/도시 목록/);
  await assert.rejects(searchUnifiedBusStations({cityId:'seoul',keyword:''},options),/입력/);
});
test('official empty search codes are not errors, but authorization failures are not empty successes',()=>{
  assert.deepEqual(normalizeSeoulStations(parseSeoulStationSearchXml('<headerCd>4</headerCd>')),[]);
  assert.throws(()=>parseSeoulStationSearchXml('<headerCd>7</headerCd><headerMsg>denied</headerMsg>'),/denied/);
  assert.deepEqual(normalizeGyeonggiStations({response:{msgHeader:{resultCode:4}}}),[]);
  assert.throws(()=>normalizeGyeonggiStations({response:{msgHeader:{resultCode:20}}}),/사용 권한/);
});
test('numeric search keeps official full number, tries a leading zero for four digits, never broadens to a number prefix',()=>{
  assert.deepEqual(stationSearchQueries('04413'),['04413']);
  assert.deepEqual(stationSearchQueries('4413'),['4413','04413']);
  assert.deepEqual(stationSearchQueries('123456789'),['123456789']);
});
test('regional station source carries through routes and arrival without reusing TAGO identifiers',async()=>{
  const originalFetch=globalThis.fetch,oldKey=process.env.GYEONGGI_SERVICE_KEY;
  try {
    process.env.GYEONGGI_SERVICE_KEY='test';
    globalThis.fetch=async url=>{
      assert.equal(url.searchParams.get('stationId'),'GBIS123');
      if(url.pathname.endsWith('/getBusStationViaRouteListv2'))return {ok:true,json:async()=>({response:{msgBody:{busRouteList:[{routeId:'GGROUTE',routeName:'1',stationId:'GBIS123'}]}}})};
      assert.ok(url.pathname.endsWith('/getBusArrivalListv2'));
      return {ok:true,json:async()=>({response:{msgBody:{busArrivalList:[{routeId:'GGROUTE',routeName:'1',predictTime1:3}]}}})};
    };
    const {routes}=await searchLiveStationRoutes({provider:'gyeonggi',stationId:'GBIS123'});
    const arrival=await fetchLiveArrival({provider:'gyeonggi',stationId:'GBIS123',routeId:routes[0].routeId});
    assert.deepEqual(arrival.arrivalsMin,[3]);
  } finally {globalThis.fetch=originalFetch;if(oldKey===undefined)delete process.env.GYEONGGI_SERVICE_KEY;else process.env.GYEONGGI_SERVICE_KEY=oldKey;}
});
