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

test('the fast-uri and ip-address overrides keep their advisory floors', async () => {
  // Both reach this tree through the MCP SDK: fast-uri through ajv (^3.0.1), ip-address through express-rate-limit
  // (^10.2.0), and both ranges admit the versions the advisories apply to. fast-uri < 3.1.8 normalizes a host's case
  // inconsistently through percent-encoded octets (GHSA-hrr3-gc8f-f4qj). ip-address <= 10.7.0 compares addresses of
  // different families in subnet checks, builds an unbounded parse diagnostic, and misclassifies link-local and NAT64
  // ranges (GHSA-j6r3-76f7-8jcv, GHSA-h3mg-xc3c-68pw, GHSA-rpw4-54j3-4h4q, GHSA-2vr4-cq9g-pvrc).
  const { overrides } = await manifest();
  for (const [name, floor, patched] of [['fast-uri', [3, 1, 8], '3.1.8'], ['ip-address', [10, 7, 1], '10.7.1']]) {
    assert.ok(overrides?.[name], `the ${name} override was removed`);
    assert.ok(atLeast(floorOf(overrides[name]), floor),
      `${name} override floor ${overrides[name]} is below the first patched version ${patched}`);
  }
});

test('the MCP SDK and the proxy-addr override keep their advisory floors (GHSA-6qxp-vccf-f47h, GHSA-jqcg-44mw-7w3h)', async () => {
  const { dependencies, overrides } = await manifest();
  // The SDK's OAuth client could send credentials to an authorization server chosen by the MCP server before 1.30.2.
  assert.ok(atLeast(floorOf(dependencies['@modelcontextprotocol/sdk']), [1, 30, 2]),
    `@modelcontextprotocol/sdk floor ${dependencies['@modelcontextprotocol/sdk']} is below the first patched version 1.30.2`);
  // proxy-addr, under the SDK's express, trusted IPv4-mapped IPv6 addresses as their IPv4 subnet before 2.0.8.
  assert.ok(overrides?.['proxy-addr'], 'the proxy-addr override was removed');
  assert.ok(atLeast(floorOf(overrides['proxy-addr']), [2, 0, 8]),
    `proxy-addr override floor ${overrides['proxy-addr']} is below the first patched version 2.0.8`);
  const lock = JSON.parse(await readFile(new URL('../../package-lock.json', import.meta.url), 'utf8'));
  assert.ok(atLeast(floorOf(lock.packages['node_modules/@modelcontextprotocol/sdk'].version), [1, 30, 2]),
    'the lockfile still installs a vulnerable @modelcontextprotocol/sdk');
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
