/**
 * Whether a string left open at a line end goes on to the next line. Pine wraps such a string onto a line indented by
 * one or more spaces (a tab is taken as indentation too), and inside parentheses or brackets places no limit on
 * indentation at all.
 */
function wrapsOnto(source: string, lineStart: number, bracketed: boolean): boolean {
  return bracketed || source[lineStart] === " " || source[lineStart] === "\t";
}

/**
 * A line indented like a block body, by a multiple of four spaces or a tab. Outside brackets, Pine's general wrapping
 * rule forbids wrapping onto one.
 */
function blockIndented(source: string, lineStart: number): boolean {
  let spaces = 0;
  while (source[lineStart + spaces] === " ") spaces += 1;
  return source[lineStart + spaces] === "\t" || spaces % 4 === 0;
}

/**
 * Where the triple-quoted string opened at `start` closes: the first triple quote past the opener that no backslash
 * escapes, or with `escapes` unset the first one at all; -1 when there is none.
 */
function tripleQuoteClose(source: string, start: number, triple: string, escapes: boolean): number {
  if (!escapes) return source.indexOf(triple, start + 3);
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
 * With `asPine` set, the source is read as valid Pine is. Every string honours backslash escapes. A triple-quoted
 * string runs to its closing triple quote, across lines. Any other string runs to its closing quote, and past a line
 * end only onto a wrapped line (see wrapsOnto, which needs the depth of parentheses and brackets the code has open);
 * otherwise it ends with its line. Unset, the reading is the plainest one: no string wraps, and a triple-quoted string
 * closes at the first triple quote, escaped or not. A block comment runs to its closing "*\/"; one that never closes is
 * read as code, so a stray marker hides nothing.
 *
 * `malformed` reports what valid Pine cannot contain: a string that never reaches its closing quote, a bracket closed
 * that was never opened or left open at the end, or a wrap outside brackets onto a line indented like a block body. In
 * valid Pine a string open at a line end is always wrapped; in a source that cannot compile, wrapping may instead carry
 * a stray quote on into real code. Not every such source is caught: a later stray quote can close the string again.
 *
 * Once the search for a closer fails, every later search for the same closer fails too, so it is not repeated and the
 * pass stays linear. For "*\/", and for a triple quote searched for without escapes, none exists past where the search
 * began. With escapes, a later search starts past a later opener, where it reads escapes exactly as the failed one did,
 * so it finds nothing that one missed.
 */
function pineCodeOnly(source: string, asPine: boolean): { code: string; malformed: boolean } {
  let code = "";
  let index = 0;
  let malformed = false;
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
        const close = tripleQuoteClose(source, index, triple, asPine);
        if (close >= 0) { index = close + 3; code += '""'; continue; }
        tripleUnclosedFrom[char] = index;
        malformed = true;
      }
      index += 1;
      while (index < source.length && source[index] !== char) {
        if (source[index] === "\n") {
          if (!(asPine && wrapsOnto(source, index + 1, bracketDepth > 0))) break;
          if (bracketDepth === 0 && blockIndented(source, index + 1)) malformed = true;
        }
        index +=source[index] === "\\" && source[index + 1] !== undefined && source[index + 1] !== "\n" ? 2 : 1;
      }
      if (source[index] === char) index += 1;
      else malformed = true;
      code += '""';
      continue;
    }
    if (char === "(" || char === "[") bracketDepth += 1;
    else if (char === ")" || char === "]") {
      if (bracketDepth > 0) bracketDepth -= 1;
      else malformed = true;
    }
    code += char;
    index += 1;
  }
  return { code, malformed: malformed || bracketDepth > 0 };
}

/**
 * The code to audit: the source read as valid Pine, and, when it cannot be valid, read the plain way as well. What
 * either reading finds counts, so code the first took for text is still found where the second sees it.
 */
function auditedCode(text: string): string {
  const pine = pineCodeOnly(text, true);
  return pine.malformed ? `${pine.code}\n${pineCodeOnly(text, false).code}` : pine.code;
}

export function auditPineSource(source: string) {
  // A carriage return before a line feed ends the line with it. One alone is taken as a line end too, and in case Pine
  // keeps it as a character instead, the source is then also read that way.
  const text = source.replace(/\r\n?/g, "\n");
  const code = /\r(?!\n)/.test(source) ? `${auditedCode(text)}\n${auditedCode(source)}` : auditedCode(text);
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
