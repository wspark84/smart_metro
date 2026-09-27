import {searchLiveStationRoutes,searchGyeonggiStations,searchGyeonggiStationRoutes} from './bus-providers.mjs';
import {searchTagoNearbyStations} from './tago-api.mjs';
import {sameHeadwayStation} from './tago-headway-binding.mjs';

// Resolve identities from both official APIs; never manufacture a regional ID.
export async function lookupBoardingRoutes(binding, {
  primary=searchLiveStationRoutes, nearby=searchTagoNearbyStations,
  stations=searchGyeonggiStations, routes=searchGyeonggiStationRoutes, env=process.env,
}={}) {
  let original, failure;
  try { original=await primary(binding); } catch(error) { failure=error; }
  if(original?.routes?.length) return original;
  const nodeId=String(binding.nodeId || binding.stationId || '');
  const x=Number(binding.posX),y=Number(binding.posY);
  if(binding.provider!=='tago' || !nodeId.startsWith('GGB') || !env.GYEONGGI_SERVICE_KEY ||
    !Number.isFinite(x) || !Number.isFinite(y) || x<124 || x>132 || y<33 || y>39) {
    if(failure) throw failure;
    return original;
  }
  const official=await nearby({serviceKey:env.TAGO_SERVICE_KEY,lat:y,lng:x});
  const matches=official.filter(s=>String(s.nodeId || s.stationId)===nodeId && String(s.cityCode)===String(binding.cityCode));
  if(matches.length!==1) throw new Error('선택한 정류장의 공식 위치를 다시 확인하지 못했습니다. 지도에서 다시 선택해 주세요.');
  const source=matches[0];
  if(!sameHeadwayStation(source,{...source,posX:x,posY:y,stationName:binding.stationName}))
    throw new Error('저장된 위치와 공식 정류장 위치가 일치하지 않습니다. 지도에서 다시 선택해 주세요.');
  const regional=await stations({serviceKey:env.GYEONGGI_SERVICE_KEY,keyword:source.stationNumber});
  const verified=regional.filter(s=>sameHeadwayStation(source,s));
  if(verified.length!==1) throw new Error('경기도 정류장의 번호·이름·위치를 하나로 확정하지 못했습니다. 다른 정류장에 연결하지 않았습니다.');
  const station={...verified[0],provider:'gyeonggi',providerLabel:'경기도 버스',selectionId:`gyeonggi:${verified[0].stationId}`,nodeId:''};
  const found=await routes({serviceKey:env.GYEONGGI_SERVICE_KEY,stationId:station.stationId});
  return {provider:'gyeonggi',routes:found,verifiedStation:station};
}
