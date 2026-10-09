/**
 * Strip likely secrets from text that travels to the MCP client or into
 * local logs: URL userinfo (user:pass@host), URL query strings (which may
 * carry session ids), whole Authorization and Cookie values (scheme and
 * credentials), the value of any key whose name holds a secret word (token,
 * secret, password, API key, session id and the like, also inside longer names
 * such as access_token or clientSecret), HAR entries naming such a header, and
 * private-key blocks. Quoted keys, URL-encoded separators and JSON escaped
 * once or more are included. Surrounding text is kept so error messages stay
 * actionable.
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
const SCHEME = String.raw`(?:bearer|basic|digest|negotiate|ntlm|aws4-hmac-sha256|oauth|dpop)`;

/** A value folded onto an indented next line; never a stack frame ("    at …"), and past the whole indent. */
const FOLD = String.raw`(?:\r?\n[ \t]+(?![ \t]|at\s))`;

/** A quote written as an HTML entity: &quot;, &#34;, &#x22;, &apos;, &#39; or &#x27;. */
const ENTITY_QUOTE = String.raw`(?:&quot;|&apos;|&#0*3[49];|&#x0*2[27];)`;

/**
 * A quote around a key or value: plain or escaped up to 15 times (JSON escaped four times), URL-encoded once or twice
 * (%22, %27, %2522, %2527), or as an HTML entity (BACKLOG 102-27).
 */
const QUOTE = String.raw`(?:\\{0,15}["']|%(?:25)?2[27]|${ENTITY_QUOTE})`;

/**
 * What may stand between a key and its value: the key's closing quote and a closing bracket (`headers['x-api-key']`),
 * then `:`, `=`, `=>` or their URL encodings %3A and %3D (once or twice encoded), with blanks or %20 around them.
 */
const SEPARATOR = String.raw`${QUOTE}?\]?[ \t]*(?:=>|[=:]|%(?:25)?3[ad])(?:[ \t]|%(?:25)?20)*`;

/**
 * HAR's `{"name":"…","value":"…"}` after a name: its closing quote, a comma, then the value key quoted or not (util.inspect
 * of a CDP cookie prints `{ name: 'sessionid', value: '…' }`), across a line break when pretty-printed.
 */
const HAR_VALUE_KEY = String.raw`${QUOTE}[ \t]*,(?:[ \t]|\r?\n)*${QUOTE}?value${QUOTE}?[ \t]*:[ \t]*(?=${QUOTE})`;

/**
 * A value opened by a quote escaped twice or more (2 to 15 backslashes: JSON escaped twice or three times, or util.inspect
 * of an escaped JSON string, which doubles the backslashes and leaves the quote bare), up to the same run of backslashes
 * and quote, not itself escaped, at the end of a value; with none on its line, to the end of the line. `group` is the
 * number of its capturing group, which the close refers back to.
 */
function deepEscapedRun(group: number): string {
  return String.raw`(\\{2,15}["'])(?:[^\r\n]*?(?=(?<!\\)` + `\\${group}` + String.raw`[ \t]*(?:[,}\]]|\\+[nrt]|\r?\n|$))|[^\r\n]*)`;
}

/**
 * A quoted value of any of the forms above, groups numbered from `first`: an escaped JSON string (double or single
 * quote), one escaped deeper, a plain double- or single-quoted string.
 */
function quotedValue(first: number): string {
  return String.raw`${escapedRun('"')}|${escapedRun("'")}|${deepEscapedRun(first + 2)}|(")(?:[^"\\\r\n]|\\.)*|(')(?:[^'\\\r\n]|\\.)*`;
}

/**
 * A value that is only null, true, false or undefined, left as it is so a JSON dump stays whole: the word, then a closing
 * bracket, a line end or the end, or a `,` or `;` before a blank, a quote, a bracket or the end, so `null,hunter2` is a
 * value and not a literal.
 */
const LITERAL = String.raw`(?:null|true|false|undefined)[ \t]*(?:[)\]}]|[,;](?=[\s"'\\{[]|$)|\r?\n|$)`;

