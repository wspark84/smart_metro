// Stateful API reads also advance the alarm runtime. Serialize them with saves,
// including across tabs where Web Locks is available. Read-only transit and auth
// remain independent so a slow save cannot block search or sign-in.
const READ_ONLY = new Set([
  '/api/healthz', '/api/mobile/health', '/api/holidays/config', '/api/commute/config',
  '/api/bus/config', '/api/bus/cities', '/api/bus/stations', '/api/bus/nearby-stations',
  '/api/bus/station-routes', '/api/places/config', '/api/places/search',
]);

export function createWorkspaceFetch(fetchImpl, { origin, locks } = {}) {
  let tail = Promise.resolve();
  let generation = 0;
  return function workspaceFetch(input, init) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, origin);
    const method = String(init?.method || input?.method || 'GET').toUpperCase();
    if (url.origin !== origin || !url.pathname.startsWith('/api/')) return fetchImpl(input, init);
    if (url.pathname === '/api/auth/logout') generation++;
    if (url.pathname.startsWith('/api/auth/') || url.pathname === '/api/account/profile' ||
        (method === 'GET' && READ_ONLY.has(url.pathname))) return fetchImpl(input, init);
    const queuedGeneration = generation;
    const signal = init?.signal || input?.signal;
    const run = () => {
      if (generation !== queuedGeneration || signal?.aborted) {
        throw new DOMException('Request cancelled before sending', 'AbortError');
      }
      return fetchImpl(input, init);
    };
    const result = tail.then(() => locks?.request
      ? locks.request('smart-metro-workspace', {mode:'exclusive', ...(signal ? {signal} : {})}, run)
      : run());
    tail = result.catch(() => {});
    return result;
  };
}
