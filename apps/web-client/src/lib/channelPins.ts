import type { Channel } from '@opencaster/client-core/api';

// Local shortcut snapshots only. These platform-independent validation helpers
// are migration candidates for a future shared Hypersnap client package.
export const CHANNEL_PIN_LIMIT = 50;
export const CHANNEL_PINS_STORAGE_KEY = 'arca.hypersnap.channels.saved.v1';
const MAX_STORED_BYTES = 256 * 1024;
interface PinStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }

function safeHttps(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 1_024) return;
  try {
    const url = new URL(value);
    // Parent URLs are protocol identifiers, so preserve their exact bytes.
    if (url.protocol === 'https:' && !url.username && !url.password) return value;
  } catch { /* An unusable optional image or URL does not invalidate the ID. */ }
}

function snapshot(value: unknown): Channel | undefined {
  if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(value.id)) return;
  const input = value as Record<string, unknown>;
  const parent = safeHttps(input.parent_url);
  const image = safeHttps(input.image_url);
  return {
    id: value.id,
    name: typeof input.name === 'string' && input.name.trim() ? input.name.slice(0, 128) : value.id,
    url: safeHttps(input.url) ?? '',
    ...(parent ? { parent_url: parent } : {}),
    ...(image ? { image_url: image } : {}),
    ...(typeof input.description === 'string' ? { description: input.description.slice(0, 512) } : {}),
    ...(Number.isSafeInteger(input.member_count) && Number(input.member_count) >= 0 ? { member_count: Number(input.member_count) } : {}),
  };
}

function snapshots(values: readonly unknown[]): Channel[] {
  const result: Channel[] = [];
  const seen = new Set<string>();
  for (const value of values.slice(0, 500)) {
    const pin = snapshot(value);
    if (!pin || seen.has(pin.id)) continue;
    result.push(pin); seen.add(pin.id);
    if (result.length === CHANNEL_PIN_LIMIT) break;
  }
  return result;
}

export function readChannelPins(storage?: Pick<PinStorage, 'getItem'>): Channel[] {
  try {
    const raw = (storage ?? localStorage).getItem(CHANNEL_PINS_STORAGE_KEY);
    if (!raw || raw.length > MAX_STORED_BYTES) return [];
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 || !('channels' in value) || !Array.isArray(value.channels)) return [];
    return snapshots(value.channels);
  } catch { return []; }
}

export function writeChannelPins(channels: readonly Channel[], storage?: Pick<PinStorage, 'setItem'>): boolean {
  try {
    (storage ?? localStorage).setItem(CHANNEL_PINS_STORAGE_KEY, JSON.stringify({ version: 1, channels: snapshots(channels) }));
    return true;
  } catch { return false; }
}

export function toggleChannelPin(channels: readonly Channel[], channel: Channel): Channel[] {
  const current = snapshots(channels);
  const pin = snapshot(channel);
  if (!pin) throw new Error('This channel has no usable shortcut identifier.');
  if (current.some(item => item.id === pin.id)) return current.filter(item => item.id !== pin.id);
  if (current.length >= CHANNEL_PIN_LIMIT) throw new Error(`Save up to ${CHANNEL_PIN_LIMIT} channels on this browser. Remove a saved channel before adding another.`);
  return [pin, ...current];
}
