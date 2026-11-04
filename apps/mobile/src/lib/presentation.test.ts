import { describe, expect, it } from 'vitest';
import { postTime, socialCount } from './presentation';

describe('timeline labels', () => {
  const now = Date.parse('2026-11-04T12:00:00Z');
  it('uses compact relative dates and rejects invalid timestamps', () => {
    expect(postTime('2026-11-04T11:59:59Z', now)).toBe('now');
    expect(postTime('2026-11-04T11:55:00Z', now)).toBe('5m');
    expect(postTime('2026-11-04T09:00:00Z', now)).toBe('3h');
    expect(postTime('2026-11-02T12:00:00Z', now)).toBe('2d');
    expect(postTime('invalid', now)).toBeNull();
    expect(postTime('2026-11-05T12:00:00Z', now)).not.toContain('-');
  });
  it('keeps invalid counts off the timeline and abbreviates large counts', () => {
    expect(socialCount(NaN)).toBe('');
    expect(socialCount(-1)).toBe('');
    expect(socialCount(0)).toBe('');
    expect(socialCount(42)).toBe('42');
    expect(socialCount(1200)).toBe(new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(1200));
  });
});
