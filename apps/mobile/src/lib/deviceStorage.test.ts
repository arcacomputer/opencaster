import { describe, expect, it, vi } from 'vitest';

const secureStore = vi.hoisted(() => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 42,
  deleteItemAsync: vi.fn(async () => undefined),
  getItemAsync: vi.fn(async () => null as string | null),
  setItemAsync: vi.fn(async () => undefined),
}));

vi.mock('expo-secure-store', () => secureStore);

import { createProtectedDeviceStorage } from './deviceStorage';

describe('protected native device storage', () => {
  it('uses one fixed SecureStore key and protected options for every operation', async () => {
    const storage = createProtectedDeviceStorage();

    await expect(storage.read()).resolves.toBeNull();
    await storage.write('protected-record');
    await storage.remove();

    const options = {
      keychainAccessible: 42,
      keychainService: 'org.opencaster.app.device-authorization',
      requireAuthentication: false,
    };
    expect(secureStore.getItemAsync).toHaveBeenCalledWith('opencaster.device.authorization.v1', options);
    expect(secureStore.setItemAsync).toHaveBeenCalledWith('opencaster.device.authorization.v1', 'protected-record', options);
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith('opencaster.device.authorization.v1', options);
    expect(secureStore.getItemAsync).toHaveBeenCalledTimes(1);
    expect(secureStore.setItemAsync).toHaveBeenCalledTimes(1);
    expect(secureStore.deleteItemAsync).toHaveBeenCalledTimes(1);
  });

  it('does not hide protected-storage failures or fall back to another store', async () => {
    const storage = createProtectedDeviceStorage();
    secureStore.getItemAsync.mockRejectedValueOnce(new Error('native storage unavailable'));
    secureStore.setItemAsync.mockRejectedValueOnce(new Error('native storage unavailable'));
    secureStore.deleteItemAsync.mockRejectedValueOnce(new Error('native storage unavailable'));

    await expect(storage.read()).rejects.toThrow('native storage unavailable');
    await expect(storage.write('record')).rejects.toThrow('native storage unavailable');
    await expect(storage.remove()).rejects.toThrow('native storage unavailable');
  });
});
