import { describe, expect, it } from 'vitest';
import type { Cast, User } from '@opencaster/client-core/api';
import { reconcilePublications, updatePublications, type CastPublication } from './pendingCasts';

const author = { fid: 10, username: 'alice' } as User;
const hash = 'a'.repeat(40);
const publication = (overrides: Partial<CastPublication> = {}): CastPublication => ({ id: 'attempt-1', sessionKey: 'device-1', author, text: 'Hello', images: [], timestamp: '2026-10-26T12:00:00Z', status: 'publishing', ...overrides });
const cast = (overrides: Partial<Cast> = {}): Cast => ({ author, hash, text: 'Hello', ...overrides } as Cast);

describe('in-memory cast publications', () => {
  it('adds an attempt once and settles only the existing publishing record', () => {
    const started = publication();
    const current = updatePublications([], { type: 'started', publication: started });
    expect(current).toEqual([started]);
    expect(updatePublications(current, { type: 'started', publication: publication({ text: 'Duplicate' }) })).toBe(current);
    const submitted = updatePublications(current, { type: 'submitted', id: started.id, hash: `0x${hash.toUpperCase()}` });
    expect(submitted[0]).toMatchObject({ status: 'submitted', hash });
    expect(current[0].status).toBe('publishing');
    expect(updatePublications(submitted, { type: 'failed', id: started.id })).toBe(submitted);
    expect(updatePublications([], { type: 'submitted', id: started.id, hash })).toEqual([]);
    expect(updatePublications([], { type: 'unknown', id: started.id })).toEqual([]);
  });

  it('retains separate attempts and preserves their content after unknown or failed submission', () => {
    const first = publication({ parent: { fid: 20, hash }, images: ['https://opencaster.org/media/image'] });
    const second = publication({ id: 'attempt-2', sessionKey: 'device-2', text: 'Different attempt' });
    let current = updatePublications([first], { type: 'started', publication: second });
    current = updatePublications(current, { type: 'unknown', id: first.id });
    current = updatePublications(current, { type: 'failed', id: second.id });
    expect(current).toEqual([{ ...second, status: 'failed' }, { ...first, status: 'unknown' }]);
    expect(first.status).toBe('publishing');
  });

  it('reconciles only full canonical hash and author matches, without duplicate cards', () => {
    const pending = publication({ status: 'submitted', hash: `0X${hash.toUpperCase()}` });
    const current = [pending];
    expect(reconcilePublications(current, [cast({ author: { ...author, fid: 11 } })])).toBe(current);
    expect(reconcilePublications(current, [cast({ hash: hash.slice(0, 8) })])).toBe(current);
    expect(reconcilePublications(current, [cast({ hash: 'b'.repeat(40) })])).toBe(current);
    expect(reconcilePublications(current, [cast(), cast({ hash: `0x${hash}` })])).toEqual([]);
    expect(current).toEqual([pending]);
  });

  it('keeps publishing, failed and unidentifiable attempts even if the same text is visible', () => {
    const current = [publication({ hash }), publication({ id: 'failed', status: 'failed', hash }), publication({ id: 'unknown', status: 'unknown' }), publication({ id: 'invalid', status: 'submitted', hash: 'not-a-hash' })];
    expect(reconcilePublications(current, [cast()])).toBe(current);
    const unknown = publication({ status: 'unknown', hash });
    expect(reconcilePublications([unknown], [cast()])).toEqual([]);
  });
});
