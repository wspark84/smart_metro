export const DEFAULT_UPSTREAM_TIMEOUT_MS = 8_000;

function createTimeoutError(timeoutMs) {
  const error = new Error(`Upstream request timed out after ${timeoutMs}ms.`);
  error.code = "UPSTREAM_TIMEOUT";
  return error;
}

/**
 * Applies one timeout policy to all provider calls so an unavailable upstream
 * cannot keep the alarm scheduler waiting forever.
 */
export async function fetchWithTimeout(
  input,
  init = {},
  { fetchImpl = fetch, timeoutMs = DEFAULT_UPSTREAM_TIMEOUT_MS } = {},
) {
  const safeTimeoutMs = Math.max(1, Number(timeoutMs) || DEFAULT_UPSTREAM_TIMEOUT_MS);
  const controller = new AbortController();
  const timeoutError = createTimeoutError(safeTimeoutMs);
  const deadline = Date.now()+safeTimeoutMs;
  let timer = null;

  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(timeoutError);
      reject(timeoutError);
    }, safeTimeoutMs);
  });

  try {
    const response = await Promise.race([
      Promise.resolve(fetchImpl(input, { ...init, signal: controller.signal })),
      timeout,
    ]);
    // fetch resolves at headers, not at the end of the body. Keep the original
    // deadline for consumers so a stalled JSON/XML body cannot run forever.
    return new Proxy(response,{
      get(target,property) {
        const value=Reflect.get(target,property,target);
        if(typeof value!=='function') return value;
        if(!['json','text','arrayBuffer','blob','formData'].includes(property)) return value.bind(target);
        return async(...args)=>{
          const remaining=deadline-Date.now();
          if(remaining<=0) {controller.abort(timeoutError);throw timeoutError;}
          let bodyTimer;
          try {
            return await Promise.race([Promise.resolve().then(()=>value.apply(target,args)),
              new Promise((_,reject)=>{bodyTimer=setTimeout(()=>{
                controller.abort(timeoutError);reject(timeoutError);
              },remaining);})]);
          } finally {clearTimeout(bodyTimer);}
        };
      },
    });
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
}
