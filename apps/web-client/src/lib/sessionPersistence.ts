export type SessionPersistence = 'remember' | 'tab';
export type SessionChangeKind = 'vault' | 'sign-out';

const PREFERENCE_KEY = 'arca.hypersnap.session-persistence';
const CHANNEL_NAME = 'arca.hypersnap.session-changes';
const STORAGE_EVENT_KEY = 'arca.hypersnap.session-change';
const listeners = new Set<(kind: SessionChangeKind) => void>();
const seenEvents = new Set<string>();
let channel: BroadcastChannel | undefined;
let storageListenerInstalled = false;

function randomEventId(): string {
  try { return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join(''); }
  catch {
    let id = '';
    while (id.length < 32) id += Math.random().toString(16).slice(2);
    return id.slice(0, 32);
  }
}

function sessionChange(value: unknown): { id: string; kind: SessionChangeKind } | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2) return undefined;
  const { id, kind } = value as Record<string, unknown>;
  if (typeof id !== 'string' || !/^[0-9a-f]{32}$/.test(id) || (kind !== 'vault' && kind !== 'sign-out')) return undefined;
  return { id, kind };
}

function notifyListeners(value: unknown): void {
  const change = sessionChange(value);
  if (!change || seenEvents.has(change.id)) return;
  seenEvents.add(change.id);
  if (seenEvents.size > 64) seenEvents.delete(seenEvents.values().next().value!);
  for (const listener of listeners) {
    try { listener(change.kind); } catch { /* One subscriber must not block other tabs' listeners. */ }
  }
}

function receiveBroadcast(event: MessageEvent): void {
  notifyListeners(event.data);
}

function receiveStorage(event: StorageEvent): void {
  if (event.key !== STORAGE_EVENT_KEY || !event.newValue) return;
  try {
    notifyListeners(JSON.parse(event.newValue) as unknown);
  } catch { /* Ignore unrelated or malformed storage events. */ }
}

function openChannel(): BroadcastChannel | undefined {
  if (channel) return channel;
  if (typeof BroadcastChannel === 'undefined') return undefined;
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.addEventListener('message', receiveBroadcast);
    (channel as BroadcastChannel & { unref?: () => void }).unref?.();
  } catch { channel = undefined; }
  return channel;
}

function installStorageListener(): void {
  if (storageListenerInstalled || typeof globalThis.addEventListener !== 'function') return;
  try {
    globalThis.addEventListener('storage', receiveStorage);
    storageListenerInstalled = true;
  } catch { /* Storage events are an optional cross-tab fallback. */ }
}

export function readSessionPersistence(): SessionPersistence {
  try {
    const value = globalThis.localStorage.getItem(PREFERENCE_KEY);
    return value === 'tab' || value === 'remember' ? value : 'remember';
  } catch { return 'remember'; }
}

export function writeSessionPersistence(mode: SessionPersistence): void {
  if (mode !== 'remember' && mode !== 'tab') throw new Error('Choose either Remember me or This tab only.');
  try { globalThis.localStorage.setItem(PREFERENCE_KEY, mode); }
  catch { throw new Error('Could not save this session preference in browser storage. Check your browser storage settings and try again.'); }
}

export function subscribeSessionChanges(listener: (kind: SessionChangeKind) => void): () => void {
  listeners.add(listener);
  openChannel();
  installStorageListener();
  return () => { listeners.delete(listener); };
}

export function notifySessionChange(kind: SessionChangeKind = 'vault'): void {
  if (kind !== 'vault' && kind !== 'sign-out') return;
  const id = randomEventId();
  const change = { id, kind };
  try { openChannel()?.postMessage(change); }
  catch { /* The storage event remains available when BroadcastChannel is denied. */ }
  try {
    globalThis.localStorage.setItem(STORAGE_EVENT_KEY, JSON.stringify(change));
    globalThis.localStorage.removeItem(STORAGE_EVENT_KEY);
  } catch { /* BroadcastChannel remains available when local storage is denied. */ }
}
