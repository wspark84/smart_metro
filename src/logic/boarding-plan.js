import { addMinutes, combineDateAndTime, evaluateLateRisk, buildDepartureGuidance, formatClock } from './commute.js';
import { koreanServiceDate } from './bus-headway.js';

export const DEPARTURE_REMINDER_MINUTES = [20, 10, 5, 3];

export function departurePlanningEnabled(state) {
  const live = state?.live;
  return Boolean(live?.provider && live.provider !== 'none' && live.routeNumber &&
    state?.commute?.planningBindingKey === JSON.stringify([live.provider,live.stationId || live.nodeId,live.routeId,live.order]));
}

export function buildDepartureReminder(plan, now, routeNumber = '') {
  const departure = plan?.risk?.departure;
  if (!departure || !Number.isFinite(departure.leaveAt?.getTime())) return null;
  const remaining = (departure.leaveAt - now) / 60000;
  const estimated = Boolean(plan.risk.targetResult.estimated);
  const level = remaining <= 3 ? 'RED' : remaining <= 5 ? 'ORANGE' : remaining <= 10 ? 'YELLOW' : 'GREEN';
  const basis = estimated ? '배차간격 예상 (실시간 아님)' : '실시간 도착정보 기준';
  const time = formatClock(departure.leaveAt);
  const title = remaining <= 0 ? '지금 집에서 출발하세요' : `집에서 출발까지 ${Math.ceil(remaining)}분`;
  const body = `${basis} · ${time}까지 집에서 출발하세요. 첫 정류장·역까지 이동 ${departure.accessMin}분을 반영했습니다. ${routeNumber ? `${routeNumber} 노선 · ` : ''}${estimated ? '예상 출발시간이며 운행 상황에 따라 바뀔 수 있습니다. 실시간 정보를 확인해 주세요.' : '실시간 정보가 바뀌면 출발시간도 갱신합니다.'}`;
  return {riskLevel:level,title:`${estimated ? '예상 · ' : ''}${title}`,body,spokenText:body,
    alertPhraseKo:body,departureAt:departure.leaveAt.toISOString(),departureEstimated:estimated,
    departureRemainingMin:remaining};
}

export function validHeadway(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 2 && n <= 180 ? n : null;
}

// Planning estimates may drive labeled reminders, never confirmed-vehicle claims.
export function buildBoardingPlan({ now, requiredArrivalTime, route, arrivalsMin = [], snapshot,
  officialHeadwayMin, observedHeadwayMin, allowObservedHeadway = false, headwayInfo = null }) {
  const base = evaluateLateRisk({now, requiredArrivalTime, route, busArrivalsMin:arrivalsMin});
  const duration = base.onboardToDestinationMin;
  const latestBoardAt = duration ? addMinutes(combineDateAndTime(now, requiredArrivalTime),
    -duration - base.etaRiskBufferMin) : null;
  const latestMin = latestBoardAt ? (latestBoardAt - now) / 60000 : null;
  const age = (now - Date.parse(snapshot?.fetchedAt || '')) / 60000;
  const recent = Number.isFinite(age) && age >= 0 && (validHeadway(officialHeadwayMin)
    ? koreanServiceDate(snapshot?.fetchedAt) === koreanServiceDate(now) : age <= 30);
  const raw = recent && Array.isArray(snapshot?.arrivalsMin) ? snapshot.arrivalsMin
    .filter(v => v !== null && v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0)
    .map(Number).sort((a,b) => a-b) : [];
  const observedGap = raw.length >= 2 ? validHeadway(raw[1] - raw[0]) : recent ? validHeadway(observedHeadwayMin) : null;
  const interval = validHeadway(officialHeadwayMin) || (allowObservedHeadway ? observedGap : null);
  const intervalSource = validHeadway(officialHeadwayMin) ? '공식 배차간격'
    : allowObservedHeadway && observedGap ? '최근 두 차량의 도착 간격' : '';
  const real = [...new Set(arrivalsMin.filter(v => typeof v === 'number' && Number.isFinite(v) && v >= 0))].sort((a,b)=>a-b);
  const planned = real.map(minutes => ({minutes, estimated:false}));
  const anchor = real.length ? real.at(-1) : raw.length ? raw.at(-1) - age : null;
  // Bound extrapolation to today's target; never roll into tomorrow.
  if (duration && interval && anchor !== null && latestMin >= 0 && latestMin <= 1440) {
    if (!real.length) raw.map(value=>value-age).filter(value=>value>=0)
      .forEach(minutes=>planned.push({minutes,estimated:true}));
    let next = anchor + interval;
    if (next < 0) next += Math.ceil(-next / interval) * interval;
    for (let count=0; next <= latestMin + interval && count<722; count++, next+=interval) {
      if (next >= 0 && !planned.some(row => Math.abs(row.minutes-next)<0.01)) planned.push({minutes:next,estimated:true});
    }
  }
  planned.sort((a,b)=>a.minutes-b.minutes);
  const evaluated = evaluateLateRisk({now, requiredArrivalTime, route, busArrivalsMin:planned.map(row=>row.minutes)});
  const rows = evaluated.results.filter(row=>Number.isFinite(row.arrivalMinutes))
    .map((row,index)=>({...row,estimated:planned[index].estimated}));
  const reachable = rows.filter(row=>row.level !== 'UNKNOWN' && row.catchable);
  const target = reachable.filter(row=>row.deltaMinutes>=0).at(-1) || reachable[0] || null;
  const following = target ? rows[target.index+1] : null;
  const confirmed = Boolean(target && !target.estimated && following && !following.estimated &&
    target.deltaMinutes>=0 && following.deltaMinutes<0);
  const estimatedLast = Boolean(target && target.deltaMinutes>=0 && following?.deltaMinutes<0 && !confirmed);
  const departure = target ? buildDepartureGuidance(target.arrivalMinutes,route.boardingAccessMin,now) : null;
  const message = target ? target.estimated
    ? '배차간격 기준 예상 도착시간입니다(실시간 아님). 운행 종료·결행은 반영되지 않을 수 있으며 실시간 정보가 확인되면 갱신합니다.'
    : evaluated.message
    : duration ? '지금 조회된 차는 이동시간상 탑승이 어렵거나 도착정보가 없습니다. 이후 교통편을 확인하고 있습니다.' : evaluated.message;
  return { rows, interval, intervalSource, headwayInfo, latestBoardAt, estimatedLast,
    anchorCheckedAt:recent ? snapshot.fetchedAt : null,
    hasEstimates:rows.some(row=>row.estimated),
    risk:{...evaluated,results:rows,targetResult:target || {...base.results[0],level:'UNKNOWN',arrivalMinutes:null},
      followingResult:following,lastChanceConfirmed:confirmed,departure,message} };
}
