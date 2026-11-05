import { describe, expect, test } from 'bun:test';
import { isLoopbackHost, isSecureOrLoopbackUrl } from './url';

describe('isSecureOrLoopbackUrl', () => {
  test('accepts https on any host', () => {
    expect(isSecureOrLoopbackUrl('https://example.com/jwks')).toBe(true);
  });

  test('accepts http on loopback hosts', () => {
    for (const url of [
      'http://127.0.0.1:9000',
      'http://127.5.6.7:9000',
      'http://[::1]:9000',
      'http://localhost:9000',
      'http://LOCALHOST:9000',
    ])
      expect(isSecureOrLoopbackUrl(url)).toBe(true);
  });

  test('refuses http on non-loopback hosts', () => {
    for (const url of [
      'http://example.com',
      'http://128.0.0.1',
      'http://127.0.0.1.evil.com',
      'http://localhost.evil.com',
      'http://[::2]',
    ])
      expect(isSecureOrLoopbackUrl(url)).toBe(false);
  });

  test('refuses other protocols', () => {
    for (const url of [
      'ftp://127.0.0.1',
      'file:///etc/passwd',
      'javascript:alert(1)',
    ])
      expect(isSecureOrLoopbackUrl(url)).toBe(false);
  });

  test('refuses a string that is not an absolute URL', () => {
    expect(isSecureOrLoopbackUrl('not a url')).toBe(false);
    expect(isSecureOrLoopbackUrl('/relative/path')).toBe(false);
  });

  test('accepts a URL object', () => {
    expect(isSecureOrLoopbackUrl(new URL('https://example.com'))).toBe(true);
    expect(isSecureOrLoopbackUrl(new URL('http://example.com'))).toBe(false);
  });
});

describe('isLoopbackHost', () => {
  test('validates the IPv4 octets', () => {
    expect(isLoopbackHost('127.255.255.255')).toBe(true);
    expect(isLoopbackHost('127.0.0.256')).toBe(false);
    expect(isLoopbackHost('127.0.0.999')).toBe(false);
    expect(isLoopbackHost('1270.0.0.1')).toBe(false);
    expect(isLoopbackHost('127.0.0')).toBe(false);
  });
});
