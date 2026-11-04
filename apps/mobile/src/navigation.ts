import type { SupportTarget } from './lib/support';
import type { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type MainTabParamList = {
  Feed: undefined;
  Search: undefined;
  Account: undefined;
};

export type MainTabScreenProps<T extends keyof MainTabParamList> = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, T>,
  NativeStackScreenProps<RootStackParamList>
>;

export type RootStackParamList = {
  Home: NavigatorScreenParams<MainTabParamList> | undefined;
  DeviceAccess: undefined;
  Safety: undefined;
  Support: SupportTarget;
  Profile: { fid: number };
  Conversation: { hash: string };
  Compose: { parent?: { fid: number; hash: string } } | undefined;
};
