import { ALARM_START_CHOICES, ALARM_INTERVAL_CHOICES, normalizeTripSchedules, scheduleValidation } from './logic/trip-schedules.js';
import { searchAddressPlaces } from './services/places.js';
import { searchNearbyStations, searchLiveStations } from './services/live-bus.js';
import { mountKakaoBoardingMap } from './services/kakao-map.js';
import { stationSelectionKey } from './logic/station-search.js';
import { isValidLocation, dateOnlyKey } from './logic/commute.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const days = ['일','월','화','수','목','금','토'];
const clone = value => JSON.parse(JSON.stringify(value));
const actionIcon = name => `<span class="material-symbols-outlined" aria-hidden="true">${name}</span>`;

// This editor owns its draft. It never assigns or persists the home's user/commute/live fields.
export function createTripScheduleEditor({getState, saveTrips, render, mapKey, getRuntime=()=>({})}) {
  let draft = null, error = '', notice = '', saving = false, request = 0;
  let mode = 'bus', keyword = '', destinationKeyword = '', places = [], destinations = [], stations = [];
  let center = {lat:37.5665,lng:126.978}, selected = null, loading = false;
  function reset() {request++; draft=null;error='';notice='';saving=false;places=[];destinations=[];stations=[];selected=null;loading=false;}
  function open(trip) {
    reset(); keyword='';destinationKeyword='';mode=trip?.departure?.live?.provider==='subway'?'subway':'bus';
    draft = trip ? clone(trip) : {id:crypto.randomUUID(),name:'출근',enabled:true,requiredArrivalTime:'09:00',boardingAccessMin:5,
      departure:null,destination:null,daysOfWeek:[1,2,3,4,5],alarmStartLeadMin:30,repeatIntervalMin:5,skipHolidays:true,snoozeDate:null};
    center = draft.departure?.location || {lat:37.5665,lng:126.978}; render();
  }
  async function load(fn, apply) {
    const ticket=++request;loading=true;error='';render();
    try {const value=await fn();if(ticket!==request)return;apply(value);}
    catch(e){if(ticket!==request)return;error=e.message || '조회에 실패했습니다. 다시 시도해 주세요.';}
    if(ticket===request){loading=false;render();}
  }
  async function commit(trips, close=true) {
    if(saving)return;const ticket=++request;saving=true;error='';render();
    try {await saveTrips(normalizeTripSchedules(trips));if(ticket!==request)return;if(close)draft=null;notice='일정을 계정에 저장했습니다. 홈 정보는 변경하지 않았습니다.';}
    catch(e){if(ticket!==request)return;error=e.message || '저장을 확인하지 못했습니다. 입력값은 유지됩니다.';}
    if(ticket===request){saving=false;render();}
  }
  function html() {
    const trips=getState().tripSchedules || [];
    const button=(action,label,extra='')=>`<button class="soft-button" data-trip-action="${action}" ${saving?'disabled':''} ${extra}>${label}</button>`;
    if(!draft)return `<section class="headline-block"><h1>반복 이동 일정</h1><p>홈은 비정기 이동용입니다. 출근·등교는 여기에서 따로 등록하세요.</p></section>
      ${error?`<p role="alert">${esc(error)}</p>`:''}${notice?`<p role="status">${esc(notice)}</p>`:''}
      ${trips.length?trips.map(trip=>`<section class="stack-panel trip-card"><div class="trip-card-heading"><h2>${esc(trip.name)} · ${trip.enabled?'알람 켜짐':'알람 꺼짐'}</h2><button class="trip-delete-button" data-trip-action="delete" data-id="${esc(trip.id)}" aria-label="${esc(trip.name)} 일정 삭제" title="일정 삭제" ${saving?'disabled':''}>${actionIcon('delete')}</button></div>
        <p>${esc(trip.departure?.live?.stationName)} → ${esc(trip.destination?.address)}</p>
        <p>${esc(trip.requiredArrivalTime)} 도착 · ${trip.daysOfWeek.map(d=>days[d]).join('·')} · ${trip.skipHolidays?'공휴일 쉬기':'공휴일도 알림'}</p>
        <p>출발 ${trip.alarmStartLeadMin >= 60 ? `${trip.alarmStartLeadMin / 60}시간` : `${trip.alarmStartLeadMin}분`} 전부터 · ${trip.repeatIntervalMin}분마다 알림</p>
        <p role="status">${esc(getRuntime()?.tripContexts?.[trip.id]?.lastError || (getRuntime()?.tripContexts?.[trip.id]?.runtime?.nextTriggerAt ? `다음 알림: ${new Date(getRuntime().tripContexts[trip.id].runtime.nextTriggerAt).toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit'})}` : '해당 요일의 도착 목표 6시간 전부터 경로를 확인합니다.'))}</p>
        <div class="trip-card-actions">${button('edit',`${actionIcon('edit')}<span>수정</span>`,`data-id="${esc(trip.id)}"`)}${button('toggle',`${actionIcon(trip.enabled?'notifications_off':'notifications_active')}<span>${trip.enabled?'알람 끄기':'알람 켜기'}</span>`,`data-id="${esc(trip.id)}"`)}${button('departed',`${actionIcon('directions_walk')}<span>${trip.snoozeDate===dateOnlyKey(new Date())?'오늘 출발 완료':'오늘 출발했어요'}</span>`,`data-id="${esc(trip.id)}"`)}</div></section>`).join(''):'<section class="stack-panel"><p>아직 등록한 일정이 없습니다. 출근 일정을 새로 입력해 주세요.</p></section>'}
      ${trips.length<10?button('new','+ 출근·반복 일정 추가'):''}`;
    return `<section class="headline-block"><h1>반복 일정 입력</h1><p>홈의 출발지·도착지는 그대로 유지됩니다. 버스·지하철·환승 경로를 자동 비교합니다.</p></section>
      <section class="stack-panel"><label class="field-block"><span>일정 이름</span><input data-trip-input="name" value="${esc(draft.name)}" maxlength="60" /></label>
      <h3>출발 정류장·역 선택</h3><div class="choice-grid">${button('bus','버스')}${button('subway','지하철')}</div>
      <div class="holiday-form"><input class="text-field-input" data-trip-input="keyword" value="${esc(keyword)}" placeholder="${mode==='bus'?'주소·건물명으로 지도 위치 찾기':'지하철역 이름'}" />${button('search-origin',loading?'조회 중…':'검색',loading?'disabled':'')}</div>
      ${places.map((p,i)=>button('place',esc(p.placeName || p.label),`data-index="${i}"`)).join('')}
      <div class="boarding-map-shell has-search-center"><div id="trip-schedule-map" class="boarding-map">지도를 불러오는 중…</div></div>
      ${mode==='bus'?button('nearby',loading?'조회 중…':'이 위치 주변 정류장 찾기',loading?'disabled':''):''}
      <p class="field-help">지도에서 정류장·역 핀을 눌러 도로 방향과 위치를 확인해 주세요.</p>
      ${selected?`<p>${esc(selected.stationName)} · ${esc(selected.arsId || selected.stationId)}</p>${button('confirm-origin','이 정류장·역을 출발지로 선택')}`:''}
      <p><strong>선택한 출발지:</strong> ${esc(draft.departure?.live?.stationName || '아직 선택하지 않았습니다')}</p>
      <h3>도착지</h3><div class="holiday-form"><input class="text-field-input" data-trip-input="destinationKeyword" value="${esc(destinationKeyword)}" placeholder="도착지 주소·건물명" />${button('search-destination','검색',loading?'disabled':'')}</div>
      ${destinations.map((p,i)=>button('destination',esc(p.placeName || p.label),`data-index="${i}"`)).join('')}
      <p><strong>선택한 도착지:</strong> ${esc(draft.destination?.address || '아직 선택하지 않았습니다')}</p>
      <div class="field-grid"><label class="field-block"><span>도착 목표시간</span><input type="time" data-trip-input="requiredArrivalTime" value="${esc(draft.requiredArrivalTime)}" /></label>
      <label class="field-block"><span>정류장까지 (분)</span><input type="number" min="0" max="180" data-trip-input="boardingAccessMin" value="${esc(draft.boardingAccessMin)}" /></label></div>
      <h3 class="trip-option-title">반복 요일</h3><div class="trip-weekdays">${days.map((d,i)=>`<button class="weekday-chip ${draft.daysOfWeek.includes(i)?'selected':''}" aria-pressed="${draft.daysOfWeek.includes(i)}" data-trip-action="day" data-value="${i}">${d}</button>`).join('')}</div>
      <h3 class="trip-option-title">알람 시작</h3><div class="trip-option-grid" role="group" aria-label="출발 전 알람 시작">${ALARM_START_CHOICES.map(m=>`<button class="choice-chip ${Number(draft.alarmStartLeadMin)===m?'selected':''}" aria-label="출발 ${m >= 60 ? `${m/60}시간` : `${m}분`} 전부터" aria-pressed="${Number(draft.alarmStartLeadMin)===m}" data-trip-action="alarm-start" data-value="${m}">${m >= 60 ? `${m/60}시간` : `${m}분`} 전</button>`).join('')}</div>
      <h3 class="trip-option-title">알람 반복 간격</h3><div class="trip-option-grid" role="group" aria-label="알람 반복 간격">${ALARM_INTERVAL_CHOICES.map(m=>`<button class="choice-chip ${Number(draft.repeatIntervalMin)===m?'selected':''}" aria-pressed="${Number(draft.repeatIntervalMin)===m}" data-trip-action="alarm-interval" data-value="${m}">${m}분마다</button>`).join('')}</div>
      <div class="trip-check-options">
      <label class="trip-check-row"><input type="checkbox" data-trip-input="skipHolidays" ${draft.skipHolidays?'checked':''} /><span>공휴일에는 알람 쉬기</span></label>
      <label class="trip-check-row"><input type="checkbox" data-trip-input="enabled" ${draft.enabled?'checked':''} /><span>이 일정 알람 켜기</span></label>
      </div>
      ${error?`<p role="alert">${esc(error)}</p>`:''}
      <div class="trip-card-actions">${button('save',saving?'저장 중…':'일정 저장')}${button('cancel','취소')}</div></section>`;
  }
  function mount() {
    if(!draft)return;
    const element=document.querySelector('#trip-schedule-map');
    void mountKakaoBoardingMap(element,{appKey:mapKey(),candidates:stations,selectedId:stationSelectionKey(selected),center,
      onCenterChanged:value=>{center=value;},onSelect:id=>{selected=stations.find(s=>stationSelectionKey(s)===id);render();}});
  }
  function input(target) {
    const key=target.dataset.tripInput;if(!key)return false;if(!draft || saving)return true;
    if(key==='keyword')keyword=target.value;else if(key==='destinationKeyword')destinationKeyword=target.value;
    else if(['name','requiredArrivalTime','boardingAccessMin','skipHolidays','enabled'].includes(key))draft[key]=target.type==='checkbox'?target.checked:target.value;
    return true;
  }
  function click(target) {
    const action=target.dataset.tripAction;if(!action)return false;if(saving)return true;
    const trips=getState().tripSchedules || [], trip=trips.find(t=>t.id===target.dataset.id);
    if(action==='new')open();
    else if(action==='edit' && trip)open(trip);
    else if(action==='cancel'){reset();render();}
    else if(action==='delete' && trip){if(window.confirm(`‘${trip.name}’ 일정을 삭제할까요? 홈 정보는 유지됩니다.`))void commit(trips.filter(t=>t.id!==trip.id));}
    else if(action==='toggle' && trip)void commit(trips.map(t=>t.id===trip.id?{...t,enabled:!t.enabled}:t));
    else if(action==='departed' && trip)void commit(trips.map(t=>t.id===trip.id?{...t,snoozeDate:dateOnlyKey(new Date())}:t));
    else if(draft){
      if(action==='save'){error=scheduleValidation(draft);if(error)render();else void commit([...trips.filter(t=>t.id!==draft.id),draft]);}
      else if(action==='day'){const v=Number(target.dataset.value);draft.daysOfWeek=draft.daysOfWeek.includes(v)?draft.daysOfWeek.filter(x=>x!==v):[...draft.daysOfWeek,v];render();}
      else if(action==='alarm-start' || action==='alarm-interval'){const key=action==='alarm-start'?'alarmStartLeadMin':'repeatIntervalMin';draft[key]=Number(target.dataset.value);render();}
      else if(action==='bus' || action==='subway'){request++;loading=false;mode=action;places=[];stations=[];selected=null;render();}
      else if(action==='search-origin' && keyword.trim())void load(()=>mode==='bus'?searchAddressPlaces(keyword):searchLiveStations({provider:'subway',keyword}),p=>{if(mode==='bus')places=(p.results || []).filter(isValidLocation);else stations=(p.stations || []).map(s=>({...s,provider:'subway'}));});
      else if(action==='place'){const p=places[Number(target.dataset.index)];if(p){center={lat:p.lat,lng:p.lng};places=[];stations=[];selected=null;render();}}
      else if(action==='nearby'){
        if(document.querySelector('#trip-schedule-map')?.dataset.mapStatus!=='ready'){error='지도가 표시된 뒤 주변 정류장을 조회해 주세요.';render();}
        else void load(()=>searchNearbyStations(center),p=>{stations=(p.stations || []).map(s=>({...s,provider:s.provider || p.provider || 'tago'}));selected=null;});
      }
      else if(action==='confirm-origin' && selected){
        const location={lat:Number(selected.posY ?? selected.lat),lng:Number(selected.posX ?? selected.lng)};
        if(isValidLocation(location) && document.querySelector('#trip-schedule-map')?.dataset.mapStatus==='ready'){
          draft.departure={location,live:{provider:selected.provider || mode,stationId:selected.stationId,stationName:selected.stationName,arsId:selected.arsId || '',cityCode:selected.cityCode || '',nodeId:selected.nodeId || selected.stationId}};selected=null;render();
        }
      }
      else if(action==='search-destination' && destinationKeyword.trim())void load(()=>searchAddressPlaces(destinationKeyword),p=>{destinations=(p.results || []).filter(isValidLocation);});
      else if(action==='destination'){const p=destinations[Number(target.dataset.index)];if(p){draft.destination={address:p.roadAddress || p.jibunAddress || p.label || p.placeName,location:{lat:p.lat,lng:p.lng}};destinations=[];render();}}
    }
    return true;
  }
  return {html,mount,input,click,reset};
}
