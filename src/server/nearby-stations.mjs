import {searchTagoNearbyStations} from './tago-api.mjs';
import {normalizeGyeonggiStations} from './bus-providers.mjs';
import {fetchWithTimeout} from './upstream-fetch.mjs';
import {haversineDistanceMeters} from '../logic/commute.js';
import {nearbyCatalogStations} from './transit-catalog.mjs';

// Official: https://www.gbis.go.kr/gbis2014/publicService.action?cmd=mBusStationSearcharound
export async function searchNearbyBoardingStations({lat,lng},{env=process.env,fetchImpl=fetch,tago=searchTagoNearbyStations}={}) {
  if(lat==null || lng==null || String(lat).trim()==='' || String(lng).trim()==='' ||
    !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng)) || Number(lat)<33 || Number(lat)>39 || Number(lng)<124 || Number(lng)>132)
    throw new Error('지도의 검색 위치가 올바르지 않습니다.');
  let originalError;
  if(fetchImpl===globalThis.fetch) {
    const saved=await nearbyCatalogStations(lat,lng);
    if(saved?.length) return {provider:'tago',stations:saved,source:'database'};
  }
  try {
    const stations=await tago({serviceKey:env.TAGO_SERVICE_KEY,lat,lng,fetchImpl});
    if(stations.length) return {provider:'tago',stations};
  } catch(error) {originalError=error;}
  if(!env.GYEONGGI_SERVICE_KEY) {
    if(originalError) throw originalError;
    return {provider:'tago',stations:[]};
  }
  try {
    const url=new URL('https://apis.data.go.kr/6410000/busstationservice/v2/getBusStationAroundListv2');
    for(const [key,value] of Object.entries({serviceKey:env.GYEONGGI_SERVICE_KEY,x:lng,y:lat,format:'json'})) url.searchParams.set(key,value);
    const response=await fetchWithTimeout(url,{}, {fetchImpl});
    if(!response.ok) throw new Error('경기도 주변 정류장 조회에 실패했습니다.');
    const stations=normalizeGyeonggiStations(await response.json()).filter(s=>{
      const distance=haversineDistanceMeters({lat:Number(lat),lng:Number(lng)},{lat:Number(s.posY),lng:Number(s.posX)});
      return distance!==null && distance<=500;
    }).map(s=>({...s,provider:'gyeonggi',providerLabel:'경기도 버스',selectionId:`gyeonggi:${s.stationId}`}));
    if(!stations.length && originalError) throw originalError;
    return {provider:'gyeonggi',stations};
  } catch(error) {throw originalError || error;}
}
