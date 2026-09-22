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

  let debugInfo: any = {};
  let status: 'available' | 'taken' | 'unknown' = 'unknown';

  const isZaDomain = cleanDomain.endsWith('.za');

  if (isZaDomain) {
    try {
      const url = `https://whoisjson.com/api/v1/whois?domain=${encodeURIComponent(cleanDomain)}`;
      const res = await fetchWithTimeout(url, {
        headers: { 
          'Authorization': `TOKEN=${apiKey}`,
          'Accept': 'application/json',
          'User-Agent': 'WebDesignPros-DomainChecker/1.0'
        },
      }, 8000);

      const data = await res.json() as Record<string, any>;
      debugInfo = { httpStatus: res.status, data };

      if (typeof data.registered === 'boolean') {
        status = data.registered ? 'taken' : 'available';
      }
    } catch (err: any) {
      debugInfo = { error: err.message || String(err) };
    }
  } else {
    status = await queryRDAP(cleanDomain);
  }

  return new Response(
    JSON.stringify({
      success: true,
      domain: cleanDomain,
      status: status,
      debug: debugInfo
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