import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildPaths, fingerprintAssets, main } from './cloudflare-build.mjs';

const env = { WORKERS_CI: '1', WORKERS_CI_BUILD_UUID: '00000000-0000-4000-8000-000000000001', WORKERS_CI_COMMIT_SHA: 'a'.repeat(40) };
const directories = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
async function fixture() {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'opencaster-build-test-')); directories.push(temporaryRoot);
  const run = vi.fn(async args => {
    if (args[0] === 'workspace') {
      const directory = args.at(-1); await mkdir(path.join(directory, 'assets'));
      await writeFile(path.join(directory, 'index.html'), '<title>Opencaster</title>');
      await writeFile(path.join(directory, 'assets/app.js'), 'export {};');
    }
  });
  return { temporaryRoot, env, run, head: () => env.WORKERS_CI_COMMIT_SHA };
}

describe('Workers Builds verified version staging', () => {
  it('rejects missing or malformed platform metadata and a different checkout', async () => {
    for (const invalid of [{}, { ...env, WORKERS_CI: '0' }, { ...env, WORKERS_CI_BUILD_UUID: '../../elsewhere' }, { ...env, WORKERS_CI_COMMIT_SHA: '' }]) {
      expect(() => buildPaths(invalid)).toThrow('Expected Workers Builds');
    }
    const setup = await fixture();
    await expect(main('build', { ...setup, head: () => 'b'.repeat(40) })).rejects.toThrow('checked-out commit');
    expect(setup.run).not.toHaveBeenCalled();
  });

  it('runs the full gate before a fresh external build and stages exactly those assets without production promotion', async () => {
    const setup = await fixture(); const files = await main('build', setup);
    expect(setup.run.mock.calls.map(([args]) => args[0])).toEqual(['verify', 'workspace']);
    expect(JSON.parse(await readFile(files.manifest, 'utf8')).commit).toBe(env.WORKERS_CI_COMMIT_SHA);
    await main('upload', { ...setup, env: { ...env, WORKERS_CI_BRANCH: 'main' } });
    expect(setup.run.mock.calls.at(-1)[0]).toEqual(['exec', '--', 'wrangler', 'versions', 'upload', '--config', 'services/gateway/wrangler.jsonc', '--assets', files.assets, '--upload-source-maps']);
  });

  it('stops when verification fails and refuses to reuse a release directory', async () => {
    const setup = await fixture(); setup.run.mockRejectedValueOnce(new Error('gate failed'));
    await expect(main('build', setup)).rejects.toThrow('gate failed');
    expect(setup.run).toHaveBeenCalledTimes(1);
    await main('build', setup);
    await expect(main('build', setup)).rejects.toThrow();
  });

  it('refuses an upload after asset bytes or source metadata change', async () => {
    const setup = await fixture(); const files = await main('build', setup); setup.run.mockClear();
    await writeFile(path.join(files.assets, 'assets/app.js'), 'changed');
    await expect(main('upload', setup)).rejects.toThrow('changed after verification');
    expect(setup.run).not.toHaveBeenCalled();
  });

  it('rejects symlinks, browser maps and nonapplication fixtures before staging', async () => {
    const setup = await fixture(); const files = await main('build', setup);
    await symlink(path.join(files.assets, 'index.html'), path.join(files.assets, 'linked.html'));
    await expect(fingerprintAssets(files.assets)).rejects.toThrow('symlinks');
    await rm(path.join(files.assets, 'linked.html')); await writeFile(path.join(files.assets, 'assets/app.js.map'), '{}');
    await expect(fingerprintAssets(files.assets)).rejects.toThrow('Unexpected release asset');
    await rm(path.join(files.assets, 'assets/app.js.map')); await writeFile(path.join(files.assets, 'index.html'), '<title>Fixture</title>');
    await expect(fingerprintAssets(files.assets)).rejects.toThrow('production Opencaster');
  });
});
