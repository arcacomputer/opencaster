import * as SecureStore from 'expo-secure-store';
import type { ProtectedDeviceStorage } from './deviceAuthorization';

const STORAGE_KEY = 'opencaster.device.authorization.v1';
const STORAGE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  keychainService: 'org.opencaster.app.device-authorization',
  requireAuthentication: false,
};

export function createProtectedDeviceStorage(): ProtectedDeviceStorage {
  return {
    read: () => SecureStore.getItemAsync(STORAGE_KEY, STORAGE_OPTIONS),
    write: value => SecureStore.setItemAsync(STORAGE_KEY, value, STORAGE_OPTIONS),
    remove: () => SecureStore.deleteItemAsync(STORAGE_KEY, STORAGE_OPTIONS),
  };
}

export const protectedDeviceStorage = createProtectedDeviceStorage();
