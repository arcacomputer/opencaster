export type SessionPersistence = 'remember' | 'tab';

const PREFERENCE_KEY = 'arca.hypersnap.session-persistence';
const CHANNEL_NAME = 'arca.hypersnap.session-changes';
const STORAGE_EVENT_KEY = 'arca.hypersnap.session-change';
const listeners = new Set<() => void>();
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

function notifyListeners(id: unknown): void {
  if (typeof id !== 'string' || !/^[0-9a-f]{32}$/.test(id) || seenEvents.has(id)) return;
  seenEvents.add(id);
  if (seenEvents.size > 64) seenEvents.delete(seenEvents.values().next().value!);
  for (const listener of listeners) {
    try { listener(); } catch { /* One subscriber must not block other tabs' listeners. */ }
  }
}

function receiveBroadcast(event: MessageEvent): void {
  const value: unknown = event.data;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || !('id' in value)) return;
  notifyListeners(value.id);
}

function receiveStorage(event: StorageEvent): void {
  if (event.key !== STORAGE_EVENT_KEY || !event.newValue) return;
  try {
    const value: unknown = JSON.parse(event.newValue);
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1 && 'id' in value) notifyListeners(value.id);
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

export function subscribeSessionChanges(listener: () => void): () => void {
  listeners.add(listener);
  openChannel();
  installStorageListener();
  return () => { listeners.delete(listener); };
}

export function notifySessionChange(): void {
  const id = randomEventId();
  try { openChannel()?.postMessage({ id }); }
  catch { /* The storage event remains available when BroadcastChannel is denied. */ }
  try {
    globalThis.localStorage.setItem(STORAGE_EVENT_KEY, JSON.stringify({ id }));
    globalThis.localStorage.removeItem(STORAGE_EVENT_KEY);
  } catch { /* BroadcastChannel remains available when local storage is denied. */ }
}
