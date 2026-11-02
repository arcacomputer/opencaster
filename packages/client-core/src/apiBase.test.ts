import { describe, expect, it } from 'vitest';
import { API_BASE as webBase } from './apiBase';
import { API_BASE as nativeBase } from './apiBase.native';

describe('platform API origins', () => {
  it('preserves the browser same-origin gateway', () => {
    expect(webBase).toBe('/api');
  });

  it('uses only the existing HTTPS gateway on native platforms', () => {
    expect(nativeBase).toBe('https://opencaster.org/api');
  });
});
