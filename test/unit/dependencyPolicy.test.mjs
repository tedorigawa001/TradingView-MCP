import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const manifest = async () => JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
/** Lowest version a caret range admits, as [major, minor, patch]. */
const floorOf = (range) => {
  const match = /^\^?(\d+)\.(\d+)\.(\d+)$/.exec(range);
  assert.ok(match, `unsupported range: ${range}`);
  return match.slice(1, 4).map(Number);
};
const atLeast = (actual, required) =>
  actual[0] > required[0] || (actual[0] === required[0] &&
    (actual[1] > required[1] || (actual[1] === required[1] && actual[2] >= required[2])));

test('the hono override keeps its advisory floor', async () => {
  // hono reaches this tree through the MCP SDK, whose own range (^4.11.4) admits the
  // versions GHSA-gqvv-2mrq-wpjv, GHSA-g6gw-c38x-mqfc and GHSA-crvj-82cr-hjcx apply to.
  // The override exists so a fresh resolution cannot land on one. Nothing else would notice
  // it going: npm picks the newest match today, so audit stays clean either way, and the
  // guarantee would be gone without a single failure.
  const { overrides } = await manifest();
  assert.ok(overrides?.hono, 'the hono override was removed');
  assert.ok(atLeast(floorOf(overrides.hono), [4, 13, 5]),
    `hono override floor ${overrides.hono} is below the first patched version 4.13.5`);
});

test('every override still resolves to something at or above its floor', async () => {
  const { overrides } = await manifest();
  const lock = JSON.parse(await readFile(new URL('../../package-lock.json', import.meta.url), 'utf8'));
  for (const [name, range] of Object.entries(overrides)) {
    const installed = lock.packages[`node_modules/${name}`]?.version;
    assert.ok(installed, `${name} is overridden but absent from the lockfile`);
    assert.ok(atLeast(floorOf(installed), floorOf(range)),
      `${name} resolved to ${installed}, below its override floor ${range}`);
  }
});
