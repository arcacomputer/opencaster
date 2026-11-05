import { describe, expect, it } from 'vitest';
import { isUploadedMediaLocation, isUploadedMediaUrl, MEDIA_PATH, mediaUrl } from './appOrigins';

const sha = 'ab'.repeat(32);

describe('the uploaded-media URL contract', () => {
  it('issues upload links on the canonical origin', () => {
    expect(mediaUrl(sha)).toBe(`https://opencaster.org/media/${sha}`);
    expect(isUploadedMediaUrl(mediaUrl(sha))).toBe(true);
  });

  it('accepts only exact content-addressed paths', () => {
    expect(MEDIA_PATH.test(`/media/${sha}`)).toBe(true);
    for (const path of ['/media/upload', `/media/${sha}/`, `/media/${'AB'.repeat(32)}`, `/media/${sha.slice(1)}`, `/x/media/${sha}`]) expect(MEDIA_PATH.test(path)).toBe(false);
  });

  it('matches stored URLs exactly on the current and legacy origins', () => {
    for (const origin of ['https://opencaster.org', 'https://quorum.arca.computer']) expect(isUploadedMediaUrl(`${origin}/media/${sha}`)).toBe(true);
    for (const value of [
      `HTTPS://OPENCASTER.ORG/media/${sha}`, `https://opencaster.org:443/media/${sha}`, `https://opencaster.org/media/${sha}#x`,
      `https://opencaster.org/media/${sha}?token=private`, `https://opencaster.org.evil.test/media/${sha}`, `http://opencaster.org/media/${sha}`,
      `https://hypersnap-quorum.lf-e32.workers.dev/media/${sha}`, 42,
    ]) expect(isUploadedMediaUrl(value)).toBe(false);
  });

  it('recognizes parsed media locations by origin and path', () => {
    expect(isUploadedMediaLocation(new URL(`https://quorum.arca.computer/media/${sha}`))).toBe(true);
    expect(isUploadedMediaLocation(new URL(`https://opencaster.org/media/${sha}?w=1`))).toBe(true);
    expect(isUploadedMediaLocation(new URL(`https://hypersnap-quorum.lf-e32.workers.dev/media/${sha}`))).toBe(false);
    expect(isUploadedMediaLocation(new URL(`https://opencaster.org/media/upload`))).toBe(false);
  });
});
