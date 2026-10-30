// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import ConnectAccount, { DeviceSettings } from './ConnectAccount';
import { deleteSavedSession, getSavedSessionMethod, preparePairing, unlockSavedSession, unlockSavedSessionWithPasskey, type PendingPairing, type PendingRevocation, type WalletSession } from '../lib/auth';
import { approvePairingWithWallet, approveRevocationWithWallet, discoverInjectedWallets, type InjectedWallet } from '../lib/wallet';
import type { PairingApproval, PairingRequest, RevocationApproval, RevocationRequest } from '@opencaster/client-core/pairing';
import { ApiError, getUser, type User } from '@opencaster/client-core/api';
import { passkeysAvailable } from '../lib/passkey';

vi.mock('../lib/auth', () => ({ deleteSavedSession: vi.fn(), getSavedSessionMethod: vi.fn(), preparePairing: vi.fn(), unlockSavedSession: vi.fn(), unlockSavedSessionWithPasskey: vi.fn() }));
vi.mock('../lib/wallet', () => ({ approvePairingWithWallet: vi.fn(), approveRevocationWithWallet: vi.fn(), discoverInjectedWallets: vi.fn() }));
vi.mock('../lib/passkey', () => ({ passkeysAvailable: vi.fn() }));
vi.mock('@opencaster/client-core/api', async original => ({ ...await original<typeof import('@opencaster/client-core/api')>(), getUser: vi.fn() }));
vi.mock('@opencaster/client-core/pairing', async original => ({ ...await original<typeof import('@opencaster/client-core/pairing')>(), validatePairingApproval: (value: unknown) => value, verifyPairingApproval: vi.fn(), hashPairingRequest: () => 'synthetic-public-checksum', validateRevocationApproval: (value: unknown) => value, verifyRevocationApproval: vi.fn(), hashRevocationRequest: () => 'synthetic-revocation-checksum' }));

const user: User = { fid: 10, username: 'isolated', custody_address: `0x${'1'.repeat(40)}`, profile: { bio: { text: '' } }, follower_count: 0, following_count: 0 };
function makeSession(): WalletSession { return { fid: user.fid, user, custodyAddress: user.custody_address, publicKey: 'a'.repeat(64), scopes: [1, 3, 4], saveToDevice: vi.fn().mockResolvedValue(undefined), saveToDeviceWithPasskey: vi.fn().mockResolvedValue(undefined), dispose: vi.fn(), prepareRevocation: vi.fn() } as unknown as WalletSession; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(value => { resolve = value; }); return { promise, resolve }; }
let container: HTMLDivElement;
let root: Root;
let session: WalletSession;
let pending: PendingPairing;
let walletApproval: PairingApproval;
let onConnect: Mock<(session: WalletSession) => void>;
let onClose: Mock<() => void>;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.resetAllMocks();
  vi.mocked(passkeysAvailable).mockReturnValue(true);
  vi.stubGlobal('isSecureContext', true); vi.stubGlobal('PublicKeyCredential', class {});
  Object.defineProperty(navigator, 'credentials', { configurable: true, value: { create: vi.fn(), get: vi.fn() } });
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (this: HTMLDialogElement) { this.open = true; });
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (this: HTMLDialogElement) { this.open = false; });
  session = makeSession(); onConnect = vi.fn(); onClose = vi.fn();
  const request: PairingRequest = { kind: 'arca.hypersnap.signer.request', version: 1, origin: 'https://opencaster.org', requestId: 'b'.repeat(64), createdAt: Math.floor(Date.now() / 1000), fid: user.fid, custodyAddress: user.custody_address, publicKey: session.publicKey, scopes: [1, 3, 4], ttl: 604800, nonce: 1, deadline: Math.floor(Date.now() / 1000) - 1609459200 + 900 };
  walletApproval = { kind: 'arca.hypersnap.signer.approval', version: 1, requestId: request.requestId, requestHash: 'c'.repeat(64), custodyAddress: request.custodyAddress, custodySignature: 'd'.repeat(130), requestSignature: 'e'.repeat(130) };
  pending = { request, user, submitted: true, complete: vi.fn().mockResolvedValue(session), dispose: vi.fn() };
  vi.mocked(getSavedSessionMethod).mockResolvedValue(undefined);
  vi.mocked(getUser).mockResolvedValue(user);
  vi.mocked(preparePairing).mockResolvedValue(pending);
  vi.mocked(unlockSavedSession).mockResolvedValue(session);
  vi.mocked(unlockSavedSessionWithPasskey).mockResolvedValue(session);
  vi.mocked(discoverInjectedWallets).mockImplementation(callback => { callback([{ id: 'isolated', name: 'Rainbow', rdns: 'me.rainbow', provider: { request: vi.fn() } }]); return () => {}; });
  vi.mocked(approvePairingWithWallet).mockResolvedValue(walletApproval);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function render(view = <ConnectAccount initialFid={10} onConnect={onConnect} onClose={onClose} />) { await act(async () => root.render(view)); }
