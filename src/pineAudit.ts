/**
 * The source with its comments removed and every string literal emptied, read in one pass so that what a construct
 * contains is not taken for another (BACKLOG 102-19). Separate passes took the "//" of "https://..." for a comment,
 * cutting the string open so the next pass swallowed real code up to some later quote; and a "/*" inside a string
 * removed the code up to the next "*\/". A string ends at its closing quote, or at the end of its line, since a Pine
 * string cannot span lines; a block comment with no end is read as code, so nothing is hidden by a stray marker.
 */
function pineCodeOnly(source: string): string {
  let code = "";
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") index += 1;
    } else if (char === "/" && next === "*" && source.indexOf("*/", index + 2) >= 0) {
      index = source.indexOf("*/", index + 2) + 2;
    } else if (char === '"' || char === "'") {
      index += 1;
      while (index < source.length && source[index] !== char && source[index] !== "\n") {
        index += source[index] === "\\" && source[index + 1] !== undefined && source[index + 1] !== "\n" ? 2 : 1;
      }
      if (source[index] === char) index += 1;
      code += '""';
    } else {
      code += char;
      index += 1;
    }
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
