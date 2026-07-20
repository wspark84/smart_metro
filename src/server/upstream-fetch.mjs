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
  let timer = null;

  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(timeoutError);
      reject(timeoutError);
    }, safeTimeoutMs);
  });

  try {
    return await Promise.race([
      Promise.resolve(fetchImpl(input, { ...init, signal: controller.signal })),
      timeout,
    ]);
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
}
