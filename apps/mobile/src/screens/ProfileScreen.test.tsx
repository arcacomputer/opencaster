// @vitest-environment happy-dom
import { act, type ComponentProps, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Alert } from 'react-native';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProfileScreen } from './ProfileScreen';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  navigate: vi.fn(),
  hideUser: vi.fn(),
  profile: { phase: 'error' as const, error: 'Profile unavailable', retry: vi.fn() },
}));

vi.mock('@opencaster/client-core/api', () => ({ getProfileFeed: vi.fn(), getUser: vi.fn() }));
vi.mock('react-native', () => ({
  Alert: { alert: vi.fn() },
  FlatList: ({ ListHeaderComponent, ListEmptyComponent, ListFooterComponent }: {
    ListHeaderComponent?: ReactNode;
    ListEmptyComponent?: ReactNode;
    ListFooterComponent?: ReactNode;
  }) => <div>{ListHeaderComponent}{ListEmptyComponent}{ListFooterComponent}</div>,
  Image: () => null,
  RefreshControl: () => null,
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock('../components/CastCard', () => ({ CastCard: () => null }));
vi.mock('../components/IconButton', () => ({
  IconButton: ({ label, onPress }: { label: string; onPress: () => void }) => (
    <button aria-label={label} onClick={onPress}>{label}</button>
  ),
}));
vi.mock('../components/LocalContentNotice', () => ({ LocalContentNotice: () => <p>Local safety notice</p> }));
vi.mock('../components/Primitives', () => ({
  ActionButton: ({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) => (
    <button onClick={onPress} disabled={disabled}>{label}</button>
  ),
  LoadingMessage: ({ label }: { label: string }) => <p>{label}</p>,
  ScreenMessage: ({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }) => (
    <div><p>{title}</p>{detail ? <p>{detail}</p> : null}{action}</div>
  ),
}));
vi.mock('../lib/LocalContentProvider', () => ({
  useLocalContent: () => ({
    snapshot: { phase: 'ready', data: { version: 1, users: [], casts: [] } },
    localContent: { hideUser: mocks.hideUser, getSnapshot: () => ({ error: null }) },
  }),
}));
vi.mock('../lib/usePagedCasts', () => ({
  usePagedCasts: () => ({
    phase: 'ready', casts: [], error: null, retryKind: null, retry: vi.fn(), loadMore: vi.fn(),
    loadingMore: false, nextCursor: null, refreshing: false, refresh: vi.fn(),
  }),
}));
vi.mock('../lib/usePublicRead', () => ({ usePublicRead: () => mocks.profile }));

let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.hideUser.mockResolvedValue(true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const props = {
    navigation: { push: mocks.push, navigate: mocks.navigate },
    route: { key: 'Profile-42', name: 'Profile', params: { fid: 42 } },
  } as unknown as ComponentProps<typeof ProfileScreen>;
  await act(async () => root.render(<ProfileScreen {...props} />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

function button(label: string) {
  const result = [...container.querySelectorAll('button')]
    .find(node => node.getAttribute('aria-label') === label || node.textContent === label);
  expect(result, label).toBeDefined();
  return result!;
}

async function click(label: string) {
  await act(async () => button(label).click());
}

it('keeps report access available after profile lookup failure with no posts', async () => {
  expect(container.textContent).toContain('Profile details unavailable');
  expect(container.textContent).toContain('No public casts are available.');

  await click('More options for FID 42');
  const choices = vi.mocked(Alert.alert).mock.calls.at(-1)![2]!;
  const report = choices.find(choice => choice.text === 'Report user by email')!;
  await act(async () => report.onPress?.());

  expect(mocks.push).toHaveBeenCalledWith('Support', { kind: 'user', fid: 42 });
  expect(mocks.hideUser).not.toHaveBeenCalled();
});

it('requires a separate confirmation before hiding a user after profile lookup failure', async () => {
  await click('More options for FID 42');
  const options = vi.mocked(Alert.alert).mock.calls.at(-1)![2]!;
  const hide = options.find(choice => choice.text === 'Hide user')!;
  await act(async () => hide.onPress?.());

  expect(vi.mocked(Alert.alert).mock.calls.at(-1)![0]).toBe('Hide FID 42 on this device?');
  expect(mocks.hideUser).not.toHaveBeenCalled();

  const confirmation = vi.mocked(Alert.alert).mock.calls.at(-1)![2]!;
  const confirmHide = confirmation.find(choice => choice.text === 'Hide user')!;
  await act(async () => confirmHide.onPress?.());
  expect(mocks.hideUser).toHaveBeenCalledWith(42);
});
