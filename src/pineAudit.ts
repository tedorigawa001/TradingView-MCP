/** Leading spaces that make a line a wrapped continuation of the one before: a count that is not a multiple of four. */
function wrapsOnto(source: string, lineStart: number): boolean {
  let spaces = 0;
  while (source[lineStart + spaces] === " ") spaces += 1;
  return spaces % 4 !== 0;
}

/**
 * The source with its comments removed and every string literal emptied, read in one pass so that what a construct
 * contains is not taken for another (BACKLOG 102-19). Separate passes took the "//" of "https://..." for a comment,
 * cutting the string open so the next pass swallowed real code up to some later quote; and a "/*" inside a string
 * removed the code up to the next "*\/".
 *
 * A triple-quoted string runs to its closing triple quote, across lines. Any other string runs to its closing quote,
 * honouring escapes, and past a line end only onto a wrapped line (indented by a count of spaces that is not a multiple
 * of four, as Pine wraps a long line; a multiple of four is a block body); otherwise it ends with its line. A block
 * comment runs to its closing "*\/"; one that never closes is read as code, so a stray marker hides nothing. Once the
 * search for a closing "*\/" fails, none exists past where it began, so later "/*" do not search again and the pass
 * stays linear. A triple quote needs no such memory: a failed search leaves no later triple quote to search from.
 */
function pineCodeOnly(source: string): string {
  let code = "";
  let index = 0;
  let blockCommentUnclosedFrom = Infinity;
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
      const close = source.startsWith(triple, index) ? source.indexOf(triple, index + 3) : -1;
      if (close >= 0) { index = close + 3; code += '""'; continue; }
      index += 1;
      while (index < source.length && source[index] !== char) {
        if (source[index] === "\n" && !wrapsOnto(source, index + 1)) break;
        index += source[index] === "\\" && source[index + 1] !== undefined && source[index + 1] !== "\n" ? 2 : 1;
      }
      if (source[index] === char) index += 1;
      code += '""';
      continue;
    }
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
