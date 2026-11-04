import { describe, expect, it } from 'vitest';
import { createSupportDraft, MAX_SUPPORT_DETAILS, SUPPORT_EMAIL, supportTargetLabel, type SupportTarget } from './support';

describe('support email drafts', () => {
  it('includes only the selected public target and user-provided description', () => {
    const draft = createSupportDraft({ kind: 'post', fid: 42, hash: `0x${'AB'.repeat(20)}` }, '  Please review this post.  ');
    expect(draft.recipient).toBe(SUPPORT_EMAIL);
    expect(draft.subject).toBe('OpenCaster post report');
    expect(draft.body).toBe(`Post ${'ab'.repeat(20)}\nAuthor FID 42\n\nPlease review this post.`);
    expect(createSupportDraft({ kind: 'user', fid: 42 }, 'Impersonation').body).toBe('User FID 42\n\nImpersonation');
    expect(createSupportDraft({ kind: 'support' }, 'Cannot load feed').body).toBe('General support\n\nCannot load feed');
  });

  it('encodes Unicode and query/header-like text only as message content', () => {
    const details = '¡Hola! 👋\n&bcc=other@example.org?subject=changed#fragment\r\nCc: nobody@example.org';
    const draft = createSupportDraft({ kind: 'support' }, details);
    const url = new URL(draft.url);
    expect(url.protocol).toBe('mailto:');
    expect(url.pathname).toBe(SUPPORT_EMAIL);
    expect([...url.searchParams.keys()]).toEqual(['subject', 'body']);
    expect(url.searchParams.get('subject')).toBe(draft.subject);
    expect(url.searchParams.get('body')).toBe(draft.body);
    expect(url.hash).toBe('');
  });

  it('rejects invalid targets and blank, oversized or malformed text before handoff', () => {
    for (const fid of [0, -1, 1.2, NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => supportTargetLabel({ kind: 'user', fid })).toThrow('Invalid report FID');
    }
    expect(() => createSupportDraft({ kind: 'post', fid: 1, hash: 'bad&bcc=other@example.org' }, 'Report')).toThrow('Invalid report post');
    expect(() => supportTargetLabel({ kind: 'unknown', fid: 1 } as unknown as SupportTarget)).toThrow();
    for (const details of ['', '  ', 'a'.repeat(MAX_SUPPORT_DETAILS + 1), '\ud800']) {
      expect(() => createSupportDraft({ kind: 'support' }, details)).toThrow();
    }
    expect(createSupportDraft({ kind: 'support' }, 'a'.repeat(MAX_SUPPORT_DETAILS)).body).toContain('a'.repeat(MAX_SUPPORT_DETAILS));
  });
});