/**
 * A whole Authorization value, scheme and credentials (BACKLOG 102-02): masking only the first word left
 * "Authorization: *** abc", and a multi-part value (Digest, AWS4-HMAC-SHA256, OAuth 1.0) kept everything after its
 * first ", ". A quoted value runs to its own unescaped closing quote, so quotes and escapes inside it stay masked. In
 * an escaped JSON string the closing quote is the \" that ends the JSON value (see escapedRun), so a ', an inner \\\"
 * (a quote escaped twice) or a \\/ does not end it. An unquoted value runs to the end of
 * the line, and onto a folded next line only when its line holds just the scheme. It follows:
 * - `:`, `=` or `=>` or their URL encodings, after a key quoted or not (JSON, Python, util.inspect, a Map, JSON escaped
 *   once or more), with a fold before the value;
 * - a name-value pair with a scheme next, `['Authorization', 'Basic …']`, so a list of header names keeps its next
 *   name; and HAR's `{"name":"Authorization","value":"…"}` whatever the value;
 * - a known scheme after a space alone.
 * A value that is only null, true, false or undefined is left as it is, so a JSON dump stays whole; one that merely
 * starts with such a word, as from a template with an undefined scheme, is masked. The key may sit inside a longer name
 * (HTTP_AUTHORIZATION, proxyAuthorization, authorizationHeader, BACKLOG 102-27), and a Cookie or Set-Cookie header,
 * whose value is a list of credentials, goes whole the same way.
 */
const AUTHORIZATION = new RegExp(String.raw`(authorization[\w-]{0,32}|cookie[\w-]{0,32})(` +
  String.raw`${SEPARATOR}${FOLD}?(?=\S)` +
  String.raw`|${HAR_VALUE_KEY}|${QUOTE}[ \t]*,(?:[ \t]|\r?\n)*(?=${QUOTE}${SCHEME}\b)` +
  String.raw`|[ \t]+(?=${SCHEME}\b)` +
  String.raw`)(?:${quotedValue(3)}` +
  String.raw`|(?!${LITERAL})(?:${SCHEME}[ \t]*${FOLD})?[^\r\n]+)`, "gi");

/**
 * A value opened by an escaped quote, up to the one that closes it: a run of 4k + 1 backslashes (one escaping the quote,
 * the rest pairs of escaped backslashes) then the quote, followed by the end of a JSON value (`,`, `}`, `]`, an escaped
 * \n, \r or \t of pretty-printed JSON, or the end of the line). With no such quote on its line the value runs to the end
 * of the line, keeping its opening quote.
 */
function escapedRun(quote: string): string {
  return String.raw`(\\${quote})(?:[^\r\n]*?(?=(?<!\\)(?:\\\\\\\\)*\\${quote}[ \t]*(?:[,}\]]|\\[nrt]|\r?\n|$))|[^\r\n]*)`;
}

/**
 * A word that makes a name a secret's (BACKLOG 102-27), anywhere in it: access_token, csrftoken, clientSecret, passwd,
 * x-api-key, sessionid_sign, TradingView's device_t. A bare "session" is not one: here it is a trading session
 * (`session: "regular"`), so only a session id or key is, which also masks a trading-session id under such a name. "auth"
 * stands alone (Node's `auth: 'user:pass'`) or after basic, proxy or http, not as the start of author or authorization.
 */
const SECRET_WORD = String.raw`(?:token|secret|passw(?:or)?d|passphrase|credential|jwt|api[_-]?key|access[_-]?key|private[_-]?key` +
  String.raw`|session[_-]?(?:id|key)|device_t|(?:basic|proxy|http)[_-]?auth|(?<![a-z0-9])auth(?![a-z]))`;

/**
 * The value of a key whose name holds a secret word, after a separator (see SEPARATOR) or as HAR's
 * `{"name":"access_token","value":"…"}`, past its opening quote (plain, escaped, encoded or an entity) and an
 * Authorization scheme, Token or ApiKey before it (`X-Auth: Bearer …`), which goes with it. The value itself is what the
 * bearer rule masks, `[\w.~+/-]+=*`: it never crosses the punctuation that ends a value in a list, JSON or a URL, so it
 * cannot run into a next key and leave that key's value in clear, which the wider values tried in the 102-27 reviews did
 * (see BACKLOG). A value holding `%`, `:` or a blank keeps what follows them, as under the bearer rule.
 */
