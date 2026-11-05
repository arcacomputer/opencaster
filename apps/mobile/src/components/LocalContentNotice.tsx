import { useLocalContent } from '../lib/LocalContentProvider';
import { ActionButton, LoadingMessage, ScreenMessage } from './Primitives';

export function LocalContentNotice({ onManage, hidden = false }: { onManage: () => void; hidden?: boolean }) {
  const { snapshot } = useLocalContent();
  if (snapshot.phase === 'loading') return <LoadingMessage label="Loading saved content filters…" />;
  return <ScreenMessage
    title={hidden ? 'Hidden on this device' : 'Content filters need attention'}
    detail={hidden ? 'Your local content settings hide this item. This does not delete or report it, or block anyone on the network.' : snapshot.error}
    action={<ActionButton label="Safety and data" onPress={onManage} secondary />}
  />;
}
