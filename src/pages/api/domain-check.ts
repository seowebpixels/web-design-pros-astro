import type { APIRoute } from 'astro';
import { checkDomainAvailability } from '../../lib/domains/checkDomainAvailability';
import { normalizeDomainInput } from '../../lib/domains/normalizeDomain';
import { validateDomain } from '../../lib/domains/validateDomain';
import type { DomainCheckResponse } from '../../lib/domains/types';

export const prerender = false;

export const GET: APIRoute = async ({ request, locals }) => {
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
    // Safely retrieve environment variable across Cloudflare Pages / Node / Astro environments
    const apiKey = 
      (locals as any)?.runtime?.env?.WHOISJSON_API_KEY || 
      import.meta.env.WHOISJSON_API_KEY || 
      (typeof process !== 'undefined' ? process.env?.WHOISJSON_API_KEY : '') || 
      '';

    const result = await checkDomainAvailability(validation.hostname, apiKey);
    
    const responsePayload: DomainCheckResponse = {
      success: true,
      domain: result.domain,
      status: result.status,
    };

    return new Response(JSON.stringify(responsePayload), {
      status: 200,
      headers: { 
        'content-type': 'application/json',
        'cache-control': 'public, max-age=60' // Cache responses for 60 seconds to prevent API rate-limiting
      },
    });
  } catch (error) {
    console.error('Domain check execution failed:', error);

    return new Response(
      JSON.stringify({ 
        success: false, 
        domain: validation.hostname, 
        status: 'unknown',
        error: 'server_error' 
      }),
      { 
        status: 500, 
        headers: { 'content-type': 'application/json' } 
      }
    );
  }
};