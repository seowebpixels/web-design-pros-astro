/**
 * GET /api/domain-check?domain=<input>
 *
 * Public domain availability endpoint. Accepts a raw, possibly messy user
 * input string, normalises and validates it, resolves the trusted RDAP
 * server via the IANA bootstrap, performs the lookup, and returns a small
 * normalised result.
 *
 * This is a lookup-only endpoint. It does not register, reserve, or
 * interact with any registrar, cart, order, or payment system.
 *
 * This route opts out of prerendering — it is the only route in the project
 * that does. The rest of the site remains fully static/prerendered.
 */

import type { APIRoute } from 'astro';
import { normalizeDomainInput } from '../../lib/domains/normalizeDomain';
import { validateDomain } from '../../lib/domains/validateDomain';
import { checkDomainAvailability } from '../../lib/domains/checkDomainAvailability';
import type { DomainCheckResponse } from '../../lib/domains/types';

export const prerender = true;

function jsonResponse(body: DomainCheckResponse, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export const GET: APIRoute = async ({ url }) => {
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
    // We still return 200 here (not 500) per Phase 2's HTTP behaviour
    // guidance — the frontend should not need to distinguish "upstream
    // uncertain" from "our own code hiccupped"; both are just 'unknown'.
    return jsonResponse({ success: true, domain: validation.hostname, status: 'unknown' }, 200);
  }
};

// Any method other than GET gets a clean 405 rather than falling through to
// a default 404. No other HTTP verbs are meaningful for this endpoint.
export const ALL: APIRoute = async () => {
  return new Response(
    JSON.stringify({
      success: false,
      domain: null,
      status: 'unknown',
      error: 'method_not_allowed',
    }),
    { status: 405, headers: { 'content-type': 'application/json', allow: 'GET' } },
  );
};
