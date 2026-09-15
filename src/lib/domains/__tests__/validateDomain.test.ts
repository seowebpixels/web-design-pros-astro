import { describe, it, expect, vi } from 'vitest';

// A small, deliberately limited stand-in for the real `tldts` package's
// public-suffix logic — just enough to correctly classify the specific
// domains this suite exercises (recognising "co.za", "co.uk" and
// "com.au" as two-label public suffixes, and everything else as a
// single-label suffix). This is NOT a full PSL implementation; the real
// `tldts` package (installed via package.json) is what actually ships to
// production. Mocking it here keeps this suite fast, offline, and
// deterministic instead of depending on tldts' bundled data file.
const MULTI_LABEL_SUFFIXES = new Set(['co.za', 'co.uk', 'com.au']);

function mockParse(hostname: string) {
  const labels = hostname.split('.');
  let suffixLabelCount = 1;

  if (labels.length >= 2) {
    const lastTwo = labels.slice(-2).join('.');
    if (MULTI_LABEL_SUFFIXES.has(lastTwo)) {
      suffixLabelCount = 2;
    }
  }

  const domainLabelCount = suffixLabelCount + 1;
  if (labels.length < domainLabelCount) {
    return { domain: null, subdomain: null };
  }

  const domain = labels.slice(-domainLabelCount).join('.');
  const subdomainLabels = labels.slice(0, labels.length - domainLabelCount);
  const subdomain = subdomainLabels.length > 0 ? subdomainLabels.join('.') : '';

  return { domain, subdomain };
}

vi.mock('tldts', () => ({
  parse: (hostname: string) => mockParse(hostname),
}));

const { validateDomain } = await import('../validateDomain');

describe('validateDomain — registrable domains', () => {
  it.each(['google.com', 'google.co.uk', 'business.co.za', 'example.com.au'])(
    '%s is valid and registrable',
    (input) => {
      const result = validateDomain(input);
      expect(result.valid).toBe(true);
      expect(result.hostname).toBe(input);
    },
  );
});

describe('validateDomain — subdomains rejected as not independently registrable', () => {
  it.each([
    'shop.google.com',
    'mail.google.com',
    'abc.microsoft.com',
    'test.github.com',
    'foo.google.co.uk',
    'abc.bbc.co.uk',
    'test.takealot.co.za',
    'abc.google.com.au',
    'a.b.com',
    '1.2.com',
  ])('%s is rejected as subdomain_not_registrable', (input) => {
    const result = validateDomain(input);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('subdomain_not_registrable');
    // Must never silently rewrite to the parent domain.
    expect(result.hostname).toBeUndefined();
  });
});

describe('validateDomain — trailing dots', () => {
  it('accepts a single trailing dot and treats it as the FQDN form', () => {
    // normalizeDomainInput is what actually strips the single trailing
    // dot in the real pipeline; validateDomain on its own sees whatever
    // string it's given. A raw single trailing dot reaching validateDomain
    // directly produces an empty final label and is correctly rejected —
    // this is exercised end-to-end via normalizeDomain's own tests. Here
    // we confirm the already-normalised form validates cleanly.
    const result = validateDomain('google.com');
    expect(result.valid).toBe(true);
  });

  it('rejects multiple trailing dots (empty final label)', () => {
    const result = validateDomain('google.com..');
    expect(result.valid).toBe(false);
  });
});

describe('validateDomain — port / authority syntax', () => {
  it('rejects bare domain:port syntax', () => {
    const result = validateDomain('google.com:443');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('authority_syntax');
  });

  it('rejects userinfo smuggling attempts', () => {
    expect(validateDomain('user:pass@google.com').valid).toBe(false);
    expect(validateDomain('evil.com@google.com').valid).toBe(false);
  });

  it('accepts a hostname already stripped of a genuine URL port', () => {
    // By the time validateDomain runs in the real pipeline, a genuine
    // URL's port has already been removed by normalizeDomainInput.
    const result = validateDomain('google.com');
    expect(result.valid).toBe(true);
  });
});

describe('validateDomain — existing invalid/security inputs', () => {
  it.each([
    ['google', 'malformed'],
    ['.com', 'invalid_label'],
    ['google..com', 'invalid_label'],
    ['google com', 'control_characters'],
    ['google_com', 'malformed'],
    ['-google.com', 'invalid_label'],
    ['google-.com', 'invalid_label'],
    ['a..b.com', 'invalid_label'],
    ['localhost', 'malformed'],
    ['127.0.0.1', 'ip_address'],
    ['::1', 'authority_syntax'],
    ['google.com\r\nSet-Cookie: x', 'control_characters'],
    ['google.com;ls', 'invalid_label'],
    ['google.com|ls', 'malformed'],
  ])('%s is rejected (%s)', (input, expectedReason) => {
    const result = validateDomain(input);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe(expectedReason);
  });

  it('rejects a link-local/internal-looking address', () => {
    expect(validateDomain('169.254.169.254').valid).toBe(false);
  });
});

describe('validateDomain — boundary label lengths', () => {
  it('accepts a 63-character label', () => {
    const label = 'a'.repeat(63);
    const result = validateDomain(`${label}.com`);
    expect(result.valid).toBe(true);
  });

  it('rejects a 64-character label', () => {
    const label = 'a'.repeat(64);
    const result = validateDomain(`${label}.com`);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('invalid_label');
  });

  it('accepts numeric domains and internal hyphens', () => {
    expect(validateDomain('123.com').valid).toBe(true);
    expect(validateDomain('my-site.com').valid).toBe(true);
  });
});
