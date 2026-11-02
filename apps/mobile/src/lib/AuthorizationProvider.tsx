import { getRandomBytesAsync } from 'expo-crypto';
import { AppState } from 'react-native';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { getCast, getReactionStatus, getSigners, getUser, submitMessage } from '@opencaster/client-core/api';
import {
  DeviceAuthorization,
  type AuthorizationSnapshot,
} from './deviceAuthorization';
import { protectedDeviceStorage } from './deviceStorage';

interface AuthorizationContextValue {
  authorization: DeviceAuthorization;
  snapshot: AuthorizationSnapshot;
}

const AuthorizationContext = createContext<AuthorizationContextValue | null>(null);

export function AuthorizationProvider({ children }: { children: ReactNode }) {
  const [authorization] = useState(() => new DeviceAuthorization({
    api: { getCast, getReactionStatus, getSigners, getUser, submitMessage },
    randomBytes: () => getRandomBytesAsync(32),
    storage: protectedDeviceStorage,
  }));
  const snapshot = useSyncExternalStore(
    authorization.subscribe,
    authorization.getSnapshot,
    authorization.getSnapshot,
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState !== 'active') authorization.lock();
    });
    return () => {
      subscription.remove();
      authorization.lock();
    };
  }, [authorization]);

  const value = useMemo(() => ({ authorization, snapshot }), [authorization, snapshot]);
  return <AuthorizationContext.Provider value={value}>{children}</AuthorizationContext.Provider>;
}

export function useAuthorization(): AuthorizationContextValue {
  const value = useContext(AuthorizationContext);
  if (!value) throw new Error('AuthorizationProvider is required.');
  return value;
}
