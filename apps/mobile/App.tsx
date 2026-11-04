import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { HomeScreen } from './src/screens/HomeScreen';
import { LookupScreen } from './src/screens/LookupScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { ConversationScreen } from './src/screens/ConversationScreen';
import type { RootStackParamList } from './src/navigation';
import { palette } from './src/theme';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  return (
    <SafeAreaProvider>
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
          <Stack.Screen component={ProfileScreen} name="Profile" options={{ title: 'Public profile' }} />
          <Stack.Screen component={ConversationScreen} name="Conversation" options={{ title: 'Conversation' }} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
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
