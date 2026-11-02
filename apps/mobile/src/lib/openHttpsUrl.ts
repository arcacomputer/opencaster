import { Alert, Linking } from 'react-native';
import { safeHttpsUrl } from './urls';

export async function openHttpsUrl(value: string): Promise<void> {
  const safeUrl = safeHttpsUrl(value);
  if (!safeUrl) return;
  try {
    await Linking.openURL(safeUrl);
  } catch {
    Alert.alert('Link unavailable', 'This HTTPS link could not be opened.');
  }
}
