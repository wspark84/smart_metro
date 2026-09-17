import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

test("HTTP server rejects legacy auth and persists isolated social-user workspaces through Supabase", { timeout: 30000 }, async () => {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const bootstrap = `
    const rows = new Map();
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(input);
      if(url.origin !== 'https://test.supabase.co') throw Error('Unexpected external call');
      const token = new Headers(options.headers).get('Authorization')?.replace('Bearer ', '');
      const result = (data, status=200) => new Response(JSON.stringify(data), {status, headers:{'Content-Type':'application/json','X-Supabase-Api-Version':'2024-01-01'}});
      if(!['user-a','user-b'].includes(token)) return result({code:'bad_jwt'},401);
      if(url.pathname === '/auth/v1/user') return result({id:token, user_metadata:{name:token}, identities:[{provider:'google'}]});
      if(url.pathname === '/rest/v1/smart_metro_documents') {
        const key = url.searchParams.get('document_key').slice(3);
        const row = rows.get(token+':'+key);
        return result(row ? [row] : []);
      }
      if(url.pathname === '/rest/v1/rpc/save_smart_metro_documents') {
        const documents = JSON.parse(options.body).p_documents;
        for(const doc of documents) {
          if(doc.payload.forceConflict || (rows.get(token+':'+doc.document_key)?.revision || 0) !== doc.expected_revision) return result({code:'40001'},409);
        }
        for(const doc of documents) rows.set(token+':'+doc.document_key, {document_key:doc.document_key,payload:doc.payload,revision:doc.expected_revision+1});
        return result(documents);
      }
      throw Error('Unexpected endpoint '+url.pathname);
    };
    await import(${JSON.stringify(new URL("../server.mjs", import.meta.url).href)});
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", bootstrap], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...process.env, PORT: String(port), APP_BASE_URL: `http://localhost:${port}`, VERCEL: "", SUPABASE_URL: "https://test.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test", SUPABASE_AUTH_PROVIDERS: "google,kakao,naver", PUSH_GATEWAY_MODE: "preview" },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  let output = "";
  child.stderr.on("data", (data) => { output += data; });
  try {
    await new Promise((resolve, reject) => {
      child.stdout.on("data", (data) => { if (String(data).includes("running at")) resolve(); });
      child.once("exit", () => reject(new Error(`Server exited before listening: ${output}`)));
      child.once("error", reject);
    });
    const call = (path, token, options = {}) => fetch(`http://127.0.0.1:${port}${path}`, {
      ...options, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
    });
    assert.equal((await call("/api/auth/register", null, { method: "POST" })).status, 410);
    assert.equal((await call("/api/auth/login", null, { method: "POST" })).status, 410);
    assert.equal((await call("/api/app-state")).status, 401);
    assert.equal((await (await call("/api/auth/session", null, { headers: { Cookie: "buswakeup_session=legacy" } })).json()).authenticated, false);
    const session = await (await call("/api/auth/session", "user-a")).json();
    assert.equal(session.authenticated, true);
    assert.equal(session.user.id, "user-a");
    assert.equal(session.session.id, "");
    const original = await (await call("/api/app-state", "user-a")).json();
    assert.equal(original.user.name, "user-a");
    const saved = await call("/api/app-state", "user-a", { method: "POST", body: JSON.stringify({ ...original, probe: "saved-a" }) });
    assert.equal(saved.status, 200, await saved.text());
    assert.equal((await (await call("/api/app-state", "user-a")).json()).probe, "saved-a");
    assert.equal((await (await call("/api/app-state", "user-b")).json()).probe, undefined);
    const conflict = await call("/api/app-state", "user-a", { method: "POST", body: JSON.stringify({ ...original, forceConflict: true }) });
    assert.equal(conflict.status, 409);
    assert.equal((await (await call("/api/app-state", "user-a")).json()).probe, "saved-a");
    assert.equal((await call("/api/app-state", "user-a", { method: "POST", headers: { Origin: "https://evil.test" }, body: "{}" })).status, 403);
  } finally {
    child.kill();
    if (child.exitCode === null) await once(child, "exit");
  }
});
