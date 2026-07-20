function pineCodeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""');
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
