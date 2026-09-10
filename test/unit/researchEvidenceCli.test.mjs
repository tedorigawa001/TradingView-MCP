import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, symlink, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { generateResearchEvidence } from '../../build/researchEvidenceGeneration.js';
import { ResearchEvidenceError, researchEvidenceDiagnostic } from '../../build/researchEvidenceErrors.js';

const cli = fileURLToPath(new URL('../../build/researchEvidenceCli.js', import.meta.url));
const secret = 'PRIVATE_SOURCE_CONTENT_MUST_NOT_APPEAR';
const run = (args, entry = cli) => spawnSync(process.execPath, [entry, ...args], {
  encoding: 'utf8', timeout: 15_000,
});
const confirmed = (path) => ['--input', path, '--confirm-local-read'];

test('diagnostics only render registered codes and fixed messages, never arbitrary error text', () => {
  for (const code of ['EVIDENCE_INPUT_NOT_REGULAR', 'EVIDENCE_INPUT_MISSING',
    'EVIDENCE_INPUT_ACCESS_DENIED', 'EVIDENCE_INPUT_CHANGED', 'EVIDENCE_FILE_LIMIT', 'EVIDENCE_BYTE_BUDGET']) {
    const error = new ResearchEvidenceError(code);
    error.message = secret;
    error.cause = new Error(secret);
    const diagnostic = researchEvidenceDiagnostic(error);
    assert.ok(diagnostic.includes(`[${code}]`));
    assert.equal(diagnostic.includes(secret), false);
  }
  for (const error of [new Error(secret), {code:'EVIDENCE_FILE_LIMIT', message:secret},
    new ResearchEvidenceError(secret), null]) {
    const diagnostic = researchEvidenceDiagnostic(error);
    assert.match(diagnostic, /details withheld/);
    assert.equal(diagnostic.includes(secret), false);
  }
});

test('CLI distinguishes missing and symlink evidence without exposing paths', async (t) => {
  const {directory, input} = await fixture(t);
  const missing = join(directory, secret);
  await writeFile(input, JSON.stringify({data:[{id:'data',path:missing}]}));
  const absent = run(confirmed(input));
  failed(absent);
  assert.match(absent.stderr, /\[EVIDENCE_INPUT_MISSING\]/);
  assert.equal(absent.stderr.includes(directory), false);
  const link = join(directory, 'link');
  if (!await makeSymlink(t, missing, link)) return;
  await writeFile(input, JSON.stringify({data:[{id:'data',path:link}]}));
  const linked = run(confirmed(input));
  failed(linked);
  assert.match(linked.stderr, /\[EVIDENCE_INPUT_NOT_REGULAR\]/);
  assert.equal(linked.stderr.includes(directory), false);
});

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'research-evidence-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = {};
  for (const axis of ['data', 'code', 'runner', 'candidate_rule', 'parameters']) {
    const path = join(directory, `${axis}.txt`);
    await writeFile(path, `${secret}:${axis}\n`, { mode: 0o600 });
    config[axis] = [{ id: axis, path }];
  }
  config.dependency_lockfile = join(directory, 'lock.json');
  await writeFile(config.dependency_lockfile, JSON.stringify({ marker: secret }), { mode: 0o600 });
  const input = join(directory, 'config.json');
  await writeFile(input, JSON.stringify(config), { mode: 0o600 });
  return { directory, config, input };
}

function failed(result) {
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.doesNotMatch(result.stderr, new RegExp(secret));
}

async function makeSymlink(t, target, path) {
  try { await symlink(target, path); return true; }
  catch (error) {
    if (process.platform === 'win32' && error.code === 'EPERM') {
      t.skip('Windows requires symlink privileges');
      return false;
    }
    throw error;
  }
}

test('CLI requires confirmation and input before reading or writing', async (t) => {
  const { directory, input } = await fixture(t);
  const output = join(directory, 'report.json');
  for (const args of [[], ['--confirm-local-read'], ['--input', input, '--output', output],
    ['--input', join(directory, 'missing.json')]]) {
    const result = run(args);
    failed(result);
    assert.match(result.stderr, /--confirm-local-read/);
  }
  await assert.rejects(lstat(output), { code: 'ENOENT' });
});

