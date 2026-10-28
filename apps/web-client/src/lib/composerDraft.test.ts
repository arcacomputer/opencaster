import { describe, expect, it } from 'vitest';
import { COMPOSER_DRAFT_KEY, DRAFT_TTL_MS, composerDraftScope, inlineMentionQuery, readComposerDraft, removeComposerDraft, saveComposerDraft } from './composerDraft';

const identity = { fid: 1234, publicKey: 'a'.repeat(64) };
function storage() { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } }; }
const content = { text: 'A private draft, not posted yet.', mentions: [{ fid: 42, username: 'alice' }], images: [`https://opencaster.org/media/${'b'.repeat(64)}`] };

describe('explicit local composer drafts', () => {
  it('round-trips canonical and historic uploaded image URLs without rewriting published content', () => {
    for (const origin of ['https://opencaster.org', 'https://quorum.arca.computer']) {
      const store = storage(); const scope = composerDraftScope(identity);
      const images = [`${origin}/media/${'b'.repeat(64)}`];
      saveComposerDraft(scope, { ...content, images }, store, 1000);
      expect(readComposerDraft(scope, store, 1000)?.images).toEqual(images);
    }
  });
  it('isolates accounts and exact destinations while allowing the same account to reconnect with a new device key', () => {
    const scopes = [composerDraftScope(identity), composerDraftScope({ ...identity, fid: 1235 }), composerDraftScope(identity, { parentUrl: 'https://example.com/one' }), composerDraftScope(identity, { parentUrl: 'https://example.com/two' }), composerDraftScope(identity, { parent: { fid: 42, hash: 'c'.repeat(40) } }), composerDraftScope(identity, { quote: { fid: 42, hash: 'c'.repeat(40) } })];
    expect(new Set(scopes).size).toBe(scopes.length);
    expect(composerDraftScope({ ...identity, publicKey: 'b'.repeat(64) })).toBe(scopes[0]);
    expect(composerDraftScope(identity, { parent: { fid: 42, hash: `0x${'C'.repeat(40)}` } })).toBe(scopes[4]);
    const store = storage(); saveComposerDraft(scopes[0], content, store, 1000);
    expect(readComposerDraft(scopes[1], store, 1000)).toBeUndefined(); expect(readComposerDraft(scopes[0], store, 1000)?.text).toBe(content.text);
  });
  it('serializes only allowed draft fields and never stores a whole session or arbitrary metadata', () => {
    const store = storage(); const scope = composerDraftScope(identity);
    saveComposerDraft(scope, { ...content, privateKey: 'never-store-this', session: { secret: true } } as typeof content, store, 1000);
    const encoded = store.getItem(COMPOSER_DRAFT_KEY)!;
    expect(encoded).not.toContain('never-store-this'); expect(encoded).not.toContain('secret');
    expect(readComposerDraft(scope, store, 1000)).toMatchObject(content);
  });
  it('expires saved content after 24 hours and rejects invalid local data without network access', () => {
    const store = storage(); const scope = composerDraftScope(identity); saveComposerDraft(scope, content, store, 1000);
    expect(readComposerDraft(scope, store, 1000 + DRAFT_TTL_MS)).toBeUndefined();
    store.setItem(COMPOSER_DRAFT_KEY, '{broken'); expect(() => readComposerDraft(scope, store)).toThrow('could not be read');
  });
  it('evicts the oldest drafts to keep both record count and total storage bounded', () => {
    const store = storage();
    for (let i = 0; i < 25; i++) saveComposerDraft(composerDraftScope({ ...identity, fid: i + 1 }), { text: '🙂'.repeat(4096), mentions: [], images: [] }, store, 1000 + i);
    const encoded = store.getItem(COMPOSER_DRAFT_KEY)!;
    expect(new TextEncoder().encode(encoded).length).toBeLessThanOrEqual(128 * 1024);
    expect(JSON.parse(encoded).length).toBeLessThanOrEqual(20);
    expect(readComposerDraft(composerDraftScope({ ...identity, fid: 1 }), store, 1025)).toBeUndefined();
    expect(readComposerDraft(composerDraftScope({ ...identity, fid: 25 }), store, 1025)).toBeDefined();
  });
  it('does not let an older posting receipt delete a newer saved revision', () => {
    const store = storage(); const scope = composerDraftScope(identity);
    const first = saveComposerDraft(scope, content, store, 1000); const second = saveComposerDraft(scope, { ...content, text: 'Newer text' }, store, 1001);
    removeComposerDraft(scope, first.id, store, 1002);
    expect(readComposerDraft(scope, store, 1002)?.id).toBe(second.id);
    removeComposerDraft(scope, second.id, store, 1002); expect(readComposerDraft(scope, store, 1002)).toBeUndefined();
  });
  it.each(['data:image/png;base64,abcd', 'javascript:alert(1)', 'https://other.example/picture.png', `https://quorum.arca.computer/media/${'b'.repeat(64)}?token=secret`])('refuses noncanonical uploaded image URL %s', url => {
    expect(() => saveComposerDraft(composerDraftScope(identity), { ...content, images: [url] }, storage(), 1000)).toThrow('cannot be saved');
  });
  it('recognizes only the active standalone mention token at the caret', () => {
    expect(inlineMentionQuery('Hello @ali', 10)).toEqual({ start: 6, end: 10, query: 'ali' });
    expect(inlineMentionQuery('mail@ali', 8)).toBeUndefined(); expect(inlineMentionQuery('https://example.com/@ali', 24)).toBeUndefined();
    expect(inlineMentionQuery('@alice', 3)).toBeUndefined(); expect(inlineMentionQuery('@', 1)).toBeUndefined();
  });
});
