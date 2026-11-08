import { addMinutes, combineDateAndTime, evaluateLateRisk, buildDepartureGuidance, formatClock, determineLateRiskLevel, getRiskMeta } from './commute.js';
import { koreanServiceDate } from './bus-headway.js';
import { CLOCK_SKEW_MS } from './live-arrivals.js';

export const DEPARTURE_REMINDER_MINUTES = [20, 10, 5, 3];

export function departurePrediction(plan, now) {
  const row=plan?.risk?.targetResult;
  if (!plan?.risk?.departure || !row || row.level==='UNKNOWN' || row.deltaMinutes<0) return null;
  return {boardingAt:addMinutes(now,row.arrivalMinutes).toISOString(),
    leaveAt:plan.risk.departure.leaveAt.toISOString(),estimated:Boolean(row.estimated)};
}

export function detectEarlyDeparture(plan, previous, now, fetchedAt) {
  const row=plan?.risk?.targetResult;
  const prediction=departurePrediction(plan,now);
  const age=now-Date.parse(fetchedAt || '');
  if (!prediction || !previous || !Number.isFinite(Date.parse(previous.boardingAt)) || row.estimated || row.arrivalMinutes<=0 ||
      !(age>=-CLOCK_SKEW_MS && age<=90_000) || !(plan.risk.followingResult?.deltaMinutes<0) ||
      plan.risk.departure.remainingMin>3 ||
      koreanServiceDate(previous.boardingAt)!==koreanServiceDate(now)) return null;
  const advancedMin=(Date.parse(previous.boardingAt)-Date.parse(prediction.boardingAt))/60000;
  if (!(advancedMin>=1)) return null;
  return {...prediction,advancedMin,arrivalAtWork:row.arriveWorkAt.toISOString(),
    title:'긴급 · 도착시간이 앞당겨졌어요',
    body:`실시간 정보가 갱신되어 차량 도착이 ${Math.floor(advancedMin)}분 앞당겨졌습니다. 지금 바로 출발하세요. ${formatClock(new Date(prediction.boardingAt))} 탑승, ${formatClock(row.arriveWorkAt)} 목적지 도착 예상입니다. 이 차를 놓치면 다음 차는 지각 예상입니다.${!row.catchable ? ' 평소 이동시간으로는 탑승이 빠듯하며 탑승을 보장할 수 없습니다.' : ''} 주변을 살피며 안전하게 이동하세요.`};
}

export function departurePlanningEnabled(state) {
  const live = state?.live;
  if(state?.commute?.routingMode==='all-routes') return Boolean(live?.provider && live.provider!=='none' && live.stationName);
  return Boolean(live?.provider && live.provider !== 'none' && live.routeNumber &&
    state?.commute?.planningBindingKey === JSON.stringify([live.provider,live.stationId || live.nodeId,live.routeId,live.order]));
}

export function buildDepartureReminder(plan, now, routeNumber = '') {
  const departure = plan?.risk?.departure;
  if (!departure || !Number.isFinite(departure.leaveAt?.getTime())) return null;
  const remaining = (departure.leaveAt - now) / 60000;
  const estimated = Boolean(plan.risk.targetResult.estimated);
  const scheduled = Boolean(plan.risk.targetResult.intervalPlan);
  const learned = Boolean(plan.risk.targetResult.historyPlan);
  const level = remaining <= 3 ? 'RED' : remaining <= 5 ? 'ORANGE' : remaining <= 10 ? 'YELLOW' : 'GREEN';
  const basis = learned ? '지난 운행 기록(이노치 예상시간표)으로 예상한 시간 · 실시간 아님'
    : scheduled ? '시간표(배차간격)로 예상한 시간 · 실시간 아님'
    : estimated ? '앞 차 실시간 정보 + 배차간격으로 예상한 시간 · 실시간 아님' : '실시간 도착정보 기준';
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

// Within the route's first–last bus (Korea time). Unknown hours: assume running.
export function inServiceHours(headwayInfo, at) {
  const toMin = clock => /^\d{2}:\d{2}$/.test(clock || '') ? Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3)) : null;
  const first = toMin(headwayInfo?.firstTime), last = toMin(headwayInfo?.lastTime);
  if (first === null || last === null) return true;
  const kst = new Date(at.getTime() + 9 * 3600_000);
  let minute = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  const end = last <= first ? last + 1440 : last;
  if (minute < first && end > 1440) minute += 1440;
  return minute >= first && minute <= end;
}

