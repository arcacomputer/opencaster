import { getReactionStatus } from '@opencaster/client-core/api';
import { useCallback } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useAuthorization } from '../lib/AuthorizationProvider';
import type { CastTarget, ReactionKind } from '../lib/socialAction';
import { usePublicRead } from '../lib/usePublicRead';
import { palette } from '../theme';
import { ActionButton, LoadingMessage, ScreenMessage } from './Primitives';

export function CastActions({ target, onReply, intent, onDeviceAccess }: { target: CastTarget; onReply: () => void; intent?: ReactionKind; onDeviceAccess: () => void }) {
  const { authorization, snapshot } = useAuthorization();
  const fid = snapshot.request?.fid;
  const read = useCallback(async (signal: AbortSignal) => {
    if (!fid) throw new Error('Unlock a device first.');
    const cast = { fid: target.fid, hash: target.hash };
    const [like, recast] = await Promise.all([
      getReactionStatus(fid, cast, 'like', signal, { fresh: true }),
      getReactionStatus(fid, cast, 'recast', signal, { fresh: true }),
    ]);
    return { like, recast };
  }, [fid, target.fid, target.hash]);
  const state = usePublicRead(`reactions:${fid}:${snapshot.request?.publicKey}:${target.fid}:${target.hash}:${snapshot.authorized}:${snapshot.action?.hash}:${snapshot.action?.status}`, snapshot.authorized ? read : null);
  const disabled = !snapshot.authorized || snapshot.busy || snapshot.action?.status === 'pending';
  const confirm = (reaction: ReactionKind, desired: boolean) => Alert.alert(
    `${desired ? 'Add' : 'Remove'} ${reaction}?`,
    `FID ${fid} will ${desired ? 'add' : 'remove'} a public ${reaction} on FID ${target.fid}'s cast ${target.hash}.`,
    [{ text: 'Cancel', style: 'cancel' }, { text: 'Confirm', onPress: () => void authorization.react(target, reaction, desired).then(state.retry) }],
  );
  return (
    <View style={styles.panel}>
      <Text style={styles.title}>{snapshot.authorized ? 'Review your public reaction' : 'Connect to join the conversation'}</Text>
      {!snapshot.authorized ? <ActionButton label="Connect your account" onPress={onDeviceAccess} /> : null}
      {snapshot.action?.status === 'pending' ? <>
        <Text style={styles.detail}>A submission is unresolved. New actions are blocked; checking status never resubmits.</Text>
        <ActionButton label="Check submission status" onPress={() => void authorization.checkAction()} disabled={snapshot.busy} />
      </> : null}
      {snapshot.error ? <Text accessibilityRole="alert" style={styles.detail}>{snapshot.error}</Text> : null}
      {snapshot.notice ? <Text accessibilityLiveRegion="polite" style={styles.detail}>{snapshot.notice}</Text> : null}
      {!intent ? <ActionButton label="Reply" onPress={onReply} disabled={disabled} /> : null}
      {state.phase === 'loading' ? <LoadingMessage label="Checking your reaction state…" /> : null}
      {state.phase === 'error' ? <ScreenMessage title="Reaction state unavailable" detail={state.error} action={<ActionButton label="Retry reaction status" onPress={state.retry} disabled={snapshot.busy} secondary />} /> : null}
      {state.phase === 'ready' ? (intent ? [intent] : ['like', 'recast'] as const).map(reaction => (
        <ActionButton key={reaction} label={state.value[reaction] ? `Remove ${reaction}` : `Add ${reaction}`}
          disabled={disabled} secondary onPress={() => confirm(reaction, !state.value[reaction])} />
      )) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 10, padding: 18 },
  title: { color: palette.text, fontWeight: '700', fontSize: 15 },
  detail: { color: palette.muted, fontSize: 14, lineHeight: 21 },
});
