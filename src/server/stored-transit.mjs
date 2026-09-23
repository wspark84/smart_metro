import {koreanServiceDate} from '../logic/bus-headway.js';

const BUS_PROVIDERS = ['seoul','gyeonggi','tago'];
const MAX_ENTRIES = 32;
const FAILED_RETRY_MS = 5 * 60_000;
export const headwayBindingKey = b => JSON.stringify([b.provider,b.cityCode || '',b.routeId || '']);
export const observationBindingKey = b => JSON.stringify([b.provider,b.cityCode || '',b.stationId || b.nodeId || '',b.routeId || '',b.order || '']);
const validMinutes = value => Array.isArray(value) ? value.filter(v=>typeof v==='number' && Number.isFinite(v) && v>=0) : [];
const signature = p => JSON.stringify(['source','weekday','saturday','sunday','holiday','allDays'].map(key=>p?.[key] || null));
const replace = (entries,entry) => [...entries.filter(item=>item.key!==entry.key),entry].slice(-MAX_ENTRIES);

// Cache belongs to the authenticated account's existing alarm-runtime document.
// It is durable across requests/deploys and never accepts a client-supplied anchor.
export async function loadStoredTransit(binding,{cache={},loadArrival,loadHeadway,saveCache,now=new Date()}) {
  if (!BUS_PROVIDERS.includes(binding.provider) || !binding.routeId) return loadArrival();
  const next = {
    headways:Array.isArray(cache.headways) ? structuredClone(cache.headways).slice(-MAX_ENTRIES) : [],
    observations:Array.isArray(cache.observations) ? structuredClone(cache.observations).slice(-MAX_ENTRIES) : [],
  };
  const routeKey = headwayBindingKey(binding);
  const stopKey = observationBindingKey(binding);
  const today = koreanServiceDate(now);
  let stored = next.headways.find(item=>item.key===routeKey);
  let dirty = false;
  // Start the independent real-time request immediately. Its failure must not
  // prevent today's metadata check or erase either durable last-known value.
  const arrivalTask = Promise.resolve().then(loadArrival).then(value=>({value}),()=>({value:null}));
  const failedRetryDue = stored?.refreshFailed && (stored.retryPolicy !== 5 ||
    now.getTime() - Date.parse(stored.checkedAt || '') >= FAILED_RETRY_MS);
  if (!stored || stored.checkedDate !== today || failedRetryDue) {
    let profile;
    try { profile = await loadHeadway(); } catch { profile = null; }
    const ready = profile?.status === 'ready';
    const changed = ready && signature(profile) !== signature(stored?.profile);
    stored = {key:routeKey,checkedDate:today,checkedAt:now.toISOString(),
      profile:ready ? profile : stored?.profile || null,
      lastChangedAt:changed ? now.toISOString() : stored?.lastChangedAt || null,
      refreshFailed:!ready,retryPolicy:5,failure:ready ? null : profile?.message || '배차간격 조회에 실패했습니다. 잠시 후 다시 확인합니다.'};
    next.headways = replace(next.headways,stored);
    dirty = true;
  }
  const {value:result} = await arrivalTask;
  const payload = result?.value;
  const fetchedAt = result?.fetchedAt;
  const age = now.getTime() - Date.parse(fetchedAt || '');
  const minutes = validMinutes(payload?.arrivalsMin);
  const real = Boolean(payload && minutes.length && result.cacheStatus !== 'stale-fallback' &&
    payload.liveStatus !== 'unavailable' && age >= -5000 && age <= 90_000 &&
    (!payload.lineNumber || !binding.routeNumber || String(payload.lineNumber)===String(binding.routeNumber)));
  let observation = next.observations.find(item=>item.key===stopKey)?.snapshot || null;
  if (real) {
    const snapshot = {provider:binding.provider,lineNumber:payload.lineNumber || binding.routeNumber,
      bindingKey:stopKey,arrivalsMin:minutes,fetchedAt};
    if (JSON.stringify(snapshot) !== JSON.stringify(observation)) {
      observation = snapshot;
      next.observations = replace(next.observations,{key:stopKey,snapshot});
      dirty = true;
    }
  }
  if (dirty) await saveCache(next);
  const headway = stored.profile ? {...stored.profile,checkedAt:stored.checkedAt,
    lastChangedAt:stored.lastChangedAt,stale:stored.refreshFailed} : {
    status:'unavailable',checkedAt:stored.checkedAt,message:stored.failure || '공식 배차간격을 아직 확인하지 못했습니다.',
  };
  const value = {...(real ? payload : {}),provider:binding.provider,
    lineNumber:real ? payload.lineNumber || binding.routeNumber : binding.routeNumber,
    stopName:real ? payload.stopName || binding.stationName : binding.stationName,
    arrivalsMin:real ? minutes : [],liveStatus:real ? 'ready' : 'unavailable',headway,
    lastObservation:observation,
    messages:real ? payload.messages || [] : ['실시간 정보 없음 · 저장한 도착시각과 배차간격으로 예상합니다.']};
  return {...(real ? result : {}),value,cacheStatus:real ? result.cacheStatus : 'unavailable',
    fetchedAt:real ? fetchedAt : now.toISOString(),servedAt:now.toISOString(),stale:!real,
    fallbackError:real ? '' : '실시간 도착정보를 확인하지 못했습니다.'};
}
