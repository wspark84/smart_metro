// Shared bus passage records (DB: smart_metro_private.bus_passages), written and
// read through two RPCs as the signed-in person or the running alarm job.
// Best effort: a failure here never stops arrivals or alarms.
import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "./supabase-gateway.mjs";
import { currentStorageCaller } from "./document-storage.mjs";

const HISTORY_TTL_MS = 10 * 60_000;
const history = new Map(); // binding key -> {at, days}

export const passageBinding = (binding) => ({
  provider: String(binding?.provider || ""), cityCode: String(binding?.cityCode || ""),
  stationId: String(binding?.stationId || binding?.nodeId || ""), routeId: String(binding?.routeId || ""),
});
const bindingKey = (binding) => JSON.stringify(Object.values(passageBinding(binding)));

function rpcClient(env, fetchImpl) {
  let config;
  try { config = getSupabaseConfig(env); } catch { return null; }
  const caller = currentStorageCaller();
  if (!config.configured || !caller) return null;
  const client = createClient(config.url, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (url, options = {}) => fetchImpl(url, { ...options, signal: AbortSignal.timeout(5000) }),
      ...(caller.accessToken ? { headers: { Authorization: `Bearer ${caller.accessToken}` } } : {}) },
  });
  const job = caller.jobId ? { p_job_id: caller.jobId, p_token: caller.token } : {};
  return (name, args) => client.rpc(name, { ...args, ...job });
}

/** Saves one passage. Returns true when the server accepted the call. */
export async function recordBusPassage(binding, passedAt, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const rpc = rpcClient(env, fetchImpl);
  if (!rpc) return false;
  try {
    const { error } = await rpc("record_smart_metro_bus_passages", { p_passages: [{
      ...passageBinding(binding), routeNumber: String(binding?.routeNumber || "").slice(0, 40),
      passedAt: new Date(passedAt).toISOString() }] });
    if (error) console.error("[bus-passages]", JSON.stringify({ op: "record", code: String(error.code || "").slice(0, 20) }));
    else history.delete(bindingKey(binding));
    return !error;
  } catch { return false; }
}

/** Passage minutes per service date for the last 10 weeks, or null. */
export async function loadBusPassageDays(binding, { env = process.env, fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  const key = bindingKey(binding);
  const cached = history.get(key);
  if (cached && now - cached.at < HISTORY_TTL_MS) return cached.days;
  const rpc = rpcClient(env, fetchImpl);
  if (!rpc) return null;
  try {
    const { data, error } = await rpc("smart_metro_bus_passage_days", { p_bindings: [passageBinding(binding)] });
    if (error) {
      console.error("[bus-passages]", JSON.stringify({ op: "read", code: String(error.code || "").slice(0, 20) }));
      return null;
    }
    const days = Array.isArray(data) && data[0]?.days && typeof data[0].days === "object" ? data[0].days : {};
    history.set(key, { at: now, days });
    return days;
  } catch { return null; }
}
