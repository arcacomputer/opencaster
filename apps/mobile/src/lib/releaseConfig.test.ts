// @vitest-environment node

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { expo } from '../../app.json';

const mobileRoot = new URL('../../', import.meta.url);

describe('native release configuration', () => {
  it('blocks permissions unused by private storage and document-picker flows', () => {
    expect(expo.android.permissions).toEqual(['android.permission.INTERNET']);
    expect(expo.android.blockedPermissions).toEqual([
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.VIBRATE',
      'android.permission.USE_BIOMETRIC',
      'android.permission.USE_FINGERPRINT',
    ]);
    expect(expo.android.allowBackup).toBe(false);
    expect(expo.plugins).toContainEqual([
      'expo-secure-store',
      { configureAndroidBackup: true, faceIDPermission: false },
    ]);
  });

  it('configures square native PNG assets with the intended alpha channels', () => {
    const assets = [
      [expo.icon, 1024, 2],
      [expo.android.adaptiveIcon.foregroundImage, 432, 6],
      [expo.android.adaptiveIcon.monochromeImage, 432, 6],
    ] as const;

    for (const [path, size, colorType] of assets) {
      const png = readFileSync(new URL(path, mobileRoot));
      expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      expect(png.toString('ascii', 12, 16)).toBe('IHDR');
      expect(png.readUInt32BE(16)).toBe(size);
      expect(png.readUInt32BE(20)).toBe(size);
      expect(png[24]).toBe(8);
      expect(png[25]).toBe(colorType);
    }
    expect(expo.android.adaptiveIcon.backgroundColor).toBe('#292335');
  });
});
