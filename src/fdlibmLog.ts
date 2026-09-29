/*
 * A port of fdlibm's __ieee754_log (e_log.c), the algorithm behind V8's Math.log.
 *
 * ====================================================
 * Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
 *
 * Developed at SunSoft, a Sun Microsystems, Inc. business.
 * Permission to use, copy, modify, and distribute this
 * software is freely granted, provided that this notice
 * is preserved.
 * ====================================================
 */

/**
 * Why a port: compiled Math.log differs by one ulp between V8's arm64 and x64 builds on about 0.1% of inputs,
 * so realized covariance computed on an Apple Silicon Mac and on x64 Linux or Windows got different proxy-set
 * IDs from the same bars and rules. JavaScript rounds every operation to double with no fused multiply-add, so
 * this port gives the same bits on every conforming engine and CPU: those of the x64 build.
 */
const words = new DataView(new ArrayBuffer(8));
const highWord = (x: number) => { words.setFloat64(0, x); return words.getInt32(0); };
const lowWord = (x: number) => { words.setFloat64(0, x); return words.getUint32(4); };
const withHighWord = (x: number, high: number) => { words.setFloat64(0, x); words.setInt32(0, high); return words.getFloat64(0); };

const ln2_hi = 6.93147180369123816490e-01;   // 3fe62e42 fee00000
const ln2_lo = 1.90821492927058770002e-10;   // 3dea39ef 35793c76
const two54 = 1.80143985094819840000e+16;    // 43500000 00000000
const Lg1 = 6.666666666666735130e-01;        // 3FE55555 55555593
const Lg2 = 3.999999999940941908e-01;        // 3FD99999 9997FA04
const Lg3 = 2.857142874366239149e-01;        // 3FD24924 94229359
const Lg4 = 2.222219843214978396e-01;        // 3FCC71C5 1D8E78AF
const Lg5 = 1.818357216161805012e-01;        // 3FC74664 96CB03DE
const Lg6 = 1.531383769920937332e-01;        // 3FC39A09 D078C69F
const Lg7 = 1.479819860511658591e-01;        // 3FC2F112 DF3E5244

/**
 * log(x): reduce x to 2^k·(1 + f) with √2/2 < 1 + f < √2, approximate log(1 + f) with the minimax polynomial
 * in s = f/(2 + f), and add k·ln2 in two parts. Error below 1 ulp. log(±0) = −∞, log(x < 0) = NaN.
 */
export function fdlibmLog(x: number): number {
  let hx = highWord(x);
  let k = 0;
  if (hx < 0x00100000) {   // x < 2^-1022
    if (((hx & 0x7fffffff) | lowWord(x)) === 0) return -Infinity;
    if (hx < 0) return Number.NaN;
    k -= 54;
    x *= two54;   // subnormal: scale up
    hx = highWord(x);
  }
  if (hx >= 0x7ff00000) return x + x;
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  let i = (hx + 0x95f64) & 0x100000;
  x = withHighWord(x, hx | (i ^ 0x3ff00000));   // normalize x or x/2
  k += i >> 20;
  const f = x - 1.0;
  const dk = k;
  if ((0x000fffff & (2 + hx)) < 3) {   // -2^-20 <= f < 2^-20
    if (f === 0) return k === 0 ? 0 : dk * ln2_hi + dk * ln2_lo;
    const R = f * f * (0.5 - 0.33333333333333333 * f);
    return k === 0 ? f - R : dk * ln2_hi - ((R - dk * ln2_lo) - f);
  }
  const s = f / (2.0 + f);
  const z = s * s;
  i = hx - 0x6147a;
  const w = z * z;
  const j = 0x6b851 - hx;
  const t1 = w * (Lg2 + w * (Lg4 + w * Lg6));
  const t2 = z * (Lg1 + w * (Lg3 + w * (Lg5 + w * Lg7)));
  i |= j;
  const R = t2 + t1;
  if (i > 0) {
    const hfsq = 0.5 * f * f;
    return k === 0 ? f - (hfsq - s * (hfsq + R)) : dk * ln2_hi - ((hfsq - (s * (hfsq + R) + dk * ln2_lo)) - f);
  }
  return k === 0 ? f - s * (f - R) : dk * ln2_hi - ((s * (f - R) - dk * ln2_lo) - f);
}
