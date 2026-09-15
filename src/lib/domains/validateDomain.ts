/**
 * Structural validation for a normalised domain candidate.
 *
 * Deliberately does NOT add a new dependency for IDNA/punycode handling.
 * Instead it leverages the platform's native, spec-compliant WHATWG URL
 * parser (available in both Node.js and the Cloudflare Workers runtime)
 * to perform safe ASCII/punycode conversion of internationalised domains
 * as a side effect of parsing. If the URL parser cannot make sense of the
 * input at all, it is rejected as malformed rather than partially handled.
 *
 * Registrability (public-suffix-aware) checking uses the maintained
 * `tldts` package, which ships a continuously-updated copy of the Public
 * Suffix List. This is the ONLY source of truth for "is this a
 * registrable domain or a subdomain of one" — no user-controlled input
 * is ever treated as suffix data, and no hardcoded per-TLD fallback
 * rules (e.g. ".co.za", ".de", ".io") are implemented here.
 */

import { parse as parseTld } from 'tldts';

export type DomainValidationReason =
  | 'empty'
  | 'control_characters'
  | 'authority_syntax'
  | 'malformed'
  | 'ip_address'
  | 'too_long'
  | 'invalid_label'
  | 'invalid_tld'
  | 'subdomain_not_registrable';

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

  // Reject authority/userinfo syntax, and any leftover colon, BEFORE any
  // URL parsing takes place. We validate by wrapping the candidate in a
  // throwaway "http://" URL below so the native parser can do safe
  // IDNA/punycode conversion for us — but that same parser treats an "@"
  // as a userinfo delimiter, so "evil.example@google.com" would otherwise
  // silently resolve to hostname "google.com", letting an attacker
  // smuggle a domain past validation. Backslash is rejected too,
  // defensively — it is never a legal hostname character and different
  // URL-parser implementations are not fully consistent in how they
  // treat it, so we don't rely on this parser's specific behaviour for
  // it.
  //
  // A colon is rejected here for the same reason: a *genuine* URL's port
  // (e.g. "https://google.com:443/") is already stripped by
  // normalizeDomainInput before this function ever sees it — but only
  // when the original input actually had a URL scheme. A bare
  // "google.com:443" typed directly has no scheme, so normalizeDomain
  // deliberately leaves its colon in place; if we let it reach the URL
  // wrapper below, the wrapper would parse ":443" as a valid port and
  // silently accept it. Rejecting any leftover colon here — before that
  // wrapping happens — is what keeps bare domain:port syntax invalid.
  // This also rejects bare (non-bracketed) IPv6-shaped input up front.
  if (input.includes('@') || input.includes('\\') || input.includes(':')) {
    return { valid: false, reason: 'authority_syntax' };
  }

  let hostname: string;
  try {
    // Wrapping in a throwaway http:// URL gives us the platform's built-in,
    // safe IDNA/punycode host conversion for free, with no new dependency.
    //
    // TODO(security — deferred, not solved): this converts internationalised
    // labels to ASCII/punycode, but does NOT defend against Unicode
    // confusable/homograph attacks — e.g. a Cyrillic "а" substituted for a
    // Latin "a" in something that visually reads as "google.com",
    // "apple.com", or "paypal.com" will still IDNA-convert and validate
    // successfully here. The same applies to invisible/zero-width
    // formatting characters, and to unexpected symbols that resemble
    // ASCII characters (e.g. a "degree sign" standing in for a letter).
    // A real fix needs an explicitly approved Unicode/confusable policy
    // (e.g. restricting to a single script per label, or a maintained
    // confusable-detection library) — that is out of scope for this pass
    // and must not be treated as already handled.
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

  // Public-suffix-aware registrability check. This is the ONLY place
  // that determines "domain vs. subdomain" — using the maintained PSL
  // data in `tldts`, never a hardcoded per-TLD rule. A subdomain of a
  // registrable domain (e.g. "shop.google.com", "foo.google.co.uk") is
  // not something a customer can independently register and must be
  // rejected outright, never silently rewritten to its parent domain.
  const suffixInfo = parseTld(hostname, { allowIcannDomains: true, allowPrivateDomains: false });

  if (suffixInfo.domain && suffixInfo.subdomain) {
    return { valid: false, reason: 'subdomain_not_registrable' };
  }

  // suffixInfo.domain === null means tldts/the Public Suffix List does not
  // recognise this TLD/suffix at all. That is NOT the same thing as "this
  // is a subdomain" — the earlier TLD_PATTERN check already confirmed the
  // input is syntactically TLD-shaped. Per policy, an unrecognised-but-
  // syntactically-valid TLD is not rejected here; it is allowed to flow
  // through as a valid, registrable-looking hostname, and
  // checkDomainAvailability's existing "no RDAP bootstrap mapping for
  // this TLD" fallback (which already defaults to 'unknown') is what
  // ultimately prevents it from ever being reported as 'available'.

  return { valid: true, hostname };
}
