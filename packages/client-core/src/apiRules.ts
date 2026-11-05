/** Query formats and limits shared by the client data layer and the gateway
 * read allowlist, so both sides accept exactly the same requests. */
export const CAST_HASH = /^(?:0x)?[a-fA-F0-9]{40}$/;
export const WALLET_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
export const CHANNEL_ID = /^[a-zA-Z0-9_-]{1,64}$/;
export const PAGE_CURSOR = /^[a-zA-Z0-9_+/=:-]{1,2048}$/;
const PAGE_TOKEN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MAX_PAGE_TOKEN_LENGTH = 2048;
const MAX_SEARCH_QUERY_BYTES = 256;

/** Maximum page sizes accepted per endpoint family. */
export const API_LIMITS = {
  page: 100,
  bulkUsers: 100,
  castReactions: 25,
  channelMembers: 25,
  castQuotes: 25,
  suggestedUsers: 20,
} as const;

/** Base64 page tokens used by native v1 reads. */
export function validPageToken(value: string): boolean {
  return value.length > 0 && value.length <= MAX_PAGE_TOKEN_LENGTH && PAGE_TOKEN.test(value);
}

/** Unsigned 64-bit decimal cursors used by follow and channel member lists. */
export function validDecimalCursor(value: string): boolean {
  return /^\d{1,20}$/.test(value) && BigInt(value) <= 0xffffffffffffffffn;
}

export function validSearchQuery(value: string): boolean {
  // eslint-disable-next-line no-control-regex -- Search validation intentionally rejects ASCII control characters.
  return !!value.trim() && new TextEncoder().encode(value).length <= MAX_SEARCH_QUERY_BYTES && !/[\u0000-\u001f\u007f]/.test(value);
}
