/**
 * Normalises raw user input into a best-effort domain candidate string.
 *
 * This function is intentionally conservative: it only strips well-understood
 * wrapping (protocol, path/query/fragment, port, leading "www.", trailing
 * dot) and never attempts to "fix" or guess at malformed input. Structural
 * validity (label rules, TLD shape, IDNA conversion) is handled separately
 * by validateDomain.ts — this function's only job is to recover the likely
 * intended hostname from common paste patterns such as:
 *
 *   "example.co.za"
 *   "EXAMPLE.CO.ZA"
 *   "https://example.co.za"
 *   "http://example.co.za/"
 *   "www.example.co.za"
 *   "example.co.za/some/path?query=1"
 *
 * Returns null for empty/whitespace-only input. Anything else is passed
 * through for validateDomain.ts to accept or reject — this function does
 * not reject malformed domains itself, it only un-wraps common paste noise.
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

  // Strip a leading URL scheme if present (http://, https://, ftp://, etc.)
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');

  // Strip any path, query string or fragment left over from a pasted URL.
  const pathIndex = value.search(/[/?#]/);
  if (pathIndex !== -1) {
    value = value.slice(0, pathIndex);
  }

  // Strip a trailing port if one was pasted (e.g. "example.co.za:8080").
  value = value.replace(/:\d+$/, '');

  // Strip a single leading "www." label.
  value = value.replace(/^www\./, '');

  // Strip trailing dot(s) — FQDN notation ("example.co.za.").
  value = value.replace(/\.+$/, '');

  value = value.trim();

  if (value.length === 0) {
    return null;
  }

  return value;
}
