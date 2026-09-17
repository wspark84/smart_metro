import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('public screen files are not held behind a busy account runtime lock', async () => {
  const source = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');
  const callbackSource = source.slice(source.indexOf('const server = createServer('), source.indexOf('\nserver.listen('));
  let listener;
  const served = [];
  const queued = [];
  const context = vm.createContext({
    createServer(callback) { listener = callback; return {}; },
    parseRequestUrl(request) { return new URL(request.url, 'http://localhost'); },
    runWithRuntimeLock(work) { queued.push(work); return new Promise(() => {}); },
    async handleRequest(request) { served.push(request.url); },
    sendUnhandledServerError() { assert.fail('unexpected static request error'); },
  });
  vm.runInContext(callbackSource, context);
  listener({method:'GET',url:'/api/app-state'}, {});
  listener({method:'GET',url:'/'}, {});
  listener({method:'GET',url:'/src/locale-ko.js'}, {});
  listener({method:'HEAD',url:'/src/styles.css'}, {});
  await Promise.resolve();
  assert.deepEqual(served, ['/', '/src/locale-ko.js', '/src/styles.css']);
  assert.equal(queued.length, 1, 'account API must still use the protected runtime lock');
});
