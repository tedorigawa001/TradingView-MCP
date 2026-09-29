import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fdlibmLog } from '../../build/fdlibmLog.js';
import { createRandom } from '../../build/seededRandom.js';

// The realized covariance log (src/fdlibmLog.ts). V8's Math.log differs by one ulp between its arm64 and x64
// builds, so these tests hold the port to three things: Math.log's accuracy, x64's exact bits, and one digest
// that must be the same on every CPU in the CI matrix.
// sha256 of the big-endian bits of fdlibmLog over inputs(): the same on every CPU, since the port is plain JS arithmetic.
const DIGEST = '76b4968bf9ffe467859b18938d02895b6b8fd3464f9144a2cc376bfdf5e8f75e';
const view = new DataView(new ArrayBuffer(8));
const ordinal = (x) => { view.setFloat64(0, x); return view.getBigInt64(0); };
const ulps = (a, b) => Number(ordinal(a) - ordinal(b));

/** Inputs over every branch: the full exponent range, subnormals, near 1 (the |f| < 2^-20 branch), powers of 2, prices. */
function inputs() {
  const random = createRandom(20260929);
  const out = [];
  for (let i = 0; i < 10_000; i++) out.push(Math.exp(-745 + random() * 1454));
  for (let i = 0; i < 2_000; i++) out.push(1 + (random() - 0.5) * 2 ** -18);
  for (let i = 0; i < 1_000; i++) out.push(random() * 2 ** -1022);
  // Prices, where arm64's Math.log differs most often (about 3% of EURUSD-like closes near 1.1).
  for (let i = 0; i < 5_000; i++) out.push(0.5 + random() * 1.5);
  for (let i = 0; i < 2_000; i++) out.push(50 + random() * 150);
  for (let k = -1074; k <= 1023; k += 7) out.push(2 ** k);
  for (let d = -8; d <= 8; d++) out.push(1 + d * Number.EPSILON, 2 + d * 2 * Number.EPSILON);
  out.push(Number.MIN_VALUE, Number.MAX_VALUE, Math.E, Math.SQRT2, Math.SQRT1_2, 0.7, 1.3, 1.1, 150.123);
  // The branch boundaries on the high mantissa word: the √2 normalization (0x6a09c), the polynomial choice
  // (0x6147a, 0x6b851) and the |f| < 2^-20 test (0xffffe..0x00001). Random inputs almost never land on them.
  const words = new DataView(new ArrayBuffer(8));
  for (const mantissa of [0x6147a, 0x6b851, 0x6a09c, 0xfffff, 0x00001]) {
    for (const hx of [mantissa - 1, mantissa, mantissa + 1]) {
      for (const exponent of [0x3c0, 0x3fe, 0x3ff, 0x400, 0x7fe]) {
        const lows = [0, 1, 0x80000000, 0xffffffff, ...Array.from({ length: 60 }, () => Math.floor(random() * 2 ** 32))];
        for (const low of lows) {
          words.setUint32(0, (exponent << 20) | (hx & 0xfffff));
          words.setUint32(4, low);
          out.push(words.getFloat64(0));
        }
      }
    }
  }
  return out;
}

test('special values follow Math.log', () => {
  for (const x of [0, -0, -1, -Number.MIN_VALUE, Number.NaN, Infinity, -Infinity, 1]) {
    assert.ok(Object.is(fdlibmLog(x), Math.log(x)), String(x));
  }
});

test('within one ulp of Math.log everywhere, and equal to it on x64, where V8 compiles fdlibm without FMA', (t) => {
  let differ = 0, largest = 0;
  for (const x of inputs()) {
    const gap = Math.abs(ulps(fdlibmLog(x), Math.log(x)));
    largest = Math.max(largest, gap);
    if (gap) differ++;
  }
  assert.ok(largest <= 1, `largest gap ${largest} ulp`);
  // A tripwire on V8 internals, not on the port: if a future x64 V8 changes Math.log, the port (pinned by the digest
  // below) is still right, and only the docs' "the x64 build's bits" wording needs revisiting.
  if (process.arch === 'x64') assert.equal(differ, 0, 'x64 Math.log no longer matches the port: revisit the docs, not the port');
  t.diagnostic(`${process.arch}: ${differ} of ${inputs().length} differ from Math.log by one ulp`);
});

test('one digest of every output, identical on every CPU', () => {
  const bits = Buffer.alloc(8 * inputs().length);
  inputs().forEach((x, i) => bits.writeDoubleBE(fdlibmLog(x), 8 * i));
  assert.equal(createHash('sha256').update(bits).digest('hex'), DIGEST);
});
