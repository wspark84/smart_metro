import { DEFAULT_STATE, sanitizeState } from "./state.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeEntity(base, patch) {
  return {
    ...base,
    ...(patch && typeof patch === "object" ? patch : {}),
  };
}

export function projectDomainSnapshot(state) {
  const safe = sanitizeState(state || clone(DEFAULT_STATE));

  return {
    user: {
      id: "demo-user",
      name: safe.user.name,
      requiredArrivalTime: safe.user.requiredArrivalTime,
      homeAddress: safe.user.homeAddress,
      workAddress: safe.user.workAddress,
      homeLocation: safe.user.homeLocation,
      workLocation: safe.user.workLocation,
    },
    route: {
      id: "primary-route",
      selectedStopId: safe.commute.selectedStopId,
      stopLocation: safe.commute.stopLocation,
      transitJourney: safe.commute.transitJourney || null,
      selectedLineIds: safe.commute.selectedLineIds,
      primaryLineId: safe.commute.primaryLineId,
      busRideMin: safe.commute.busRideMin,
      homeToStopWalkMin: safe.commute.homeToStopWalkMin,
      boardingAccessMin: safe.commute.boardingAccessMin,
      alightToWorkWalkMin: safe.commute.alightToWorkWalkMin,
      liveBinding: {
        provider: safe.live.provider,
        stationId: safe.live.stationId,
        stationName: safe.live.stationName,
        arsId: safe.live.arsId,
        routeId: safe.live.routeId,
        order: safe.live.order,
        cityCode: safe.live.cityCode,
        nodeId: safe.live.nodeId,
        routeNumber: safe.live.routeNumber,
      },
    },
    schedule: {
      id: "primary-schedule",
      startTime: safe.schedule.startTime,
      endTime: safe.schedule.endTime,
      repeatIntervalMin: safe.schedule.repeatIntervalMin,
      repeatPreset: safe.schedule.repeatPreset,
      daysOfWeek: safe.schedule.daysOfWeek,
      skipHolidays: safe.schedule.skipHolidays,
      snoozeDate: safe.schedule.snoozeDate,
      holidayDates: safe.holidayDates,
      officialHolidays: safe.officialHolidays,
      holidaySync: safe.holidaySync,
    },
    notificationSettings: {
      id: "primary-notification-settings",
      soundPresetId: safe.notification.soundPresetId,
      vibrationStrength: safe.notification.vibrationStrength,
      escalationEnabled: safe.notification.escalationEnabled,
      ttsVoiceId: safe.notification.ttsVoiceId,
      ttsSpeed: safe.notification.ttsSpeed,
      dndBypass: safe.notification.dndBypass,
    },
    meta: {
      updatedAt: new Date().toISOString(),
    },
  };
}

export function applyDomainSnapshotToState(snapshot, baseState = clone(DEFAULT_STATE)) {
  const next = clone(baseState || DEFAULT_STATE);
  const domain = snapshot || {};

  next.user = mergeEntity(next.user, {
    name: domain.user?.name,
    requiredArrivalTime: domain.user?.requiredArrivalTime,
    homeAddress: domain.user?.homeAddress,
    workAddress: domain.user?.workAddress,
    homeLocation: domain.user?.homeLocation,
    workLocation: domain.user?.workLocation,
  });
  next.commute = mergeEntity(next.commute, {
    selectedStopId: domain.route?.selectedStopId,
    stopLocation: domain.route?.stopLocation,
    transitJourney: domain.route?.transitJourney || null,
    selectedLineIds: domain.route?.selectedLineIds,
    primaryLineId: domain.route?.primaryLineId,
    busRideMin: domain.route?.busRideMin,
    homeToStopWalkMin: domain.route?.homeToStopWalkMin,
    boardingAccessMin: domain.route?.boardingAccessMin ?? null,
    alightToWorkWalkMin: domain.route?.alightToWorkWalkMin,
  });
  next.schedule = mergeEntity(next.schedule, {
    startTime: domain.schedule?.startTime,
    endTime: domain.schedule?.endTime,
    repeatIntervalMin: domain.schedule?.repeatIntervalMin,
    repeatPreset: domain.schedule?.repeatPreset,
    daysOfWeek: domain.schedule?.daysOfWeek,
    skipHolidays: domain.schedule?.skipHolidays,
    snoozeDate: domain.schedule?.snoozeDate,
  });
  next.notification = mergeEntity(next.notification, {
    soundPresetId: domain.notificationSettings?.soundPresetId,
    vibrationStrength: domain.notificationSettings?.vibrationStrength,
    escalationEnabled: domain.notificationSettings?.escalationEnabled,
    ttsVoiceId: domain.notificationSettings?.ttsVoiceId,
    ttsSpeed: domain.notificationSettings?.ttsSpeed,
    dndBypass: domain.notificationSettings?.dndBypass,
  });
  const previousBinding = JSON.stringify(projectDomainSnapshot(baseState).route.liveBinding);
  next.live = mergeEntity(next.live, domain.route?.liveBinding);
  if (domain.route?.liveBinding && previousBinding !== JSON.stringify(domain.route.liveBinding)) {
    next.live.snapshot = null;
    next.live.lastSyncedAt = null;
    next.live.status = "idle";
  }
  next.holidayDates = Array.isArray(domain.schedule?.holidayDates) ? domain.schedule.holidayDates : next.holidayDates;
  next.officialHolidays = Array.isArray(domain.schedule?.officialHolidays)
    ? domain.schedule.officialHolidays
    : next.officialHolidays;
  next.holidaySync = mergeEntity(next.holidaySync, domain.schedule?.holidaySync);
  delete next.user.id;
  delete next.notification.id;

  return sanitizeState(next);
}

export function updateDomainEntity(snapshot, entityName, patch) {
  const base = snapshot ? clone(snapshot) : projectDomainSnapshot(DEFAULT_STATE);
  const safePatch = patch && typeof patch === "object" ? patch : {};

  if (entityName === "user") {
    base.user = mergeEntity(base.user, safePatch);
  } else if (entityName === "route") {
    const routePatch = { ...safePatch };
    const liveBindingPatch = routePatch.liveBinding && typeof routePatch.liveBinding === "object" ? routePatch.liveBinding : null;
    delete routePatch.liveBinding;
    base.route = mergeEntity(base.route, routePatch);
    if (liveBindingPatch) {
      base.route.liveBinding = mergeEntity(base.route.liveBinding || {}, liveBindingPatch);
    }
  } else if (entityName === "schedule") {
    base.schedule = mergeEntity(base.schedule, safePatch);
  } else if (entityName === "notificationSettings") {
    base.notificationSettings = mergeEntity(base.notificationSettings, safePatch);
  } else {
    throw new Error(`Unsupported domain entity: ${entityName}`);
  }

  base.meta = {
    ...(base.meta || {}),
    updatedAt: new Date().toISOString(),
  };

  return base;
}
