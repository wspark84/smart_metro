import {lookupBoardingRoutes} from './boarding-routes.mjs';
import {fetchTransitRoutes} from './transit-providers.mjs';
import {fetchWithTimeout} from './upstream-fetch.mjs';
import {parseSubwayRouteId} from '../logic/station-search.js';
import {transitQueryKey} from '../logic/transit-journey.js';
import {routeRows} from './tago-headway-binding.mjs';

const name=v=>String(v || '').replace(/[\s.,·]/g,'');
const same=(a,b)=>Boolean(name(a)) && name(a)===name(b);
const stationSame=(a,b)=>same(String(a || '').replace(/\([^)]*\)/g,'').replace(/역$/,''),String(b || '').replace(/\([^)]*\)/g,'').replace(/역$/,''));
const list=v=>Array.isArray(v) ? v : v ? [v] : [];

export async function verifyBoardingDirection(binding,journey,{env=process.env,fetchImpl=fetch}={}) {
  if(binding.provider==='subway') {
    const direction=parseSubwayRouteId(binding.routeId);
    const stops=journey.steps[0]?.stops || [];
    const terminal=direction ? stops.findIndex(s=>stationSame(s,direction.destination)) : -1;
    return Boolean(direction && stationSame(direction.nextStation,journey.nextStation) &&
      (terminal<0 || terminal===stops.length-1) && journey.firstVehicles.some(v=>same(v.type,direction.trainType)));
  }
  if(binding.provider==='tago') {
    const stops=(await routeRows('getRouteAcctoThrghSttnList',{cityCode:binding.cityCode,routeId:binding.routeId},{env,fetchImpl}))
      .sort((a,b)=>Number(a.nodeord)-Number(b.nodeord));
    const positions=stops.flatMap((s,i)=>String(s.nodeid)===String(binding.nodeId) ? [i] : []);
    return positions.length===1 && same(stops[positions[0]+1]?.nodenm,journey.nextStation);
  }
  if(binding.provider==='seoul') {
    const url=new URL('http://ws.bus.go.kr/api/rest/busRouteInfo/getStaionByRoute');
    url.searchParams.set('serviceKey',env.SEOUL_OPEN_API_KEY);url.searchParams.set('busRouteId',binding.routeId);
    const response=await fetchWithTimeout(url,{}, {fetchImpl});
    if(!response.ok) return false;
    const xml=await response.text();
    const value=(block,key)=>block.match(new RegExp(`<${key}>([\\s\\S]*?)</${key}>`))?.[1]?.trim() || '';
    if(value(xml,'headerCd')!=='0') return false;
    const stops=[...xml.matchAll(/<itemList>([\s\S]*?)<\/itemList>/g)].map(m=>({id:value(m[1],'station'),name:value(m[1],'stationNm'),seq:value(m[1],'seq')})).sort((a,b)=>Number(a.seq)-Number(b.seq));
    const positions=stops.flatMap((s,i)=>s.id===String(binding.stationId) && (!binding.order || s.seq===String(binding.order)) ? [i] : []);
    return positions.length===1 && same(stops[positions[0]+1]?.name,journey.nextStation);
  }
  if(binding.provider!=='gyeonggi') return false;
  const url=new URL('https://apis.data.go.kr/6410000/busrouteservice/v2/getBusRouteStationListv2');
  for(const [key,value] of Object.entries({serviceKey:env.GYEONGGI_SERVICE_KEY,routeId:binding.routeId,format:'json'})) url.searchParams.set(key,value);
  const response=await fetchWithTimeout(url,{}, {fetchImpl});
  if(!response.ok) throw new Error('노선의 공식 경유 방향을 조회하지 못했습니다.');
  const json=await response.json(),body=json.response || json;
  if(String(body.msgHeader?.resultCode)!=='0') throw new Error('노선의 공식 경유 방향을 확인하지 못했습니다.');
  const stops=list(body.msgBody?.busRouteStationList).sort((a,b)=>Number(a.stationSeq)-Number(b.stationSeq));
  const positions=stops.flatMap((s,i)=>String(s.stationId)===String(binding.stationId) &&
    (!binding.order || String(s.stationSeq)===String(binding.order)) ? [i] : []);
  return positions.length===1 && same(stops[positions[0]+1]?.stationName,journey.nextStation);
}

export async function discoverJourneyOptions(query,{lookup=lookupBoardingRoutes,journeys=fetchTransitRoutes,
  verify=verifyBoardingDirection,env=process.env}={}) {
  const [stops,paths]=await Promise.all([
    lookup({...query,posX:query.stopLocation?.lng,posY:query.stopLocation?.lat},{env}),journeys(query,env),
  ]);
  const station=stops.verifiedStation || query;
  const options=[],verifiedPaths=new Set(),verification=new Map();
  const candidates=paths.routes.filter(path=>(query.provider==='subway' ? stationSame(path.boardingStation,query.stationName) : same(path.boardingStation,query.stationName)) &&
    path.vehicleType===(query.provider==='subway' ? 'SUBWAY' : 'BUS'));
  for(const route of stops.routes || []) {
    const binding={...query,...station,...route,provider:stops.provider || query.provider,
      stationId:route.stationId || station.stationId || query.stationId,
      nodeId:route.nodeId || station.nodeId || query.nodeId,
      stationName:station.stationName || query.stationName,routeId:route.routeId,routeNumber:route.routeNumber};
    const matches=candidates.filter(path=>path.firstVehicles.some(v=>same(v.name,route.routeNumber)));
    for(const path of matches) {
      try {
        const verificationKey=JSON.stringify([binding.provider,binding.stationId,binding.routeId,binding.order,path.nextStation,path.steps[0]?.stops,path.firstVehicles]);
        if(!verification.has(verificationKey)) verification.set(verificationKey,verify(binding,path,{env}));
        if(!await verification.get(verificationKey)) continue;
        options.push({...path,id:`${binding.provider}:${route.routeId}:${path.id}`,binding,
          verified:true,compatible:true,boardingConfirmed:true,direction:route.label || `${path.nextStation} 방면`});
        verifiedPaths.add(path.id);
      } catch { /* Unverified candidate stays excluded and is reported below. */ }
    }
  }
  return {queryKey:transitQueryKey(query),fetchedAt:new Date().toISOString(),options,unverifiedCount:candidates.filter(path=>!verifiedPaths.has(path.id)).length,
    warning:'조회 제공처가 반환하고 탑승 위치·방향을 확인한 경로를 비교합니다. 환승 대기 및 운행 지연은 예상과 다를 수 있습니다.'};
}

export async function refreshJourneyOptions(query,{loadArrival,discover=discoverJourneyOptions,previous=null,now=new Date()}={}) {
  const key=transitQueryKey(query);
  const age=now-Date.parse(previous?.fetchedAt || '');
  const metadata=previous?.queryKey===key && age>=0 && age<5*60_000 ? previous : await discover(query);
  const snapshots=new Map(),options=[];
  // Sequential durable-cache writes avoid losing another route's observation.
  for(const option of metadata.options) {
    const id=JSON.stringify([option.binding.provider,option.binding.stationId,option.binding.routeId,option.binding.order]);
    if(!snapshots.has(id)) {
      try { const result=await loadArrival(option.binding);snapshots.set(id,{...result.value,fetchedAt:result.fetchedAt,cacheStatus:result.cacheStatus}); }
      catch { snapshots.set(id,{liveStatus:'unavailable',arrivalsMin:[]}); }
    }
    options.push({...option,snapshot:snapshots.get(id)});
  }
  return {...metadata,options,updatedAt:now.toISOString()};
}
