import { IconButton } from './IconButton';

export function StackBackButton({ navigation }: {
  navigation: { canGoBack: () => boolean; goBack: () => void };
}) {
  if (!navigation.canGoBack()) return null;
  return <IconButton icon="arrow-left" label="Go back" onPress={() => navigation.goBack()} />;
}
