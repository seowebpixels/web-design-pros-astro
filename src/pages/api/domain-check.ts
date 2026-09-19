import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { checkDomainAvailability } from '../../lib/domains/checkDomainAvailability';
import { normalizeDomainInput } from '../../lib/domains/normalizeDomain';
import { validateDomain } from '../../lib/domains/validateDomain';
import type { DomainCheckResponse } from '../../lib/domains/types';

export const GET: APIRoute = async ({ request }) => {
  console.log('--> Incoming domain-check request received!');

  const url = new URL(request.url);
  const rawDomain = url.searchParams.get('domain');

  if (!rawDomain) {
    return new Response(
      JSON.stringify({ success: false, domain: null, status: 'unknown', error: 'missing_domain' }),
      { status: 400, headers: { 'content-type': 'application/json' } }
    );
  }

  const normalized = normalizeDomainInput(rawDomain);
  if (!normalized) {
    return new Response(
      JSON.stringify({ success: false, domain: null, status: 'unknown', error: 'invalid_domain' }),
      { status: 400, headers: { 'content-type': 'application/json' } }
    );
  }

  const validation = validateDomain(normalized);
  if (!validation.valid || !validation.hostname) {
    return new Response(
      JSON.stringify({ success: false, domain: null, status: 'unknown', error: 'invalid_domain' }),
      { status: 400, headers: { 'content-type': 'application/json' } }
    );
  }

  try {
    // Access environment variables directly from Cloudflare runtime or node process
    const apiKey = (env as any)?.WHOISJSON_API_KEY || process.env.WHOISJSON_API_KEY || '';

    console.log(`--> Executing lookup for ${validation.hostname} (Key length: ${apiKey.length})`);

    const result = await checkDomainAvailability(validation.hostname, apiKey);
    
    const responsePayload: DomainCheckResponse = {
      success: true,
      domain: result.domain,
      status: result.status,
    };

    return new Response(JSON.stringify(responsePayload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (error) {
    console.error('DEBUG: Domain check execution failed:', error);
    return new Response(
      JSON.stringify({ success: true, domain: validation.hostname, status: 'unknown' }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  }
};