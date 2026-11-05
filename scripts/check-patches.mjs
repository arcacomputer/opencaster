import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const patchesDirectory = path.join(root, 'patches');
const requiredPatches = new Map([
  ['react-native-screens', 'apps/mobile/package.json'],
]);
const patchFiles = readdirSync(patchesDirectory).filter((file) => file.endsWith('.patch'));
const expectedPatchFiles = new Set();
const requireFromRoot = createRequire(path.join(root, 'package.json'));

for (const [packageName, manifestPath] of requiredPatches) {
  const matchingPatches = patchFiles.filter((file) => file.startsWith(`${packageName}+`));
  if (matchingPatches.length !== 1) {
    throw new Error(`Expected exactly one patch for ${packageName}; found ${matchingPatches.length}.`);
  }

  const patchFile = matchingPatches[0];
  const patchVersion = patchFile.slice(packageName.length + 1, -'.patch'.length);
  if (!patchVersion) {
    throw new Error(`Patch filename has no version: ${patchFile}`);
  }

  const manifest = JSON.parse(readFileSync(path.join(root, manifestPath), 'utf8'));
  if (manifest.dependencies?.[packageName] !== patchVersion) {
    throw new Error(`${manifestPath} must pin ${packageName} to ${patchVersion}.`);
  }

  const installedPackage = requireFromRoot(`${packageName}/package.json`);
  if (installedPackage.version !== patchVersion) {
    throw new Error(
      `${packageName} patch is for ${patchVersion}, but installed version is ${installedPackage.version}.`,
    );
  }

  expectedPatchFiles.add(patchFile);
}

const unguardedPatches = patchFiles.filter((file) => !expectedPatchFiles.has(file));
if (unguardedPatches.length > 0) {
  throw new Error(`No version guard is configured for patch file(s): ${unguardedPatches.join(', ')}.`);
}
