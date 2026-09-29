import { isValidLocation } from './commute.js';

export const REMINDER_CHOICES = [20, 10, 5, 3];
export function reminderMinutes(values) {
  return REMINDER_CHOICES.filter(value => (Array.isArray(values) ? values : REMINDER_CHOICES).includes(value));
}
export function normalizeTripSchedules(values) {
  const ids = new Set();
  return (Array.isArray(values) ? values : []).filter(value => {
    if (!value || !/^[a-zA-Z0-9_-]{1,80}$/.test(value.id) || ['__proto__','constructor','prototype'].includes(value.id) || ids.has(value.id)) return false;
    ids.add(value.id); return true;
  }).slice(0, 10).map(value => ({
    id: value.id, name: String(value.name || '출근').slice(0, 60), enabled: value.enabled === true,
    requiredArrivalTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(value.requiredArrivalTime) ? value.requiredArrivalTime : '09:00',
    boardingAccessMin: Math.min(180, Math.max(0, Number(value.boardingAccessMin) || 0)),
    departure: value.departure && isValidLocation(value.departure.location) ? {
      location: {lat:Number(value.departure.location.lat),lng:Number(value.departure.location.lng)},
      live: Object.fromEntries(['provider','stationId','stationName','arsId','cityCode','nodeId'].map(key => [key,String(value.departure.live?.[key] || '').slice(0,150)])),
    } : null,
    destination: value.destination && isValidLocation(value.destination.location) ? {
      address:String(value.destination.address || '').slice(0,300),
      location:{lat:Number(value.destination.location.lat),lng:Number(value.destination.location.lng)},
    } : null,
    daysOfWeek: [...new Set((Array.isArray(value.daysOfWeek) ? value.daysOfWeek : [1,2,3,4,5]).filter(day => Number.isInteger(day) && day >= 0 && day <= 6))],
    reminderMinutes: reminderMinutes(value.reminderMinutes), skipHolidays:value.skipHolidays !== false,
    snoozeDate: /^\d{4}-\d{2}-\d{2}$/.test(value.snoozeDate || '') ? value.snoozeDate : null,
  }));
}
export function scheduleValidation(trip) {
  if (!trip?.name?.trim()) return '일정 이름을 입력해 주세요.';
  if (!trip.departure?.live?.stationName || !isValidLocation(trip.departure?.location)) return '지도에서 출발 정류장 또는 역을 선택해 주세요.';
  if (!isValidLocation(trip.destination?.location)) return '검색 결과에서 도착지를 선택해 주세요.';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(trip.requiredArrivalTime)) return '도착 목표시간을 입력해 주세요.';
  if (!Number.isFinite(Number(trip.boardingAccessMin)) || Number(trip.boardingAccessMin)<0 || Number(trip.boardingAccessMin)>180) return '정류장까지 걸리는 시간을 0~180분으로 입력해 주세요.';
  if (!trip.daysOfWeek?.length) return '반복할 요일을 하나 이상 선택해 주세요.';
  if (!reminderMinutes(trip.reminderMinutes).length) return '사전 알림을 하나 이상 선택해 주세요.';
  return '';
}
export function tripScheduleState(base, trip) {
  return {...base, tripId:trip.id, tripName:trip.name,
    user:{...base.user,requiredArrivalTime:trip.requiredArrivalTime,workAddress:trip.destination?.address || '',workLocation:trip.destination?.location || null},
    commute:{...base.commute,routingMode:'all-routes',selectedStopId:trip.departure?.live?.stationId || trip.departure?.live?.nodeId || '',stopLocation:trip.departure?.location || null,
      boardingAccessMin:trip.boardingAccessMin,homeToStopWalkMin:trip.boardingAccessMin,transitJourney:null,automaticOptions:null,planningHeadwayMin:null,planningOfficialHeadwayMin:null,planningBindingKey:''},
    live:{...base.live,...trip.departure?.live,routeId:'',routeNumber:'',order:'',snapshot:null,lastSyncedAt:null},
    schedule:{...base.schedule,enabled:trip.enabled && !scheduleValidation(trip),oneTimeDate:null,repeatPreset:'CUSTOM',daysOfWeek:trip.daysOfWeek,skipHolidays:trip.skipHolidays,snoozeDate:trip.snoozeDate,reminderMinutes:trip.reminderMinutes},
  };
}
