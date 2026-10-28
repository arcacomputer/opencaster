/** Actual isolated Hypersnap feature checks; all writes are loopback-only.
 * From apps/web-client/:
 * yarn esbuild scripts/e2e-feature-checks.ts --bundle --platform=node --format=esm \
 *   --define:import.meta.env.DEV=false --outfile=/tmp/arca-e2e-feature-checks.mjs
 * node /tmp/arca-e2e-feature-checks.mjs \
 *   --identity-file /tmp/arca-hypersnap-e2e-features/identity.json
 * Requires the synthetic fixture's node restarted in Mainnet protocol mode.
 * IndexedDB is in-memory; vault encryption, auth, signatures, the Worker, node
 * indexes, consensus/storage, R2 and SQLite Durable Objects are real code.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import 'fake-indexeddb/auto';
import { ed25519 } from '@noble/curves/ed25519.js';
import { getCast, getCastQuotes, getChannel, getChannelMembers, getChannels, getFeed, getFollowStatus, getNotifications, getProfileFeed, getReactionStatus, getReactionStatuses, getSuggestedUsers, getUser, searchCasts, searchUsers, type Cast } from '@opencaster/client-core/api';
import { unlockSavedSession, type WalletSession } from '../src/lib/auth';
import { FULL_CLIENT_SCOPES } from '@opencaster/client-core/pairing';
import { uploadMedia } from '@opencaster/client-core/media';
import { bytesToHex, hexToBytes } from '@opencaster/protocol/signedKeyRequest';
import { deleteSavedVault, encryptSignerVault, writeSavedVault } from '../src/lib/vault';

const ORIGIN = 'https://opencaster.org';
const args = process.argv.slice(2);
assert([2, 3].includes(args.length), 'Use --identity-file /tmp/arca-hypersnap-e2e-features/identity.json [--read-only].');
assert.equal(args[0], '--identity-file');
if (args.length === 3) assert.equal(args[2], '--read-only');
const readOnly = args[2] === '--read-only';
const identityFile = path.resolve(args[1]);
assert.match(identityFile, /^\/(?:private\/)?tmp\/arca-hypersnap-e2e(?:-[a-z0-9-]+)?\/identity\.json$/, 'Use a dedicated synthetic fixture directory.');
const fixture = JSON.parse(await fs.readFile(identityFile, 'utf8'));
assert.equal(fixture.kind, 'arca.hypersnap.e2e.identity');
assert.equal(fixture.version, 1);
assert.equal(fixture.fid, 1234);
assert.equal(fixture.otherFid, 1235);
assert.equal(fixture.devicePrivateKeyHex, '03'.repeat(32), 'Only the published synthetic device key is accepted.');
assert.equal(fixture.otherDevicePrivateKeyHex, '04'.repeat(32), 'Only the published synthetic device key is accepted.');
const node = new URL(fixture.nodeOrigin);
assert.equal(node.hostname, '127.0.0.1');
assert.equal(node.protocol, 'http:');
assert.equal(node.pathname, '/');
assert.equal(node.username + node.password + node.search + node.hash, '');
const project = path.resolve(process.cwd());
assert.equal(JSON.parse(await fs.readFile(path.join(project, 'package.json'), 'utf8')).name, '@opencaster/web-client', 'Run from apps/web-client/.');
const runtimeModule = await import(pathToFileURL(path.join(project, 'scripts/e2e-media-runtime.mjs')).href);
const runtime = await runtimeModule.createMediaRuntime({ nodeUrl: node.origin });
const nativeFetch = globalThis.fetch;
const nativeLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
Object.defineProperty(globalThis, 'location', { configurable: true, value: { origin: ORIGIN } });
const sessions: WalletSession[] = [];
let submissions = 0;
globalThis.fetch = async (input, init) => {
  const incoming = typeof input === 'string' ? new URL(input, ORIGIN) : input instanceof URL ? input : new URL(input.url);
  if (incoming.origin === ORIGIN) {
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    if (readOnly) assert.equal(method, 'GET', 'Read-only feature checks refuse mutations before dispatch.');
    if (method === 'POST' && incoming.pathname === '/api/v1/submitMessage') submissions++;
    // Native browsers attach Origin to same-origin POSTs. Node fetch does not.
    const headers = new Headers(init?.headers);
    if (method === 'POST') headers.set('Origin', ORIGIN);
    try {
      const response = await runtime.fetch(incoming.href, { ...init, headers });
      if (!response.ok && response.status !== 404) console.error('Isolated gateway rejection:', incoming.pathname, response.status, await response.clone().text());
      return response as Response;
    } catch (error) { console.error('Isolated gateway transport error:', incoming.pathname, error); throw error; }
  }
  assert.equal(incoming.origin, node.origin, 'External network is disabled for isolated feature checks.');
  return nativeFetch(input, init);
};

async function until<T>(label: string, read: () => Promise<T>, accept: (value: T) => boolean, timeout = 45_000): Promise<T> {
  const deadline = Date.now() + timeout;
  let lastError: unknown;
  do {
    try { const value = await read(); if (accept(value)) return value; }
    catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 500));
  } while (Date.now() < deadline);
  throw new Error(`The isolated node did not confirm ${label}. Last error: ${lastError instanceof Error ? lastError.message : 'none'}`);
}

async function sessionFor(fid: number, keyHex: string): Promise<WalletSession> {
  const user = await getUser({ fid });
  const key = hexToBytes(keyHex);
  try {
    const vault = await encryptSignerVault(key, { origin: ORIGIN, fid, custodyAddress: user.custody_address.toLowerCase(), publicKey: bytesToHex(ed25519.getPublicKey(key)), requestFid: fid, scopes: [...FULL_CLIENT_SCOPES], ttl: 604800 }, 'Synthetic local test only 2026');
    await writeSavedVault(vault);
    const session = await unlockSavedSession('Synthetic local test only 2026', { origin: ORIGIN });
    sessions.push(session);
    return session;
  } finally { key.fill(0); }
}

async function confirmedCast(session: WalletSession, text: string, ...options: Parameters<WalletSession['cast']> extends [string, ...infer Rest] ? Rest : never): Promise<Cast> {
  const receipt = await session.cast(text, ...options);
  return until('cast inclusion', () => getCast(receipt.hash), cast => cast.author.fid === session.fid && cast.text === text);
}

try {
  if (readOnly) {
    // Inspect the completed fixture without unlocking any signer or adding a
    // mutation. Its original root was deleted; its surviving quote still gives
    // us a real reverse-index target, proving quote lookup need not invent one.
    const [ownerFeed, otherFeed, participants, suggestions, likes, recasts] = await Promise.all([
      getFeed({ kind: 'user', fid: fixture.fid, limit: 100 }),
      getFeed({ kind: 'user', fid: fixture.otherFid, limit: 100 }),
      getChannelMembers('arca-e2e'),
      getSuggestedUsers(fixture.otherFid, 6),
      getProfileFeed({ fid: fixture.otherFid, tab: 'likes', limit: 25 }),
      getProfileFeed({ fid: fixture.otherFid, tab: 'recasts', limit: 25 }),
    ]);
    const quote = [...ownerFeed.casts, ...otherFeed.casts].find(cast => cast.embeds.some(embed => 'cast_id' in embed && embed.cast_id.fid === fixture.fid));
    assert(quote, 'The completed fixture must have a surviving real quote.');
    const reference = quote.embeds.find((embed): embed is { cast_id: { fid: number; hash: string } } => 'cast_id' in embed && embed.cast_id.fid === fixture.fid)!;
    const quotes = await getCastQuotes(reference.cast_id.hash);
    assert(quotes.casts.some(cast => cast.hash.replace(/^0x/, '') === quote.hash.replace(/^0x/, '')), 'The node must return its real surviving quote.');
    assert(participants.users.some(user => user.fid === fixture.fid));
    assert(suggestions.users.length <= 6 && suggestions.users.every(user => user.fid !== fixture.otherFid));
    for (const [feed, type] of [[likes, 'like'], [recasts, 'recast']] as const) assert(feed.casts.every(cast => cast.reaction_context?.fid === fixture.otherFid && cast.reaction_context.type === type));
    const removed = await getReactionStatuses(fixture.otherFid, [reference.cast_id]);
    assert(removed.every(status => !status.liked && !status.recasted), 'The earlier fixture removals must remain absent.');
    assert.equal(submissions, 0, 'Read-only mode must not submit any messages.');
    const proof = {
      kind: 'actual-local-hypersnap-community-read-checks', actualNode: node.origin, productionWrites: 0, localSignedSubmissions: submissions,
      registryMocked: false, apiMocked: false, quoteReverseIndex: true, channelParticipantIndex: true,
      suggestedProfilesRead: true, suggestedProfileCount: suggestions.users.length, likesCount: likes.casts.length, recastsCount: recasts.casts.length,
      removedReactionStatesVerified: true, actualNodeRequests: runtime.nodeRequests.length,
    };
    await fs.writeFile(path.join(path.dirname(identityFile), 'feature-read-checks-proof.json'), JSON.stringify(proof, null, 2));
    console.log(JSON.stringify(proof));
  } else {
  const owner = await sessionFor(fixture.fid, fixture.devicePrivateKeyHex);
  const other = await sessionFor(fixture.otherFid, fixture.otherDevicePrivateKeyHex);
  console.log('PASS actual node registry + real encrypted-vault unlock for both isolated accounts');
  const token = `arcae2efeature${Date.now()}`;
  const displayName = `Feature${Date.now()}`;
  const update = await owner.updateProfile({ displayName });
  assert.deepEqual(update.failed ?? [], []);
  await until('profile update inclusion', () => getUser({ fid: owner.fid }), user => user.display_name === displayName);
  await until('user search index', () => searchUsers({ query: displayName }), result => result.users.some(user => user.fid === owner.fid));
  console.log('PASS profile edit + real user-search index');

  const root = await confirmedCast(owner, `${token} root`);
  const rootTarget = { fid: owner.fid, hash: root.hash };
  const quote = await confirmedCast(owner, `${token} quote`, undefined, { embeds: [{ castId: rootTarget }] });
  assert(quote.embeds.some(embed => 'cast_id' in embed && embed.cast_id.fid === owner.fid && embed.cast_id.hash.replace(/^0x/, '') === root.hash.replace(/^0x/, '')));
  await until('quote reverse index', () => getCastQuotes(root.hash), result => result.casts.some(cast => cast.hash === quote.hash));
  console.log('PASS signed cast-ID quote embed persisted and hydrated by Hypersnap');

  const channelId = 'arca-e2e';
  const parentUrl = `https://warpcast.com/~/channel/${channelId}`; // Protocol namespace only; never fetched.
  const channelCast = await confirmedCast(owner, `${token} channel`, undefined, { parentUrl });
  assert.equal(channelCast.parent_url, parentUrl);
  assert.equal(channelCast.parent_hash, undefined);
  await until('channel directory index', () => getChannel(channelId), channel => channel.url === parentUrl);
  const searchedChannels = await until('channel search', () => getChannels({ kind: 'search', query: channelId }), result => result.channels.some(channel => channel.id === channelId));
  assert(searchedChannels.channels[0].member_count! >= 1);
  await until('channel feed inclusion', () => getFeed({ kind: 'channel', channel: channelId }), feed => feed.casts.some(cast => cast.hash === channelCast.hash));
  await until('channel participant index', () => getChannelMembers(channelId), result => result.users.some(user => user.fid === owner.fid));
  console.log('PASS channel parent URL + detail + directory search + actual channel feed');

  const media = await uploadMedia(new File([new Uint8Array(runtimeModule.E2E_PNG)], 'isolated-test.png', { type: 'image/png' }), input => owner.authorizeMediaUpload(input));
  const photo = await confirmedCast(owner, `${token} photo`, undefined, { embeds: [{ url: media.url }] });
  assert(photo.embeds.some(embed => 'url' in embed && embed.url === media.url));
  const image = await fetch(media.url);
  assert.equal(image.status, 200);
  assert.equal(bytesToHex(new Uint8Array(await image.arrayBuffer())), bytesToHex(runtimeModule.E2E_PNG));
  console.log('PASS actual signed upload grant, Worker, SQLite quota, R2 bytes and media cast embed');

  const reply = await confirmedCast(other, `${token} reply`, rootTarget);
  const mention = await confirmedCast(other, `${token} mention`, undefined, { mentions: [owner.fid], mentionsPositions: [0] });
  assert.equal(reply.parent_author?.fid, owner.fid);
  assert(mention.mentioned_profiles?.some(user => user.fid === owner.fid));
  await other.react(rootTarget, 'like');
  await until('persisted like receipt', () => getReactionStatus(other.fid, rootTarget, 'like'), liked => liked);
  await other.react(rootTarget, 'recast');
  await until('persisted like and recast state', () => getReactionStatuses(other.fid, [rootTarget]), states => states.length === 1 && states[0].liked && states[0].recasted);
  const likedCasts = await until('profile Likes history', () => getProfileFeed({ fid: other.fid, tab: 'likes', limit: 100 }), feed => feed.casts.some(cast => cast.hash === root.hash));
  const recastCasts = await until('profile Recasts history', () => getProfileFeed({ fid: other.fid, tab: 'recasts', limit: 100 }), feed => feed.casts.some(cast => cast.hash === root.hash));
  for (const [feed, type] of [[likedCasts, 'like'], [recastCasts, 'recast']] as const) {
    const hydrated = feed.casts.find(cast => cast.hash === root.hash)!;
    assert.equal(hydrated.text, root.text);
    assert.equal(hydrated.author.fid, owner.fid);
    assert.equal(hydrated.reaction_context?.fid, other.fid);
    assert.equal(hydrated.reaction_context?.type, type);
    assert(Number.isFinite(Date.parse(hydrated.reaction_context!.timestamp)));
  }
  // Fresh reads, rather than optimistic card state, must preserve both toggles.
  assert(await getReactionStatus(other.fid, rootTarget, 'like'));
  assert(await getReactionStatus(other.fid, rootTarget, 'recast'));
  assert.equal(await getReactionStatus(owner.fid, rootTarget, 'like'), false, 'Viewer state must not leak between the two isolated accounts.');
  console.log('PASS actual v1 current like/recast receipts, fresh account-scoped reads, and authoritative Likes/Recasts profile hydration');
  await other.follow(owner.fid);
  await until('effective follow', () => getFollowStatus(other.fid, owner.fid), following => following);
  const suggestions = await getSuggestedUsers(other.fid, 6);
  assert(suggestions.users.length <= 6);
  assert(suggestions.users.every(user => user.fid !== other.fid));
  const activity = await until('reply, mention, reaction and follow notifications', () => getNotifications({ fid: owner.fid, limit: 100 }), result => ['replies', 'mentions', 'reactions', 'follows'].every(type => result.notifications.some(item => item.type === type && item.actors.some(user => user.fid === other.fid))));
  console.log('PASS real reply/mention/reaction/follow writes and normalized recent activity');

  await until('cast search index', () => searchCasts({ query: token, limit: 100 }), feed => feed.casts.some(cast => cast.hash === quote.hash));
  const roots = await getProfileFeed({ fid: owner.fid, tab: 'casts', limit: 100 });
  assert(roots.casts.some(cast => cast.hash === channelCast.hash), 'Channel root posts belong in Casts.');
  const replies = await getProfileFeed({ fid: other.fid, tab: 'replies', limit: 100 });
  assert(replies.casts.some(cast => cast.hash === reply.hash));
  assert(replies.casts.every(cast => !!cast.parent_hash));
  const photos = await getProfileFeed({ fid: owner.fid, tab: 'media', limit: 100 });
  assert(photos.casts.some(cast => cast.hash === photo.hash));
  console.log('PASS actual full-text cast search and Casts/Replies/Photos profile tabs');

  // Give remove messages a strictly later Farcaster timestamp than their adds.
  // These are the only three additional writes in this extension: one recast
  // above and removal of the existing like plus that recast below.
  await new Promise(resolve => setTimeout(resolve, 1100));
  await other.react(rootTarget, 'like', true);
  await other.react(rootTarget, 'recast', true);
  await until('confirmed unlike and undo-recast', () => getReactionStatuses(other.fid, [rootTarget]), states => states.length === 1 && !states[0].liked && !states[0].recasted);
  for (const tab of ['likes', 'recasts'] as const) {
    const history = await getProfileFeed({ fid: other.fid, tab, limit: 100 });
    assert(!history.casts.some(cast => cast.hash === root.hash), 'Removed reactions must disappear from profile history.');
  }
  console.log('PASS actual REACTION_REMOVE inclusion, exact NotFound normalization, and removal from both profile histories');

  const beforeForeignDelete = submissions;
  await assert.rejects(owner.deleteCast({ fid: other.fid, hash: reply.hash }), /only casts|different|own account/i);
  assert.equal(submissions, beforeForeignDelete, 'A foreign delete must be rejected before submission.');
  await getCast(reply.hash);
  const deletion = await owner.deleteCast(rootTarget);
  assert.match(deletion.hash, /^(?:0x)?[a-f0-9]{40}$/);
  await assert.rejects(getCast(root.hash), error => !!error && typeof error === 'object' && 'code' in error && error.code === 'cast_not_found');
  console.log('PASS own signed CAST_REMOVE confirmed absent; foreign delete refused without submission');
  const rawSearch = await fetch(`/api/v2/farcaster/cast/search?limit=25&q=${encodeURIComponent(token)}`);
  assert.equal(rawSearch.status, 200);
  const rawHits = await rawSearch.json() as { result: { casts: Cast[] } };
  assert(rawHits.result.casts.some(cast => cast.hash.replace(/^0x/, '') === root.hash.replace(/^0x/, '')), 'Fixture must exercise the actual stale Tantivy deletion bug.');
  const activeSearch = await searchCasts({ query: token, limit: 25 });
  assert(!activeSearch.casts.some(cast => cast.hash.replace(/^0x/, '') === root.hash.replace(/^0x/, '')));
  assert(activeSearch.casts.some(cast => cast.hash === quote.hash && cast.embeds.some(embed => 'cast_id' in embed)));
  console.log('PASS authoritative search hydration filters the actually stale deleted hit and restores quote embeds');

  await other.follow(owner.fid, true);
  await until('unfollow inclusion', () => getFollowStatus(other.fid, owner.fid), following => !following);
  const proof = {
    kind: 'actual-local-hypersnap-feature-checks', actualNode: node.origin, productionOriginUnmodified: true,
    registryMocked: false, apiMocked: false, signaturesReal: true, productionWrites: 0,
    isolatedFids: [owner.fid, other.fid], profileEditAndUserSearch: true, castSearch: true, staleDeletedSearchHitFiltered: true, searchHydrated: true,
    quoteCastIdEmbed: true, ownDelete: true, foreignDeleteDeniedBeforeSubmit: true,
    channelParentUrl: true, channelDirectoryAndFeed: true, channelParticipantIndex: true, quoteReverseIndex: true, boundedSuggestedProfilesRead: true, mediaUploadAndCast: true,
    profileTabs: ['casts', 'replies', 'media', 'likes', 'recasts'], reactionReceiptReads: true, reactionAccountIsolation: true, reactionHistoryHydrated: true, reactionRemovalsConfirmed: true,
    activityTypes: [...new Set(activity.notifications.map(item => item.type))],
    localSignedSubmissions: submissions, actualNodeRequests: runtime.nodeRequests.length,
  };
  await fs.writeFile(path.join(path.dirname(identityFile), 'feature-checks-proof.json'), JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof));
  }
} catch (error) {
  console.error('Local node errors:', JSON.stringify(runtime.nodeErrors));
  throw error;
} finally {
  sessions.forEach(session => session.dispose());
  await deleteSavedVault();
  globalThis.fetch = nativeFetch;
  if (nativeLocation) Object.defineProperty(globalThis, 'location', nativeLocation);
  else Reflect.deleteProperty(globalThis, 'location');
  await runtime.dispose();
}
