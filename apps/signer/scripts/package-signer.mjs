import { packager } from '@electron/packager';
import { flipFuses, FuseVersion, FuseV1Options } from '@electron/fuses';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
function argument(name, fallback) { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1]; }
const platform = argument('--platform', process.platform);
const arch = argument('--arch', process.arch);
const identity = argument('--sign-identity', process.env.ARCA_SIGN_IDENTITY);
const profile = argument('--notary-profile', process.env.NOTARY_KEYCHAIN_PROFILE);
if (platform !== 'darwin' || process.platform !== 'darwin') throw new Error('The release packaging script currently supports macOS builds. Use signer:build and Electron on other systems.');
if (!identity) throw new Error('Specify your Developer ID Application certificate with --sign-identity to produce a release download.');
const manifestPath = join(root, 'dist-signer', 'BUILD-MANIFEST.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const currentCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const currentDirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: root, encoding: 'utf8' }).trim().length > 0;
if (manifest.source_commit !== currentCommit) throw new Error('Rebuild the signer payload from the current source commit before packaging.');
if ((manifest.working_tree_dirty || currentDirty) && !args.includes('--allow-dirty-preview')) throw new Error('Release packaging requires a clean committed source tree. Use --allow-dirty-preview only for a local smoke test.');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (manifest.electron_version !== pkg.devDependencies.electron || manifest.version !== pkg.version) throw new Error('Rebuild the signer payload with the current package and runtime versions.');
const expectedFiles = [...Object.keys(manifest.files), 'BUILD-MANIFEST.json'].sort();
if (JSON.stringify((await readdir(join(root, 'dist-signer'))).sort()) !== JSON.stringify(expectedFiles)) throw new Error('The signer payload file list differs from its manifest. Rebuild before packaging.');
for (const [name, expected] of Object.entries(manifest.files)) {
  if (name.includes('/') || name.includes('\\') || name === '.' || name === '..') throw new Error('Invalid payload manifest path.');
  const actual = createHash('sha256').update(await readFile(join(root, 'dist-signer', name))).digest('hex');
  if (actual !== expected) throw new Error(`The signer payload changed after building: ${name}`);
}
const out = join(root, 'release');
await mkdir(out, { recursive: true });
// Build outside synced document folders: File Provider can attach FinderInfo
// after signing, which makes Apple's strict signature verification fail.
const staging = await mkdtemp(join(tmpdir(), 'arca-signer-package-'));
const paths = await packager({
  dir: join(root, 'dist-signer'), out: staging, name: 'Arca Signer', platform, arch,
  appBundleId: 'computer.arca.hypersnap.signer', appCategoryType: 'public.app-category.utilities',
  appVersion: manifest.version, buildVersion: manifest.version, overwrite: true, prune: false, asar: true,
  electronVersion: manifest.electron_version,
  afterExtract: [async ({ buildPath }) => {
    await flipFuses(join(buildPath, 'Electron.app'), {
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
      [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
    });
  }],
  osxSign: { identity, optionsForFile: () => ({ entitlements: join(root, 'entitlements.mac.plist'), hardenedRuntime: true }) },
});
const app = join(paths[0], 'Arca Signer.app');
execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { stdio: 'inherit' });
const archive = join(out, `Arca-Signer-mac-${arch}.zip`);
const zip = () => execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, archive], { stdio: 'inherit' });
zip();
let notarized = false;
if (profile) {
  execFileSync('xcrun', ['notarytool', 'submit', archive, '--keychain-profile', profile, '--wait'], { stdio: 'inherit' });
  execFileSync('xcrun', ['stapler', 'staple', app], { stdio: 'inherit' });
  execFileSync('xcrun', ['stapler', 'validate', app], { stdio: 'inherit' });
  zip();
  notarized = true;
}
await cp(manifestPath, join(out, 'BUILD-MANIFEST.json'));
const digest = createHash('sha256').update(await readFile(archive)).digest('hex');
await writeFile(join(out, 'SHA256SUMS.txt'), `${digest}  Arca-Signer-mac-${arch}.zip\n`);
await writeFile(join(out, 'RELEASE-STATUS.json'), JSON.stringify({ version: manifest.version, source_commit: manifest.source_commit, source_tree_sha256: manifest.source_tree_sha256, developer_id_signed: true, notarized, architecture: arch, preview: manifest.working_tree_dirty || currentDirty }, null, 2) + '\n');
console.log(JSON.stringify({ app, archive, sha256: digest, notarized, preview: manifest.working_tree_dirty || currentDirty }));
