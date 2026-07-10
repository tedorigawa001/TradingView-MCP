/**
 * Strip likely secrets from text that travels to the MCP client or into
 * local logs: URL userinfo (user:pass@host), URL query strings (which may
 * carry session ids) and bearer/token values. Surrounding text is kept so
 * error messages stay actionable.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/([a-z][\w+.-]*:\/\/)[^\s/@]+@/gi, "$1***@")
    .replace(/([a-z][\w+.-]*:\/\/[^\s?"'<>()[\]]+)\?[^\s"'<>()[\]]*/gi, "$1?***")
    .replace(/\b(bearer|token|api[_-]?key|authorization)([=:]\s*|\s+)[\w.~+/-]+=*/gi, "$1$2***");
}
