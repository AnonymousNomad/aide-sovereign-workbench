function currentOrigin(): string {
  const location = (globalThis as { location?: { href: string } }).location;
  return location ? location.href : 'http://localhost/';
}

export function isLocalUrl(url: string): boolean {
  try {
    const parsed = new URL(url, currentOrigin());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === new URL(currentOrigin()).hostname;
  } catch {
    return false;
  }
}

export function egressFetch(url: string, init?: RequestInit): Promise<Response> {
  if (!isLocalUrl(url)) {
    return Promise.reject(new Error(`offline guard: refusing non-local fetch to ${url}`));
  }
  return fetch(url, init);
}

