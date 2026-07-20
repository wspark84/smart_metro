export const LIVE_PROVIDER_FIELDS = [
  "stationId",
  "stationName",
  "arsId",
  "routeId",
  "order",
  "cityCode",
  "nodeId",
  "routeNumber",
];

export const MANAGED_LIVE_PROVIDERS = ["seoul", "gyeonggi", "tago"];

export function createEmptyLiveBinding() {
  return {
    stationId: "",
    stationName: "",
    arsId: "",
    routeId: "",
    order: "",
    cityCode: "",
    nodeId: "",
    routeNumber: "",
  };
}

export function createDefaultLiveBindings() {
  return {
    seoul: createEmptyLiveBinding(),
    gyeonggi: createEmptyLiveBinding(),
    tago: createEmptyLiveBinding(),
  };
}

function normalizeFieldValue(value) {
  return String(value || "").trim();
}

export function normalizeLiveBinding(binding) {
  const next = createEmptyLiveBinding();
  for (const key of LIVE_PROVIDER_FIELDS) {
    next[key] = normalizeFieldValue(binding?.[key]);
  }

  return next;
}

export function normalizeLiveBindings(bindings) {
  const defaults = createDefaultLiveBindings();
  for (const provider of MANAGED_LIVE_PROVIDERS) {
    defaults[provider] = normalizeLiveBinding(bindings?.[provider]);
  }

  return defaults;
}

function pickTopLevelBinding(liveState) {
  return normalizeLiveBinding(liveState || {});
}

function hasBindingValue(binding) {
  return LIVE_PROVIDER_FIELDS.some((key) => String(binding?.[key] || "").trim() !== "");
}

function mergeBindingValues(primary, fallback) {
  const normalizedPrimary = normalizeLiveBinding(primary);
  const normalizedFallback = normalizeLiveBinding(fallback);
  const merged = createEmptyLiveBinding();

  for (const key of LIVE_PROVIDER_FIELDS) {
    merged[key] = normalizedPrimary[key] || normalizedFallback[key] || "";
  }

  return merged;
}

export function applyBindingToLiveState(liveState, binding) {
  const normalizedBinding = normalizeLiveBinding(binding);
  for (const key of LIVE_PROVIDER_FIELDS) {
    liveState[key] = normalizedBinding[key];
  }

  return liveState;
}

export function ensureLiveBindingState(liveState) {
  const safeLiveState = liveState && typeof liveState === "object" ? liveState : {};
  safeLiveState.bindings = normalizeLiveBindings(safeLiveState.bindings);

  if (!MANAGED_LIVE_PROVIDERS.includes(safeLiveState.provider)) {
    return safeLiveState;
  }

  const currentTopLevel = pickTopLevelBinding(safeLiveState);
  const storedBinding = safeLiveState.bindings[safeLiveState.provider];
  const mergedBinding = hasBindingValue(currentTopLevel)
    ? mergeBindingValues(currentTopLevel, storedBinding)
    : storedBinding;

  safeLiveState.bindings[safeLiveState.provider] = mergedBinding;
  applyBindingToLiveState(safeLiveState, mergedBinding);
  return safeLiveState;
}

export function syncActiveLiveBinding(liveState) {
  ensureLiveBindingState(liveState);
  if (!MANAGED_LIVE_PROVIDERS.includes(liveState.provider)) {
    return liveState;
  }

  liveState.bindings[liveState.provider] = mergeBindingValues(pickTopLevelBinding(liveState), liveState.bindings[liveState.provider]);
  return liveState;
}

export function switchLiveProvider(liveState, nextProvider) {
  ensureLiveBindingState(liveState);
  if (MANAGED_LIVE_PROVIDERS.includes(liveState.provider)) {
    syncActiveLiveBinding(liveState);
  }

  liveState.provider = String(nextProvider || "").trim() || "none";
  if (!MANAGED_LIVE_PROVIDERS.includes(liveState.provider)) {
    applyBindingToLiveState(liveState, createEmptyLiveBinding());
    return liveState;
  }

  applyBindingToLiveState(liveState, liveState.bindings[liveState.provider]);
  return liveState;
}