// Planning estimates may drive labeled reminders, never confirmed-vehicle claims.
export function buildBoardingPlan({ now, requiredArrivalTime, route, arrivalsMin = [], snapshot,
  officialHeadwayMin, observedHeadwayMin, allowObservedHeadway = false, headwayInfo = null, history = [] }) {
  const base = evaluateLateRisk({now, requiredArrivalTime, route, busArrivalsMin:arrivalsMin});
  const duration = base.onboardToDestinationMin;
  const latestBoardAt = duration ? addMinutes(combineDateAndTime(now, requiredArrivalTime),
    -duration - base.etaRiskBufferMin) : null;
  const latestMin = latestBoardAt ? (latestBoardAt - now) / 60000 : null;
  const age = Math.max(0, (now - Date.parse(snapshot?.fetchedAt || '')) / 60000);
  const recent = Number.isFinite(age) && now - Date.parse(snapshot?.fetchedAt || '') >= -CLOCK_SKEW_MS && (validHeadway(officialHeadwayMin)
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
  // No live arrival and none seen earlier today (차고지·회차 대기, 지연,
  // 조회 실패): plan from the published interval. Being at the stop one full
  // interval before the last on-time boarding catches a bus whatever the
  // timing, so the alarm still goes off; live arrivals replace this as soon
  // as they come. Never after the route's last bus.
  // When even that point is already behind us (the interval is longer than
  // the time left), the interval cannot say when to leave: report that live
  // arrivals are awaited (e.g. a bus still waiting at the turnaround) rather
  // than a misleading "leave now".
  const scheduleMax = validHeadway(headwayInfo?.max) || validHeadway(officialHeadwayMin);
  let awaitingLive = false;
  // 이노치 예상시간표 first: when buses actually passed this stop on earlier
  // days of the same type. Be at the stop by the earliest time seen; judge
  // being on time by the latest. Falls back to the interval plan below.
  const learned = !real.length && !raw.length && duration && latestMin >= 0 && latestMin <= 1440
    ? (Array.isArray(history) ? history : []).filter(row => Number.isFinite(row?.earliestMin) && row.earliestMin >= 0) : [];
  for (const row of learned) planned.push({minutes:row.earliestMin, estimated:true, historyPlan:true,
    spreadMin:Math.max(0, row.latestMin - row.earliestMin), typicalMin:row.typicalMin});
  if (!learned.length && !real.length && !raw.length && duration && scheduleMax && latestMin >= 0 && latestMin <= 1440) {
    const access = Number.isFinite(route.boardingAccessMin) ? route.boardingAccessMin : 0;
    const atStop = latestMin - scheduleMax;
    if (atStop >= access && inServiceHours(headwayInfo, addMinutes(now, atStop)))
      planned.push({minutes:atStop, estimated:true, intervalPlan:true});
    else if (access <= latestMin && inServiceHours(headwayInfo, addMinutes(now, access)))
      awaitingLive = true;
  }
  planned.sort((a,b)=>a.minutes-b.minutes);
  const evaluated = evaluateLateRisk({now, requiredArrivalTime, route, busArrivalsMin:planned.map(row=>row.minutes)});
  const rows = evaluated.results.filter(row=>Number.isFinite(row.arrivalMinutes))
    .map((row,index)=>{
      const plan = planned[index];
      const out = {...row,estimated:plan.estimated,intervalPlan:Boolean(plan.intervalPlan),historyPlan:Boolean(plan.historyPlan)};
      if (!plan.historyPlan || !(row.arriveWorkAt instanceof Date)) return out;
      // On time only if even the latest-seen bus arrives in time.
      const arriveWorkAt = addMinutes(row.arriveWorkAt, plan.spreadMin);
      const deltaMinutes = Math.floor((combineDateAndTime(now, requiredArrivalTime) - arriveWorkAt) / 60000);
      const level = determineLateRiskLevel(deltaMinutes);
      return {...out,arriveWorkAt,deltaMinutes,level,risk:getRiskMeta(level),
        latestMinutes:row.arrivalMinutes + plan.spreadMin,typicalMinutes:plan.typicalMin};
    });
  const reachable = rows.filter(row=>row.level !== 'UNKNOWN' && row.catchable);
  const lastOnTime = rows.filter(row=>row.level!=='UNKNOWN' && row.deltaMinutes>=0 && row.arrivalMinutes>0).at(-1);
  const urgentBoarding = Boolean(lastOnTime && !lastOnTime.estimated && !lastOnTime.catchable &&
    rows[lastOnTime.index+1]?.deltaMinutes<0 && Number.isFinite(route.boardingAccessMin));
  const target = (urgentBoarding ? lastOnTime : null) || reachable.filter(row=>row.deltaMinutes>=0).at(-1) || reachable[0] || null;
  const following = target ? rows[target.index+1] : null;
  const confirmed = Boolean(target && !target.estimated && following && !following.estimated &&
    target.deltaMinutes>=0 && following.deltaMinutes<0);
  const estimatedLast = Boolean(target && target.deltaMinutes>=0 && following?.deltaMinutes<0 && !confirmed);
  const departure = target ? buildDepartureGuidance(target.arrivalMinutes,route.boardingAccessMin,now) : null;
  const message = target ? target.historyPlan
    ? '실시간 도착정보가 아직 없어 지난 운행 기록(이노치 예상시간표)으로 예상한 시간입니다(실시간 아님). 실시간 정보가 확인되면 바로 바꿔 드려요.'
    : target.intervalPlan
    ? '실시간 도착정보가 아직 없어 시간표(배차간격)로 예상한 시간입니다(실시간 아님). 실시간 정보가 확인되면 바로 바꿔 드려요.'
    : target.estimated
    ? '배차간격 기준 예상 도착시간입니다(실시간 아님). 운행 종료·결행은 반영되지 않을 수 있으며 실시간 정보가 확인되면 갱신합니다.'
    : evaluated.message
    : duration ? '지금 조회된 차는 이동시간상 탑승이 어렵거나 도착정보가 없습니다. 이후 교통편을 확인하고 있습니다.' : evaluated.message;
  return { rows, interval, intervalSource, headwayInfo, latestBoardAt, estimatedLast,urgentBoarding,awaitingLive,
    anchorCheckedAt:recent ? snapshot.fetchedAt : null,
    hasEstimates:rows.some(row=>row.estimated),
    risk:{...evaluated,results:rows,targetResult:target || {...base.results[0],level:'UNKNOWN',arrivalMinutes:null},
      followingResult:following,lastChanceConfirmed:confirmed,departure,message} };
}
