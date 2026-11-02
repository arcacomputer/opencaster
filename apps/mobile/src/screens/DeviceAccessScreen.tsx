import { FARCASTER_EPOCH_SECONDS, hashSignerRequest, type PairingRequest, type RevocationRequest } from '@opencaster/client-core/pairing';
import { getUser } from '@opencaster/client-core/api';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { importAuthorizationApproval, shareAuthorizationRequest } from '../lib/authorizationTransfer';
import {
  parseAuthorizationIdentityQuery,
  validateAuthorizationIdentity,
  validateSavedAuthorizationIdentity,
} from '../lib/authorizationIdentity';
import { useAuthorization } from '../lib/AuthorizationProvider';
import type { AuthorizationSnapshot } from '../lib/deviceAuthorization';
import type { RootStackParamList } from '../navigation';
import { usePublicRead } from '../lib/usePublicRead';
import { ActionButton } from '../components/Primitives';
import { palette } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'DeviceAccess'>;
type ApprovalKind = 'grant' | 'revoke';

function dateFor(seconds: number): string {
  return new Date((seconds + FARCASTER_EPOCH_SECONDS) * 1000).toLocaleString();
}

function scopeText(scopes: readonly number[]): string {
  return scopes.map(scope => ({
    1: 'cast/reply creation',
    3: 'reaction addition',
    4: 'reaction removal',
  }[scope] ?? `scope ${scope}`)).join(', ');
}

function requestDetails(request: PairingRequest | RevocationRequest, label: string) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{label}</Text>
      <Text style={styles.detailLabel}>Public key</Text>
      <Text selectable style={styles.mono}>{request.publicKey}</Text>
      <Text style={styles.detailLabel}>Request checksum</Text>
      <Text selectable style={styles.mono}>{hashSignerRequest(request)}</Text>
      <Text style={styles.detailLabel}>Permissions</Text>
      <Text style={styles.body}>{'scopes' in request ? scopeText(request.scopes) : 'Custody-approved removal of this exact device key'}</Text>
      <Text style={styles.detailLabel}>Request ID</Text>
      <Text selectable style={styles.mono}>{request.requestId}</Text>
      <Text style={styles.detailLabel}>Approval deadline</Text>
      <Text style={styles.body}>{request.deadline} ({dateFor(request.deadline)})</Text>
    </View>
  );
}

