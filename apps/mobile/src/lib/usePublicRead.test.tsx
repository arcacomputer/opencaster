// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { usePublicRead } from './usePublicRead';

vi.mock('@react-navigation/native', async () => {
  const { useEffect } = await import('react');
  return { useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]) };
});

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function Harness({ read }: { read(signal: AbortSignal): Promise<string> }) {
  const [render, setRender] = useState(0);
  const state = usePublicRead('stable-read', read);
  return <button onClick={() => setRender(value => value + 1)}>{state.phase}:{render}</button>;
}

it('does not repeat a stable public read after an unrelated render', async () => {
  const read = vi.fn(async () => 'ready');
  await act(async () => root.render(<Harness read={read} />));
  expect(read).toHaveBeenCalledOnce();

  await act(async () => container.querySelector('button')!.click());
  expect(container.textContent).toBe('ready:1');
  expect(read).toHaveBeenCalledOnce();
});
