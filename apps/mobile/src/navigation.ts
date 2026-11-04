import type { SupportTarget } from './lib/support';

export type RootStackParamList = {
  Home: undefined;
  Lookup: undefined;
  DeviceAccess: undefined;
  Safety: undefined;
  Support: SupportTarget;
  Profile: { fid: number };
  Conversation: { hash: string };
  Compose: { parent?: { fid: number; hash: string } } | undefined;
};
