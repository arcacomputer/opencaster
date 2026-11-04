import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar, StyleSheet } from 'react-native';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LocalContentProvider } from './src/lib/LocalContentProvider';
import { HomeScreen } from './src/screens/HomeScreen';
import { LookupScreen } from './src/screens/LookupScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { ConversationScreen } from './src/screens/ConversationScreen';
import { DeviceAccessScreen } from './src/screens/DeviceAccessScreen';
import { ComposerScreen } from './src/screens/ComposerScreen';
import { SafetyScreen } from './src/screens/SafetyScreen';
import { SupportScreen } from './src/screens/SupportScreen';
import type { RootStackParamList } from './src/navigation';
import { palette } from './src/theme';
import { AuthorizationProvider } from './src/lib/AuthorizationProvider';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  return (
    <AuthorizationProvider>
      <SafeAreaProvider>
        <LocalContentProvider>
          <KeyboardProvider preload={false}>
            <StatusBar barStyle="light-content" backgroundColor={palette.background} />
            <NavigationContainer
              theme={{
                ...DarkTheme,
                colors: {
                  ...DarkTheme.colors,
                  background: palette.background,
                  border: palette.border,
                  card: palette.background,
                  primary: palette.cyan,
                  text: palette.text,
                },
              }}
            >
              <Stack.Navigator
                initialRouteName="Home"
                screenOptions={{
                  contentStyle: styles.screen,
                  headerStyle: styles.header,
                  headerTintColor: palette.cyan,
                  headerTitleStyle: styles.headerTitle,
                  headerBackTitle: 'Back',
                }}
              >
                <Stack.Screen component={HomeScreen} name="Home" options={{ title: 'OpenCaster' }} />
                <Stack.Screen component={LookupScreen} name="Lookup" options={{ title: 'Find a person' }} />
                <Stack.Screen component={DeviceAccessScreen} name="DeviceAccess" options={{ title: 'Device access' }} />
                <Stack.Screen component={ComposerScreen} name="Compose" options={{ title: 'Compose' }} />
                <Stack.Screen component={ProfileScreen} name="Profile" options={{ title: 'Public profile' }} />
                <Stack.Screen component={ConversationScreen} name="Conversation" options={{ title: 'Conversation' }} />
                <Stack.Screen component={SafetyScreen} name="Safety" options={{ title: 'Safety and data' }} />
                <Stack.Screen component={SupportScreen} name="Support" options={{ title: 'Reports and support' }} />
              </Stack.Navigator>
            </NavigationContainer>
          </KeyboardProvider>
        </LocalContentProvider>
      </SafeAreaProvider>
    </AuthorizationProvider>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: palette.background,
  },
  header: {
    backgroundColor: palette.background,
  },
  headerTitle: {
    color: palette.text,
    fontWeight: '700',
  },
});
