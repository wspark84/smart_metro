// Stateful API reads also advance the alarm runtime. Serialize them with saves,
// including across tabs where Web Locks is available. Read-only transit and auth
// remain independent so a slow save cannot block search or sign-in.
const READ_ONLY = new Set([
  '/api/healthz', '/api/mobile/health', '/api/holidays/config', '/api/commute/config',
  '/api/bus/config', '/api/bus/cities', '/api/bus/stations', '/api/bus/nearby-stations',
  '/api/bus/station-routes', '/api/places/config', '/api/places/search',
]);

export function createWorkspaceFetch(fetchImpl, { origin, locks, timeoutMs = 30000 } = {}) {
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
    const upstreamSignal = init?.signal || input?.signal;
    const controller = new AbortController();
    const signal = controller.signal;
    const forwardAbort = () => controller.abort(upstreamSignal.reason);
    if (upstreamSignal?.aborted) forwardAbort();
    else upstreamSignal?.addEventListener('abort', forwardAbort, {once:true});
    let timer;
    const deadline = new Promise((_, reject) => {
      const aborted = () => reject(signal.reason);
      if (signal.aborted) aborted();
      else signal.addEventListener('abort', aborted, {once:true});
      timer = setTimeout(() => controller.abort(new DOMException('서버 응답 시간이 초과되었습니다. 다시 시도해 주세요.', 'TimeoutError')), timeoutMs);
    });
    const run = () => {
      if (generation !== queuedGeneration || signal?.aborted) {
        throw new DOMException('Request cancelled before sending', 'AbortError');
      }
      return fetchImpl(input, {...init, signal});
    };
    const result = tail.then(() => locks?.request
      ? locks.request('smart-metro-workspace', {mode:'exclusive', ...(signal ? {signal} : {})}, run)
      : run());
    tail = result.catch(() => {});
    return Promise.race([result, deadline]).finally(() => {
      clearTimeout(timer);
      upstreamSignal?.removeEventListener('abort', forwardAbort);
    });
  };
}
