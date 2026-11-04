// @vitest-environment happy-dom
import { getUser, type User } from '@opencaster/client-core/api';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAuthorizationIdentityReads } from './useAuthorizationIdentityReads';

vi.mock('@react-navigation/native', async () => {
  const { useEffect } = await import('react');
  return { useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]) };
});
vi.mock('@opencaster/client-core/api', () => ({ getUser: vi.fn() }));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(getUser).mockResolvedValue({
    fid: 1234,
    username: 'alice',
    custody_address: `0x${'11'.repeat(20)}`,
    profile: { bio: { text: '' } },
    follower_count: 0,
    following_count: 0,
  } satisfies User);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function Harness() {
  const [render, setRender] = useState(0);
  const { lookup, savedIdentity } = useAuthorizationIdentityReads('alice', 1234);
  return (
    <button onClick={() => setRender(value => value + 1)}>
      {lookup.phase}:{savedIdentity.phase}:{render}
    </button>
  );
}

it('does not repeat identity reads after an unrelated render', async () => {
  await act(async () => root.render(<Harness />));
  expect(getUser).toHaveBeenCalledTimes(2);
  expect(getUser).toHaveBeenCalledWith({ username: 'alice' }, expect.any(AbortSignal));
  expect(getUser).toHaveBeenCalledWith({ fid: 1234 }, expect.any(AbortSignal));

  await act(async () => container.querySelector('button')!.click());
  expect(container.textContent).toBe('ready:ready:1');
  expect(getUser).toHaveBeenCalledTimes(2);
});
