/**
 * Strip likely secrets from text that travels to the MCP client or into
 * local logs: URL userinfo (user:pass@host), URL query strings (which may
 * carry session ids), whole Authorization values (scheme and credentials) and
 * bearer/token/API-key values, quoted keys included. Surrounding text is kept
 * so error messages stay actionable.
 *
 * The scheme runs are bounded rather than open-ended. An unbounded
 * `[\w+.-]*` before `://` costs one scan of the whole remaining string at
 * every letter that turns out not to start a scheme, which is quadratic: a
 * 40 KB message took 2.9 s and an 80 KB one 11.7 s. This function runs on
 * every tool error and on every page exception, both of which can carry
 * text the page chose, so a long enough message froze the single Node
 * thread. `{0,64}` caps the per-position cost; no real scheme comes close.
 */

/**
 * Nothing useful is lost by capping the result: this is diagnostic text, not
 * data. Truncation happens after redaction, so a secret can never survive by
 * straddling the cut.
 */
export const MAX_REDACTED_CHARS = 4096;

/** Authorization schemes that may follow the header name after a space alone, or stand alone before a folded value. */
const SCHEME = String.raw`(?:bearer|basic|digest|negotiate|ntlm|aws4-hmac-sha256|oauth)`;

/** A value folded onto an indented next line; never a stack frame ("    at …"), and past the whole indent. */
const FOLD = String.raw`(?:\r?\n[ \t]+(?![ \t]|at\s))`;

/**
 * A whole Authorization value, scheme and credentials (BACKLOG 102-02): masking only the first word left
 * "Authorization: *** abc", and a multi-part value (Digest, AWS4-HMAC-SHA256, OAuth 1.0) kept everything after its
 * first ", ". A quoted value runs to its own unescaped closing quote, so quotes and escapes inside it stay masked. In
 * an escaped JSON string the closing quote is the \" that ends the JSON value (see escapedRun), so a ', an inner \\\"
 * (a quote escaped twice) or a \\/ does not end it. An unquoted value runs to the end of
 * the line, and onto a folded next line only when its line holds just the scheme. It follows:
 * - `:`, `=` or `=>`, after a key quoted or not (JSON, Python, util.inspect, a Map, an escaped JSON string), with a
 *   fold before the value, and Proxy-Authorization included since \b falls after its hyphen;
 * - a name-value pair with a scheme next, `['Authorization', 'Basic …']`, so a list of header names keeps its next
 *   name; and HAR's `{"name":"Authorization","value":"…"}` whatever the value;
 * - a known scheme after a space alone.
 * A value that is only null, true, false or undefined is left as it is, so a JSON dump stays whole; one that merely
 * starts with such a word, as from a template with an undefined scheme, is masked.
 */
const AUTHORIZATION = new RegExp(String.raw`\b(authorization)(` +
  String.raw`\\?["']?[ \t]*(?:=>|[=:])[ \t]*${FOLD}?(?=\S)` +
  String.raw`|\\?["'][ \t]*,[ \t]*(?:\\?["']value\\?["'][ \t]*:[ \t]*(?=\\?["'])|(?=\\?["']${SCHEME}\b))` +
  String.raw`|[ \t]+(?=${SCHEME}\b)` +
  String.raw`)(?:${escapedRun('"')}|${escapedRun("'")}|(")(?:[^"\\\r\n]|\\.)*|(')(?:[^'\\\r\n]|\\.)*` +
  String.raw`|(?!(?:null|true|false|undefined)[ \t]*(?:[,;)\]}]|\r?\n|$))(?:${SCHEME}[ \t]*${FOLD})?[^\r\n]+)`, "gi");

/**
 * A value opened by an escaped quote, up to the one that closes it: a run of 4k + 1 backslashes (one escaping the quote,
 * the rest pairs of escaped backslashes) then the quote, followed by the end of a JSON value (`,`, `}`, `]`, an escaped
 * \n, \r or \t of pretty-printed JSON, or the end of the line). With no such quote on its line the value runs to the end
 * of the line, keeping its opening quote.
 */
function escapedRun(quote: string): string {
  return String.raw`(\\${quote})(?:[^\r\n]*?(?=(?<!\\)(?:\\\\\\\\)*\\${quote}[ \t]*(?:[,}\]]|\\[nrt]|\r?\n|$))|[^\r\n]*)`;
}

/** Bearer, token and API-key values after a separator, a space, or a fold onto an indented next line. */
const GENERIC = new RegExp(String.raw`\b(bearer|token|api[_-]?key)` +
  String.raw`(\\?["']?[ \t]*(?:=>|[=:])[ \t]*${FOLD}?\\?["']?|[ \t]+|[ \t]*${FOLD})[\w.~+/-]+=*`, "gi");

/** What a message becomes when it cannot be redacted: nothing of it is passed on. */
export const WITHHELD_MESSAGE = "[message withheld: it could not be redacted]";

/** Appended to a result cut at MAX_REDACTED_CHARS, on its own line. */
const TRUNCATED = "\n… [truncated]";

export function redactSecrets(text: string): string {
  // A result that was already cut is redacted again without its marker and gets it back, so no rule can reach the
  // marker, nor shorten a value at the cut and so pull the marker's start back under the cap (102 follow-up review).
  const truncated = text.endsWith(TRUNCATED);
  let redacted: string;
  try {
    redacted = redactAll(truncated ? text.slice(0, -TRUNCATED.length) : text);
  } catch {
    // A quoted run pushes one backtracking entry per character, so a value of some 8 million characters (a page may
    // send up to 256 MiB) overflows the regexp stack. Fail closed rather than throw from an error path (102-02 review).
    return WITHHELD_MESSAGE;
  }
  // A cut inside an escape leaves a dangling backslash, which a second pass would read as a value; drop it.
  return redacted.length <= MAX_REDACTED_CHARS && !truncated
    ? redacted
    : `${redacted.slice(0, MAX_REDACTED_CHARS).replace(/\\+$/, "")}${TRUNCATED}`;
}

function redactAll(text: string): string {
  return text
    .replace(/([a-z][\w+.-]{0,64}:\/\/)[^\s/@]+@/gi, "$1***@")
    // Before the query rule, which stops at a space and so would leave "?***" and the credential behind it.
    .replace(AUTHORIZATION, (_, name: string, separator: string, escapedDouble?: string, escapedSingle?: string, double?: string,
      single?: string) => `${name}${separator}${escapedDouble ?? escapedSingle ?? double ?? single ?? ""}***`)
    // The query is optional so that a URL without one is consumed whole: requiring it made every later "x://" in the
    // body rescan the rest of the message, which took 5 s on 200 KB of "x://" (code review of 102-02).
    .replace(/([a-z][\w+.-]{0,64}:\/\/[^\s?"'<>()[\]]+)(\?[^\s"'<>()[\]]*)?/gi,
      (match: string, url: string, query: string | undefined) => (query === undefined ? match : `${url}?***`))
    .replace(GENERIC, "$1$2***");
}
