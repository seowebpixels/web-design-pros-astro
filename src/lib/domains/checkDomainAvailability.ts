export interface DomainCheckResult {
  domain: string;
  status: 'available' | 'taken' | 'unknown';
  error?: string;
}

/**
  Fetch with a configurable timeout (defaults to 2000ms / 2s)
 */
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 2000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
  Standard RDAP Lookup with 2-second timeout
 */
async function queryRDAP(domain: string): Promise<'available' | 'taken' | 'unknown'> {
  try {
    const res = await fetchWithTimeout(`https://rdap.org/domain/${domain}`, {
      headers: { Accept: 'application/rdap+json' },
    }, 2000);

    if (res.status === 404) {
      return 'available';
    }

    if (res.status === 200) {
      return 'taken';
    }

    return 'unknown';
  } catch (err) {
    console.error(`[RDAP Error for ${domain}]:`, err);
    return 'unknown';
  }
}

/**
  WhoisJSON Lookup (Handles .za, .de, .fr, and RDAP fallbacks)
 */
async function queryWhoisJSON(domain: string, apiKey: string): Promise<'available' | 'taken' | 'unknown'> {
  if (!apiKey) {
    console.error('WhoisJSON API key is missing from environment variables.');
    return 'unknown';
  }

  try {
    const url = `https://whoisjson.com/api/v1/whois?domain=${encodeURIComponent(domain)}`;
    const res = await fetchWithTimeout(url, {
      headers: { Authorization: `Token ${apiKey}` }, // FIXED: Space separator instead of '='
    }, 2000);

    if (!res.ok) {
      console.error(`[WhoisJSON HTTP Error ${res.status} for ${domain}]`);
      return 'unknown';
    }

    const data = await res.json() as { registered?: boolean; status?: string };
    console.log(`[WhoisJSON Raw Output for ${domain}]:`, JSON.stringify(data, null, 2));

    if (typeof data.registered === 'boolean') {
      return data.registered ? 'taken' : 'available';
    }

    return 'unknown';
  } catch (err) {
    console.error(`[WhoisJSON Fetch Exception for ${domain}]:`, err);
    return 'unknown';
  }
}

/**
  Main Availability Checker
 */
export async function checkDomainAvailability(
  domain: string,
  apiKey?: string
): Promise<DomainCheckResult> {
  const cleanDomain = domain.toLowerCase().trim();

  // Rule 3: All .za domains go directly to WhoisJSON (skipping RDAP entirely)
  if (cleanDomain.endsWith('.za')) {
    const status = await queryWhoisJSON(cleanDomain, apiKey || '');
    return { domain: cleanDomain, status };
  }

  // Rule 1: Non-.za domains query RDAP directly
  let status = await queryRDAP(cleanDomain);

  // Rule 2: If RDAP returns UNKNOWN (or times out), failover to WhoisJSON
  if (status === 'unknown' && apiKey) {
    status = await queryWhoisJSON(cleanDomain, apiKey);
  }

  return { domain: cleanDomain, status };
}