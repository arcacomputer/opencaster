// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cast, User } from '../lib/api';
import type { CastPublication } from '../lib/pendingCasts';
import PendingCastCard from './PendingCastCard';

const author = { fid: 10, username: 'alice', display_name: 'Alice' } as User;
const publication = (overrides: Partial<CastPublication> = {}): CastPublication => ({ id: 'attempt-1', sessionKey: 'device-1', author, text: 'Hello @bob https://example.com\n<script>still text</script>', images: [], timestamp: '2026-10-26T12:00:00Z', status: 'publishing', ...overrides });
let host: HTMLDivElement; let root: Root;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render(value: CastPublication, onDismiss = vi.fn()) { await act(async () => root.render(<PendingCastCard publication={value} onDismiss={onDismiss} />)); return onDismiss; }

describe('pending cast cards', () => {
  it('keeps original human text and announces each distinct submission status without social controls', async () => {
    for (const [status, message] of [['publishing', 'Publishing…'], ['submitted', 'Submitted · waiting to appear'], ['unknown', 'Submission status unknown. Check your profile before retrying.'], ['failed', 'Not submitted.']] as const) {
      const value = publication({ status }); await render(value);
      expect(host.querySelector('article[aria-label="Pending cast"]')).not.toBeNull();
      expect(host.querySelector('.cast__text')?.textContent).toBe(value.text);
      expect(host.querySelector('[role="status"][aria-live="polite"]')?.textContent).toBe(message);
      expect(host.querySelector('a,script,.cast__actions')).toBeNull();
      expect([...host.querySelectorAll('button')].map(button => button.getAttribute('aria-label'))).toEqual(['Hide pending cast']);
    }
  });

  it('hides only on explicit dismissal and prevents hiding the active submission', async () => {
    const onDismiss = await render(publication());
    expect(host.querySelector<HTMLButtonElement>('button')?.disabled).toBe(true);
    await render(publication({ status: 'unknown' }), onDismiss);
    expect(host.querySelector<HTMLButtonElement>('button')?.disabled).toBe(false);
    await act(async () => { host.querySelector<HTMLButtonElement>('button')!.click(); });
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('renders credential-free HTTPS previews only and never links an unconfirmed quote or parent', async () => {
    const quote = { author: { fid: 20, username: 'bob' }, text: 'Quoted text', hash: 'a'.repeat(40) } as Cast;
    await render(publication({ author: { ...author, pfp_url: 'https://user:secret@example.com/avatar' }, parent: { fid: 20, hash: quote.hash }, quote, images: ['javascript:alert(1)', 'data:image/png;base64,a', 'http://example.com/plain.png', 'https://user:secret@example.com/private.png', 'https://opencaster.org/media/safe', 'https://opencaster.org/media/extra'] }));
    expect([...host.querySelectorAll('img')].map(image => image.getAttribute('src'))).toEqual(['https://opencaster.org/media/safe']);
    expect(host.querySelector('img')?.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(host.textContent).toContain('Reply to FID 20');
    expect(host.querySelector('.pending-cast__quote')?.textContent).toContain('bobQuoted text');
    expect(host.querySelector('a')).toBeNull();
  });

  it('limits duplicated image previews and labels channel casts without exposing their URL', async () => {
    const image = 'https://opencaster.org/media/first';
    await render(publication({ parentUrl: 'https://example.com/channel/test', timestamp: 'invalid', images: [image, image, 'https://opencaster.org/media/second', 'https://opencaster.org/media/third'] }));
    expect(host.querySelectorAll('img')).toHaveLength(2);
    expect(host.textContent).toContain('Channel cast');
    expect(host.textContent).not.toContain('https://example.com/channel/test');
    expect(host.querySelector('time')).toBeNull();
  });
});
