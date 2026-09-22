// functions/api/domain-check.ts

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
      headers: { Accept: 'application/rdap+json' },
    }, 8000);
    if (res.status === 404) return 'available';
    if (res.status === 200) return 'taken';
    return 'unknown';
  } catch (err) {
    return 'unknown';
  }
}

async function queryWhoisJSON(domain: string, apiKey: string): Promise<'available' | 'taken' | 'unknown'> {
  if (!apiKey) return 'unknown';
  try {
    const url = `https://whoisjson.com/api/v1/whois?domain=${encodeURIComponent(domain)}`;
    const res = await fetchWithTimeout(url, {
      headers: { 
        'Authorization': `Token ${apiKey}`,
        'Accept': 'application/json' 
      },
    }, 8000);

    if (!res.ok) return 'unknown';
    const data = await res.json() as { registered?: boolean };
    if (typeof data.registered === 'boolean') {
      return data.registered ? 'taken' : 'available';
    }
    return 'unknown';
  } catch (err) {
    return 'unknown';
  }
}

export const onRequestGet: PagesFunction<{ WHOISJSON_API_KEY: string }> = async (context) => {
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

  if (cleanDomain.endsWith('.za')) {
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
      headers: { 'Content-Type': 'application/json' },
    }
  );
};