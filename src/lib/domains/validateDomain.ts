/**
 * Structural validation for a normalised domain candidate.
 *
 * Deliberately does NOT add a new dependency for IDNA/punycode handling.
 * Instead it leverages the platform's native, spec-compliant WHATWG URL
 * parser (available in both Node.js and the Cloudflare Workers runtime)
 * to perform safe ASCII/punycode conversion of internationalised domains
 * as a side effect of parsing. If the URL parser cannot make sense of the
 * input at all, it is rejected as malformed rather than partially handled.
 */

export type DomainValidationReason =
  | 'empty'
  | 'control_characters'
  | 'authority_syntax'
  | 'malformed'
  | 'ip_address'
  | 'too_long'
  | 'invalid_label'
  | 'invalid_tld';

export interface DomainValidationResult {
  valid: boolean;
  /** Canonical ASCII/punycode hostname — only present when valid is true. */
  hostname?: string;
  reason?: DomainValidationReason;
}

const MAX_DOMAIN_LENGTH = 253;

// A DNS label: 1–63 chars, alphanumeric, hyphens allowed only in the middle
// (never leading or trailing). This also rejects empty labels, which arise
// from consecutive dots after splitting on ".".
const LABEL_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

// TLD must be alphabetic (2+ chars) or a punycode ACE-prefixed label
// ("xn--..."). Purely numeric or malformed TLDs are rejected.
const TLD_PATTERN = /^([a-z]{2,63}|xn--[a-z0-9]{1,59})$/;

const IPV4_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/;

export function validateDomain(input: string): DomainValidationResult {
  if (!input || input.length === 0) {
    return { valid: false, reason: 'empty' };
  }

  // Reject whitespace and control characters before attempting to parse —
  // the URL parser can be lenient about some of these in ways we don't want.
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001F\u007F]/.test(input)) {
    return { valid: false, reason: 'control_characters' };
  }

  // Reject authority/userinfo syntax BEFORE any URL parsing takes place.
  // We validate by wrapping the candidate in a throwaway "http://" URL
  // below so the native parser can do safe IDNA/punycode conversion for
  // us — but that same parser treats an "@" as a userinfo delimiter, so
  // "evil.example@google.com" would otherwise silently resolve to
  // hostname "google.com", letting an attacker smuggle a domain past
  // validation. Backslash is rejected too, defensively — it is never a
  // legal hostname character and different URL-parser implementations
  // are not fully consistent in how they treat it, so we don't rely on
  // this parser's specific behaviour for it.
  if (input.includes('@') || input.includes('\\')) {
    return { valid: false, reason: 'authority_syntax' };
  }

  let hostname: string;
  try {
    // Wrapping in a throwaway http:// URL gives us the platform's built-in,
    // safe IDNA/punycode host conversion for free, with no new dependency.
    const parsed = new URL(`http://${input}/`);
    hostname = parsed.hostname;
  } catch {
    return { valid: false, reason: 'malformed' };
  }

  if (!hostname) {
    return { valid: false, reason: 'malformed' };
  }

  // Reject IPv4 literals and bracketed IPv6 literals — these are not domain
  // names and must never be sent to a registry RDAP endpoint.
  if (IPV4_PATTERN.test(hostname) || hostname.startsWith('[')) {
    return { valid: false, reason: 'ip_address' };
  }

  if (hostname.length > MAX_DOMAIN_LENGTH) {
    return { valid: false, reason: 'too_long' };
  }

  const labels = hostname.split('.');

  // A registrable domain needs at least a second-level label plus a TLD.
  if (labels.length < 2) {
    return { valid: false, reason: 'malformed' };
  }

  for (const label of labels) {
    if (!LABEL_PATTERN.test(label)) {
      return { valid: false, reason: 'invalid_label' };
    }
  }

  const tld = labels[labels.length - 1];
  if (!TLD_PATTERN.test(tld)) {
    return { valid: false, reason: 'invalid_tld' };
  }

  return { valid: true, hostname };
}
