import Feather from '@expo/vector-icons/Feather';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { HomeScreen } from './screens/HomeScreen';
import { LookupScreen } from './screens/LookupScreen';
import { AccountScreen } from './screens/AccountScreen';
import { IconButton, type IconName } from './components/IconButton';
import type { MainTabParamList } from './navigation';
import { palette } from './theme';

const Tab = createBottomTabNavigator<MainTabParamList>();
const icons: Record<keyof MainTabParamList, IconName> = { Feed: 'home', Search: 'search', Account: 'user' };

export function MainTabs() {
  return <Tab.Navigator screenOptions={({ route }) => ({
    headerStyle: { backgroundColor: palette.background },
    headerTintColor: palette.text,
    headerTitleStyle: { fontWeight: '800' },
    headerShadowVisible: false,
    tabBarStyle: { backgroundColor: palette.background, borderTopColor: palette.border },
    tabBarActiveTintColor: palette.cyan,
    tabBarInactiveTintColor: palette.muted,
    tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
    tabBarHideOnKeyboard: true,
    tabBarIcon: ({ color, size }) => <Feather name={icons[route.name]} color={color} size={size} accessible={false} />,
  })}>
    <Tab.Screen name="Feed" component={HomeScreen} options={({ navigation }) => ({
      title: 'OpenCaster', tabBarLabel: 'Home',
      headerRight: () => <IconButton icon="user" label="Your account" onPress={() => navigation.navigate('Account')} />,
    })} />
    <Tab.Screen name="Search" component={LookupScreen} options={{ title: 'Search' }} />
    <Tab.Screen name="Account" component={AccountScreen} options={{ title: 'You' }} />
  </Tab.Navigator>;
}
