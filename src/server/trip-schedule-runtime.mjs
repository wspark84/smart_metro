import { normalizeTripSchedules, tripScheduleState } from '../logic/trip-schedules.js';
import { reconcileAlarmRuntime } from './alarm-runtime.mjs';
import { reconcileAlarmDelivery } from './alarm-delivery.mjs';
import { isAlarmRefreshWindow } from './alarm-arrival-refresh.mjs';

// Per-trip observations and handled reminders are isolated from the home trip.
export async function reconcileTripSchedules(base, previous = {}, now = new Date(), {refresh, accuracyRuntime} = {}) {
  const trips=normalizeTripSchedules(base.tripSchedules);
  const entries=trips.map(trip=>({trip,state:tripScheduleState(base,trip),old:previous[trip.id] || {}}));
  // Bound upstream work per tick. Cached plans for every trip are still reconciled each tick.
  const due=entries.filter(e=>isAlarmRefreshWindow(e.state,now) &&
    (!Number.isFinite(Date.parse(e.old.runtime?.automaticOptions?.nextRefreshAt || '')) || Date.parse(e.old.runtime.automaticOptions.nextRefreshAt)<=now.getTime()))
    .sort((a,b)=>Date.parse(a.old.lastRefreshAttempt || '1970-01-01')-Date.parse(b.old.lastRefreshAttempt || '1970-01-01'))[0];
  const contexts={},results=[];
  for(const entry of entries){
    const {trip,state,old}=entry;
    let runtime=old.runtime || {},lastError='',lastRefreshAttempt=old.lastRefreshAttempt;
    if(entry===due && refresh){
      lastRefreshAttempt=now.toISOString();
      try {runtime={...runtime,automaticOptions:await refresh(state,runtime.automaticOptions,now)};}
      catch(e){lastError=e.message || '일정 경로를 조회하지 못했습니다.';}
    }
    state.commute.automaticOptions=runtime.automaticOptions || null;
    const result=reconcileAlarmRuntime(state,runtime,now,{accuracyRuntime});
    result.dueEvents=result.dueEvents.map(event=>({...event,tripId:trip.id,tripName:trip.name,
      title:`${trip.name} · ${event.title}`,notificationSpec:{...event.notificationSpec,title:`${trip.name} · ${event.notificationSpec?.title || event.title}`}}));
    const delivery=reconcileAlarmDelivery(old.delivery,result,now);
    contexts[trip.id]={runtime:result.runtime,delivery,lastRefreshAttempt,lastError:lastError || (entry===due?'':old.lastError || '')};
    results.push({trip,state,result,delivery});
  }
  return {contexts,results};
}
