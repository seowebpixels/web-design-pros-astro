/**
 * GET /api/domain-check?domain=<input>
 *
 * This is a native Cloudflare Pages Function (file-based routing under
 * /functions), NOT an Astro API route. The WDP site is a fully static
 * Astro build with no server adapter — this file is Cloudflare's own
 * mechanism for serving a single dynamic endpoint alongside an otherwise
 * static Pages deployment, and is built/bundled entirely independently
 * of Astro. It must not be duplicated as (or replaced by) an Astro route
 * under src/pages/api/ — that configuration requires an SSR adapter,
 * which this project deliberately does not use.
 *
 * Public domain availability endpoint. Accepts a raw, possibly messy user
 * input string, normalises and validates it (rejecting subdomains, bare
 * domain:port syntax, malformed trailing dots, userinfo/authority
 * smuggling, etc.), resolves the trusted RDAP server via the IANA
 * bootstrap, performs the lookup, and returns a small normalised result.
 *
 * This is a lookup-only endpoint. It does not register, reserve, or
 * interact with any registrar, cart, order, or payment system.
 */

import { normalizeDomainInput } from '../../src/lib/domains/normalizeDomain';
import { validateDomain } from '../../src/lib/domains/validateDomain';
import { checkDomainAvailability } from '../../src/lib/domains/checkDomainAvailability';
import type { DomainCheckResponse } from '../../src/lib/domains/types';

/**
 * Minimal local shape of the Cloudflare Pages Functions context. Kept
 * local rather than pulling in `@cloudflare/workers-types` — this
 * function only ever touches `request`, and the project otherwise has no
 * other Cloudflare-specific type dependency to justify adding one.
 */
interface PagesFunctionContext {
  request: Request;
}

function jsonResponse(body: DomainCheckResponse, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      // This is a live availability check, never a cacheable resource —
      // a cached response could show a later visitor stale information,
      // including a stale 'available'.
      'cache-control': 'no-store',
    },
  });
}

export async function onRequestGet({ request }: PagesFunctionContext): Promise<Response> {
  const url = new URL(request.url);
  const rawDomain = url.searchParams.get('domain');

  if (!rawDomain) {
    return jsonResponse(
      { success: false, domain: null, status: 'unknown', error: 'missing_domain' },
      400,
    );
  }

  const normalized = normalizeDomainInput(rawDomain);
  if (!normalized) {
    return jsonResponse(
      { success: false, domain: null, status: 'unknown', error: 'invalid_domain' },
      400,
    );
  }

  const validation = validateDomain(normalized);
  if (!validation.valid || !validation.hostname) {
    if (validation.reason === 'subdomain_not_registrable') {
      return jsonResponse(
        { success: false, domain: null, status: 'unknown', error: 'subdomain_not_registrable' },
        400,
      );
    }
    return jsonResponse(
      { success: false, domain: null, status: 'unknown', error: 'invalid_domain' },
      400,
    );
  }

  try {
    const result = await checkDomainAvailability(validation.hostname);
    return jsonResponse({ success: true, domain: result.domain, status: result.status }, 200);
  } catch {
    // Any unexpected internal failure must never be reported as available.
    // We still return 200 here (not 500) — the frontend should not need
    // to distinguish "upstream uncertain" from "our own code hiccupped";
    // both are just 'unknown'. Internal exception details are never
    // exposed to the client.
    return jsonResponse({ success: true, domain: validation.hostname, status: 'unknown' }, 200);
  }
}

// Cloudflare Pages Functions call `onRequestGet` for every GET request to
// this route, and fall back to this generic `onRequest` for every OTHER
// HTTP method (that is the documented precedence — a more specific
// `onRequestVERB` always wins for its verb). So this handler is only ever
// reached for non-GET requests, and can unconditionally return 405.
export async function onRequest(): Promise<Response> {
  return new Response(
    JSON.stringify({
      success: false,
      domain: null,
      status: 'unknown',
      error: 'method_not_allowed',
    }),
    {
      status: 405,
      headers: { 'content-type': 'application/json', allow: 'GET', 'cache-control': 'no-store' },
    },
  );
}
