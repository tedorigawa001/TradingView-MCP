/**
 * Whether a string left open at a line end goes on to the next line. Pine wraps such a string onto a line indented by
 * one or more spaces, and inside parentheses or brackets places no limit on indentation at all.
 */
function wrapsOnto(source: string, lineStart: number, bracketed: boolean): boolean {
  return bracketed || source[lineStart] === " " || source[lineStart] === "\t";
}

/** Where the triple-quoted string opened at `start` closes: the first triple quote past the opener that no backslash escapes, or -1. */
function tripleQuoteClose(source: string, start: number, triple: string): number {
  for (let index = start + 3; index < source.length; index += 1) {
    if (source[index] === "\\") index += 1;
    else if (source.startsWith(triple, index)) return index;
  }
  return -1;
}

/**
 * The source with its comments removed and every string literal emptied, read in one pass so that what a construct
 * contains is not taken for another (BACKLOG 102-19). Separate passes took the "//" of "https://..." for a comment,
 * cutting the string open so the next pass swallowed real code up to some later quote; and a "/*" inside a string
 * removed the code up to the next "*\/".
 *
 * Every string honours backslash escapes. A triple-quoted string runs to its closing triple quote, across lines. Any
 * other string runs to its closing quote, and past a line end only onto a wrapped line (see wrapsOnto, which needs the
 * depth of parentheses and brackets the code has open); otherwise it ends with its line. A block comment runs to its
 * closing "*\/"; one that never closes is read as code, so a stray marker hides nothing.
 *
 * Once the search for a closer fails, every later search for the same closer fails too, so it is not repeated and the
 * pass stays linear. For "*\/" none exists past where the search began. For a triple quote, a later search starts past
 * a later opener, where it reads escapes exactly as the failed one did, so it finds nothing that one missed.
 */
function pineCodeOnly(source: string): string {
  let code = "";
  let index = 0;
  let bracketDepth = 0;
  let blockCommentUnclosedFrom = Infinity;
  const tripleUnclosedFrom: Record<string, number> = { '"': Infinity, "'": Infinity };
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }
    if (char === "/" && next === "*" && index < blockCommentUnclosedFrom) {
      const close = source.indexOf("*/", index + 2);
      if (close >= 0) { index = close + 2; continue; }
      blockCommentUnclosedFrom = index;
    }
    if (char === '"' || char === "'") {
      const triple = char.repeat(3);
      if (source.startsWith(triple, index) && index < tripleUnclosedFrom[char]) {
        const close = tripleQuoteClose(source, index, triple);
        if (close >= 0) { index = close + 3; code += '""'; continue; }
        tripleUnclosedFrom[char] = index;
      }
      index += 1;
      while (index < source.length && source[index] !== char) {
        if (source[index] === "\n" && !wrapsOnto(source, index + 1, bracketDepth > 0)) break;
        index += source[index] === "\\" && source[index + 1] !== undefined && source[index + 1] !== "\n" ? 2 : 1;
      }
      if (source[index] === char) index += 1;
      code += '""';
      continue;
    }
    if (char === "(" || char === "[") bracketDepth += 1;
    else if ((char === ")" || char === "]") && bracketDepth > 0) bracketDepth -= 1;
    code += char;
    index += 1;
  }
  return code;
}

export function auditPineSource(source: string) {
  const code = pineCodeOnly(source);
  const usesRequestSecurity = /\brequest\.security(?:_lower_tf)?\s*\(/.test(code);
  const usesPivots = /\bta\.pivot(?:high|low)\s*\(/.test(code);
  const usesVarip = /\bvarip\b/.test(code);
  const usesTimenow = /\btimenow\b/.test(code);
  const calcOnEveryTick = /\bcalc_on_every_tick\s*=\s*true\b/.test(code);
  const usesRealtimeState = /\bbarstate\.isrealtime\b/.test(code);
  const findings = [
    ...(usesRequestSecurity ? [{ code: "request_security", severity: "warning", message: "request.security can introduce higher-timeframe lookahead/recalculation risk." }] : []),
    ...(usesPivots ? [{ code: "pivots", severity: "warning", message: "Pivot values are only confirmed after future bars have elapsed." }] : []),
    ...(usesVarip ? [{ code: "varip", severity: "warning", message: "varip can preserve intrabar state that differs after restart." }] : []),
    ...(usesTimenow ? [{ code: "timenow", severity: "warning", message: "timenow makes values depend on wall-clock execution time." }] : []),
    ...(calcOnEveryTick ? [{ code: "calc_on_every_tick", severity: "warning", message: "Intrabar strategy recalculation can differ from closed-bar history." }] : []),
    ...(usesRealtimeState ? [{ code: "barstate_isrealtime", severity: "warning", message: "Realtime-only branches can differ from historical execution." }] : []),
  ];
  return { usesRequestSecurity, usesPivots, usesVarip, usesTimenow, calcOnEveryTick, usesRealtimeState, findings };
}

export type PineSourceAudit = ReturnType<typeof auditPineSource>;
