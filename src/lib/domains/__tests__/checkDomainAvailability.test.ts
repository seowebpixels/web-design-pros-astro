import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  classifyRdapHttpResponse,
  queryRdapServer,
  getTopLevelLabel,
} from '../checkDomainAvailability';

describe('getTopLevelLabel', () => {
  it('returns only the final label, not a registrable domain', () => {
    expect(getTopLevelLabel('example.co.za')).toBe('za');
    expect(getTopLevelLabel('example.com')).toBe('com');
  });
});

describe('classifyRdapHttpResponse — 200 responses', () => {
  it('classifies a valid RDAP domain object (objectClassName) as taken', () => {
    const body = { objectClassName: 'domain', ldhName: 'example.com' };
    expect(classifyRdapHttpResponse(200, body, false)).toBe('taken');
  });

  it('classifies a valid RDAP domain object (ldhName + rdapConformance) as taken', () => {
    const body = { ldhName: 'example.com', rdapConformance: ['rdap_level_0'] };
    expect(classifyRdapHttpResponse(200, body, false)).toBe('taken');
  });

  it('classifies malformed/non-RDAP 200 bodies as unknown', () => {
    expect(classifyRdapHttpResponse(200, { foo: 'bar' }, false)).toBe('unknown');
    expect(classifyRdapHttpResponse(200, null, false)).toBe('unknown');
    expect(classifyRdapHttpResponse(200, [1, 2, 3], false)).toBe('unknown');
    expect(classifyRdapHttpResponse(200, 'not an object', false)).toBe('unknown');
  });

  it('classifies an unparseable 200 body as unknown', () => {
    expect(classifyRdapHttpResponse(200, undefined, true)).toBe('unknown');
  });
});

describe('classifyRdapHttpResponse — 404 responses', () => {
  it('classifies a valid RDAP not-found error object as available', () => {
    expect(classifyRdapHttpResponse(404, { errorCode: 404 }, false)).toBe('available');
  });

  it('classifies an HTML 404 (unparseable body) as unknown', () => {
    expect(classifyRdapHttpResponse(404, undefined, true)).toBe('unknown');
  });

  it('classifies an empty-body 404 as unknown', () => {
    expect(classifyRdapHttpResponse(404, undefined, true)).toBe('unknown');
  });

  it('classifies unrelated JSON on a 404 as unknown', () => {
    expect(classifyRdapHttpResponse(404, { foo: 'bar' }, false)).toBe('unknown');
  });

  it('classifies a mismatched error code on a 404 as unknown', () => {
    expect(classifyRdapHttpResponse(404, { errorCode: 500 }, false)).toBe('unknown');
  });
});

describe('classifyRdapHttpResponse — other statuses always unknown', () => {
  it.each([429, 401, 403, 500, 502, 503])('status %d is always unknown', (status) => {
    expect(classifyRdapHttpResponse(status, { objectClassName: 'domain' }, false)).toBe(
      'unknown',
    );
  });
});

describe('queryRdapServer — network-level failure handling', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns unknown on a thrown network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down'));
    const result = await queryRdapServer('https://rdap.example/', 'example.com');
    expect(result).toBe('unknown');
  });

  it('returns unknown on an aborted/timed-out request', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new DOMException('The operation was aborted.', 'AbortError'));
    const result = await queryRdapServer('https://rdap.example/', 'example.com');
    expect(result).toBe('unknown');
  });

  it('classifies a genuine 200 RDAP domain object end-to-end as taken', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ objectClassName: 'domain' }), { status: 200 }),
    );
    const result = await queryRdapServer('https://rdap.example/', 'example.com');
    expect(result).toBe('taken');
  });

  it('classifies a genuine RDAP 404 error object end-to-end as available', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ errorCode: 404 }), { status: 404 }));
    const result = await queryRdapServer('https://rdap.example/', 'example.com');
    expect(result).toBe('available');
  });

  it('classifies an HTML 404 end-to-end as unknown', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response('<html>Not Found</html>', { status: 404 }));
    const result = await queryRdapServer('https://rdap.example/', 'example.com');
    expect(result).toBe('unknown');
  });

  it('classifies a 429 end-to-end as unknown', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('', { status: 429 }));
    const result = await queryRdapServer('https://rdap.example/', 'example.com');
    expect(result).toBe('unknown');
  });
});
