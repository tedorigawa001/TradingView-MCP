/**
 * Strip likely secrets from text that travels to the MCP client or into
 * local logs: URL userinfo (user:pass@host), URL query strings (which may
 * carry session ids) and bearer/token values. Surrounding text is kept so
 * error messages stay actionable.
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

export function redactSecrets(text: string): string {
  const redacted = text
    .replace(/([a-z][\w+.-]{0,64}:\/\/)[^\s/@]+@/gi, "$1***@")
    .replace(/([a-z][\w+.-]{0,64}:\/\/[^\s?"'<>()[\]]+)\?[^\s"'<>()[\]]*/gi, "$1?***")
    .replace(/\b(bearer|token|api[_-]?key|authorization)([=:]\s*|\s+)[\w.~+/-]+=*/gi, "$1$2***");
  return redacted.length <= MAX_REDACTED_CHARS
    ? redacted
    : `${redacted.slice(0, MAX_REDACTED_CHARS)}… [truncated]`;
}
