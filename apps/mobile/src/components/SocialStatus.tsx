import { StyleSheet, Text, View } from 'react-native';
import { useAuthorization } from '../lib/AuthorizationProvider';
import { palette } from '../theme';
import { ActionButton } from './Primitives';

export function SocialStatus({ onDeviceAccess, onOpenCast, compact = false }: { onDeviceAccess: () => void; onOpenCast: (hash: string) => void; compact?: boolean }) {
  const { authorization, snapshot } = useAuthorization();
  const { action } = snapshot;
  if (compact && !snapshot.busy && !action && !snapshot.error && !snapshot.notice) return null;
  return (
    <View style={styles.panel}>
      {!compact ? <><Text style={styles.title}>{snapshot.authorized ? `Device unlocked · FID ${snapshot.request?.fid}` : 'Posting requires an authorized, unlocked device'}</Text>
      <ActionButton label="Manage device access" onPress={onDeviceAccess} secondary /></> : null}
      {!compact && snapshot.phase !== 'locked' && snapshot.phase !== 'empty'
        ? <ActionButton label={snapshot.busy ? 'Stop waiting and lock' : 'Lock device'} onPress={authorization.lock} secondary /> : null}
      {snapshot.busy ? <Text accessibilityLiveRegion="polite" style={styles.detail}>Working… no success is assumed.</Text> : null}
      {action ? (
        <View style={styles.receipt}>
          <Text style={styles.title}>{action.status === 'pending' ? 'Submission unresolved' : 'Last result confirmed by node'}</Text>
          <Text selectable style={styles.detail}>{action.kind === 'cast' ? (action.parent ? 'Reply' : 'Post') : `${action.desired ? 'Add' : 'Remove'} ${action.reaction}`} · {action.hash}</Text>
          {action.status === 'pending' ? <>
            <Text style={styles.detail}>It may have reached Hypersnap. New actions are blocked; checking status only reads and never resubmits. Locking, forgetting or revoking the device cannot retract an earlier message.</Text>
            <ActionButton label="Check submission status" disabled={snapshot.busy} onPress={() => void authorization.checkAction()} />
          </> : action.kind === 'cast'
            ? <ActionButton label="Open confirmed cast" onPress={() => onOpenCast(action.hash)} secondary />
            : <Text style={styles.detail}>The intended reaction state was visible, not an independently verified message receipt.</Text>}
        </View>
      ) : null}
      {snapshot.error ? <Text accessibilityRole="alert" style={styles.error}>{snapshot.error}</Text> : null}
      {snapshot.notice ? <Text accessibilityLiveRegion="polite" style={styles.detail}>{snapshot.notice}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 10, padding: 18, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.border },
  receipt: { gap: 10 },
  title: { color: palette.text, fontWeight: '700', fontSize: 15 },
  detail: { color: palette.muted, lineHeight: 21, fontSize: 14 },
  error: { color: palette.text, lineHeight: 21, fontSize: 14 },
});
