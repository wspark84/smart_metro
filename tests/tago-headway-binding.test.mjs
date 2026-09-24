import test from 'node:test';
import assert from 'node:assert/strict';
import {sameHeadwayStation,resolveTagoHeadwayBinding,reverseTagoRoute} from '../src/server/tago-headway-binding.mjs';
import {fetchBusHeadway} from '../src/server/bus-headway.mjs';
const stop={stationId:'regional-stop',stationName:'테스트.정류장',stationNumber:'04413',posX:'127.06',posY:'37.28'};
const tago={...stop,nodeId:'official-node',stationId:'official-node',cityCode:'official-city',stationNumber:'4413'};
const route={routeId:'regional-route',routeNumber:'1',destinationName:'종점'};
const target={routeId:'official-route',routeNumber:'1',destinationName:'종점'};
const binding={provider:'gyeonggi',stationId:stop.stationId,stationName:stop.stationName,routeId:route.routeId};
const deps={env:{},stations:async()=>[stop],regionalRoutes:async()=>[route],nearby:async()=>[tago],numberedStations:async()=>[tago],routes:async()=>[target]};

test('a successful partial-number search without the exact route reports missing coverage',async()=>{
  let mismatch='';
  const result=await resolveTagoHeadwayBinding(binding,{...deps,routes:async()=>[],
    onMismatch:stage=>{mismatch=stage;},fetchImpl:async url=>{
      assert.match(url.pathname,/getRouteNoList$/);
      const item=[{routeid:'official-11',routeno:11},{routeid:'official-13',routeno:13}];
      return {ok:true,text:async()=>JSON.stringify({response:{header:{resultCode:'00'},
        body:{items:{item},totalCount:2,pageNo:1,numOfRows:100}}})};
    }});
  assert.equal(result,null);
  assert.equal(mismatch,'route-not-listed');
});
test('reverse route lookup preserves official gateway errors instead of discarding HTTP error bodies',async()=>{
  let reads=0;
  await assert.rejects(reverseTagoRoute(tago,'1',{env:{TAGO_SERVICE_KEY:'secret'},fetchImpl:async()=>({ok:false,status:403,text:async()=>{
    reads++;return '<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>32</returnReasonCode><returnAuthMsg>secret</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>';
  }})}),error=>{
    assert.equal(error.apiCode,32);assert.equal(error.status,403);assert.equal(error.lookupStage,'route-list');
    assert.doesNotMatch(error.message,/secret/);return true;
  });
  assert.equal(reads,1);
});
test('empty stop route index is resolved from route list and exact official path node',async()=>{
  const result=await resolveTagoHeadwayBinding(binding,{...deps,routes:async()=>[],reverseRoutes:async(s,n)=>{
    assert.equal(s.nodeId,'official-node');assert.equal(n,'1');return [target];}});
  assert.equal(result.routeId,'official-route');
});
test('reverse lookup verifies the official node and rejects similarly numbered routes',async()=>{
  const run=async node=>reverseTagoRoute(tago,'1',{env:{TAGO_SERVICE_KEY:'test'},fetchImpl:async url=>{
    const item=url.pathname.endsWith('getRouteNoList') ? [{routeid:'r1',routeno:'1'},{routeid:'r11',routeno:'11'}] : [{routeid:'r1',nodeid:node}];
    if(url.pathname.endsWith('getRouteAcctoThrghSttnList')) assert.equal(url.searchParams.get('routeId'),'r1');
    return {ok:true,text:async()=>JSON.stringify({response:{header:{resultCode:'00'},body:{items:{item},totalCount:item.length,pageNo:1,numOfRows:100}}})};
  }});
  assert.equal((await run('official-node'))[0].routeId,'r1');assert.deepEqual(await run('opposite-stop'),[]);
});
test('nearby response without undocumented nodeno is enriched using official station-number lookup',async()=>{
  let lookedUp=false;
  const result=await resolveTagoHeadwayBinding(binding,{...deps,nearby:async()=>[{...tago,stationNumber:''}],
    numberedStations:async input=>{lookedUp=true;assert.equal(input.cityCode,'official-city');assert.equal(input.keyword,'4413');return [tago];}});
  assert.equal(result?.routeId,'official-route');assert.equal(lookedUp,true);
});
test('cross-provider match requires exact public number, name and nearby coordinates',()=>{
  assert.equal(sameHeadwayStation(stop,tago),true);
  for(const change of [{stationNumber:'4414'},{stationName:'반대편'},{posX:'128'},{posY:''},{posY:null}])
    assert.equal(sameHeadwayStation(stop,{...tago,...change}),false);
});
test('optional number supplied by live nearby response avoids unreliable number search',async()=>{
  const result=await resolveTagoHeadwayBinding(binding,{...deps,numberedStations:async()=>{throw new Error('must not query');}});
  assert.equal(result.routeId,'official-route');
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
    {nearby:async()=>[tago,{...tago,nodeId:'other'}],numberedStations:async()=>[tago,{...tago,nodeId:'other'}]},
    {nearby:async()=>[{...tago,stationNumber:''}],numberedStations:async()=>[{...tago,nodeId:'other'}]},
    {nearby:async()=>[{...tago,stationNumber:''}],numberedStations:async()=>[{...tago,stationNumber:'4414'}]},
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
    if(url.pathname.includes('getCrdntPrxmtSttnList')) return page({nodeid:'official-node',nodenm:stop.stationName,citycode:'official-city',gpslong:127.06,gpslati:37.28});
    if(url.pathname.includes('getSttnNoList')) return page({nodeid:'official-node',nodenm:stop.stationName,nodeno:4413,gpslong:127.06,gpslati:37.28});
    if(url.pathname.includes('getSttnThrghRouteList')) return page({routeid:'official-route',routeno:'1',endnodenm:'종점'});
    assert.match(url.pathname,/getRouteInfoIem/);
    assert.equal(url.searchParams.get('routeId'),'official-route');
    return page({routeid:'official-route',intervaltime:12,intervalsattime:18,intervalsuntime:20});
  };
  const options={env:{GYEONGGI_SERVICE_KEY:'gg-test',TAGO_SERVICE_KEY:'tago-test'},fetchImpl};
  const result=await fetchBusHeadway(binding,options);
  assert.equal(result.status,'ready');assert.equal(result.source,'TAGO 버스노선정보');assert.equal(result.weekday.max,12);
  assert.equal(calls,7);
  await fetchBusHeadway(binding,options);assert.equal(calls,7);
});
