import { afterEach, describe, expect, it, vi } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex } from '@opencaster/protocol/signedKeyRequest';
import { createMediaUploadGrant, isMediaOrigin, MAX_MEDIA_BYTES, MEDIA_UPLOAD_HEADER, sha256Hex, uploadMedia, type MediaUploadInput } from './media';
import { isUploadedMediaUrl } from './appOrigins';

const BASE = 'https://opencaster.org';
const bytes = new Uint8Array([137,80,78,71]);
const file = () => new File([new Uint8Array(bytes).buffer], 'public-image.png', { type: 'image/png' });
const key = new Uint8Array(32).fill(32);
const identity = { fid: 1234, publicKey: bytesToHex(ed25519.getPublicKey(key)) };
const authorize = (input: MediaUploadInput) => createMediaUploadGrant(input, identity, async payload => ed25519.sign(payload, key));
afterEach(() => vi.unstubAllGlobals());

describe('the browser media upload boundary', () => {
  it('retains exact historical media URLs and origin labels without treating lookalikes as trusted', async () => {
    for (const origin of [BASE, 'https://quorum.arca.computer', 'https://hypersnap-quorum.lf-e32.workers.dev']) {
      expect(isMediaOrigin(origin)).toBe(true);
      expect((await authorize({ origin, sha256: 'ab'.repeat(32), size: bytes.length, contentType: 'image/png' })).origin).toBe(origin);
    }
    for (const origin of [BASE, 'https://quorum.arca.computer']) expect(isUploadedMediaUrl(`${origin}/media/${'ab'.repeat(32)}`)).toBe(true);
    for (const value of ['https://opencaster.org.evil.test', 'https://user@opencaster.org', 'https://opencaster.org:443', 'null', undefined]) expect(isMediaOrigin(value)).toBe(false);
    for (const value of [`https://opencaster.org/media/${'ab'.repeat(32)}?token=private`, `https://quorum.arca.computer.evil.test/media/${'ab'.repeat(32)}`, `https://hypersnap-quorum.lf-e32.workers.dev/media/${'ab'.repeat(32)}`]) expect(isUploadedMediaUrl(value)).toBe(false);
  });

  it('sends one signed binary request with no credentials and accepts only its exact content-addressed link', async () => {
    vi.stubGlobal('location', { origin: BASE });
    const expected = `${BASE}/media/${await sha256Hex(bytes)}`;
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ url: expected })));
    vi.stubGlobal('fetch', fetch);
    expect(await uploadMedia(file(), authorize)).toEqual({ url: expected });
    expect(fetch).toHaveBeenCalledOnce();
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('/media/upload');
    expect(options).toMatchObject({ method: 'POST', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
    expect(new Uint8Array(options.body)).toEqual(bytes);
    expect(JSON.parse(options.headers[MEDIA_UPLOAD_HEADER])).toMatchObject({ origin: BASE, fid: 1234, size: bytes.length, contentType: 'image/png' });
  });

  it('rejects unsupported files, oversized files and unknown website origins before authorization', async () => {
    vi.stubGlobal('location', { origin: BASE });
    const sign = vi.fn(authorize);
    for (const bad of [new File(['<svg/>'], 'image.svg', { type: 'image/svg+xml' }), new File([], 'empty.png', { type: 'image/png' }), new File([new ArrayBuffer(MAX_MEDIA_BYTES + 1)], 'large.png', { type: 'image/png' })]) {
      await expect(uploadMedia(bad, sign)).rejects.toThrow('5 MiB');
    }
    vi.stubGlobal('location', { origin: 'https://attacker.example' });
    await expect(uploadMedia(file(), sign)).rejects.toThrow('opencaster.org');
    expect(sign).not.toHaveBeenCalled();
  });

  it('does not sign or upload a cancelled selection', async () => {
    vi.stubGlobal('location', { origin: BASE });
    const controller = new AbortController(); controller.abort();
    const sign = vi.fn(authorize);
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(uploadMedia(file(), sign, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(sign).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a changed authorization instead of uploading different content', async () => {
    vi.stubGlobal('location', { origin: BASE });
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(uploadMedia(file(), async input => ({ ...await authorize(input), sha256: 'f'.repeat(64) }))).rejects.toThrow('does not match');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not retry an uncertain upload or display an arbitrary server error', async () => {
    vi.stubGlobal('location', { origin: BASE });
    const fetch = vi.fn().mockRejectedValueOnce(new Error('Untrusted network text')).mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Untrusted server text' }), { status: 403 }));
    vi.stubGlobal('fetch', fetch);
    const failure = await uploadMedia(file(), authorize).catch((error: unknown) => error);
    expect(failure).toMatchObject({ message: 'The upload status could not be confirmed. Check your attachment before trying again.' });
    expect(failure).not.toHaveProperty('cause'); expect(String(failure)).not.toContain('Untrusted network text');
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(uploadMedia(file(), authorize)).rejects.toThrow('This device is not authorized');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('refuses external, malformed and unrelated image links in the response', async () => {
    vi.stubGlobal('location', { origin: BASE });
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    for (const url of ['https://attacker.example/image.png', `${BASE}/media/${'f'.repeat(64)}`, `https://quorum.arca.computer/media/${await sha256Hex(bytes)}`, 'javascript:alert(1)']) {
      fetch.mockResolvedValueOnce(new Response(JSON.stringify({ url })));
      await expect(uploadMedia(file(), authorize)).rejects.toThrow('invalid image link');
    }
  });
});
