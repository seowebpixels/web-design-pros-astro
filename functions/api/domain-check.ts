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

interface PagesFunctionContext {
  request: Request;
  env: {
    WHOISJSON_API_KEY?: string;
  };
}

function jsonResponse(body: DomainCheckResponse, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  });
}

export async function onRequestGet({ request, env }: PagesFunctionContext): Promise<Response> {
  // Top-level debug log to confirm function entry
  console.log('--> Incoming domain-check request received!');

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
    return jsonResponse(
      { success: false, domain: null, status: 'unknown', error: 'invalid_domain' },
      400,
    );
  }

  try {
    const apiKey = env.WHOISJSON_API_KEY || '';
    console.log(`--> Executing lookup for ${validation.hostname} (Key length: ${apiKey.length})`);
    
    const result = await checkDomainAvailability(validation.hostname, apiKey);
    return jsonResponse({ success: true, domain: result.domain, status: result.status }, 200);
  } catch (error) {
    console.error('DEBUG: Domain check execution failed:', error);
    return jsonResponse({ success: true, domain: validation.hostname, status: 'unknown' }, 200);
  }
}