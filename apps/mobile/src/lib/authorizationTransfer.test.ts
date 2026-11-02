import { describe, expect, beforeEach, it, vi } from 'vitest';
import type { PairingRequest } from '@opencaster/client-core/pairing';
import { APP_ORIGIN } from '@opencaster/client-core/appOrigins';
import { FARCASTER_EPOCH_SECONDS, PAIRING_SCOPES, PAIRING_TTL_SECONDS, PAIRING_WINDOW_SECONDS } from '@opencaster/client-core/pairing';

const mocks = vi.hoisted(() => ({
  files: [] as Array<{
    uri: string;
    content: string;
    exists: boolean;
    deleted: boolean;
    infoSize: number | null;
    textCalls: number;
    text: () => Promise<string>;
  }>,
  importInfoSize: 0,
  importText: '',
  picker: vi.fn(),
  share: vi.fn(),
}));

vi.mock('expo-document-picker', () => ({ getDocumentAsync: mocks.picker }));
vi.mock('expo-sharing', () => ({ shareAsync: mocks.share }));
vi.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'file:///app/cache/' } },
  File: class {
    uri: string;
    content = '';
    exists = false;
    deleted = false;
    infoSize = 0;
    textCalls = 0;

    constructor(...parts: Array<string | { uri: string }>) {
      this.uri = parts.length === 2 && typeof parts[0] !== 'string'
        ? `${parts[0].uri}${parts[1]}`
        : String(parts[0]);
      if (this.uri !== 'file:///app/cache/' && !this.uri.includes('opencaster-')) {
        this.exists = true;
        this.infoSize = mocks.importInfoSize;
        this.content = mocks.importText;
      }
      mocks.files.push(this);
    }

    create(): void {
      this.exists = true;
    }

    write(value: string): void {
      this.content = value;
      this.exists = true;
    }

    info(): { size: number | null } {
      return { size: this.infoSize };
    }

    text(): Promise<string> {
      this.textCalls++;
      return Promise.resolve(this.content);
    }

    delete(): void {
      this.deleted = true;
      this.exists = false;
    }
  },
}));

import { importAuthorizationApproval, shareAuthorizationRequest } from './authorizationTransfer';

const NOW = 1_793_600_000_000;
const request: PairingRequest = {
  kind: 'arca.hypersnap.signer.request',
  version: 1,
  origin: APP_ORIGIN,
  requestId: '11'.repeat(32),
  createdAt: NOW / 1000,
  fid: 1234,
  custodyAddress: `0x${'22'.repeat(20)}`,
  publicKey: '33'.repeat(32),
  scopes: [...PAIRING_SCOPES],
  ttl: PAIRING_TTL_SECONDS,
  nonce: 7,
  deadline: NOW / 1000 - FARCASTER_EPOCH_SECONDS + PAIRING_WINDOW_SECONDS,
};

describe('public authorization transfer files', () => {
  beforeEach(() => {
    mocks.files.length = 0;
    mocks.importInfoSize = 0;
    mocks.importText = '';
    mocks.picker.mockReset();
    mocks.share.mockReset();
    mocks.share.mockResolvedValue(undefined);
  });

  it('validates and shares only the public request, then deletes the cache file', async () => {
    await shareAuthorizationRequest(request, NOW);

    expect(mocks.share).toHaveBeenCalledTimes(1);
    const file = mocks.files[0];
    expect(file.uri).toContain(request.requestId);
    expect(file.deleted).toBe(true);
    expect(JSON.parse(file.content)).toEqual(request);
    expect(file.content).not.toContain('seed');
  });

  it('rejects protected records instead of exporting their seed', async () => {
    await expect(shareAuthorizationRequest({ ...request, seed: '44'.repeat(32) }, NOW)).rejects.toThrow(/invalid or expired/);
    expect(mocks.share).not.toHaveBeenCalled();
  });

  it('treats picker cancellation as a no-op', async () => {
    mocks.picker.mockResolvedValue({ canceled: true, assets: null });

    await expect(importAuthorizationApproval()).resolves.toBeNull();
    expect(mocks.files).toHaveLength(0);
  });

  it('rejects oversized metadata without reading and removes the copied cache file', async () => {
    mocks.picker.mockResolvedValue({
      canceled: false,
      assets: [{ name: 'approval.json', size: 16_385, uri: 'file:///app/cache/approval.json' }],
    });

    await expect(importAuthorizationApproval()).rejects.toThrow(/16 KiB/);
    expect(mocks.files).toHaveLength(1);
    expect(mocks.files[0].textCalls).toBe(0);
    expect(mocks.files[0].deleted).toBe(true);
  });

  it('checks actual UTF-8 bytes and cleans up a cache copy', async () => {
    mocks.importText = 'é'.repeat(8_193);
    mocks.importInfoSize = 8_193;
    mocks.picker.mockResolvedValue({
      canceled: false,
      assets: [{ name: 'approval.json', size: 8_193, uri: 'file:///app/cache/approval.json' }],
    });

    await expect(importAuthorizationApproval()).rejects.toThrow(/16 KiB/);
    expect(mocks.files[0].deleted).toBe(true);
  });

  it('does not delete or read a document outside the app cache', async () => {
    mocks.picker.mockResolvedValue({
      canceled: false,
      assets: [{ name: 'approval.json', size: 10, uri: 'content://external/approval.json' }],
    });

    await expect(importAuthorizationApproval()).rejects.toThrow(/copied into app storage/);
    expect(mocks.files).toHaveLength(0);
  });

  it('rejects cache URIs that escape the app cache directory', async () => {
    mocks.picker.mockResolvedValue({
      canceled: false,
      assets: [{ name: 'approval.json', size: 10, uri: 'file:///app/cache/../outside.json' }],
    });

    await expect(importAuthorizationApproval()).rejects.toThrow(/copied into app storage/);
    expect(mocks.files).toHaveLength(0);
  });

  it('returns bounded public text and removes the copied cache file', async () => {
    mocks.importText = '{"kind":"arca.hypersnap.signer.approval"}';
    mocks.importInfoSize = new TextEncoder().encode(mocks.importText).byteLength;
    mocks.picker.mockResolvedValue({
      canceled: false,
      assets: [{ name: 'approval.json', size: mocks.importInfoSize, uri: 'file:///app/cache/approval.json' }],
    });

    await expect(importAuthorizationApproval()).resolves.toBe(mocks.importText);
    expect(mocks.files[0].deleted).toBe(true);
  });
});
