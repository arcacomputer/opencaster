/** Native v1 `castsByFid` history uses the legacy User/CastMessage primary key.
 * Hyper's shadow User prefix (0x1e) is used by v2 feeds, not this v1 store. The
 * fixed key is [0x03][FID:u32 BE][0x01][timestamp:u32 BE][message hash:20].
 * Side-effect-free so the browser client and gateway apply the same rules.
 */
const CURSOR = /^[A-Za-z0-9+/]{40}$/;
const HASH = /^(?:0x)?[a-fA-F0-9]{40}$/;

export type CastHistoryMessageType = 'MESSAGE_TYPE_CAST_ADD' | 'MESSAGE_TYPE_CAST_REMOVE';
export interface CastHistoryMessage {
  hash: string;
  data: Record<string, unknown> & { fid: number; timestamp: number; network: 'FARCASTER_NETWORK_MAINNET'; type: CastHistoryMessageType };
}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Lowercase hex key of a canonical 30-byte cursor for `fid`, otherwise undefined. */
export function castHistoryCursorKey(value: unknown, fid: number): string | undefined {
  if (typeof value !== 'string' || !CURSOR.test(value)) return;
  try {
    const bytes = atob(value);
    if (bytes.length !== 30 || btoa(bytes) !== value || bytes.charCodeAt(0) !== 0x03 || bytes.charCodeAt(5) !== 0x01) return;
    const cursorFid = bytes.charCodeAt(1) * 0x1000000 + bytes.charCodeAt(2) * 0x10000 + bytes.charCodeAt(3) * 0x100 + bytes.charCodeAt(4);
    if (cursorFid !== fid) return;
    return Array.from(bytes, byte => byte.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  } catch { return; }
}

/** Key of a validated history message, comparable with `castHistoryCursorKey`. */
export function castHistoryMessageKey(fid: number, timestamp: number, hash: string): string {
  if (!HASH.test(hash)) throw new Error('Invalid cast hash.');
  return `03${fid.toString(16).padStart(8, '0')}01${timestamp.toString(16).padStart(8, '0')}${hash.replace(/^0x/, '').toLowerCase()}`;
}

/** A mainnet CastAdd/CastRemove history message authored by `fid`. */
export function validCastHistoryMessage(message: unknown, fid: number): message is CastHistoryMessage {
  if (!object(message) || typeof message.hash !== 'string' || !HASH.test(message.hash) || !object(message.data)) return false;
  const data = message.data;
  return data.fid === fid && Number.isSafeInteger(data.timestamp) && Number(data.timestamp) >= 0 && Number(data.timestamp) <= 0xffffffff
    && data.network === 'FARCASTER_NETWORK_MAINNET'
    && ((data.type === 'MESSAGE_TYPE_CAST_ADD' && object(data.castAddBody))
      || (data.type === 'MESSAGE_TYPE_CAST_REMOVE' && object(data.castRemoveBody)));
}