const KEYED = new RegExp(String.raw`(${SECRET_WORD}[\w-]{0,32})((?:${SEPARATOR}${FOLD}?|${HAR_VALUE_KEY})${QUOTE}?)` +
  String.raw`(?!${LITERAL})(?:(?:${SCHEME}|token|api[_-]?key):?(?:[ \t]+|[ \t]*${FOLD}))?[\w.~+/-]+=*`, "gi");

/** HAR with the value before the name: `{"value":"…","name":"Cookie"}`. */
const HAR_VALUE_FIRST = new RegExp(String.raw`("value"[ \t]*:[ \t]*")(?:[^"\\\r\n]|\\.)*` +
  String.raw`(?="[ \t]*,[ \t]*"name"[ \t]*:[ \t]*"[^"\\\r\n]{0,64}?(?:authorization|cookie|${SECRET_WORD}))`, "gi");

/**
 * A private key (PEM or PGP), which spans lines: its body goes and its armour lines stay. One cut before its END line goes
 * to the end of the text, which also keeps the search for an END line to one pass however many BEGIN lines there are.
 */
const PRIVATE_KEY_BLOCK = new RegExp(String.raw`(-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY(?: BLOCK)?-----)` +
  String.raw`(?:[\s\S]*?(-----END [A-Z0-9 ]{0,40}PRIVATE KEY(?: BLOCK)?-----)|[\s\S]*)`, "g");

/**
 * A masked block that a cut left without its whole END line, which the second pass of a cut result keeps as it is; a
 * first pass masks it like any other block, so text that merely looks masked keeps nothing.
 */
const CUT_PRIVATE_KEY = /^\n\*\*\*(?:\n(?:-{1,5}(?:E|EN|END(?: [A-Z0-9 ]{0,40}-{0,5})?)?)?)?$/;

/**
 * Bearer, token and API-key values after a separator, a space, or a fold onto an indented next line. A value that is
 * only null, true, false or undefined is left as it is (BACKLOG 102-27).
 */
const GENERIC = new RegExp(String.raw`\b(bearer|token|api[_-]?key)` +
  String.raw`(\\?["']?[ \t]*(?:=>|[=:])[ \t]*${FOLD}?\\?["']?|[ \t]+|[ \t]*${FOLD})(?!${LITERAL})[\w.~+/-]+=*`, "gi");

/** What a keyed rule leaves: the name, the separator, the value's opening quote if any, then the mask. */
const maskValue = (_: string, name: string, separator: string, ...openings: unknown[]) =>
  `${name}${separator}${openings.slice(0, 5).find((opening) => typeof opening === "string") ?? ""}***`;

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
    redacted = redactAll(truncated ? text.slice(0, -TRUNCATED.length) : text, truncated);
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

function redactAll(text: string, cut: boolean): string {
  return text
    .replace(PRIVATE_KEY_BLOCK, (block: string, begin: string, end?: string) =>
      (cut && end === undefined && CUT_PRIVATE_KEY.test(block.slice(begin.length))
        ? block
        : `${begin}\n***${end === undefined ? "" : `\n${end}`}`))
    .replace(/([a-z][\w+.-]{0,64}:\/\/)[^\s/@]+@/gi, "$1***@")
    // Before the query rule, which stops at a space and so would leave "?***" and the credential behind it.
    .replace(AUTHORIZATION, maskValue)
    .replace(HAR_VALUE_FIRST, "$1***")
    // The query is optional so that a URL without one is consumed whole: requiring it made every later "x://" in the
    // body rescan the rest of the message, which took 5 s on 200 KB of "x://" (code review of 102-02).
    .replace(/([a-z][\w+.-]{0,64}:\/\/[^\s?"'<>()[\]]+)(\?[^\s"'<>()[\]]*)?/gi,
      (match: string, url: string, query: string | undefined) => (query === undefined ? match : `${url}?***`))
    // After the query rule, as the bearer rule: a value that is a URL would otherwise lose its scheme to the mask and the
    // URL its query mask (102-27 reviews).
    .replace(KEYED, "$1$2***")
    .replace(GENERIC, "$1$2***");
}
