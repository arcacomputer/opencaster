import { createRequire } from 'node:module';
import { afterEach, expect, it, vi } from 'vitest';
import { getFeed } from '@opencaster/client-core/api';

vi.mock('@opencaster/client-core/apiBase', () => import('@opencaster/client-core/apiBase.native'));

const require = createRequire(import.meta.url);
const nativeRequire = createRequire(require.resolve('react-native/package.json'));
const { Request: NativeRequest } = nativeRequire('whatwg-fetch') as { Request: typeof Request };

afterEach(() => vi.unstubAllGlobals());

it.each([undefined, 'opaque-cursor'])('preserves gateway queries through the native fetch polyfill (%s)', async cursor => {
  let request: Request | undefined;
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
    request = new NativeRequest(url, options);
    return new Response(JSON.stringify({ casts: [], next: { cursor: null } }));
  }));

  await getFeed({ kind: 'trending', timeWindow: '24h', limit: 20, cursor });

  const url = new URL(request!.url);
  expect(url.origin).toBe('https://opencaster.org');
  expect(url.pathname).toBe('/api/v2/farcaster/feed/trending');
  expect(Object.fromEntries(url.searchParams)).toEqual({ limit: '20', time_window: '24h', ...(cursor ? { cursor } : {}) });
  expect(request!.headers.get('Cache-Control')).toBe('no-cache');
});
