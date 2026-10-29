const IPV4_LOOPBACK =
  /^127\.(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){2}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;

// Takes a URL-style hostname (IPv6 keeps its brackets, as in `new URL(x).hostname`).
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'localhost' || host === '[::1]' || IPV4_LOOPBACK.test(host);
}

// A URL must be https, or http on a loopback host: plain http only where the traffic cannot leave the machine.
export function isSecureOrLoopbackUrl(url: string | URL): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === 'https:' ||
    (parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname))
  );
}
