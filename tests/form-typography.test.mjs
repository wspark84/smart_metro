import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('form controls share readable sizing instead of oversized clock typography', async () => {
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  const controls = /\.field-block input,\s*\.field-block select\s*\{([^}]+)\}/.exec(css)?.[1];
  assert.ok(controls, 'text inputs and platform selects must share a style');
  assert.match(css, /--font-size-control:\s*1rem/);
  assert.match(controls, /font-size:\s*var\(--font-size-control\)/);
  assert.match(controls, /min-width:\s*0/);
  assert.match(controls, /width:\s*100%/);
  assert.match(controls, /font-weight:\s*500/);
  assert.doesNotMatch(controls, /font-size:\s*2rem|font-weight:\s*800/);
  assert.match(css, /\.field-block input\[type="time"\]\s*\{[^}]*font-size:\s*1\.25rem/);
});
