/**
 * Performs the RDAP lookup for a validated hostname and classifies the
 * result into WDP's three public states: 'available' | 'taken' | 'unknown'.
 *
 * CRITICAL RULE (must never be violated): an error, timeout, unsupported
 * TLD, rate limit, or any other uncertain condition must resolve to
 * 'unknown' — never 'available'. False negatives (telling a customer a
 * domain is unavailable/unknown when it was actually free) are an
 * acceptable cost; false positives (telling a customer a domain is
 * available when it is not, or when we simply couldn't check) are not.
 *
 * REMINDER: this result is informational only. It does not reserve or
 * register anything, and does not guarantee the domain will still be
 * available by the time WDP manually completes a registrar purchase.
 */

import { getRdapBaseUrlsForTld } from './rdapBootstrap';
import type { DomainAvailabilityResult, DomainAvailabilityStatus } from './types';

const RDAP_FETCH_TIMEOUT_MS = 5000; // 5 seconds per upstream RDAP request

// Short-lived cache of the final classified result, keyed by hostname.
// Deliberately short (60s) — availability is time-sensitive and must never
// be treated as a reservation. This only exists to absorb rapid repeated
// identical requests (e.g. accidental double-submits), not to serve stale
// answers. Opportunistic/isolate-lifetime only, same caveat as the
// bootstrap cache.
const RESULT_CACHE_TTL_MS = 60 * 1000;

// Hard cap on the result cache so a burst of many unique valid-looking
// domain lookups cannot grow the Map without bound. This is an in-memory
// performance cache only, never authoritative storage.
const MAX_RESULT_CACHE_ENTRIES = 750;

interface CachedResult {
  status: DomainAvailabilityStatus;
  cachedAt: number;
}

const resultCache = new Map<string, CachedResult>();

function getRegistrableTld(hostname: string): string {
  const labels = hostname.split('.');
  return labels[labels.length - 1];
}

/**
 * Records a result in the bounded cache. Because every entry shares the
 * same TTL and a Map iterates in insertion order, the oldest inserted
 * entry is always the next to expire — so a simple front-to-back walk is
 * sufficient to opportunistically prune expired entries, with no separate
 * expiry index needed. If the cache is still at capacity after pruning,
 * the single oldest remaining entry is evicted to make room.
 */
function setCachedResult(hostname: string, status: DomainAvailabilityStatus): void {
  const now = Date.now();

  for (const [key, entry] of resultCache) {
    if (now - entry.cachedAt >= RESULT_CACHE_TTL_MS) {
      resultCache.delete(key);
    } else {
      // Insertion-ordered Map: once a non-expired entry is reached, every
      // entry after it is non-expired too.
      break;
    }
  }

  // Delete-before-set on an existing key moves it to the end of insertion
  // order, keeping the invariant above correct even on the rare
  // near-simultaneous duplicate lookup.
  resultCache.delete(hostname);

  if (resultCache.size >= MAX_RESULT_CACHE_ENTRIES) {
    const oldestKey = resultCache.keys().next().value;
    if (oldestKey !== undefined) {
      resultCache.delete(oldestKey);
    }
  }

  resultCache.set(hostname, { status, cachedAt: now });
}

/**
 * Conservative check for whether a 200-status response body is plausibly a
 * genuine RDAP domain object, rather than HTML, an empty body, malformed
 * JSON, or unrelated JSON that happens to have parsed. This is NOT a full
 * RDAP schema validator — it only checks for the minimum characteristics
 * needed to reasonably distinguish a real domain response (RFC 9083) from
 * anything else that could have produced a 200.
 */
function looksLikeRdapDomainObject(body: unknown): boolean {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return false;
  }

  const record = body as Record<string, unknown>;

  const hasDomainObjectClass = record.objectClassName === 'domain';
  const hasLdhName = typeof record.ldhName === 'string' && record.ldhName.length > 0;
  const hasRdapConformance = Array.isArray(record.rdapConformance);

  // The explicit "objectClassName": "domain" marker is the strongest
  // signal and sufficient on its own. Failing that, require a domain-name
  // field alongside an RDAP conformance marker — enough to reasonably
  // rule out an unrelated JSON payload without a full schema check.
  return hasDomainObjectClass || (hasLdhName && hasRdapConformance);
}

async function queryRdapServer(baseUrl: string, hostname: string): Promise<DomainAvailabilityStatus> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RDAP_FETCH_TIMEOUT_MS);

  try {
    const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    // URL construction (not string concatenation) + encodeURIComponent on
    // the path segment, so a hostname can never be used to break out of the
    // intended RDAP path.
    const lookupUrl = new URL(`domain/${encodeURIComponent(hostname)}`, normalizedBase);

    const response = await fetch(lookupUrl.toString(), {
      signal: controller.signal,
      headers: { accept: 'application/rdap+json' },
    });

    if (response.status === 200) {
      // A 200 status alone is not proof of registration — the body must
      // plausibly be a real RDAP domain object. An upstream could return
      // HTML, an empty body, malformed JSON, or unrelated JSON on a 200.
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        // Not parseable as JSON at all (e.g. HTML, empty body, truncated
        // response) — cannot confidently establish "taken".
        return 'unknown';
      }

      return looksLikeRdapDomainObject(body) ? 'taken' : 'unknown';
    }

    if (response.status === 404) {
      // The registry's documented not-found response for this exact,
      // correctly-resolved RDAP endpoint.
      return 'available';
    }

    // 429, 401/403, 5xx, or any other unexpected status. Never inferred as
    // available.
    return 'unknown';
  } catch {
    // Network failure, DNS failure, or timeout/abort.
    return 'unknown';
  } finally {
    clearTimeout(timer);
  }
}

export async function checkDomainAvailability(hostname: string): Promise<DomainAvailabilityResult> {
  const cached = resultCache.get(hostname);
  if (cached && Date.now() - cached.cachedAt < RESULT_CACHE_TTL_MS) {
    return { domain: hostname, status: cached.status };
  }

  const tld = getRegistrableTld(hostname);
  const baseUrls = await getRdapBaseUrlsForTld(tld);

  let status: DomainAvailabilityStatus = 'unknown';

  if (baseUrls && baseUrls.length > 0) {
    // Try each documented base URL in order until one produces a confident
    // (non-'unknown') classification.
    for (const baseUrl of baseUrls) {
      const result = await queryRdapServer(baseUrl, hostname);
      if (result !== 'unknown') {
        status = result;
        break;
      }
    }
  }
  // No bootstrap mapping at all (unsupported/unmapped TLD) leaves status as
  // the 'unknown' default set above — never inferred as available.

  setCachedResult(hostname, status);
  return { domain: hostname, status };
}
