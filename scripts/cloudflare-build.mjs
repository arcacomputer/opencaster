#!/usr/bin/env node
// Workers Builds packages branches and stages main. Production promotion
// remains the release procedure in apps/web-client/README.md.
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function buildPaths(env, temporaryRoot = tmpdir()) {
  if (env.WORKERS_CI !== '1' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(env.WORKERS_CI_BUILD_UUID ?? '')
    || !/^[0-9a-f]{40}$/i.test(env.WORKERS_CI_COMMIT_SHA ?? '')
    || typeof env.WORKERS_CI_BRANCH !== 'string' || !env.WORKERS_CI_BRANCH.trim()) throw new Error('Expected Workers Builds branch, commit and build identifiers.');
  const assets = path.join(temporaryRoot, `arca-release-workers-${env.WORKERS_CI_BUILD_UUID}`);
  return { assets, manifest: `${assets}.json` };
}

export async function fingerprintAssets(directory) {
  const entries = [];
  async function walk(current) {
    for (const name of (await readdir(current)).sort()) {
      const file = path.join(current, name); const stat = await lstat(file);
      if (stat.isSymbolicLink()) throw new Error('Release assets cannot contain symlinks.');
      if (stat.isDirectory()) { await walk(file); continue; }
      if (!stat.isFile() || /\.map$|\.DS_Store$|\(\d+\)/i.test(name)) throw new Error('Unexpected release asset.');
      const bytes = await readFile(file);
      entries.push({ path: path.relative(directory, file), sha256: createHash('sha256').update(bytes).digest('hex') });
    }
  }
  await walk(directory);
  if (!entries.some(entry => entry.path === 'index.html') || !entries.some(entry => entry.path.startsWith('assets/') && entry.path.endsWith('.js'))
    || !(await readFile(path.join(directory, 'index.html'), 'utf8')).includes('<title>Opencaster')) throw new Error('Expected production Opencaster assets.');
  return entries;
}

function runYarn(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('yarn', args, { stdio: 'inherit', env: process.env });
    child.once('error', () => reject(new Error('Unable to start Yarn.')));
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Yarn command failed (${code ?? 'terminated'}).`)));
  });
}

export async function main(phase = process.argv[2], {
  env = process.env, temporaryRoot = tmpdir(), run = runYarn,
  head = () => execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
} = {}) {
  if (!['build', 'upload'].includes(phase)) throw new Error('Use build or upload.');
  const files = buildPaths(env, temporaryRoot);
  if (head() !== env.WORKERS_CI_COMMIT_SHA) throw new Error('Build source does not match the checked-out commit.');
  if (phase === 'build') {
    await run(['verify']);
    await mkdir(files.assets); // Refuse to reuse any existing release directory.
    await run(['workspace', '@opencaster/web-client', 'build', '--outDir', files.assets]);
    const entries = await fingerprintAssets(files.assets);
    await writeFile(files.manifest, JSON.stringify({ branch: env.WORKERS_CI_BRANCH, commit: env.WORKERS_CI_COMMIT_SHA, entries }), { flag: 'wx', mode: 0o600 });
    return files;
  }
  const manifest = JSON.parse(await readFile(files.manifest, 'utf8'));
  if (manifest.branch !== env.WORKERS_CI_BRANCH || manifest.commit !== env.WORKERS_CI_COMMIT_SHA || JSON.stringify(manifest.entries) !== JSON.stringify(await fingerprintAssets(files.assets))) throw new Error('Release assets or source metadata changed after verification.');
  // Native branch Previews have separate Worker identities and resources. Keep
  // their full packaging check local; only main may stage a production version.
  const previewArgs = env.WORKERS_CI_BRANCH === 'main' ? [] : ['--dry-run'];
  await run(['exec', '--', 'wrangler', 'versions', 'upload', '--config', 'services/gateway/wrangler.jsonc', '--assets', files.assets, '--upload-source-maps', ...previewArgs]);
  if (previewArgs.length) console.log('Branch Worker packaging verified; no version uploaded.');
  return files;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