function button(label: string) { return [...container.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === label)!; }
async function click(element: HTMLElement) { await act(async () => element.click()); }
async function fill(id: string, value: string) { const input = container.querySelector<HTMLInputElement>(`#${id}`)!; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!; await act(async () => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); }); }
async function selectWallet(name: string) {
  const field = container.querySelector<HTMLSelectElement>('.wallet-list select')!;
  const option = [...field.options].find(value => value.textContent?.startsWith(name))!;
  await act(async () => { field.value = option.value; field.dispatchEvent(new Event('change', { bubbles: true })); });
}
async function reviewAccount() { await click(button('Find my account')); await click(button('Use this account')); }
async function approve({ remember = true } = {}) {
  await reviewAccount();
  await click(button('Connect Rainbow extension & approve'));
  if (remember) await click(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
  await click(button('Submit approved device key'));
}

describe('explicit passkey device storage UI', () => {
  it('unlocks a saved passkey vault only after a click and does not request a password or new wallet authorization', async () => {
    vi.mocked(getSavedSessionMethod).mockResolvedValue('passkey');
    await render();
    expect(unlockSavedSessionWithPasskey).not.toHaveBeenCalled();
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(container.textContent).toContain('A synced passkey alone does not copy it');
    await click(button('Unlock with a passkey'));
    expect(unlockSavedSessionWithPasskey).toHaveBeenCalledOnce();
    expect(onConnect).toHaveBeenCalledWith(session);
    expect(unlockSavedSession).not.toHaveBeenCalled(); expect(preparePairing).not.toHaveBeenCalled();
  });

  it('keeps password vault unlock compatible without automatically migrating it', async () => {
    vi.mocked(getSavedSessionMethod).mockResolvedValue('password');
    await render(); await fill('device-password', 'old secure password'); await click(button('Unlock this device'));
    expect(unlockSavedSession).toHaveBeenCalledWith('old secure password', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(onConnect).toHaveBeenCalledWith(session); expect(session.saveToDeviceWithPasskey).not.toHaveBeenCalled();
  });

  it('waits for a separate save click after authorization instead of automatically creating a passkey', async () => {
    await render(); await approve();
    expect(pending.complete).toHaveBeenCalledOnce();
    expect(onConnect).not.toHaveBeenCalled(); expect(session.saveToDeviceWithPasskey).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Hypersnap confirmed this device');
    await click(button('Save with a passkey'));
    expect(session.saveToDeviceWithPasskey).toHaveBeenCalledOnce(); expect(onConnect).toHaveBeenCalledWith(session);
    expect(session.saveToDevice).not.toHaveBeenCalled();
  });

  it('keeps new sign-in in memory when remembering the device was not selected', async () => {
    await render(); await approve({ remember: false });
    expect(onConnect).toHaveBeenCalledWith(session); expect(session.saveToDeviceWithPasskey).not.toHaveBeenCalled(); expect(session.saveToDevice).not.toHaveBeenCalled();
  });

  it('keeps the authorized session available after unsupported passkey encryption and requires an explicit password fallback', async () => {
    vi.mocked(session.saveToDeviceWithPasskey).mockRejectedValue(new Error('This passkey does not support secure key encryption.'));
    await render(); await approve(); await click(button('Save with a passkey'));
    expect(onConnect).not.toHaveBeenCalled(); expect(session.dispose).not.toHaveBeenCalled(); expect(deleteSavedSession).not.toHaveBeenCalled(); expect(session.saveToDevice).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('does not support');
    await click(button('Use a password instead')); await fill('new-device-password', 'new secure password'); await fill('confirm-device-password', 'new secure password'); await click(button('Save with a password'));
    expect(session.saveToDevice).toHaveBeenCalledWith('new secure password', expect.objectContaining({ signal: expect.any(AbortSignal) })); expect(onConnect).toHaveBeenCalledWith(session);
  });

  it('allows continuing in this tab after cancelled passkey creation without saving anything else', async () => {
    vi.mocked(session.saveToDeviceWithPasskey).mockRejectedValue(new DOMException('Passkey creation cancelled.', 'NotAllowedError'));
    await render(); await approve(); await click(button('Save with a passkey'));
    await click(button('Continue for this tab without saving'));
    expect(onConnect).toHaveBeenCalledWith(session); expect(session.saveToDevice).not.toHaveBeenCalled(); expect(deleteSavedSession).not.toHaveBeenCalled();
  });

  it('offers explicit password or tab choices when basic WebAuthn support is unavailable', async () => {
    vi.mocked(passkeysAvailable).mockReturnValue(false);
    await render(); await approve();
    expect(button('Save with a passkey').disabled).toBe(true);
    expect(container.textContent).toContain('Passkeys are unavailable in this browser');
    expect(session.saveToDeviceWithPasskey).not.toHaveBeenCalled(); expect(session.saveToDevice).not.toHaveBeenCalled();
    await click(button('Continue for this tab without saving')); expect(onConnect).toHaveBeenCalledWith(session);
  });

  it('cancels a pending passkey save when closed and rejects its late session handoff', async () => {
    const saving = deferred<void>(); vi.mocked(session.saveToDeviceWithPasskey).mockReturnValue(saving.promise);
    await render(); await approve(); await click(button('Save with a passkey'));
    const options = vi.mocked(session.saveToDeviceWithPasskey).mock.calls[0][0]!;
    await click(container.querySelector<HTMLButtonElement>('button[aria-label="Cancel sign-in"]')!);
    expect(options.signal?.aborted).toBe(true); expect(onClose).toHaveBeenCalledOnce();
    await act(async () => saving.resolve());
    expect(onConnect).not.toHaveBeenCalled(); expect(session.dispose).toHaveBeenCalled();
  });

  it('does not reconnect from a passkey unlock that finishes after the dialog was closed', async () => {
    const unlocking = deferred<WalletSession>(); vi.mocked(getSavedSessionMethod).mockResolvedValue('passkey'); vi.mocked(unlockSavedSessionWithPasskey).mockReturnValue(unlocking.promise);
    await render(); await click(button('Unlock with a passkey'));
    const options = vi.mocked(unlockSavedSessionWithPasskey).mock.calls[0][0]!;
    await click(container.querySelector<HTMLButtonElement>('button[aria-label="Cancel sign-in"]')!);
    expect(options.signal?.aborted).toBe(true);
    await act(async () => unlocking.resolve(session));
    expect(onConnect).not.toHaveBeenCalled(); expect(session.dispose).toHaveBeenCalledOnce();
  });

  it('migrates an unlocked password vault only after passkey saving succeeds, without a new Hypersnap authorization', async () => {
    const saving = deferred<void>(); const notify = vi.fn();
    vi.mocked(getSavedSessionMethod).mockResolvedValue('password'); vi.mocked(session.saveToDeviceWithPasskey).mockReturnValue(saving.promise);
    await render(<DeviceSettings session={session} onClose={onClose} onLock={vi.fn()} notify={notify} />);
    expect(container.textContent).toContain('Encrypted key saved with a password'); expect(session.saveToDeviceWithPasskey).not.toHaveBeenCalled();
    await click(button('Save with a passkey'));
    expect(container.textContent).toContain('Encrypted key saved with a password');
    await act(async () => saving.resolve());
    expect(container.textContent).toContain('Encrypted key saved with a passkey');
    expect(preparePairing).not.toHaveBeenCalled(); expect(session.prepareRevocation).not.toHaveBeenCalled(); expect(deleteSavedSession).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('No new network authorization'));
  });

  it('preserves the old password vault and active session if passkey migration fails', async () => {
    const onLock = vi.fn(); vi.mocked(getSavedSessionMethod).mockResolvedValue('password'); vi.mocked(session.saveToDeviceWithPasskey).mockRejectedValue(new Error('Passkey encryption is unsupported.'));
    await render(<DeviceSettings session={session} onClose={onClose} onLock={onLock} notify={vi.fn()} />);
    await click(button('Save with a passkey'));
    expect(container.textContent).toContain('Encrypted key saved with a password'); expect(deleteSavedSession).not.toHaveBeenCalled(); expect(session.dispose).not.toHaveBeenCalled(); expect(onLock).not.toHaveBeenCalled(); expect(session.saveToDevice).not.toHaveBeenCalled();
    await click(button('Use password encryption instead')); expect(container.querySelector('#settings-device-password')).not.toBeNull();
  });

  it('does not let an earlier vault lookup overwrite a successful passkey migration', async () => {
    const storage = deferred<'password'>(); vi.mocked(getSavedSessionMethod).mockReturnValue(storage.promise);
    await render(<DeviceSettings session={session} onClose={onClose} onLock={vi.fn()} notify={vi.fn()} />);
    await click(button('Save with a passkey'));
    expect(container.textContent).toContain('Encrypted key saved with a passkey');
    await act(async () => storage.resolve('password'));
    expect(container.textContent).toContain('Encrypted key saved with a passkey');
    expect(container.textContent).not.toContain('Encrypted key saved with a password');
  });

  it('aborts password saving when the authorization dialog closes and rejects the late session handoff', async () => {
    const saving = deferred<void>(); vi.mocked(session.saveToDevice).mockReturnValue(saving.promise);
    await render(); await approve(); await click(button('Use a password instead'));
    await fill('new-device-password', 'new secure password'); await fill('confirm-device-password', 'new secure password'); await click(button('Save with a password'));
    const options = vi.mocked(session.saveToDevice).mock.calls[0][1]!;
    await click(container.querySelector<HTMLButtonElement>('button[aria-label="Cancel sign-in"]')!);
    expect(options.signal?.aborted).toBe(true);
    await act(async () => saving.resolve());
    expect(onConnect).not.toHaveBeenCalled(); expect(session.dispose).toHaveBeenCalled();
  });

  it('aborts password saving when device settings closes while keeping the active session connected', async () => {
    const saving = deferred<void>(); const notify = vi.fn(); vi.mocked(session.saveToDevice).mockReturnValue(saving.promise);
    await render(<DeviceSettings session={session} onClose={onClose} onLock={vi.fn()} notify={notify} />);
    await click(button('Use password encryption instead')); await fill('settings-device-password', 'new secure password'); await fill('settings-confirm-password', 'new secure password'); await click(button('Save with a password'));
    const options = vi.mocked(session.saveToDevice).mock.calls[0][1]!;
    await click(container.querySelector<HTMLButtonElement>('button[aria-label="Close dialog"]')!);
    expect(options.signal?.aborted).toBe(true);
    await act(async () => saving.resolve());
    expect(notify).not.toHaveBeenCalled(); expect(onClose).toHaveBeenCalledOnce(); expect(session.dispose).not.toHaveBeenCalled();
  });

  it('offers explicit local recovery for an unreadable saved key while keeping wallet reconnection available', async () => {
    vi.mocked(getSavedSessionMethod).mockRejectedValue(new Error('Malformed encrypted vault.'));
    await render();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('saved device key could not be read');
    expect(button('Find my account').disabled).toBe(false);
    expect(deleteSavedSession).not.toHaveBeenCalled();
    await click(button('Forget unreadable saved key'));
    expect(deleteSavedSession).toHaveBeenCalledWith();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(button('Forget unreadable saved key')).toBeUndefined();
    expect(preparePairing).not.toHaveBeenCalled(); expect(unlockSavedSessionWithPasskey).not.toHaveBeenCalled();
  });

  it('lets an active device explicitly forget an unreadable vault without revoking or disconnecting it', async () => {
    const onLock = vi.fn(); vi.mocked(getSavedSessionMethod).mockRejectedValue(new Error('Malformed encrypted vault.'));
    await render(<DeviceSettings session={session} onClose={onClose} onLock={onLock} notify={vi.fn()} />);
    expect(container.textContent).toContain('Saved vault could not be read; active key stays in this tab');
    expect(container.textContent).toContain('account cannot be verified');
    expect(deleteSavedSession).not.toHaveBeenCalled();
    await click(button('Forget unreadable vault'));
    expect(deleteSavedSession).toHaveBeenCalledWith();
    expect(button('Save with a passkey')).toBeDefined();
    expect(onLock).not.toHaveBeenCalled(); expect(session.dispose).not.toHaveBeenCalled(); expect(session.prepareRevocation).not.toHaveBeenCalled();
  });

  it('resets pending migration and old form state when device settings receives a replacement session', async () => {
    const saving = deferred<void>(); const notify = vi.fn(); const onLock = vi.fn();
    vi.mocked(getSavedSessionMethod).mockResolvedValue('password'); vi.mocked(session.saveToDeviceWithPasskey).mockReturnValue(saving.promise);
    await render(<DeviceSettings session={session} onClose={onClose} onLock={onLock} notify={notify} />);
    await click(button('Use password encryption instead')); await fill('settings-device-password', 'old secret password'); await fill('settings-confirm-password', 'old secret password');
    await click(button('Save with a passkey'));
    const oldSignal = vi.mocked(session.saveToDeviceWithPasskey).mock.calls[0][0]!.signal;
    const replacement = { ...makeSession(), publicKey: 'f'.repeat(64), user: { ...user, username: 'replacement-device' } };
    vi.mocked(getSavedSessionMethod).mockResolvedValue(undefined);
    await render(<DeviceSettings session={replacement} onClose={onClose} onLock={onLock} notify={notify} />);
    expect(oldSignal?.aborted).toBe(true);
    expect(container.textContent).toContain('@replacement-device'); expect(container.textContent).toContain('Key held only in this tab');
    expect(container.querySelector('#settings-device-password')).toBeNull(); expect(button('Lock').disabled).toBe(false); expect(button('Save with a passkey').disabled).toBe(false); expect(button('Revoke').disabled).toBe(false);
    await act(async () => saving.resolve());
    expect(notify).not.toHaveBeenCalled(); expect(container.textContent).not.toContain('Encrypted key saved with a passkey');
    expect(button('Save with a passkey').disabled).toBe(false);
    await click(button('Lock')); expect(onLock).toHaveBeenCalledOnce();
  });
});

describe('public identity review before key creation', () => {
  it.each([
    { input: '@isolated', lookup: { username: 'isolated' } },
    { input: '10', lookup: { fid: 10 } },
    { input: user.custody_address, lookup: { custodyAddress: user.custody_address } },
  ])('shows username, FID and full custody for $input before preparing only after an explicit review', async ({ input, lookup }) => {
    await render(<ConnectAccount onConnect={onConnect} onClose={onClose} />);
    expect(container.querySelector('main.onboarding')).not.toBeNull(); expect(container.querySelector('dialog')).toBeNull();
    expect(container.querySelector('.onboarding-domain-notice')?.textContent).toContain('Saved device keys and passkeys from quorum.arca.computer do not transfer here automatically.');
    expect(container.querySelector('.onboarding-domain-notice')?.textContent).toContain('Reconnect your existing custody wallet');
    expect(preparePairing).not.toHaveBeenCalled(); expect(approvePairingWithWallet).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(container.querySelector('h1'));
    await fill('account-identifier', input); await click(button('Find my account'));
    expect(getUser).toHaveBeenCalledWith(lookup, expect.any(AbortSignal));
    const summary = container.querySelector('section[aria-label="Account identity"]')!;
    const facts = Object.fromEntries([...summary.querySelectorAll('dl > div')].map(row => [row.querySelector('dt')?.textContent, row.querySelector('dd')?.textContent]));
    expect(facts).toEqual({ Username: '@isolated', FID: '10', 'Custody wallet': user.custody_address });
    expect(preparePairing).not.toHaveBeenCalled(); expect(approvePairingWithWallet).not.toHaveBeenCalled(); expect(container.querySelector('.wallet-list')).toBeNull();
    expect(container.querySelector('[aria-current="step"]')?.textContent).toContain('Review identity');
    expect(document.activeElement?.textContent).toBe('Is this your account?');
    await click(button('Use this account'));
    expect(preparePairing).toHaveBeenCalledWith({ fid: 10 }, expect.objectContaining({ requestedScopes: [1, 3, 4], signal: expect.any(AbortSignal) }));
    expect(container.querySelector('[aria-current="step"]')?.textContent).toContain('Approve wallet');
    expect(document.activeElement?.textContent).toBe('Approve this device in your wallet');
    expect(container.querySelector('details.onboarding-protocol')?.hasAttribute('open')).toBe(false);
    expect(container.querySelector('.onboarding-permissions')?.textContent).toContain('Approve before');
    expect(container.querySelector('.onboarding-permissions')?.textContent).toContain('Permission');
    expect(pending.complete).not.toHaveBeenCalled();
    await click(button('Use another account')); expect(document.activeElement?.textContent).toBe('Find your public account'); expect(button('Find my account').disabled).toBe(false);
  });

  it('keeps an unknown lookup on the public form and permits a safe retry without preparing a key', async () => {
    vi.mocked(getUser).mockRejectedValueOnce(new Error('This account was not found on Hypersnap.'));
    await render(); await click(button('Find my account'));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('not found'); expect(button('Find my account').disabled).toBe(false);
    expect(container.querySelector('section[aria-label="Account identity"]')).toBeNull(); expect(preparePairing).not.toHaveBeenCalled();
    await click(button('Find my account')); expect(button('Use this account')).toBeDefined(); expect(preparePairing).not.toHaveBeenCalled();
  });

  it.each([
    { input: '10', response: { ...user, fid: 11 } },
    { input: user.custody_address, response: { ...user, custody_address: `0x${'2'.repeat(40)}`, verified_addresses: { eth_addresses: [user.custody_address], sol_addresses: [] } } },
  ])('rejects a returned identity that does not match the public identifier $input', async ({ input, response }) => {
    vi.mocked(getUser).mockResolvedValue(response);
    await render(<ConnectAccount onConnect={onConnect} onClose={onClose} />); await fill('account-identifier', input); await click(button('Find my account'));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('different identity'); expect(button('Use this account')).toBeUndefined();
    expect(preparePairing).not.toHaveBeenCalled(); expect(approvePairingWithWallet).not.toHaveBeenCalled();
  });

  it('labels an account without a username truthfully while still showing its FID and full custody address', async () => {
    vi.mocked(getUser).mockResolvedValue({ ...user, username: 'fid:10' });
    await render(); await click(button('Find my account'));
    const summary = container.querySelector('section[aria-label="Account identity"]')!;
    expect(summary.textContent).toContain('Username unavailable on Hypersnap'); expect(summary.textContent).toContain('10'); expect(summary.textContent).toContain(user.custody_address); expect(summary.textContent).not.toContain('@fid:10');
    expect(preparePairing).not.toHaveBeenCalled();
  });

  it('requires another explicit review when freshly prepared custody or username changes', async () => {
    const address = `0x${'2'.repeat(40)}`; const changed = { ...user, username: 'updated-account', custody_address: address };
    pending = { ...pending, user: changed, request: { ...pending.request, custodyAddress: address } };
    vi.mocked(preparePairing).mockResolvedValue(pending);
    await render(); await reviewAccount();
    const summary = container.querySelector('section[aria-label="Account identity"]')!;
    expect(summary.textContent).toContain('@updated-account'); expect(summary.textContent).toContain(address); expect(summary.textContent).not.toContain(user.custody_address);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('details changed'); expect(container.querySelector('.wallet-list')).toBeNull();
    expect(approvePairingWithWallet).not.toHaveBeenCalled(); expect(button('Submit approved device key')).toBeUndefined();
    expect(document.activeElement?.textContent).toBe('Review the updated account');
    await click(button('Use updated account'));
    expect(preparePairing).toHaveBeenCalledOnce(); expect(button('Connect Rainbow extension & approve')).toBeDefined(); expect(pending.complete).not.toHaveBeenCalled();
  });

  it('disposes a prepared key if its request does not agree with the fresh account identity', async () => {
    pending = { ...pending, request: { ...pending.request, custodyAddress: `0x${'2'.repeat(40)}` } };
    vi.mocked(preparePairing).mockResolvedValue(pending);
    await render(); await reviewAccount();
    expect(pending.dispose).toHaveBeenCalledOnce(); expect(container.querySelector('[role="alert"]')?.textContent).toContain('does not match');
    expect(container.querySelector('.wallet-list')).toBeNull(); expect(button('Use this account').disabled).toBe(false); expect(approvePairingWithWallet).not.toHaveBeenCalled();
  });

  it('aborts a pending public lookup when leaving and ignores its late identity', async () => {
    const lookup = deferred<User>(); vi.mocked(getUser).mockReturnValue(lookup.promise);
    await render(); await click(button('Find my account')); const signal = vi.mocked(getUser).mock.calls[0][1]!;
    await click(container.querySelector<HTMLButtonElement>('button[aria-label="Cancel sign-in"]')!); expect(signal.aborted).toBe(true);
    await act(async () => lookup.resolve(user)); expect(container.querySelector('section[aria-label="Account identity"]')).toBeNull(); expect(preparePairing).not.toHaveBeenCalled(); expect(onClose).toHaveBeenCalledOnce();
  });

  it('disposes a prepared key that arrives after leaving the identity-review page', async () => {
    const preparing = deferred<PendingPairing>(); vi.mocked(preparePairing).mockReturnValue(preparing.promise);
    await render(); await reviewAccount(); const signal = vi.mocked(preparePairing).mock.calls[0][1].signal!;
    await click(container.querySelector<HTMLButtonElement>('button[aria-label="Cancel sign-in"]')!); expect(signal.aborted).toBe(true);
    await act(async () => preparing.resolve(pending)); expect(pending.dispose).toHaveBeenCalledOnce(); expect(container.querySelector('.wallet-list')).toBeNull(); expect(onConnect).not.toHaveBeenCalled();
  });
});

describe('ENS onboarding identity review', () => {
  it.each([
    { input: '@ALICE.ETH', name: 'alice.eth' },
    { input: '@Jesse.Base.ETH', name: 'jesse.base.eth' },
    { input: '0xarca.eth', name: '0xarca.eth' },
  ])('reviews $input as a lookup label alongside the canonical account, then prepares only its FID', async ({ input, name }) => {
    await render(<ConnectAccount onConnect={onConnect} onClose={onClose} />);
    expect(container.querySelector('label[for="account-identifier"]')?.textContent).toBe('Username, ENS name, FID, or custody wallet address');
    expect(container.querySelector<HTMLInputElement>('#account-identifier')?.placeholder).toContain('name.eth');
    expect(container.textContent).toContain('must already be linked to an account and indexed on Hypersnap'); expect(container.textContent).toContain('does not register names');
    await fill('account-identifier', input); await click(button('Find my account'));
    expect(getUser).toHaveBeenCalledWith({ ensName: name }, expect.any(AbortSignal));
    const summary = container.querySelector('section[aria-label="Account identity"]')!;
    const nameRow = [...summary.querySelectorAll('dl > div')].find(row => row.querySelector('dt')?.textContent === 'ENS name used for lookup')!;
    expect(nameRow.querySelector('dd > span')?.textContent).toBe(name); expect(nameRow.textContent).toContain('Lookup label only');
    expect(summary.textContent).toContain('@isolated'); expect(summary.textContent).toContain(user.custody_address); expect(summary.textContent).toContain('FID10');
    expect(preparePairing).not.toHaveBeenCalled(); expect(approvePairingWithWallet).not.toHaveBeenCalled();
    await click(button('Use this account'));
    expect(preparePairing).toHaveBeenCalledWith({ fid: 10 }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(container.textContent).not.toContain('ENS name used for lookup');
    await click(button('Use another account')); await fill('account-identifier', '10'); await click(button('Find my account'));
    expect(container.querySelector('section[aria-label="Account identity"]')?.textContent).not.toContain('ENS name used for lookup');
  });

  it.each(['sub.alice.eth', 'mañana.eth', `${'a'.repeat(17)}.eth`, 'arca.com'])('rejects unsupported name %s before any account request or key preparation', async input => {
    await render(<ConnectAccount onConnect={onConnect} onClose={onClose} />); await fill('account-identifier', input); await click(button('Find my account'));
    expect(container.querySelector('[role="alert"]')).not.toBeNull(); expect(getUser).not.toHaveBeenCalled(); expect(preparePairing).not.toHaveBeenCalled(); expect(button('Use this account')).toBeUndefined();
  });

  it('distinguishes a missing indexed name from an unavailable node and keeps both failures before key creation', async () => {
    vi.mocked(getUser).mockRejectedValueOnce(new ApiError('Missing name proof.', 404, 'ens_name_not_found')).mockRejectedValueOnce(new ApiError('Hypersnap name lookup is temporarily unavailable.', 503, 'upstream_error'));
    await render(<ConnectAccount onConnect={onConnect} onClose={onClose} />); await fill('account-identifier', 'missing.eth'); await click(button('Find my account'));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('No account is linked');
    expect(container.querySelector('.onboarding-lookup-recovery')?.textContent).toContain('FID or exact custody wallet address');
    expect(preparePairing).not.toHaveBeenCalled();
    await click(button('Find my account'));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('temporarily unavailable'); expect(container.querySelector('[role="alert"]')?.textContent).not.toContain('No account is linked');
    expect(container.querySelector('.onboarding-lookup-recovery')).toBeNull(); expect(preparePairing).not.toHaveBeenCalled(); expect(approvePairingWithWallet).not.toHaveBeenCalled();
  });

  it('removes the historical ENS label when a fresh account change requires another review', async () => {
    pending = { ...pending, user: { ...user, username: 'fresh-account' } }; vi.mocked(preparePairing).mockResolvedValue(pending);
    await render(<ConnectAccount onConnect={onConnect} onClose={onClose} />); await fill('account-identifier', 'alias.eth'); await click(button('Find my account'));
    expect(container.textContent).toContain('ENS name used for lookup');
    await click(button('Use this account'));
    expect(container.textContent).not.toContain('ENS name used for lookup'); expect(container.querySelector('section[aria-label="Account identity"]')?.textContent).toContain('@fresh-account');
    expect(button('Use updated account')).toBeDefined(); expect(container.querySelector('.wallet-list')).toBeNull(); expect(approvePairingWithWallet).not.toHaveBeenCalled();
  });

  it('aborts a cancelled ENS lookup and never lets its late result label a subsequent FID review', async () => {
    const lookup = deferred<User>(); vi.mocked(getUser).mockReturnValueOnce(lookup.promise);
    await render(<ConnectAccount onConnect={onConnect} onClose={onClose} />); await fill('account-identifier', 'alice.eth'); await click(button('Find my account'));
    expect(getUser).toHaveBeenCalledWith({ ensName: 'alice.eth' }, expect.any(AbortSignal)); const signal = vi.mocked(getUser).mock.calls[0][1]!;
    await click(container.querySelector<HTMLButtonElement>('button[aria-label="Cancel sign-in"]')!); expect(signal.aborted).toBe(true);
    await fill('account-identifier', '10'); await click(button('Find my account')); await act(async () => lookup.resolve(user));
    const summary = container.querySelector('section[aria-label="Account identity"]')!;
    expect(summary.textContent).toContain('@isolated'); expect(summary.textContent).not.toContain('ENS name used for lookup'); expect(preparePairing).not.toHaveBeenCalled(); expect(onConnect).not.toHaveBeenCalled();
  });
});

describe('explicit browser-wallet approval controls', () => {
  it('requires a choice among detected wallets and recovers from the ordinary-account mismatch with an explicit retry', async () => {
    const rainbow: InjectedWallet = { id: 'rainbow', name: 'Rainbow', rdns: 'me.rainbow', provider: { request: vi.fn() } };
    const coinbase: InjectedWallet = { id: 'coinbase', name: 'Coinbase Wallet', rdns: 'com.coinbase.wallet', provider: { request: vi.fn() } };
    let announce!: (wallets: InjectedWallet[]) => void;
    vi.mocked(discoverInjectedWallets).mockImplementation(callback => { announce = callback; callback([rainbow]); return () => {}; });
    vi.mocked(approvePairingWithWallet).mockRejectedValueOnce(new Error('Connect the custody address shown for this identity in your wallet. A different verified wallet cannot authorize this account.'));
    await render(); await reviewAccount();
    expect(button('Connect Rainbow extension & approve').disabled).toBe(false);
    await act(async () => announce([rainbow, coinbase]));
    const field = container.querySelector<HTMLSelectElement>('.wallet-list select')!;
    expect(field.value).toBe(''); expect(field.options).toHaveLength(3); expect(button('Choose a browser wallet').disabled).toBe(true);
    expect(approvePairingWithWallet).not.toHaveBeenCalled();
    await selectWallet('Coinbase Wallet'); await click(button('Connect Coinbase Wallet & approve'));
    expect(approvePairingWithWallet).toHaveBeenLastCalledWith(pending.request, coinbase.provider, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(container.querySelector('.wallet-approval-feedback [role="alert"]')?.textContent).toContain('custody address');
    expect(container.querySelector('.wallet-account-help')?.textContent).toContain('everyday wallet');
    expect(container.textContent).toContain('two typed-data signatures'); expect(container.textContent).toContain('mint an NFT');
    expect(button('Retry Coinbase Wallet approval').disabled).toBe(false);
    await click(button('Retry Coinbase Wallet approval'));
    expect(approvePairingWithWallet).toHaveBeenCalledTimes(2);
    expect(container.querySelector('.wallet-approved')?.textContent).toContain('Coinbase Wallet');
    expect(button('Submit approved device key').disabled).toBe(false); expect(pending.complete).not.toHaveBeenCalled();
  });

  it('cancels a hung second signature, permits another wallet, and ignores the cancelled attempt’s late approval and progress', async () => {
    const coinbase: InjectedWallet = { id: 'coinbase', name: 'Coinbase Wallet', provider: { request: vi.fn() } };
    const rainbow: InjectedWallet = { id: 'rainbow', name: 'Rainbow', rdns: 'me.rainbow', provider: { request: vi.fn() } };
    const stalled = deferred<PairingApproval>();
    vi.mocked(discoverInjectedWallets).mockImplementation(callback => { callback([coinbase, rainbow]); return () => {}; });
    vi.mocked(approvePairingWithWallet).mockReturnValueOnce(stalled.promise);
    await render(); await reviewAccount(); await selectWallet('Coinbase Wallet'); await click(button('Connect Coinbase Wallet & approve'));
    const old = vi.mocked(approvePairingWithWallet).mock.calls[0][2]!;
    await act(async () => old.onProgress?.('Approve the Hypersnap key request in your wallet (2 of 2)…'));
    expect(container.querySelector('.wallet-approval-feedback [role="status"]')?.textContent).toContain('(2 of 2)');
    expect(button('Cancel wallet approval').disabled).toBe(false);
    await click(button('Cancel wallet approval')); expect(old.signal?.aborted).toBe(true);
    expect(button('Retry Coinbase Wallet approval').disabled).toBe(false);
    await selectWallet('Rainbow'); await click(button('Connect Rainbow extension & approve'));
    expect(container.querySelector('.wallet-approved')?.textContent).toContain('Rainbow');
    await act(async () => { old.onProgress?.('Stale Coinbase wallet progress'); stalled.resolve(walletApproval); });
    expect(container.querySelector('.wallet-approved')?.textContent).toContain('Rainbow');
    expect(container.querySelector('.wallet-approved')?.textContent).not.toContain('Coinbase');
    expect(container.textContent).not.toContain('Stale Coinbase wallet progress'); expect(pending.complete).not.toHaveBeenCalled();
  });

  it('pins the chosen provider across late discovery replacements and re-detects it only after an explicit refresh', async () => {
    const original: InjectedWallet = { id: 'fallback', name: 'Browser wallet', provider: { request: vi.fn() } };
    const replacement: InjectedWallet = { id: 'coinbase', name: 'Coinbase Wallet', provider: { request: vi.fn() } };
    let announce!: (wallets: InjectedWallet[]) => void; let scans = 0;
    vi.mocked(discoverInjectedWallets).mockImplementation(callback => { announce = callback; callback(scans++ ? [replacement] : [original]); return () => {}; });
    const stalled = deferred<PairingApproval>(); vi.mocked(approvePairingWithWallet).mockReturnValueOnce(stalled.promise);
    await render(); await reviewAccount(); await click(button('Connect Browser wallet & approve'));
    await act(async () => announce([replacement]));
    expect(vi.mocked(approvePairingWithWallet).mock.calls[0][1]).toBe(original.provider);
    await click(button('Cancel wallet approval')); await click(button('Retry Browser wallet approval'));
    expect(vi.mocked(approvePairingWithWallet).mock.calls[1][1]).toBe(original.provider);
    await click(button('Refresh browser wallets')); await click(button('Connect Coinbase Wallet & approve'));
    expect(vi.mocked(approvePairingWithWallet).mock.calls[2][1]).toBe(replacement.provider);
    await act(async () => stalled.resolve(walletApproval));
    expect(container.querySelector('.wallet-approved')?.textContent).toContain('Coinbase Wallet'); expect(pending.complete).not.toHaveBeenCalled();
  });

  it('aborts an expired wallet request and rejects its late approval without leaving the account controls busy', async () => {
    vi.useFakeTimers();
    pending = { ...pending, request: { ...pending.request, deadline: Math.floor(Date.now() / 1000) - 1609459200 + 1 } };
    vi.mocked(preparePairing).mockResolvedValue(pending);
    const stalled = deferred<PairingApproval>(); vi.mocked(approvePairingWithWallet).mockReturnValue(stalled.promise);
    await render(); await reviewAccount(); await click(button('Connect Rainbow extension & approve'));
    const old = vi.mocked(approvePairingWithWallet).mock.calls[0][2]!;
    await act(async () => vi.advanceTimersByTime(2_000));
    expect(old.signal?.aborted).toBe(true); expect(button('Use another account').disabled).toBe(false);
    expect(container.querySelector('.wallet-approval-feedback')?.textContent).toContain('expired');
    await act(async () => stalled.resolve(walletApproval));
    expect(container.querySelector('.wallet-approved')).toBeNull(); expect(pending.complete).not.toHaveBeenCalled();
    await click(button('Use another account')); expect(button('Find my account').disabled).toBe(false);
  });

  it('aborts wallet approval when the dialog closes and ignores a provider that resolves afterwards', async () => {
    const stalled = deferred<PairingApproval>(); vi.mocked(approvePairingWithWallet).mockReturnValue(stalled.promise);
    await render(); await reviewAccount(); await click(button('Connect Rainbow extension & approve'));
    const old = vi.mocked(approvePairingWithWallet).mock.calls[0][2]!;
    await click(container.querySelector<HTMLButtonElement>('button[aria-label="Cancel sign-in"]')!);
    expect(old.signal?.aborted).toBe(true); expect(onClose).toHaveBeenCalledOnce();
    await act(async () => stalled.resolve(walletApproval));
    expect(onConnect).not.toHaveBeenCalled(); expect(pending.complete).not.toHaveBeenCalled(); expect(container.querySelector('.wallet-approved')).toBeNull();
  });

  it('keeps revocation submission busy when its wallet-approval deadline passes during confirmation', async () => {
    vi.useFakeTimers();
    const request: RevocationRequest = { kind: 'arca.hypersnap.signer.revoke.request', version: 1, origin: pending.request.origin, requestId: pending.request.requestId, createdAt: pending.request.createdAt, fid: user.fid, custodyAddress: user.custody_address, publicKey: session.publicKey, nonce: 2, deadline: Math.floor(Date.now() / 1000) - 1609459200 + 1 };
    const approval: RevocationApproval = { kind: 'arca.hypersnap.signer.revoke.approval', version: 1, requestId: request.requestId, requestHash: 'c'.repeat(64), custodyAddress: request.custodyAddress, custodySignature: 'd'.repeat(130), signatureType: 1 };
    const confirmation = deferred<void>(); const onLock = vi.fn(); const notify = vi.fn();
    const revocation: PendingRevocation = { request, submitted: false, dispose: vi.fn(), complete: vi.fn().mockReturnValue(confirmation.promise) };
    vi.mocked(session.prepareRevocation).mockResolvedValue(revocation); vi.mocked(approveRevocationWithWallet).mockResolvedValue(approval);
    await render(<DeviceSettings session={session} onClose={onClose} onLock={onLock} notify={notify} />);
    await click(button('Revoke')); await click(button('Connect Rainbow extension & approve')); await click(button('Submit revocation and confirm removal'));
    expect(button('Checking revocation…').disabled).toBe(true); expect(container.querySelector('.wallet-list')).toBeNull();
    await act(async () => vi.advanceTimersByTime(2_000));
    expect(button('Checking revocation…').disabled).toBe(true); expect(button('Close request; keep local key').disabled).toBe(true);
    expect(revocation.complete).toHaveBeenCalledOnce(); expect(onLock).not.toHaveBeenCalled();
    await act(async () => confirmation.resolve());
    expect(onLock).toHaveBeenCalledWith(true); expect(notify).toHaveBeenCalledWith(expect.stringContaining('authorization was revoked'));
  });
});
