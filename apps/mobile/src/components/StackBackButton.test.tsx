import { expect, it, vi } from 'vitest';
import { StackBackButton } from './StackBackButton';

vi.mock('./IconButton', () => ({ IconButton: () => null }));

it('offers an explicit return action when the JS stack has a previous route', () => {
  const navigation = { canGoBack: () => true, goBack: vi.fn() };
  const button = StackBackButton({ navigation });

  expect(button).not.toBeNull();
  expect(button!.props.label).toBe('Go back');
  button!.props.onPress();
  expect(navigation.goBack).toHaveBeenCalledOnce();
});

it('does not offer a return action at the root', () => {
  const navigation = { canGoBack: () => false, goBack: vi.fn() };
  expect(StackBackButton({ navigation })).toBeNull();
  expect(navigation.goBack).not.toHaveBeenCalled();
});
