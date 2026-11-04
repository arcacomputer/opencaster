/** Server-only visibility policy. Never import this module into browser code. */
export interface ModerationEnv {
  OPENCASTER_MODERATION?: string;
}

export interface ModerationPolicy {
  readonly blockedFids: ReadonlySet<number>;
  readonly blockedCasts: ReadonlySet<string>;
  readonly blockedMedia: ReadonlySet<string>;
}

export type ModerationConfig =
  | { status: 'disabled' }
  | { status: 'invalid' }
  | { status: 'enabled'; policy: ModerationPolicy };

export class ModerationFilterError extends Error {}

const MAX_CONFIG_BYTES = 64 * 1024;
const MAX_ITEMS = 500;
const CONFIG_FIELDS = ['version', 'blockedFids', 'blockedCasts', 'blockedMedia'];
const FID_KEYS = ['fid', 'targetFid', 'target_fid', 'author_fid'];
const CAST_KEYS = ['hash', 'targetHash', 'target_hash', 'parentHash', 'parent_hash', 'castHash', 'cast_hash'];
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

export function hasModerationBinding(env: ModerationEnv): boolean {
  return Object.hasOwn(env, 'OPENCASTER_MODERATION');
}

export function normalizeFid(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : undefined;
  if (typeof value !== 'string' || !/^\d{1,16}$/.test(value)) return;
  const fid = Number(value);
  return Number.isSafeInteger(fid) && fid > 0 ? fid : undefined;
}

export function normalizeCastHash(value: unknown): string | undefined {
  return typeof value === 'string' ? /^(?:0x)?([a-f0-9]{40})$/i.exec(value)?.[1].toLowerCase() : undefined;
}

export function normalizeMediaHash(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : undefined;
}

export function resolveModeration(env: ModerationEnv): ModerationConfig {
  if (!hasModerationBinding(env)) return { status: 'disabled' };
  const text = env.OPENCASTER_MODERATION;
  if (typeof text !== 'string') return { status: 'invalid' };
  const size = new TextEncoder().encode(text).byteLength;
  if (size === 0 || size > MAX_CONFIG_BYTES) return { status: 'invalid' };

  try {
    const value: unknown = JSON.parse(text);
    if (!object(value) || Object.keys(value).length !== CONFIG_FIELDS.length
      || CONFIG_FIELDS.some(field => !Object.hasOwn(value, field))
      || value.version !== 1
      || !Array.isArray(value.blockedFids) || value.blockedFids.length > MAX_ITEMS
      || !Array.isArray(value.blockedCasts) || value.blockedCasts.length > MAX_ITEMS
      || !Array.isArray(value.blockedMedia) || value.blockedMedia.length > MAX_ITEMS) return { status: 'invalid' };

    const blockedFids = new Set<number>();
    for (const fid of value.blockedFids) {
      if (typeof fid !== 'number') return { status: 'invalid' };
      const normalized = normalizeFid(fid);
      if (normalized === undefined) return { status: 'invalid' };
      blockedFids.add(normalized);
    }
    const blockedCasts = new Set<string>();
    for (const hash of value.blockedCasts) {
      const normalized = normalizeCastHash(hash);
      if (!normalized) return { status: 'invalid' };
      blockedCasts.add(normalized);
    }
    const blockedMedia = new Set<string>();
    for (const hash of value.blockedMedia) {
      const normalized = normalizeMediaHash(hash);
      if (!normalized) return { status: 'invalid' };
      blockedMedia.add(normalized);
    }
    return { status: 'enabled', policy: { blockedFids, blockedCasts, blockedMedia } };
  } catch {
    return { status: 'invalid' };
  }
}

export function blocksFid(policy: ModerationPolicy, value: unknown): boolean {
  const fid = normalizeFid(value);
  return fid !== undefined && policy.blockedFids.has(fid);
}

export function blocksCast(policy: ModerationPolicy, value: unknown): boolean {
  const hash = normalizeCastHash(value);
  return !!hash && policy.blockedCasts.has(hash);
}

export function blocksMedia(policy: ModerationPolicy, value: unknown): boolean {
  const hash = normalizeMediaHash(value);
  return !!hash && policy.blockedMedia.has(hash);
}

function directlyBlocked(value: Record<string, unknown>, policy: ModerationPolicy): boolean {
  return FID_KEYS.some(key => blocksFid(policy, value[key]))
    || CAST_KEYS.some(key => blocksCast(policy, value[key]));
}

function nativeMessage(value: Record<string, unknown>): boolean {
  return object(value.data) && Object.hasOwn(value.data, 'fid') && Object.hasOwn(value.data, 'type');
}

interface Traversal {
  nodes: number;
  removedNativeMessages: number;
}

function countNode(state: Traversal, depth: number): void {
  state.nodes++;
  if (depth > 64 || state.nodes > 100_000) throw new ModerationFilterError();
}

function nativeMessageContainsBlock(value: unknown, policy: ModerationPolicy, state: Traversal, depth: number): boolean {
  countNode(state, depth);
  if (Array.isArray(value)) return value.some(item => nativeMessageContainsBlock(item, policy, state, depth + 1));
  if (!object(value)) return false;
  if (directlyBlocked(value, policy)) return true;
  return Object.values(value).some(child => nativeMessageContainsBlock(child, policy, state, depth + 1));
}

type Filtered = { removed: true } | { removed: false; value: unknown };

function filterValue(value: unknown, policy: ModerationPolicy, state: Traversal, depth: number): Filtered {
  if (object(value) && nativeMessage(value)) {
    if (nativeMessageContainsBlock(value, policy, state, depth)) {
      state.removedNativeMessages++;
      return { removed: true };
    }
    return { removed: false, value };
  }
  countNode(state, depth);
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    for (const item of value) {
      const filtered = filterValue(item, policy, state, depth + 1);
      if (!filtered.removed) result.push(filtered.value);
    }
    return { removed: false, value: result };
  }
  if (!object(value)) return { removed: false, value };
  if (directlyBlocked(value, policy)) return { removed: true };

  const result = Object.create(null) as Record<string, unknown>;
  for (const [key, child] of Object.entries(value)) {
    const filtered = filterValue(child, policy, state, depth + 1);
    if (filtered.removed) return { removed: true };
    result[key] = filtered.value;
  }
  return { removed: false, value: result };
}

export function filterModeratedContent(value: Record<string, unknown>, policy: ModerationPolicy): {
  value?: Record<string, unknown>;
  rootRemoved: boolean;
  removedNativeMessages: number;
} {
  const state: Traversal = { nodes: 0, removedNativeMessages: 0 };
  const filtered = filterValue(value, policy, state, 0);
  return {
    ...(filtered.removed ? {} : { value: filtered.value as Record<string, unknown> }),
    rootRemoved: filtered.removed,
    removedNativeMessages: state.removedNativeMessages,
  };
}