test('CLI rejects positionals, unknown flags, and invalid output paths', async (t) => {
  const { directory, input } = await fixture(t);
  for (const extra of [['positional'], ['--unknown'], ['--output'], ['--output', 'relative.json'],
    ['--output', join(directory, 'missing', 'report.json')]]) {
    failed(run([...confirmed(input), ...extra]));
  }
});

test('stdout report and durable output have the same six hashes as the generator', async (t) => {
  const { directory, input, config } = await fixture(t);
  const expected = await generateResearchEvidence(config);
  const stdout = run(confirmed(input));
  assert.equal(stdout.status, 0, stdout.stderr);
  assert.equal(stdout.stderr, '');
  const report = JSON.parse(stdout.stdout);
  assert.deepEqual(report.manifest, expected.manifest);
  const hashes = Object.values(report.manifest).filter((value) => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value));
  assert.equal(hashes.length, 6);
  assert.doesNotMatch(stdout.stdout, new RegExp(secret));

  const output = join(directory, 'report.json');
  const saved = run([...confirmed(input), '--output', output]);
  assert.equal(saved.status, 0, saved.stderr);
  assert.equal(saved.stderr, '');
  assert.deepEqual(JSON.parse(saved.stdout), { written: true, manifest: expected.manifest });
  assert.equal(saved.stdout.includes(directory), false);
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')).manifest, report.manifest);
  assert.doesNotMatch(await readFile(output, 'utf8'), new RegExp(secret));
  if (process.platform !== 'win32') assert.equal((await lstat(output)).mode & 0o777, 0o600);
});

test('omitted axes remain nullable', async (t) => {
  const { input } = await fixture(t);
  await writeFile(input, '{}');
  const result = run(confirmed(input));
  assert.equal(result.status, 0, result.stderr);
  const expected = await generateResearchEvidence({});
  assert.deepEqual(JSON.parse(result.stdout).manifest, expected.manifest);
  assert.equal(Object.values(expected.manifest).filter((value) => value === null).length, 6);
});

test('strict config and malformed JSON fail without exposing source content', async (t) => {
  const { input, config } = await fixture(t);
  for (const body of [JSON.stringify({ ...config, [secret]: true }),
    JSON.stringify({ data: [{ id: 'data', path: 'relative', extra: secret }] }),
    `{"broken": ${secret}}`]) {
    await writeFile(input, body);
    failed(run(confirmed(input)));
  }
});

test('existing output is untouched', async (t) => {
  const { directory, input } = await fixture(t);
  const output = join(directory, 'existing.json');
  await writeFile(output, secret, { mode: 0o600 });
  failed(run([...confirmed(input), '--output', output]));
  assert.equal(await readFile(output, 'utf8'), secret);
});

test('output symlinks, including dangling links, are refused', async (t) => {
  const { directory, input } = await fixture(t);
  const target = join(directory, 'target.json');
  await writeFile(target, secret);
  for (const [name, destination] of [['existing', target], ['dangling', join(directory, 'absent.json')]]) {
    const output = join(directory, `${name}-link.json`);
    if (!await makeSymlink(t, destination, output)) return;
    failed(run([...confirmed(input), '--output', output]));
    assert.equal((await lstat(output)).isSymbolicLink(), true);
  }
  assert.equal(await readFile(target, 'utf8'), secret);
  await assert.rejects(lstat(join(directory, 'absent.json')), { code: 'ENOENT' });
});

test('config symlinks are refused by the bounded reader', async (t) => {
  const { directory, input } = await fixture(t);
  const link = join(directory, 'config-link.json');
  if (!await makeSymlink(t, input, link)) return;
  failed(run(confirmed(link)));
});

test('bin symlink invokes the realpath entrypoint and confirmation guard', async (t) => {
  const { directory, input, config } = await fixture(t);
  const bin = join(directory, 'research-evidence');
  if (!await makeSymlink(t, cli, bin)) return;
  failed(run(['--input', input], bin));
  const result = run(confirmed(input), bin);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).manifest, (await generateResearchEvidence(config)).manifest);
});
