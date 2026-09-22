// functions/api/domain-check.ts

interface Env {
  WHOISJSON_API_KEY: string;
}

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function queryRDAP(domain: string): Promise<'available' | 'taken' | 'unknown'> {
  try {
    const res = await fetchWithTimeout(`https://rdap.org/domain/${domain}`, {
      headers: { 
        'Accept': 'application/rdap+json',
        'User-Agent': 'WebDesignPros-DomainChecker/1.0'
      },
    }, 8000);

    if (res.status === 404) return 'available';
    if (res.status === 200) return 'taken';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

async function queryWhoisJSON(domain: string, apiKey: string): Promise<'available' | 'taken' | 'unknown'> {
  if (!apiKey) return 'unknown';

  try {
    const url = `https://whoisjson.com/api/v1/whois?domain=${encodeURIComponent(domain)}`;
    
    const res = await fetchWithTimeout(url, {
      headers: { 
        'Authorization': `TOKEN=${apiKey}`,
        'Accept': 'application/json',
        'User-Agent': 'WebDesignPros-DomainChecker/1.0'
      },
    }, 8000);

    if (!res.ok) return 'unknown';

    const data = await res.json() as Record<string, any>;

    if (data.error || data.message || data.statusCode) {
      return 'unknown';
    }

    // 1. Direct boolean evaluation
    if (typeof data.registered === 'boolean') {
      return data.registered ? 'taken' : 'available';
    }

    // 2. Metadata field evaluation
    if (
      data.name || 
      data.domain_name || 
      data.registrar || 
      data.created_date || 
      (Array.isArray(data.nameserver) && data.nameserver.length > 0) ||
      (Array.isArray(data.nameservers) && data.nameservers.length > 0)
    ) {
      return 'taken';
    }

    // 3. Fallback string matching
    const rawString = JSON.stringify(data).toLowerCase();

    if (
      rawString.includes('domain name:') || 
      rawString.includes('"registered":true') || 
      rawString.includes('status: active') ||
      rawString.includes('registered')
    ) {
      return 'taken';
    }

    if (
      rawString.includes('no match') || 
      rawString.includes('not found') || 
      rawString.includes('"registered":false')
    ) {
      return 'available';
    }

    return 'unknown';
  } catch {
    return 'unknown';
  }
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const rawDomain = url.searchParams.get('domain');

  if (!rawDomain) {
    return new Response(JSON.stringify({ success: false, error: 'missing_domain' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const cleanDomain = rawDomain.toLowerCase().trim();
  const apiKey = context.env.WHOISJSON_API_KEY || '';

  let status: 'available' | 'taken' | 'unknown' = 'unknown';

  const isZaDomain = cleanDomain.endsWith('.za');

  if (isZaDomain) {
    status = await queryWhoisJSON(cleanDomain, apiKey);
  } else {
    status = await queryRDAP(cleanDomain);
    if (status === 'unknown' && apiKey) {
      status = await queryWhoisJSON(cleanDomain, apiKey);
    }
  }

  return new Response(
    JSON.stringify({
      success: true,
      domain: cleanDomain,
      status: status,
    }),
    {
      status: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      },
    }
  );
};