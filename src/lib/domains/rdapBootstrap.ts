/**
 * IANA DNS RDAP bootstrap discovery.
 *
 * Resolves the trusted, authoritative RDAP base URL(s) for a given TLD using
 * the official IANA bootstrap registry (https://data.iana.org/rdap/dns.json).
 * This is the ONLY mechanism used to discover an RDAP server — the client
 * can never supply or influence which upstream URL is queried, which is the
 * core SSRF defence for this feature.
 *
 * Caching: a module-level, in-memory cache with a 24-hour TTL. The bootstrap
 * file changes infrequently, so a long TTL is appropriate. This cache is
 * OPPORTUNISTIC ONLY — Cloudflare Workers isolates are ephemeral and may be
 * recycled at any time, so this is a performance optimisation within a
 * single isolate's lifetime, never a correctness guarantee or persistent
 * store. No KV/D1 is used for this, per Phase 2 scope.
 */

const BOOTSTRAP_URL = 'https://data.iana.org/rdap/dns.json';
const BOOTSTRAP_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const BOOTSTRAP_FETCH_TIMEOUT_MS = 5000; // 5 seconds

interface BootstrapCacheEntry {
  map: Map<string, string[]>;
  fetchedAt: number;
}

// Raw shape of https://data.iana.org/rdap/dns.json — only the fields we use.
interface IanaBootstrapDocument {
  services?: unknown;
}

let cache: BootstrapCacheEntry | null = null;
let inFlight: Promise<BootstrapCacheEntry> | null = null;

async function fetchBootstrap(): Promise<BootstrapCacheEntry> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BOOTSTRAP_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(BOOTSTRAP_URL, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`IANA bootstrap responded with HTTP ${response.status}`);
    }

    const data = (await response.json()) as IanaBootstrapDocument;
    const map = new Map<string, string[]>();

    // Bootstrap "services" entries look like:
    //   [ ["za"], ["https://rdap.registry.example/"] ]
    // i.e. a list of [tlds[], rdapBaseUrls[]] pairs. Entries are keyed by
    // the actual TLD label only (e.g. "za", not "co.za") — the registry's
    // own RDAP server is responsible for resolving multi-label names
    // beneath it (e.g. example.co.za).
    if (Array.isArray(data.services)) {
      for (const entry of data.services) {
        if (!Array.isArray(entry) || entry.length < 2) continue;

        const [tlds, baseUrls] = entry as [unknown, unknown];
        if (!Array.isArray(tlds) || !Array.isArray(baseUrls)) continue;

        const httpsBaseUrls = baseUrls.filter(
          (u): u is string => typeof u === 'string' && u.startsWith('https://'),
        );
        if (httpsBaseUrls.length === 0) continue;

        for (const tld of tlds) {
          if (typeof tld === 'string' && tld.length > 0) {
            map.set(tld.toLowerCase(), httpsBaseUrls);
          }
        }
      }
    }

    return { map, fetchedAt: Date.now() };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Returns the trusted RDAP base URL(s) for the given TLD, or null if the
 * TLD has no known mapping in the bootstrap data (unsupported/unmapped TLD).
 * Never throws — bootstrap fetch failures resolve to a stale cache if one
 * exists, or null otherwise, so the caller can report "unknown" rather than
 * fail hard.
 */
export async function getRdapBaseUrlsForTld(tld: string): Promise<string[] | null> {
  const normalizedTld = tld.toLowerCase();
  const now = Date.now();

  if (cache && now - cache.fetchedAt < BOOTSTRAP_TTL_MS) {
    return cache.map.get(normalizedTld) ?? null;
  }

  // De-duplicate concurrent cold-start fetches within the same isolate.
  if (!inFlight) {
    inFlight = fetchBootstrap()
      .then((result) => {
        cache = result;
        return result;
      })
      .finally(() => {
        inFlight = null;
      });
  }

  try {
    const result = await inFlight;
    return result.map.get(normalizedTld) ?? null;
  } catch {
    // Fetch failed. Fall back to a stale cache rather than failing hard —
    // stale bootstrap data is still far more trustworthy than none, since
    // it changes infrequently. If there's no cache at all, the caller will
    // correctly report "unknown".
    if (cache) {
      return (cache as BootstrapCacheEntry).map.get(normalizedTld) ?? null;
    }
    return null;
  }
}
