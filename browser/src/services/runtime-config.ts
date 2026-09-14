export interface AideRuntimeConfig {
  facadeOrigin?: string;
}

declare global {
  var __AIDE_RUNTIME_CONFIG__: AideRuntimeConfig | undefined;
}

const DEFAULT_FACADE_ORIGIN = 'http://127.0.0.1:4777';

function configuredFacadeOrigin(): URL {
  const raw = globalThis.__AIDE_RUNTIME_CONFIG__?.facadeOrigin ?? DEFAULT_FACADE_ORIGIN;
  const url = new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`invalid facade protocol: ${url.protocol}`);
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') throw new Error(`facade must remain local: ${url.hostname}`);
  if (url.username || url.password || (url.pathname !== '/' && url.pathname !== '')) throw new Error('facade origin must not contain credentials or a path');
  return url;
}

function checkedPath(pathname: string): string {
  if (!pathname.startsWith('/') || pathname.startsWith('//')) throw new Error(`facade path must be root-relative: ${pathname}`);
  return pathname;
}

export function facadeHttpUrl(pathname: string): string {
  return new URL(checkedPath(pathname), configuredFacadeOrigin()).toString();
}

export function facadeWebSocketUrl(pathname: string): string {
  const url = new URL(checkedPath(pathname), configuredFacadeOrigin());
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}
