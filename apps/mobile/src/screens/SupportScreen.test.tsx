// @vitest-environment happy-dom
import { act, type ComponentProps, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Linking } from 'react-native';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SupportScreen } from './SupportScreen';

vi.mock('react-native', () => ({
  Linking: { openURL: vi.fn() },
  StyleSheet: { create: (value: unknown) => value },
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  TextInput: ({ value, onChangeText }: { value: string; onChangeText: (value: string) => void }) => (
    <textarea value={value} onInput={event => onChangeText(event.currentTarget.value)} onChange={() => {}} />
  ),
}));
vi.mock('@react-navigation/elements', () => ({ useHeaderHeight: () => 64 }));
vi.mock('react-native-keyboard-controller', () => ({ KeyboardAvoidingView: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('../components/Primitives', () => ({
  ActionButton: ({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) => (
    <button onClick={onPress} disabled={disabled}>{label}</button>
  ),
}));

let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(Linking.openURL).mockResolvedValue(undefined);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const props = { route: { params: { kind: 'user', fid: 42 } } } as ComponentProps<typeof SupportScreen>;
  await act(async () => root.render(<SupportScreen {...props} />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

function button(label: string) {
  return [...container.querySelectorAll('button')].find(node => node.textContent === label)!;
}
async function describeIssue() {
  await act(async () => {
    const input = container.querySelector('textarea')!;
    input.value = 'Please review this user.';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it('requires review and explicit handoff, and editing never opens email', async () => {
  expect(button('Review email').disabled).toBe(true);
  await describeIssue();
  await act(async () => button('Review email').click());
  expect(Linking.openURL).not.toHaveBeenCalled();
  expect(container.textContent).toContain('To: support@opencaster.org');
  expect(container.textContent).toContain('User FID 42');
  await act(async () => button('Edit draft').click());
  expect(container.querySelector('textarea')!.value).toBe('Please review this user.');
  expect(Linking.openURL).not.toHaveBeenCalled();
  await act(async () => button('Review email').click());
  await act(async () => button('Open email draft').click());
  expect(Linking.openURL).toHaveBeenCalledTimes(1);
  expect(Linking.openURL).toHaveBeenCalledWith(expect.stringContaining('mailto:support@opencaster.org?subject='));
  expect(container.textContent).toContain('OpenCaster cannot confirm that it was sent or received.');
});

it('preserves the reviewed email and provides manual fallback when handoff fails', async () => {
  vi.mocked(Linking.openURL).mockRejectedValue(new Error('No mail handler'));
  await describeIssue();
  await act(async () => button('Review email').click());
  await act(async () => button('Open email draft').click());
  expect(container.textContent).toContain('Could not open an email app. Nothing was sent by OpenCaster.');
  expect(container.textContent).toContain('Please review this user.');
  expect(container.textContent).toContain('Subject: OpenCaster user report');
  expect(button('Edit draft').disabled).toBe(false);
});
