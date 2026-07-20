/**
 * Serializes work that touches the prototype's file-backed runtime state.
 *
 * The current storage layer is not transactional. Keeping this queue process-local
 * prevents one request from switching the active user context while another one is
 * reading or writing that user's alarm files.
 */
export function createAsyncMutex() {
  let tail = Promise.resolve();

  return async function runExclusive(task) {
    const previous = tail;
    let release = null;
    tail = new Promise((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await task();
    } finally {
      release();
    }
  };
}
