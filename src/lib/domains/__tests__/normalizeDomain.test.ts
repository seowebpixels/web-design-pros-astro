import { describe, it, expect } from 'vitest';
import { normalizeDomainInput } from '../normalizeDomain';

describe('normalizeDomainInput', () => {
  it('returns null for empty/whitespace-only input', () => {
    expect(normalizeDomainInput('')).toBeNull();
    expect(normalizeDomainInput('   ')).toBeNull();
  });

  it('returns null for non-string input', () => {
    // @ts-expect-error deliberately testing runtime guard against bad input
    expect(normalizeDomainInput(null)).toBeNull();
    // @ts-expect-error deliberately testing runtime guard against bad input
    expect(normalizeDomainInput(undefined)).toBeNull();
  });

  it('lowercases input', () => {
    expect(normalizeDomainInput('EXAMPLE.CO.ZA')).toBe('example.co.za');
  });

  it('passes through a bare domain unchanged (aside from case)', () => {
    expect(normalizeDomainInput('example.co.za')).toBe('example.co.za');
  });

  it('strips a genuine URL scheme', () => {
    expect(normalizeDomainInput('https://example.co.za')).toBe('example.co.za');
    expect(normalizeDomainInput('http://example.co.za/')).toBe('example.co.za');
  });

  it('strips a leading www. label', () => {
    expect(normalizeDomainInput('www.example.co.za')).toBe('example.co.za');
  });

  it('strips path, query and fragment noise from a pasted URL', () => {
    expect(normalizeDomainInput('example.co.za/some/path?query=1')).toBe('example.co.za');
    expect(normalizeDomainInput('https://example.co.za/some/path?query=1#frag')).toBe(
      'example.co.za',
    );
  });

  describe('trailing dot handling', () => {
    it('strips exactly one trailing dot (FQDN notation)', () => {
      expect(normalizeDomainInput('google.com.')).toBe('google.com');
    });

    it('leaves two or more trailing dots untouched (caught later as invalid)', () => {
      expect(normalizeDomainInput('google.com..')).toBe('google.com..');
      expect(normalizeDomainInput('google.com...')).toBe('google.com...');
    });
  });

  describe('port handling', () => {
    it('strips a port when a genuine URL scheme was present', () => {
      expect(normalizeDomainInput('https://google.com:443/')).toBe('google.com');
      expect(normalizeDomainInput('https://google.com:8080/test')).toBe('google.com');
    });

    it('does NOT strip a port from bare domain:port input with no scheme', () => {
      // Left intact deliberately so validateDomain rejects the leftover
      // colon, rather than silently treating it as a legitimate port.
      expect(normalizeDomainInput('google.com:443')).toBe('google.com:443');
    });
  });

  describe('userinfo/authority smuggling passes through untouched for validateDomain to reject', () => {
    it('does not strip or otherwise "fix" an @ userinfo attempt', () => {
      expect(normalizeDomainInput('https://user:pass@google.com/')).toBe('user:pass@google.com');
      expect(normalizeDomainInput('https://evil.com@google.com/')).toBe('evil.com@google.com');
    });
  });

  it('handles combined noise (case, scheme, www, path, port) together', () => {
    expect(normalizeDomainInput('HTTPS://WWW.EXAMPLE.CO.ZA:8080/path?x=1')).toBe(
      'example.co.za',
    );
  });
});
