import Feather from '@expo/vector-icons/Feather';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActionButton, PublicPreviewNotice } from '../components/Primitives';
import { SocialStatus } from '../components/SocialStatus';
import type { IconName } from '../components/IconButton';
import { useAuthorization } from '../lib/AuthorizationProvider';
import type { MainTabScreenProps } from '../navigation';
import { palette } from '../theme';

function SettingsRow({ title, detail, icon, onPress }: { title: string; detail: string; icon: IconName; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
    <Feather name={icon} size={23} color={palette.text} accessible={false} />
    <View style={styles.rowCopy}><Text style={styles.rowTitle}>{title}</Text><Text style={styles.detail}>{detail}</Text></View>
    <Feather name="chevron-right" size={20} color={palette.muted} accessible={false} />
  </Pressable>;
}

export function AccountScreen({ navigation }: MainTabScreenProps<'Account'>) {
  const { snapshot } = useAuthorization();
  return <SafeAreaView edges={['left', 'right']} style={styles.screen}>
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.welcome}>
        <View style={styles.avatar}><Feather name="user" size={32} color={palette.cyan} accessible={false} /></View>
        <Text accessibilityRole="header" style={styles.title}>{snapshot.authorized ? 'Your space' : 'Join the conversation'}</Text>
        <Text style={styles.detail}>Browse freely. Connect an existing account to post, reply and react using a separately approved device key.</Text>
        <ActionButton label={snapshot.authorized ? 'Manage account access' : 'Connect your account'} onPress={() => navigation.navigate('DeviceAccess')} />
      </View>
      {snapshot.request?.fid ? <SettingsRow icon="user" title="Your public profile" detail={`FID ${snapshot.request.fid}`} onPress={() => navigation.navigate('Profile', { fid: snapshot.request!.fid })} /> : null}
      <SettingsRow icon="shield" title="Safety and data" detail="Hidden posts, people and privacy" onPress={() => navigation.navigate('Safety')} />
      <SettingsRow icon="help-circle" title="Help and support" detail="Review an email to the support operator" onPress={() => navigation.navigate('Support', { kind: 'support' })} />
      {snapshot.request || snapshot.busy || snapshot.error || snapshot.notice || snapshot.action ? <SocialStatus onDeviceAccess={() => navigation.navigate('DeviceAccess')} onOpenCast={hash => navigation.navigate('Conversation', { hash })} /> : null}
      <PublicPreviewNotice />
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  content: { padding: 20, gap: 12, paddingBottom: 32 },
  welcome: { gap: 14, paddingVertical: 12 },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: palette.raised, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: '800', color: palette.text },
  detail: { fontSize: 14, lineHeight: 21, color: palette.muted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 18, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.border },
  rowCopy: { flex: 1, gap: 4 },
  rowTitle: { color: palette.text, fontSize: 16, fontWeight: '600' },
  pressed: { backgroundColor: palette.surface },
});
