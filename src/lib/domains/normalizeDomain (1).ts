/**
 * Normalises raw user input into a best-effort domain candidate string.
 *
 * This function is intentionally conservative: it only strips well-understood
 * wrapping (protocol, path/query/fragment, port, leading "www.", trailing
 * dot) and never attempts to "fix" or guess at malformed input. Structural
 * validity (label rules, TLD shape, IDNA conversion, registrability) is
 * handled separately by validateDomain.ts — this function's only job is to
 * recover the likely intended hostname from common paste patterns such as:
 *
 *   "example.co.za"
 *   "EXAMPLE.CO.ZA"
 *   "https://example.co.za"
 *   "http://example.co.za/"
 *   "www.example.co.za"
 *   "example.co.za/some/path?query=1"
 *   "https://example.co.za:8080/some/path"
 *
 * Returns null for empty/whitespace-only input. Anything else is passed
 * through for validateDomain.ts to accept or reject — this function does
 * not reject malformed domains itself, it only un-wraps common paste noise.
 *
 * IMPORTANT — port handling: a port is only ever stripped when the input
 * genuinely had a URL scheme (e.g. "https://example.co.za:8080/"). Bare
 * "example.co.za:8080" (no scheme) is NOT stripped here — its colon is
 * deliberately left in place so that validateDomain.ts rejects it outright,
 * rather than letting its own temporary URL-wrapping trick silently accept
 * an arbitrary bare "domain:port" string as if the port were legitimate.
 *
 * IMPORTANT — trailing dots: exactly one trailing dot (valid FQDN notation,
 * e.g. "example.co.za.") is stripped. Two or more trailing dots are left
 * untouched, so validateDomain.ts correctly rejects them (they produce an
 * empty final label).
 */
export function normalizeDomainInput(rawInput: string): string | null {
  if (typeof rawInput !== 'string') {
    return null;
  }

  let value = rawInput.trim();
  if (value.length === 0) {
    return null;
  }

  value = value.toLowerCase();

  // Strip a leading URL scheme if present (http://, https://, ftp://, etc.),
  // and remember whether one was actually there.
  const schemeMatch = /^[a-z][a-z0-9+.-]*:\/\//.exec(value);
  const hadScheme = schemeMatch !== null;
  if (schemeMatch) {
    value = value.slice(schemeMatch[0].length);
  }

  // Strip any path, query string or fragment left over from a pasted URL.
  const pathIndex = value.search(/[/?#]/);
  if (pathIndex !== -1) {
    value = value.slice(0, pathIndex);
  }

  // Strip a trailing port — but only when it was extracted from a genuine
  // URL (a real scheme was present). A bare "domain:port" with no scheme
  // is left as-is; validateDomain.ts rejects any leftover colon.
  if (hadScheme) {
    value = value.replace(/:\d+$/, '');
  }

  // Strip a single leading "www." label.
  value = value.replace(/^www\./, '');

  // Strip exactly one trailing dot (FQDN notation, "example.co.za.").
  // Two or more trailing dots are left in place — see docblock above.
  if (value.endsWith('.') && !value.endsWith('..')) {
    value = value.slice(0, -1);
  }

  value = value.trim();

  if (value.length === 0) {
    return null;
  }

  return value;
}
