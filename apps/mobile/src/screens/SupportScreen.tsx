import { useHeaderHeight } from '@react-navigation/elements';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useRef, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActionButton } from '../components/Primitives';
import { createSupportDraft, MAX_SUPPORT_DETAILS, SUPPORT_EMAIL, SUPPORT_OPERATOR, supportTargetLabel, type SupportDraft } from '../lib/support';
import type { RootStackParamList } from '../navigation';
import { palette } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Support'>;

export function SupportScreen({ route }: Props) {
  const headerHeight = useHeaderHeight();
  const [details, setDetails] = useState('');
  const [draft, setDraft] = useState<SupportDraft | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const opening = useRef(false);
  let targetLabel: string;
  let targetValid = true;
  try {
    targetLabel = supportTargetLabel(route.params);
  } catch {
    targetLabel = 'Invalid report target. Go back and select a public post or profile again.';
    targetValid = false;
  }

  const review = () => {
    try {
      setDraft(createSupportDraft(route.params, details));
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The email draft could not be prepared.');
    }
  };
  const openEmail = async () => {
    if (!draft || opening.current) return;
    opening.current = true;
    setBusy(true);
    setMessage('');
    try {
      await Linking.openURL(draft.url);
      setMessage('Email app requested. You must send the email there. OpenCaster cannot confirm that it was sent or received.');
    } catch {
      setMessage('Could not open an email app. Nothing was sent by OpenCaster. Select and copy the address, subject and message on this screen into an email app or webmail.');
    } finally {
      opening.current = false;
      setBusy(false);
    }
  };

  return <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
    <KeyboardAvoidingView style={styles.screen} behavior="padding" keyboardVerticalOffset={headerHeight}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <Text accessibilityRole="header" style={styles.heading}>Reports and support by email</Text>
        <Text selectable style={styles.text}>Contact: {SUPPORT_EMAIL}{'\n'}Responsible operator: {SUPPORT_OPERATOR}</Text>
        <Text selectable style={styles.text}>{targetLabel}</Text>
        <Text style={styles.text}>This opens a draft in your email app, not a network report. Review it here, then choose whether to send it there. Opening a draft does not confirm delivery, a response or removal of content. Local hiding is separate.</Text>
        <Text style={styles.text}>Opening the draft shares its contents with your email app. Sending it also shares your email address and message with the support operator and email providers. This is not anonymous. Do not include keys, approval files, recovery phrases or unnecessary personal information. Do not post private reports in public repository issues.</Text>
        <Text style={styles.text}>Your draft stays in this screen’s memory and is not saved by OpenCaster. Leaving this screen may discard it. Your email app may save its own draft. This is not an emergency service; report handling and enforcement policies are still being developed.</Text>
        {draft ? <>
          <Text accessibilityRole="header" style={styles.heading}>Review email</Text>
          <Text selectable style={styles.text}>To: {draft.recipient}</Text>
          <Text selectable style={styles.text}>Subject: {draft.subject}</Text>
          <Text selectable style={styles.text}>{draft.body}</Text>
          <Text style={styles.text}>You can also select and copy these details into webmail if no email app is configured.</Text>
          <ActionButton label="Open email draft" disabled={busy} onPress={() => void openEmail()} />
          <ActionButton label="Edit draft" disabled={busy} onPress={() => { setDraft(null); setMessage(''); }} secondary />
        </> : <>
          <TextInput accessibilityLabel="Report or support description" multiline value={details} onChangeText={setDetails}
            maxLength={MAX_SUPPORT_DETAILS} placeholder="Describe the problem and why you are reporting it" placeholderTextColor={palette.muted}
            style={styles.input} textAlignVertical="top" />
          <Text style={styles.text}>{details.length} / {MAX_SUPPORT_DETAILS} characters</Text>
          <ActionButton label="Review email" disabled={!targetValid || !details.trim()} onPress={review} />
        </>}
        {message ? <Text accessibilityRole="alert" style={styles.text}>{message}</Text> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  content: { padding: 20, gap: 16 },
  heading: { color: palette.text, fontSize: 22, fontWeight: '700' },
  text: { color: palette.muted, fontSize: 15, lineHeight: 22 },
  input: { minHeight: 140, borderColor: palette.border, borderWidth: 1, borderRadius: 12, padding: 14, color: palette.text, fontSize: 16 },
});
