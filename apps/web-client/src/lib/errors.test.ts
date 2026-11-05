import { describe, expect, it } from 'vitest';
import { ERROR_MESSAGE_LIMIT, errorMessage } from './errors';

describe('errorMessage', () => {
  it('returns the error message for Error instances', () => {
    expect(errorMessage(new Error('Node unavailable.'), 'Fallback.')).toBe('Node unavailable.');
  });

  it('bounds long error messages', () => {
    expect(errorMessage(new Error('x'.repeat(ERROR_MESSAGE_LIMIT + 50)), 'Fallback.')).toBe('x'.repeat(ERROR_MESSAGE_LIMIT));
  });

  it('accepts a wider bound for longer guidance', () => {
    const long = 'x'.repeat(ERROR_MESSAGE_LIMIT + 50);
    expect(errorMessage(new Error(long), 'Fallback.', Number.POSITIVE_INFINITY)).toBe(long);
  });

  it('returns the fallback for non-Error values', () => {
    expect(errorMessage('boom', 'Fallback.')).toBe('Fallback.');
    expect(errorMessage(undefined, 'Fallback.')).toBe('Fallback.');
  });
});
