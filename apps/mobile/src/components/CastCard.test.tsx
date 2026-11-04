// @vitest-environment happy-dom
import type { Cast } from '@opencaster/client-core/api';
import { act, type EffectCallback, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Alert, Platform } from 'react-native';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CastCard } from './CastCard';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(), report: vi.fn(), react: vi.fn(), status: vi.fn(), hide: vi.fn(), check: vi.fn(),
  dismiss: undefined as (() => void) | undefined,
  snapshot: { authorized: false, busy: false, request: undefined as { fid: number; publicKey: string } | undefined,
    action: undefined as { status: 'pending' } | undefined, error: null, notice: null },
}));
vi.mock('@expo/vector-icons/Feather', () => ({ default: () => null }));
vi.mock('@opencaster/client-core/api', () => ({ getReactionStatus: mocks.status }));
vi.mock('@react-navigation/native', async () => {
  const { useEffect } = await import('react');
  return { useNavigation: () => ({ navigate: mocks.navigate }), useFocusEffect: (callback: EffectCallback) => useEffect(callback, [callback]) };
});
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock('react-native', () => ({
  Alert: { alert: vi.fn() }, Platform: { OS: 'android' },
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Image: () => null, ActivityIndicator: () => null,
  Modal: ({ children, visible, onDismiss }: { children: ReactNode; visible: boolean; onDismiss: () => void }) => {
    mocks.dismiss = onDismiss;
    return visible ? <div>{children}</div> : null;
  },
  Pressable: ({ children, onPress, disabled, accessibilityLabel }: { children: ReactNode; onPress: () => void; disabled?: boolean; accessibilityLabel?: string }) => (
    <button aria-label={accessibilityLabel} onClick={onPress} disabled={disabled}>{children}</button>
  ),
}));
vi.mock('../lib/AuthorizationProvider', () => ({ useAuthorization: () => ({ snapshot: mocks.snapshot, authorization: { react: mocks.react, checkAction: mocks.check } }) }));
vi.mock('../lib/LocalContentProvider', () => ({ useLocalContent: () => ({
  snapshot: { phase: 'ready', busy: false, data: { version: 1, users: [], casts: [] } },
  localContent: { hideCast: mocks.hide, hideUser: mocks.hide },
}) }));
vi.mock('../lib/openHttpsUrl', () => ({ openHttpsUrl: vi.fn() }));

const cast = { hash: 'a'.repeat(40), author: { fid: 42, username: 'alice', display_name: 'Alice' },
  text: 'Hello', timestamp: '2026-11-04T12:00:00Z', embeds: [], replies: { count: 3 }, reactions: { likes_count: 5, recasts_count: 2 } } as unknown as Cast;
let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Platform.OS = 'android';
  Object.assign(mocks.snapshot, { authorized: false, busy: false, request: undefined, action: undefined, error: null, notice: null });
  mocks.status.mockResolvedValue(false);
  mocks.hide.mockResolvedValue(true);
  mocks.react.mockResolvedValue(undefined);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.resetAllMocks(); vi.unstubAllGlobals();
});
async function render() {
  await act(async () => root.render(<CastCard cast={cast} onAuthorPress={vi.fn()} onThreadPress={vi.fn()} onReport={mocks.report} />));
}
function button(label: string) {
  const result = [...container.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === label || node.textContent === label);
  expect(result, label).toBeDefined(); return result!;
}
async function click(label: string) { await act(async () => button(label).click()); }

it('keeps management controls and reaction reads out of the normal timeline', async () => {
  await render();
  expect(container.textContent).not.toContain('Report post by email');
  expect(mocks.status).not.toHaveBeenCalled();
  await click('Reply to Alice, 3');
  expect(mocks.navigate).toHaveBeenCalledWith('Compose', { parent: { fid: 42, hash: cast.hash } });
  expect(mocks.react).not.toHaveBeenCalled();
});
it('routes a locked reaction to account access without querying or writing', async () => {
  await render(); await click('Like post by Alice, 5'); await click('Connect your account');
  expect(mocks.navigate).toHaveBeenCalledWith('DeviceAccess');
  expect(mocks.status).not.toHaveBeenCalled(); expect(mocks.react).not.toHaveBeenCalled();
});
it('requires the existing public-write confirmation after checking reaction state on demand', async () => {
  mocks.snapshot.authorized = true; mocks.snapshot.request = { fid: 99, publicKey: 'synthetic-key' };
  await render(); expect(mocks.status).not.toHaveBeenCalled();
  await click('Like post by Alice, 5'); expect(mocks.status).toHaveBeenCalledTimes(2);
  await click('Add like'); expect(mocks.react).not.toHaveBeenCalled();
  const choices = vi.mocked(Alert.alert).mock.calls.at(-1)![2]!;
  expect(choices.map(choice => choice.text)).toEqual(['Cancel', 'Confirm']);
  await act(async () => choices[1].onPress?.());
  expect(mocks.react).toHaveBeenCalledWith({ fid: 42, hash: cast.hash }, 'like', true);
});
it('preserves pending-action blocking and exposes read-only recovery in the sheet', async () => {
  mocks.snapshot.authorized = true; mocks.snapshot.request = { fid: 99, publicKey: 'synthetic-key' }; mocks.snapshot.action = { status: 'pending' };
  await render(); await click('Like post by Alice, 5');
  expect(button('Add like').disabled).toBe(true);
  await click('Check submission status'); expect(mocks.check).toHaveBeenCalledOnce(); expect(mocks.react).not.toHaveBeenCalled();
});
it('keeps local hiding behind explicit confirmation', async () => {
  await render(); await click('More options for post by Alice'); await click('Hide this post');
  expect(mocks.hide).not.toHaveBeenCalled();
  const choices = vi.mocked(Alert.alert).mock.calls.at(-1)![2]!;
  await act(async () => choices[1].onPress?.()); expect(mocks.hide).toHaveBeenCalledWith(cast.hash);
});
it('waits for iOS modal dismissal before navigating to a report', async () => {
  Platform.OS = 'ios';
  await render(); await click('More options for post by Alice'); await click('Report post by email');
  expect(mocks.report).not.toHaveBeenCalled();
  await act(async () => mocks.dismiss?.()); expect(mocks.report).toHaveBeenCalledOnce();
  await act(async () => mocks.dismiss?.()); expect(mocks.report).toHaveBeenCalledOnce();
});