export function DeviceAccessScreen({ navigation }: Props) {
  const { authorization, snapshot } = useAuthorization();
  const [lookupText, setLookupText] = useState('');
  const [submittedLookup, setSubmittedLookup] = useState<string | null>(null);
  const [identityConsent, setIdentityConsent] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<{ kind: ApprovalKind; text: string } | null>(null);
  const readLookup = useCallback((signal: AbortSignal) => {
    if (!submittedLookup) return Promise.reject(new Error('Enter a username or positive FID.'));
    const query = parseAuthorizationIdentityQuery(submittedLookup);
    if (!query) return Promise.reject(new Error('Enter a username or positive FID.'));
    return getUser(query.lookup, signal).then(user => validateAuthorizationIdentity(query, user));
  }, [submittedLookup]);
  const lookup = usePublicRead(
    `device-access:${submittedLookup ?? ''}`,
    submittedLookup ? readLookup : null,
  );
  const savedFid = snapshot.request?.fid;
  const readSavedIdentity = useCallback((signal: AbortSignal) => {
    if (savedFid === undefined) return Promise.reject(new Error('Unlock the saved device first.'));
    return getUser({ fid: savedFid }, signal).then(user => validateSavedAuthorizationIdentity(savedFid, user));
  }, [savedFid]);
  const savedIdentity = usePublicRead(
    `device-access-record:${savedFid ?? ''}`,
    savedFid === undefined ? null : readSavedIdentity,
  );

  useEffect(() => {
    if (snapshot.phase === 'empty') {
      setPendingApproval(null);
      setIdentityConsent(false);
    }
    if (pendingApproval && (
      (pendingApproval.kind === 'grant' && (snapshot.phase === 'registering' || snapshot.phase === 'registered')) ||
      (pendingApproval.kind === 'revoke' && snapshot.phase === 'revoking')
    )) {
      setPendingApproval(null);
    }
  }, [pendingApproval, snapshot.phase]);

  const submitLookup = () => {
    const normalized = lookupText.trim().replace(/^@/, '');
    if (!parseAuthorizationIdentityQuery(normalized)) {
      setTransferError('Enter a username or a valid positive FID.');
      return;
    }
    setTransferError(null);
    setIdentityConsent(false);
    if (submittedLookup === normalized) lookup.retry();
    else setSubmittedLookup(normalized);
  };

  const prepare = () => {
    const value = lookup.phase === 'ready' ? lookup.value : null;
    if (!value || !identityConsent) {
      setTransferError('Review the exact identity and consent to protected device storage before preparing a request.');
      return;
    }
    void authorization.prepare({ fid: value.fid, custodyAddress: value.custody_address });
  };

  const shareRequest = (request: PairingRequest | RevocationRequest | null) => {
    if (!request) return;
    setTransferError(null);
    void shareAuthorizationRequest(request).catch(() => {
      setTransferError('The public authorization request could not be shared.');
    });
  };

  const importApproval = (kind: ApprovalKind) => {
    setTransferError(null);
    void importAuthorizationApproval().then(text => {
      if (text !== null) setPendingApproval({ kind, text });
    }).catch(() => {
      setTransferError('The public authorization file could not be imported.');
    });
  };

  const confirmApproval = (kind: ApprovalKind, text: string) => {
    const title = kind === 'grant' ? 'Approve/register this device?' : 'Approve network revocation?';
    const message = kind === 'grant'
      ? 'This submits the custody-approved public approval to the network. Review the identity, key, permissions, checksum, and deadline first.'
      : 'This submits the separate custody-approved revocation request. The app will only delete its local key after fresh status confirms the key is absent.';
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: kind === 'grant' ? 'Approve/register device' : 'Approve network revocation',
        onPress: () => void (kind === 'grant' ? authorization.approve(text) : authorization.approveRevocation(text)),
      },
    ]);
  };

  const forget = () => {
    if (snapshot.busy) return;
    const prepared = snapshot.phase === 'prepared' || snapshot.phase === 'revoke-prepared';
    Alert.alert(
      prepared ? 'Cancel this local request?' : 'Forget this device locally?',
      'This deletes only the saved device key on this phone. It does not revoke a network authorization; use custody-approved network revocation for that.',
      [
        { text: 'Keep', style: 'cancel' },
        { text: 'Forget locally', style: 'destructive', onPress: () => void authorization.forget() },
      ],
    );
  };

  const locked = snapshot.phase === 'locked';
  const record = snapshot.request;
  const revocation = snapshot.revocation;
  const identity = lookup.phase === 'ready' ? lookup.value : null;

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.heading}>
          <Text accessibilityRole="header" style={styles.headingTitle}>Protected device access</Text>
          <Text style={styles.body}>Authorize this device with a separate offline signer. This screen does not import custody keys or recovery phrases.</Text>
        </View>
        <Text style={styles.body}>
          Permissions are exactly cast/reply creation, reaction addition, and reaction removal. The seven-day window is sliding inactivity, not a fixed expiry. Approval files expire after 15 minutes.
        </Text>
        {snapshot.notice ? <Text style={styles.notice}>{snapshot.notice}</Text> : null}
        {snapshot.error ? <Text accessibilityRole="alert" style={styles.error}>{snapshot.error}</Text> : null}
        {transferError ? <Text accessibilityRole="alert" style={styles.error}>{transferError}</Text> : null}

        {locked ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Locked</Text>
            <Text style={styles.body}>The protected device record has not been opened. Unlock explicitly to inspect or use it. App backgrounding never unlocks or submits a request.</Text>
            <ActionButton label="Unlock saved device" onPress={() => void authorization.unlock()} disabled={snapshot.busy} />
            <ActionButton label="Forget saved device (local only)" onPress={forget} secondary disabled={snapshot.busy} />
            {pendingApproval ? <Text style={styles.notice}>A public {pendingApproval.kind} approval is waiting. Unlock, then explicitly submit it.</Text> : null}
          </View>
        ) : null}

        {snapshot.phase === 'empty' || locked ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Review the account identity</Text>
            <Text style={styles.body}>Look up the exact username or FID first. Preparing a request stores a new device key only after this identity review and your explicit consent.</Text>
            <TextInput
              accessibilityLabel="Username or FID"
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={value => {
                setLookupText(value);
                setSubmittedLookup(null);
                setIdentityConsent(false);
              }}
              onSubmitEditing={submitLookup}
              placeholder="Username or FID"
              placeholderTextColor={palette.muted}
              returnKeyType="search"
              style={styles.input}
              value={lookupText}
            />
            <ActionButton label="Look up identity" onPress={submitLookup} disabled={lookup.phase === 'loading'} />
            {lookup.phase === 'loading' ? <Text style={styles.body}>Looking up public identity…</Text> : null}
            {lookup.phase === 'error' ? <Text accessibilityRole="alert" style={styles.error}>The public identity lookup failed. Try again.</Text> : null}
            {identity ? (
              <View style={styles.review}>
                <Text style={styles.detailLabel}>Username</Text>
                <Text selectable style={styles.body}>{identity.username ? `@${identity.username}` : '(none)'}</Text>
                <Text style={styles.detailLabel}>FID</Text>
                <Text selectable style={styles.body}>{identity.fid}</Text>
                <Text style={styles.detailLabel}>Custody address</Text>
                <Text selectable style={styles.mono}>{identity.custody_address}</Text>
                <Text style={styles.body}>I reviewed this exact username/FID/custody identity and consent to storing the new device key only in native protected storage.</Text>
                <ActionButton
                  label={identityConsent ? 'Identity reviewed and consented' : 'Confirm identity and storage consent'}
                  onPress={() => setIdentityConsent(value => !value)}
                  secondary={!identityConsent}
                />
                {snapshot.phase === 'empty'
                  ? <ActionButton label="Prepare device authorization" onPress={prepare} disabled={!identityConsent || snapshot.busy} />
                  : <Text style={styles.notice}>Unlock the saved device before preparing a new authorization.</Text>}
              </View>
            ) : null}
          </View>
        ) : null}

        {record && snapshot.phase !== 'empty' && snapshot.phase !== 'locked' ? (
          <>
            {requestDetails(record, snapshot.phase === 'prepared' ? 'Prepared public request' : 'Saved device identity')}
            <View style={styles.card}>
              <Text style={styles.detailLabel}>Public username</Text>
              <Text style={styles.body}>
                {savedIdentity.phase === 'ready'
                  ? (savedIdentity.value.username ? `@${savedIdentity.value.username}` : '(none)')
                  : savedIdentity.phase === 'loading' ? 'Looking up the public username…' : 'Username lookup unavailable'}
              </Text>
              <Text style={styles.detailLabel}>Farcaster identity</Text>
              <Text style={styles.body}>FID {record.fid} · custody {record.custodyAddress}</Text>
              <Text style={styles.detailLabel}>Authorization status</Text>
              <Text style={styles.body}>
                {snapshot.phase === 'registered' && snapshot.authorized ? 'Node reports this exact device key authorized. Node status is not independent finality.' : snapshot.phase === 'registered' ? 'Saved device exists, but fresh node authorization is not currently confirmed.' : `Current phase: ${snapshot.phase}`}
              </Text>
              {snapshot.phase === 'prepared' ? (
                <>
                  <ActionButton label="Share public request" onPress={() => shareRequest(record)} disabled={snapshot.busy} />
                  <ActionButton label="Import signer approval file" onPress={() => importApproval('grant')} secondary disabled={snapshot.busy} />
                  {pendingApproval?.kind === 'grant' ? (
                    <ActionButton label="Approve/register device" onPress={() => confirmApproval('grant', pendingApproval.text)} disabled={snapshot.busy} />
                  ) : null}
                  <ActionButton label="Cancel authorization (local only)" onPress={forget} secondary disabled={snapshot.busy} />
                </>
              ) : null}
              {snapshot.phase === 'registering' ? <ActionButton label="Check authorization status" onPress={() => void authorization.checkAuthorization()} disabled={snapshot.busy} /> : null}
              {snapshot.phase === 'registered' ? (
                <>
                  <ActionButton label="Check authorization status" onPress={() => void authorization.checkAuthorization()} disabled={snapshot.busy} />
                  <ActionButton label="Prepare network revocation" onPress={() => void authorization.prepareRevocation()} disabled={snapshot.busy} />
                </>
              ) : null}
              {snapshot.phase === 'revoke-prepared' && revocation ? (
                <>
                  {requestDetails(revocation, 'Prepared public revocation request')}
                  <ActionButton label="Prepare a fresh revocation request" onPress={() => void authorization.prepareRevocation()} secondary disabled={snapshot.busy} />
                  <ActionButton label="Share revocation request" onPress={() => shareRequest(revocation)} disabled={snapshot.busy} />
                  <ActionButton label="Import revocation approval file" onPress={() => importApproval('revoke')} secondary disabled={snapshot.busy} />
                  {pendingApproval?.kind === 'revoke' ? (
                    <ActionButton label="Approve network revocation" onPress={() => confirmApproval('revoke', pendingApproval.text)} disabled={snapshot.busy} />
                  ) : null}
                  <ActionButton
                    label="Cancel pending revocation"
                    onPress={() => void authorization.cancelRevocation()}
                    secondary
                    disabled={snapshot.busy}
                  />
                </>
              ) : null}
              {snapshot.phase === 'revoking' ? <ActionButton label="Check revocation status" onPress={() => void authorization.checkRevocation()} disabled={snapshot.busy} /> : null}
              <ActionButton
                label={snapshot.busy ? 'Stop waiting and lock' : 'Lock'}
                onPress={() => authorization.lock()}
                secondary
              />
              <ActionButton label={snapshot.phase === 'registered' ? 'Forget this device (local only)' : 'Forget local device record'} onPress={forget} secondary disabled={snapshot.busy} />
            </View>
          </>
        ) : null}

        {snapshot.phase === 'locked' && pendingApproval ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Public approval retained</Text>
            <Text style={styles.body}>The imported text is public only and was retained while the app locked. Unlock explicitly and submit only against the current request.</Text>
          </View>
        ) : null}
        <ActionButton label="Back to public home" onPress={() => navigation.navigate('Home')} secondary />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  body: { color: palette.text, fontSize: 15, lineHeight: 22 },
  card: { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: 12, borderWidth: 1, gap: 10, padding: 16 },
  cardTitle: { color: palette.text, fontSize: 18, fontWeight: '700' },
  content: { gap: 16, padding: 16, paddingBottom: 40 },
  detailLabel: { color: palette.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  error: { color: palette.error, fontSize: 14, lineHeight: 20 },
  heading: { gap: 6 },
  headingTitle: { color: palette.text, fontSize: 25, fontWeight: '800' },
  input: { borderColor: palette.border, borderRadius: 8, borderWidth: 1, color: palette.text, paddingHorizontal: 12, paddingVertical: 11 },
  mono: { color: palette.cyan, fontFamily: 'monospace', fontSize: 13, lineHeight: 19 },
  notice: { color: palette.cyan, fontSize: 14, lineHeight: 20 },
  review: { borderColor: palette.border, borderRadius: 8, borderWidth: 1, gap: 8, padding: 12 },
  screen: { backgroundColor: palette.background, flex: 1 },
});
