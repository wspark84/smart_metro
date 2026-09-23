import {createHash} from 'node:crypto';
import {fetchWithTimeout} from './upstream-fetch.mjs';
import {headwayRange} from '../logic/bus-headway.js';
import {parseTagoResponse} from './tago-api.mjs';

const caches = new WeakMap();
const xml = (text,key) => text.match(new RegExp(`<${key}>([\\s\\S]*?)</${key}>`))?.[1]?.trim() || '';
const rows = value => Array.isArray(value) ? value : value ? [value] : [];

export function normalizeGyeonggiHeadway(payload, routeId) {
  const response = payload.response || payload;
  if (String(response.msgHeader?.resultCode) !== '0') throw new Error('Route metadata unavailable');
  const row = rows(response.msgBody?.busRouteInfoItem).find(row => String(row.routeId) === String(routeId));
  if (!row) throw new Error('Route metadata mismatch');
  return {source:'경기도 버스노선 조회',weekday:headwayRange(row.peekAlloc,row.nPeekAlloc),
    saturday:headwayRange(row.satPeekAlloc,row.satNPeekAlloc),sunday:headwayRange(row.sunPeekAlloc,row.sunNPeekAlloc),
    holiday:headwayRange(row.wePeekAlloc,row.weNPeekAlloc)};
}

export function normalizeTagoHeadway(text, routeId) {
  const body = parseTagoResponse(text);
  const row = rows(body.items?.item).find(row => String(row.routeid) === String(routeId));
  if (!row) throw new Error('Route metadata mismatch');
  return {source:'TAGO 버스노선정보',weekday:headwayRange(row.intervaltime),
    saturday:headwayRange(row.intervalsattime),sunday:headwayRange(row.intervalsuntime),holiday:null};
}

export function normalizeSeoulHeadway(text, routeId) {
  if (xml(text,'headerCd') !== '0') throw new Error('Route metadata unavailable');
  const blocks = [...text.matchAll(/<itemList>([\s\S]*?)<\/itemList>/g)].map(match => match[1]);
  const block = blocks.find(block => xml(block,'busRouteId') === String(routeId));
  if (!block) throw new Error('Route metadata mismatch');
  return {source:'서울 버스노선정보',allDays:headwayRange(xml(block,'term'))};
}

export async function fetchBusHeadway(binding,{env=process.env,fetchImpl=fetch}={}) {
  if (!['seoul','gyeonggi','tago'].includes(binding.provider) || !binding.routeId) return null;
  const key = env[binding.provider === 'seoul' ? 'SEOUL_OPEN_API_KEY' : binding.provider === 'gyeonggi' ? 'GYEONGGI_SERVICE_KEY' : 'TAGO_SERVICE_KEY'];
  const unavailable = {status:'unavailable',message:'공식 배차간격을 확인하지 못했습니다. 노선정보 API 권한 또는 제공 여부를 확인해야 합니다.'};
  if (!key) return unavailable;
  let cache = caches.get(fetchImpl);
  if (!cache) {cache=new Map();caches.set(fetchImpl,cache);}
  const cacheKey = JSON.stringify([binding.provider,binding.cityCode,binding.routeId,createHash('sha256').update(key).digest('hex')]);
  const hit = cache.get(cacheKey);
  if (hit && hit.until > Date.now()) return structuredClone(await hit.value);
  if (cache.size >= 256) cache.delete(cache.keys().next().value);
  const entry = {until:Date.now()+6*60*60*1000};
  entry.value = (async()=>{
    try {
      const url = new URL(binding.provider === 'gyeonggi'
        ? 'https://apis.data.go.kr/6410000/busrouteservice/v2/getBusRouteInfoItemv2'
        : binding.provider === 'tago' ? 'https://apis.data.go.kr/1613000/BusRouteInfoInqireService/getRouteInfoIem'
        : 'http://ws.bus.go.kr/api/rest/busRouteInfo/getRouteInfo');
      url.searchParams.set('serviceKey',key);
      url.searchParams.set(binding.provider === 'seoul' ? 'busRouteId' : 'routeId',binding.routeId);
      if (binding.provider === 'gyeonggi') url.searchParams.set('format','json');
      if (binding.provider === 'tago') {url.searchParams.set('_type','json');url.searchParams.set('cityCode',binding.cityCode || '');}
      const response = await fetchWithTimeout(url,{}, {fetchImpl,timeoutMs:4000});
      if (!response.ok) throw new Error('Route metadata request failed');
      const profile = binding.provider === 'gyeonggi' ? normalizeGyeonggiHeadway(await response.json(),binding.routeId)
        : binding.provider === 'tago' ? normalizeTagoHeadway(await response.text(),binding.routeId)
        : normalizeSeoulHeadway(await response.text(),binding.routeId);
      if (!['weekday','saturday','sunday','holiday','allDays'].some(day=>profile[day])) throw new Error('No interval');
      return {...profile,status:'ready',fetchedAt:new Date().toISOString()};
    } catch {
      entry.until=Date.now()+60_000;
      return unavailable; // Do not leak request URLs or keys, or fail real-time arrivals.
    }
  })();
  cache.set(cacheKey,entry);
  return structuredClone(await entry.value);
}
