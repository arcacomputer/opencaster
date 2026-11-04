import { describe, expect, it } from 'vitest';
import { API_BASE as webBase, API_REQUEST_OPTIONS as webOptions } from './apiBase';
import { API_BASE as nativeBase, API_REQUEST_OPTIONS as nativeOptions } from './apiBase.native';

describe('platform API origins', () => {
  it('preserves the browser same-origin gateway', () => {
    expect(webBase).toBe('/api');
    expect(webOptions.cache).toBe('no-store');
  });

  it('uses only the existing HTTPS gateway on native platforms', () => {
    expect(nativeBase).toBe('https://opencaster.org/api');
    expect(nativeOptions.cache).toBeUndefined();
    expect(nativeOptions.headers).toEqual({ 'Cache-Control': 'no-cache' });
  });
});
