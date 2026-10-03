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

/**
 * A whole Authorization value, scheme and credentials (BACKLOG 102-02): masking only the first word left
 * "Authorization: *** abc", and a multi-part value (Digest, AWS4-HMAC-SHA256, OAuth 1.0) kept everything after its
 * first ", ". The value runs to its closing quote when quoted, else to the end of the line, and onto an indented
 * next line only when its line holds just the scheme. It follows:
 * - `:`, `=` or `=>`, after a key quoted or not (JSON, Python, util.inspect, a Map, an escaped JSON string), with an
 *   indented next line as a fold unless it is a stack frame ("    at …"), and Proxy-Authorization included since \b
 *   falls after its hyphen;
 * - a name-value pair, `['Authorization', '…']` or HAR's `{"name":"Authorization","value":"…"}`;
 * - a known scheme after a space alone.
 * A null, true, false or undefined value is left as it is, so a JSON dump stays whole.
 */
const AUTHORIZATION = new RegExp(String.raw`\b(authorization)(` +
  String.raw`\\?["']?[ \t]*(?:=>|[=:])[ \t]*(?:\r?\n[ \t]+(?![ \t]|at\s))?(?=\S)` +
  String.raw`|\\?["'][ \t]*,[ \t]*(?:\\?["']value\\?["'][ \t]*:[ \t]*)?(?=\\?["'])` +
  String.raw`|[ \t]+(?=${SCHEME}\b)` +
  String.raw`)(?:(\\?["'])[^"'\\\r\n]*|(?!(?:null|true|false|undefined)\b)(?:${SCHEME}[ \t]*\r?\n[ \t]+(?![ \t]|at\s))?[^\r\n]+)`, "gi");

export function redactSecrets(text: string): string {
  const redacted = text
    .replace(/([a-z][\w+.-]{0,64}:\/\/)[^\s/@]+@/gi, "$1***@")
    // Before the query rule, which stops at a space and so would leave "?***" and the credential behind it.
    .replace(AUTHORIZATION, (_, name: string, separator: string, quote: string | undefined) => `${name}${separator}${quote ?? ""}***`)
    // The query is optional so that a URL without one is consumed whole: requiring it made every later "x://" in the
    // body rescan the rest of the message, which took 5 s on 200 KB of "x://" (code review of 102-02).
    .replace(/([a-z][\w+.-]{0,64}:\/\/[^\s?"'<>()[\]]+)(\?[^\s"'<>()[\]]*)?/gi,
      (match: string, url: string, query: string | undefined) => (query === undefined ? match : `${url}?***`))
    .replace(/\b(bearer|token|api[_-]?key)(\\?["']?[ \t]*(?:=>|[=:])[ \t]*\\?["']?|[ \t]+)[\w.~+/-]+=*/gi, "$1$2***");
  return redacted.length <= MAX_REDACTED_CHARS
    ? redacted
    : `${redacted.slice(0, MAX_REDACTED_CHARS)}… [truncated]`;
}
