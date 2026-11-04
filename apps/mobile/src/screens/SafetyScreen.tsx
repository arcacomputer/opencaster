import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActionButton, LoadingMessage } from '../components/Primitives';
import { useLocalContent } from '../lib/LocalContentProvider';
import { MAX_HIDDEN_ITEMS } from '../lib/localContent';
import { SUPPORT_EMAIL, SUPPORT_OPERATOR } from '../lib/support';
import type { RootStackParamList } from '../navigation';
import { palette } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Safety'>;

export function SafetyScreen({ navigation }: Props) {
  const { localContent, snapshot } = useLocalContent();
  const reset = () => Alert.alert('Reset local content filters?',
    'Previously hidden users and posts will be visible again. This only clears this installation’s filter list. It does not delete an account, posts, reactions or a saved device key.',
    [{ text: 'Cancel', style: 'cancel' }, { text: 'Reset filters', style: 'destructive', onPress: () => void localContent.reset() }]);
  const restoreUser = (fid: number) => Alert.alert(`Show FID ${fid} again?`, 'This restores the user’s profile and posts in this installation, except posts you hid separately.',
    [{ text: 'Cancel', style: 'cancel' }, { text: 'Show user', onPress: () => void localContent.restoreUser(fid) }]);
  const restoreCast = (hash: string) => Alert.alert('Show this post again?', hash,
    [{ text: 'Cancel', style: 'cancel' }, { text: 'Show post', onPress: () => void localContent.restoreCast(hash) }]);

  return <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
    <ScrollView contentContainerStyle={styles.content}>
      <Text accessibilityRole="header" style={styles.heading}>Local content controls</Text>
      <Text style={styles.text}>Use Content options on a post to hide that post or its author. Hidden users are also hidden from public profile lookup and conversations in this app. Up to {MAX_HIDDEN_ITEMS} users and posts can be saved in total.</Text>
      <Text style={styles.text}>These are device-local display filters, not network blocking, reporting or moderation. They do not prevent another person from viewing or replying to your public posts, affect other clients, or remove data from Hypersnap. Public data may still be fetched before being filtered. Other people’s replies can remain visible.</Text>
      {snapshot.phase === 'loading' ? <LoadingMessage label="Loading saved filters…" /> : null}
      {snapshot.error ? <Text accessibilityRole="alert" style={styles.error}>{snapshot.error}</Text> : null}
      {snapshot.phase === 'error' ? <ActionButton label="Retry reading filters" disabled={snapshot.busy} onPress={() => void localContent.load()} /> : null}
      {snapshot.phase === 'ready' ? <>
        <Text accessibilityRole="header" style={styles.subheading}>Hidden users ({snapshot.data.users.length})</Text>
        {snapshot.data.users.map(fid => <ActionButton key={fid} label={`Show FID ${fid}`} disabled={snapshot.busy} onPress={() => restoreUser(fid)} secondary />)}
        <Text accessibilityRole="header" style={styles.subheading}>Hidden posts ({snapshot.data.casts.length})</Text>
        {snapshot.data.casts.map(hash => <View key={hash} style={styles.item}>
          <Text selectable style={styles.identifier}>{hash}</Text>
          <ActionButton label={`Show post ${hash.slice(0, 8)}`} disabled={snapshot.busy} onPress={() => restoreCast(hash)} secondary />
        </View>)}
      </> : null}
      <ActionButton label="Reset local content filters" disabled={snapshot.busy || snapshot.phase === 'loading'} onPress={reset} secondary />

      <Text accessibilityRole="header" style={styles.heading}>Privacy and data</Text>
      <Text style={styles.text}>OpenCaster reads public Hypersnap data through opencaster.org/api. Searches send the username or FID you enter. Opening feeds, profiles and conversations sends the relevant public identifiers. The gateway and network infrastructure receive connection information such as your IP address; retention and operator policies still need a published disclosure.</Text>
      <Text style={styles.text}>Remote profile images and post images may contact their HTTPS hosts. Opening an external link leaves this app and uses your browser. Those services have their own data practices.</Text>
      <Text style={styles.text}>Publishing sends signed public text, parent/target identifiers, reactions and device-authorization messages. Public activity can be copied or retained by other network participants. The app does not implement account creation, account deletion or post deletion.</Text>
      <Text style={styles.text}>A device signing key is stored separately in platform-protected storage. Locking clears the controller’s active seed buffer, but is not network revocation. Forget locally deletes the saved device credential and its local receipt, not earlier public activity. Network revocation is a separate approval flow in Device access.</Text>
      <ActionButton label="Manage device access" onPress={() => navigation.navigate('DeviceAccess')} secondary />
      <Text style={styles.text}>Hidden-content preferences contain public FIDs and cast hashes in an ordinary private app-data file, not the device-key store. They persist across restarts and are not synchronized by OpenCaster. Operating-system backup or restore behavior can vary. Resetting filters overwrites that list; it is not a promise of forensic erasure.</Text>
      <Text style={styles.text}>Draft text stays on its composer screen and may be lost when you leave or the process ends. Public submission receipts contain identifiers and status, not draft text. There is no promise to remove server logs, network copies or browser data from this screen.</Text>

      <Text accessibilityRole="header" style={styles.heading}>Reporting, support and community rules</Text>
      <Text selectable style={styles.text}>Reports and support: {SUPPORT_EMAIL}. Responsible operator: {SUPPORT_OPERATOR}. Report a public post or user from its card or profile, or describe a support issue below. The owner has confirmed that this inbox is active and monitored.</Text>
      <ActionButton label="Contact support by email" onPress={() => navigation.push('Support', { kind: 'support' })} secondary />
      <Text style={styles.text}>You review an email draft before opening your email app and sending it yourself. Opening the draft is not confirmation of delivery or action. Hiding content does not send a report. Do not put private abuse reports, credentials or recovery phrases in public repository issues.</Text>
      <Text style={styles.text}>Community guidelines, report handling, moderation operations and applicable data-request procedures still require owner decisions. Email contact is not network blocking or a completed moderation system. This preview is not store-ready and does not claim moderation compliance.</Text>
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  content: { padding: 20, gap: 16 },
  heading: { color: palette.text, fontSize: 22, fontWeight: '700', marginTop: 8 },
  subheading: { color: palette.text, fontSize: 17, fontWeight: '700' },
  text: { color: palette.muted, fontSize: 15, lineHeight: 22 },
  error: { color: palette.error, fontSize: 15, lineHeight: 22 },
  item: { gap: 8 },
  identifier: { color: palette.muted, fontSize: 13 },
});
