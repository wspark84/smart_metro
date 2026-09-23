import {searchGyeonggiStations,searchGyeonggiStationRoutes} from './bus-providers.mjs';
import {searchTagoNearbyStations,searchTagoStationRoutes,searchTagoStations} from './tago-api.mjs';

const number = value => /^\d+$/.test(String(value || '').trim()) ? String(value).trim().replace(/^0+/, '') : '';
const name = value => String(value || '').replace(/[\s.,·]/g,'');
export function sameHeadwayStation(source,candidate) {
  if (!number(source.stationNumber) || number(source.stationNumber)!==number(candidate.stationNumber)) return false;
  return sameLocationAndName(source,candidate);
}
function sameLocationAndName(source,candidate) {
  const coordinates=[source.posX,source.posY,candidate.posX,candidate.posY];
  if(coordinates.some(v=>v==null || String(v).trim()==='' || !Number.isFinite(Number(v)))) return false;
  const [x,y,cx,cy]=coordinates.map(Number);
  if(x<124 || x>132 || y<33 || y>39 || cx<124 || cx>132 || cy<33 || cy>39) return false;
  const meters=Math.hypot((x-cx)*111320*Math.cos(y*Math.PI/180),(y-cy)*111320);
  return meters<=60 && name(source.stationName)===name(candidate.stationName);
}

// Never derive TAGO IDs by adding a prefix to a regional ID. Both identities
// must be returned by their official APIs, including the city of this stop.
export async function resolveTagoHeadwayBinding(binding,{env,fetchImpl,
  stations=searchGyeonggiStations,regionalRoutes=searchGyeonggiStationRoutes,
  nearby=searchTagoNearbyStations,numberedStations=searchTagoStations,routes=searchTagoStationRoutes,onMismatch=()=>{}}={}) {
  const missing=stage=>{onMismatch(stage);return null;};
  if(binding.provider!=='gyeonggi' || !binding.stationId || !binding.stationName) return null;
  const source=(await stations({serviceKey:env.GYEONGGI_SERVICE_KEY,keyword:binding.stationName,fetchImpl}))
    .filter(s=>s.stationId===String(binding.stationId));
  if(source.length!==1) return missing('regional-stop');
  const own=(await regionalRoutes({serviceKey:env.GYEONGGI_SERVICE_KEY,stationId:binding.stationId,fetchImpl}))
    .filter(r=>r.routeId===String(binding.routeId));
  if(own.length!==1 || !own[0].routeNumber) return missing('regional-route');
  const near=(await nearby({serviceKey:env.TAGO_SERVICE_KEY,lat:source[0].posY,lng:source[0].posX,fetchImpl}))
    .filter(s=>sameLocationAndName(source[0],s));
  const cities=[...new Set(near.map(s=>s.cityCode).filter(Boolean))];
  if(cities.length!==1 || !number(source[0].stationNumber)) return missing('nearby-stop');
  // getCrdntPrxmtSttnList does NOT publish nodeno. Obtain it from
  // getSttnNoList, then join by the official city + node identity.
  const matches=(await numberedStations({serviceKey:env.TAGO_SERVICE_KEY,cityCode:cities[0],
    keyword:number(source[0].stationNumber),fetchImpl,diagnosticLogger:()=>{}}))
    .filter(s=>sameHeadwayStation(source[0],s) && near.some(n=>n.nodeId===s.nodeId && n.cityCode===s.cityCode));
  if(matches.length!==1) return missing('numbered-stop');
  const stop=matches[0];
  const candidates=(await routes({serviceKey:env.TAGO_SERVICE_KEY,cityCode:stop.cityCode,nodeId:stop.nodeId,
    routeNumber:own[0].routeNumber,fetchImpl})).filter(r=>r.routeNumber===own[0].routeNumber);
  if(candidates.length!==1) return missing('tago-route');
  if(own[0].destinationName && candidates[0].destinationName && name(own[0].destinationName)!==name(candidates[0].destinationName)) return missing('destination');
  return {...candidates[0],provider:'tago'};
}
