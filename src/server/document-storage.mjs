import { AsyncLocalStorage } from "node:async_hooks";
import * as fs from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { buildUserDataRoot } from "./user-storage.mjs";
import { SUPABASE_DOCUMENT_KEYS } from "./supabase-gateway.mjs";

const storage = new AsyncLocalStorage();
const fail = () => Object.assign(new Error("인증된 사용자 저장소가 필요합니다."), { statusCode: 401 });

function scopedKey(path) {
  const context = storage.getStore();
  if (!context) {
    if (process.env.VERCEL || process.env.SUPABASE_URL) throw fail();
    return null; // Local unit tests and explicit offline tools only.
  }
  const key = basename(path, ".json");
  if (resolve(dirname(path)) !== context.root || !SUPABASE_DOCUMENT_KEYS.includes(key)) throw fail();
  return key;
}

async function load(key) {
  const context = storage.getStore();
  if (!context.loaded.has(key)) {
    context.loaded.set(key, context.gateway.readDocument(context.accessToken, key));
  }
  return context.loaded.get(key);
}

export async function runWithDocumentStorage(auth, gateway, operation) {
  const context = { root: resolve(buildUserDataRoot(auth.user.id)), accessToken: auth.accessToken, gateway, loaded: new Map(), writes: new Map() };
  return storage.run(context, async () => {
    const result = await operation();
    if (result.commit !== false && context.writes.size) {
      const documents = await Promise.all([...context.writes].map(async ([key, payload]) => ({
        document_key: key, payload, expected_revision: (await load(key))?.revision || 0,
      })));
      await gateway.saveDocuments(auth.accessToken, documents);
    }
    return result;
  });
}

export async function readFile(path, encoding) {
  const key = scopedKey(path);
  if (!key) return fs.readFile(path, encoding);
  const context = storage.getStore();
  if (context.writes.has(key)) return JSON.stringify(context.writes.get(key));
  const row = await load(key);
  if (!row) throw Object.assign(new Error("Document not found"), { code: "ENOENT" });
  return JSON.stringify(row.payload);
}

export async function writeFile(path, value, encoding) {
  const key = scopedKey(path);
  if (!key) return fs.writeFile(path, value, encoding);
  await load(key);
  storage.getStore().writes.set(key, JSON.parse(value));
}

export async function mkdir(path, options) {
  const context = storage.getStore();
  if (!context) {
    if (process.env.VERCEL || process.env.SUPABASE_URL) throw fail();
    return fs.mkdir(path, options);
  }
  if (resolve(path) !== context.root) throw fail();
}

// Hold API responses until the whole document batch has committed. A conflict
// or failed write must never be reported to the browser as a successful save.
export function bufferedResponse() {
  const headers = {};
  let status = 200;
  let body;
  return {
    setHeader(name, value) { headers[name.toLowerCase()] = value; },
    writeHead(code, values = {}) { status = code; for (const [name, value] of Object.entries(values)) headers[name.toLowerCase()] = value; },
    end(value) { body = value; },
    get commit() { return status < 400; },
    flush(response) { response.writeHead(status, headers); response.end(body); },
  };
}
