import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalContent, MAX_LOCAL_CONTENT_BYTES } from './localContent';

type FileMock = {
  uri: string;
  exists: boolean;
  info: ReturnType<typeof vi.fn>;
  text: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
};

const state = vi.hoisted(() => ({
  files: [] as FileMock[],
  exists: false,
  size: undefined as number | undefined,
  contents: '',
}));

const secureStore = vi.hoisted(() => ({
  deleteItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
}));

vi.mock('expo-secure-store', () => secureStore);
vi.mock('expo-file-system', () => ({
  Paths: { document: { uri: 'file:///app/document/' }, cache: { uri: 'file:///app/cache/' } },
  File: class {
    uri: string;
    exists: boolean;
    info = vi.fn(() => ({ size: state.size }));
    text = vi.fn(async () => state.contents);
    create = vi.fn(() => {
      this.exists = true;
      state.exists = true;
    });
    write = vi.fn((value: string) => {
      state.contents = value;
      this.exists = true;
      state.exists = true;
    });

    constructor(directory: { uri: string }, name: string) {
      this.uri = `${directory.uri}${name}`;
      this.exists = state.exists;
      state.files.push(this);
    }
  },
}));

import { createLocalContentStorage } from './localContentStorage';

describe('local content file storage', () => {
  beforeEach(() => {
    state.files.length = 0;
    state.exists = false;
    state.size = undefined;
    state.contents = '';
    secureStore.deleteItemAsync.mockReset();
    secureStore.getItemAsync.mockReset();
    secureStore.setItemAsync.mockReset();
  });

  it('loads missing preferences as an empty filter set', async () => {
    const localContent = new LocalContent(createLocalContentStorage());

    await localContent.load();

    expect(localContent.getSnapshot()).toMatchObject({
      phase: 'ready',
      data: { version: 1, users: [], casts: [] },
    });
    expect(state.files[0]?.text).not.toHaveBeenCalled();
  });

  it('rejects oversized file metadata before reading text', async () => {
    state.exists = true;
    state.size = MAX_LOCAL_CONTENT_BYTES + 1;
    const storage = createLocalContentStorage();

    await expect(storage.read()).rejects.toThrow('Invalid saved filter size.');

    const file = state.files[0]!;
    expect(file.info).toHaveBeenCalledTimes(1);
    expect(file.text).not.toHaveBeenCalled();
  });

  it('uses the private document file separately from SecureStore', async () => {
    const storage = createLocalContentStorage();
    const value = JSON.stringify({ version: 1, users: [1234], casts: [] });

    await storage.write(value);

    const file = state.files[0]!;
    expect(file.uri).toBe('file:///app/document/opencaster-hidden-content.v1.json');
    expect(file.write).toHaveBeenCalledWith(value);
    expect(secureStore.getItemAsync).not.toHaveBeenCalled();
    expect(secureStore.setItemAsync).not.toHaveBeenCalled();
    expect(secureStore.deleteItemAsync).not.toHaveBeenCalled();
  });
});
