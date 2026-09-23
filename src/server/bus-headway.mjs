import {createHash} from 'node:crypto';
import {fetchWithTimeout} from './upstream-fetch.mjs';
import {headwayRange,koreanServiceDate} from '../logic/bus-headway.js';
import {parseTagoResponse} from './tago-api.mjs';
import {resolveTagoHeadwayBinding} from './tago-headway-binding.mjs';

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

export async function fetchBusHeadway(binding,{env=process.env,fetchImpl=fetch,now=new Date()}={}) {
  if (!['seoul','gyeonggi','tago'].includes(binding.provider) || !binding.routeId) return null;
  const key = env[binding.provider === 'seoul' ? 'SEOUL_OPEN_API_KEY' : binding.provider === 'gyeonggi' ? 'GYEONGGI_SERVICE_KEY' : 'TAGO_SERVICE_KEY'];
  const unavailable = {status:'unavailable',message:'공식 배차간격을 확인하지 못했습니다. 노선정보 API 권한 또는 제공 여부를 확인해야 합니다.'};
  if (!key) return {...unavailable,message:binding.provider === 'tago' ? 'TAGO_SERVICE_KEY 설정이 필요합니다.' : unavailable.message};
  let cache = caches.get(fetchImpl);
  if (!cache) {cache=new Map();caches.set(fetchImpl,cache);}
  const cacheKey = JSON.stringify([binding.provider,binding.cityCode,binding.routeId,binding.stationId,binding.stationName,koreanServiceDate(now),createHash('sha256').update(key+'|'+(env.TAGO_SERVICE_KEY || '')).digest('hex')]);
  const hit = cache.get(cacheKey);
  if (hit && hit.until > Date.now()) return structuredClone(await hit.value);
  if (cache.size >= 256) cache.delete(cache.keys().next().value);
  const entry = {until:Date.now()+24*60*60*1000};
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
      if (!response.ok) throw Object.assign(new Error('Route metadata request failed'),{status:response.status});
      const profile = binding.provider === 'gyeonggi' ? normalizeGyeonggiHeadway(await response.json(),binding.routeId)
        : binding.provider === 'tago' ? normalizeTagoHeadway(await response.text(),binding.routeId)
        : normalizeSeoulHeadway(await response.text(),binding.routeId);
      if (!['weekday','saturday','sunday','holiday','allDays'].some(day=>profile[day])) throw Object.assign(new Error('No interval'),{code:'NO_HEADWAY'});
      return {...profile,status:'ready',fetchedAt:now.toISOString()};
    } catch (error) {
      if(binding.provider==='gyeonggi' && env.TAGO_SERVICE_KEY) {
        try {
          // Bound the additional identity lookup; a slow metadata provider must
          // not keep the independently loaded real-time arrivals waiting.
          const deadline=AbortSignal.timeout(10000);
          const boundedFetch=(url,options={})=>fetchImpl(url,{...options,
            signal:options.signal ? AbortSignal.any([deadline,options.signal]) : deadline});
          let mismatch='';
          const tago=await resolveTagoHeadwayBinding(binding,{env,fetchImpl:boundedFetch,onMismatch:stage=>{mismatch=stage;}});
          if(tago) {
            const fallback=await fetchBusHeadway(tago,{env,fetchImpl,now});
            if(fallback?.status==='ready') return {...fallback,matchedProvider:'tago',matchedRouteId:tago.routeId};
            entry.until=Date.now()+60_000;
            if(fallback) return fallback;
          }
          entry.until=Date.now()+60_000;
          const reasons={'regional-stop':'경기 정류장 ID 확인','regional-route':'경기 노선 ID 확인','nearby-stop':'TAGO 주변 정류장 위치 대조',
            'numbered-stop':'TAGO 정류장 번호·ID 대조','tago-route':'TAGO 경유 노선 확인','destination':'노선 종점 대조'};
          return {...unavailable,message:`TAGO 배차간격 연결 중 ${reasons[mismatch] || '정류장·노선 확인'} 단계에서 일치하는 정보를 찾지 못했습니다.`};
        } catch (lookupError) {
          entry.until=Date.now()+60_000;
          const apiCode=lookupError?.message?.match(/^TAGO API 오류 \((\d+)\)/)?.[1];
          const step={'route-list':'노선 번호 검색','route-path':'노선 경유 정류장 확인'}[lookupError?.lookupStage];
          if(step) {
            const reason=apiCode==='20' || [401,403].includes(lookupError.status) ? 'API 이용 권한 거부'
              : apiCode==='22' ? '일일 조회 한도 초과'
              : lookupError.code==='UPSTREAM_TIMEOUT' || ['TimeoutError','AbortError'].includes(lookupError.name) ? '응답 시간 초과'
              : lookupError.status ? `HTTP ${Number(lookupError.status)}`
              : ['Incomplete route metadata','Invalid route metadata','Route metadata limit exceeded'].includes(lookupError.message) ? '응답 목록의 누락 또는 형식 불일치'
              : apiCode ? `API 오류 ${apiCode}` : '응답 해석 실패';
            return {...unavailable,message:`TAGO ${step} 단계 실패: ${reason}.`};
          }
          if(apiCode==='20') return {...unavailable,message:'TAGO 정류소정보 API 이용 권한이 거부되었습니다. 정류소정보 서비스 승인과 서버 인증키를 확인해 주세요.'};
          if(apiCode==='22') return {...unavailable,message:'TAGO 정류소정보 API의 일일 조회 한도를 초과했습니다.'};
          if(apiCode==='30') return {...unavailable,message:'TAGO 정류소정보 API 인증키가 유효하지 않습니다.'};
          return {...unavailable,message:'TAGO 배차간격 연결을 위한 정류장·노선 조회에 실패했습니다. 잠시 후 다시 확인합니다.'};
        }
      }
      entry.until=Date.now()+60_000;
      const code = error?.message?.match(/^TAGO API 오류 \((\d+)\)/)?.[1];
      const message = code === '20' || [401,403].includes(error?.status)
        ? '버스노선정보 API 이용 권한을 확인해 주세요. 승인 후 최대 5분 간격으로 다시 확인합니다.'
        : code === '22' ? '버스노선정보 API의 일일 조회 한도를 초과했습니다.'
        : code === '30' ? '버스노선정보 API 인증키가 등록되지 않았습니다.'
        : error?.code === 'NO_HEADWAY' ? '이 노선의 API 응답에 유효한 배차간격이 없습니다.'
        : error?.code === 'UPSTREAM_TIMEOUT' ? '버스노선정보 조회 응답이 지연되고 있습니다. 잠시 후 다시 확인합니다.'
        : '버스노선정보를 확인하지 못했습니다. 최대 5분 간격으로 다시 확인합니다.';
      return {...unavailable,message}; // Allowlisted messages only: never return URLs or secrets.
    }
  })();
  cache.set(cacheKey,entry);
  return structuredClone(await entry.value);
}
