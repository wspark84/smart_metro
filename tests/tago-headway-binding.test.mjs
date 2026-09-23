import test from 'node:test';
import assert from 'node:assert/strict';
import {sameHeadwayStation,resolveTagoHeadwayBinding} from '../src/server/tago-headway-binding.mjs';
import {fetchBusHeadway} from '../src/server/bus-headway.mjs';
const stop={stationId:'regional-stop',stationName:'테스트.정류장',stationNumber:'04413',posX:'127.06',posY:'37.28'};
const tago={...stop,nodeId:'official-node',stationId:'official-node',cityCode:'official-city',stationNumber:'4413'};
const route={routeId:'regional-route',routeNumber:'1',destinationName:'종점'};
const target={routeId:'official-route',routeNumber:'1',destinationName:'종점'};
const binding={provider:'gyeonggi',stationId:stop.stationId,stationName:stop.stationName,routeId:route.routeId};
const deps={env:{},stations:async()=>[stop],regionalRoutes:async()=>[route],nearby:async()=>[tago],routes:async()=>[target]};
test('cross-provider match requires exact public number, name and nearby coordinates',()=>{
  assert.equal(sameHeadwayStation(stop,tago),true);
  for(const change of [{stationNumber:'4414'},{stationName:'반대편'},{posX:'128'},{posY:''},{posY:null}])
    assert.equal(sameHeadwayStation(stop,{...tago,...change}),false);
});
test('official route and station identities are used without transforming regional IDs',async()=>{
  const result=await resolveTagoHeadwayBinding(binding,{...deps,routes:async input=>{
    assert.equal(input.nodeId,'official-node');assert.equal(input.cityCode,'official-city');return [target];
  }});
  assert.equal(result.routeId,'official-route');assert.equal(result.provider,'tago');
});
test('ambiguous stations, routes, mismatched regional IDs or destinations fail closed',async()=>{
  for(const change of [
    {stations:async()=>[{...stop,stationId:'other'}]},
    {regionalRoutes:async()=>[{...route,routeId:'other'}]},
    {nearby:async()=>[tago,{...tago,nodeId:'other'}]},
    {routes:async()=>[target,{...target,routeId:'other'}]},
    {routes:async()=>[{...target,destinationName:'다른종점'}]},
  ]) assert.equal(await resolveTagoHeadwayBinding(binding,{...deps,...change}),null);
});
test('Gyeonggi failure obtains and caches TAGO headway through verified official identities',async()=>{
  let calls=0;
  const json=value=>({ok:true,json:async()=>value,text:async()=>JSON.stringify(value)});
  const gg=(key,value)=>json({response:{msgHeader:{resultCode:0},msgBody:{[key]:value}}});
  const page=item=>json({response:{header:{resultCode:'00'},body:{items:{item},totalCount:1,pageNo:1,numOfRows:100}}});
  const fetchImpl=async url=>{
    calls++;
    if(url.pathname.includes('getBusRouteInfoItem')) return {ok:false,status:403};
    if(url.pathname.includes('getBusStationList')) return gg('busStationList',{stationId:stop.stationId,stationName:stop.stationName,mobileNo:'04413',x:127.06,y:37.28});
    if(url.pathname.includes('getBusStationViaRouteList')) return gg('busRouteList',{routeId:route.routeId,routeName:'1',endStationName:'종점'});
    if(url.pathname.includes('getCrdntPrxmtSttnList')) return page({nodeid:'official-node',nodenm:stop.stationName,nodeno:4413,citycode:'official-city',gpslong:127.06,gpslati:37.28});
    if(url.pathname.includes('getSttnThrghRouteList')) return page({routeid:'official-route',routeno:'1',endnodenm:'종점'});
    assert.match(url.pathname,/getRouteInfoIem/);
    assert.equal(url.searchParams.get('routeId'),'official-route');
    return page({routeid:'official-route',intervaltime:12,intervalsattime:18,intervalsuntime:20});
  };
  const options={env:{GYEONGGI_SERVICE_KEY:'gg-test',TAGO_SERVICE_KEY:'tago-test'},fetchImpl};
  const result=await fetchBusHeadway(binding,options);
  assert.equal(result.status,'ready');assert.equal(result.source,'TAGO 버스노선정보');assert.equal(result.weekday.max,12);
  assert.equal(calls,6);
  await fetchBusHeadway(binding,options);assert.equal(calls,6);
});
