import {buildBoardingPlan} from './boarding-plan.js';
import {projectLiveArrivals} from './live-arrivals.js';
import {selectBusHeadway,koreanServiceDate} from './bus-headway.js';
import {buildDepartureGuidance} from './commute.js';
import {TRANSIT_ROUTE_MAX_AGE_MS} from './transit-journey.js';

export function buildJourneyOptionsPlan({options=[],now,requiredArrivalTime,boardingAccessMin,holidays=[],incomplete=false}) {
  const plans=options.map(option=>{
    const snapshot=option.snapshot;
    const age=now-Date.parse(option.fetchedAt || '');
    const dailyReference=option.dailyMetadataDate===koreanServiceDate(now) &&
      option.dailyMetadataDate===koreanServiceDate(option.fetchedAt);
    const durationValid=option.verified===true && age>=0 &&
      (age<=TRANSIT_ROUTE_MAX_AGE_MS || dailyReference);
    const headwayInfo=selectBusHeadway(snapshot?.headway,now,holidays);
    const live=snapshot?.liveStatus!=='unavailable' && snapshot?.cacheStatus!=='stale-fallback' ? projectLiveArrivals(snapshot,now) : [];
    const plan=buildBoardingPlan({now,requiredArrivalTime,
      route:{durationAvailable:durationValid,onboardToDestinationMin:option.onboardDurationSec/60,boardingAccessMin},
      arrivalsMin:live,snapshot:live.length ? snapshot : snapshot?.lastObservation || snapshot,
      officialHeadwayMin:headwayInfo?.minutes,headwayInfo,allowObservedHeadway:option.binding?.provider==='subway'});
    return {option,plan};
  });
  const rows=plans.flatMap(({option,plan})=>plan.rows.map(row=>({...row,optionId:option.id,
    routeNumber:option.binding.routeNumber,direction:option.direction || option.nextStation,
    onboardDurationSec:option.onboardDurationSec,transfers:option.transfers,binding:option.binding})))
    .sort((a,b)=>a.arrivalMinutes-b.arrivalMinutes).map((row,index)=>({...row,index}));
  const ontime=rows.filter(r=>r.level!=='UNKNOWN' && r.deltaMinutes>=0 && r.arrivalMinutes>0);
  const reachable=ontime.filter(r=>r.catchable);
  const urgent=!reachable.length ? ontime.filter(r=>!r.estimated).at(-1) : null;
  const target=reachable.at(-1) || urgent || rows.find(r=>r.catchable) || null;
  const base=plans.find(({option})=>option.id===target?.optionId)?.plan || plans[0]?.plan || buildBoardingPlan({now,requiredArrivalTime,
    route:{durationAvailable:false,boardingAccessMin},arrivalsMin:[]});
  const following=target ? rows.find(r=>r.arrivalMinutes>target.arrivalMinutes && r.deltaMinutes<0) : null;
  const complete=!incomplete && plans.length>0 && plans.every(({plan})=>plan.rows.some(row=>row.level!=='UNKNOWN'));
  return {...base,rows,urgentBoarding:Boolean(urgent && complete && following),estimatedLast:Boolean(complete && following && target?.deltaMinutes>=0),
    hasEstimates:rows.some(r=>r.estimated),optionsCount:options.length,coverageComplete:complete,
    risk:{...base.risk,results:rows,targetResult:target || {...base.risk.targetResult,level:'UNKNOWN',arrivalMinutes:null},
      followingResult:complete ? following : null,lastChanceConfirmed:false,
      departure:target ? buildDepartureGuidance(target.arrivalMinutes,boardingAccessMin,now) : null,
      message:target ? '확인된 경로들을 비교한 출발시각 예상입니다. 환승 대기와 운행 지연에 따라 달라질 수 있습니다.' : '목적지까지 연결되는 경로와 차량 도착정보를 확인하고 있습니다.'}};
}
