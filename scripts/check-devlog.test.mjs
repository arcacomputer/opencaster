import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkDevLog, needsReleaseNote, parseDevLog } from './check-devlog.mjs';

const LOG = 'apps/web-client/src/lib/devLog.ts';
const LEGACY_LOG = 'hypersnap/src/lib/devLog.ts';
const APP = 'apps/web-client/src/App.tsx';
const ZERO = '0'.repeat(40);
const URL_PREFIX = 'https://github.com/arcacomputer/opencaster/commit/';
const directories = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function repository() {
  const cwd = mkdtempSync(path.join(tmpdir(), 'arca-devlog-guard-')); directories.push(cwd);
  const env = { ...process.env, GIT_CONFIG_GLOBAL: path.join(cwd, 'no-global-config'), GIT_CONFIG_NOSYSTEM: '1' };
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG_COUNT']) delete env[name];
  const git = (...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '--initial-branch=main'); git('config', 'user.name', 'Isolated Dev Log Test'); git('config', 'user.email', 'devlog-test@example.invalid'); git('config', 'commit.gpgsign', 'false');
  mkdirSync(path.join(cwd, '.git', 'isolated-empty-hooks')); git('config', 'core.hooksPath', path.join(cwd, '.git', 'isolated-empty-hooks'));
  const write = (file, contents) => { mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true }); writeFileSync(path.join(cwd, file), contents); };
  const commit = (message, date = '2026-10-19T12:00:00-03:00') => {
    git('add', '--all');
    execFileSync('git', ['commit', '--quiet', '-m', message], { cwd, env: { ...env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }, stdio: ['ignore', 'pipe', 'pipe'] });
    return git('rev-parse', 'HEAD');
  };
  const log = (entries, file = LOG) => write(file, `export const DEV_LOG = ${JSON.stringify(entries, null, 2)};\n`);
  return { cwd, git, write, commit, log };
}
function milestone(id, commit, date = '2026-10-19') {
  return { id, date, title: `Milestone ${id}`, summary: `Public progress for ${id}.`, changes: ['A concrete isolated test improvement.'], commit: `${URL_PREFIX}${commit}`, tag: 'Reliability' };
}
function seeded({ legacy = false } = {}) {
  const logPath = legacy ? LEGACY_LOG : LOG;
  const repo = repository(); repo.write(legacy ? 'hypersnap/src/App.tsx' : APP, 'export const version = 1;\n');
  const source = repo.commit('Initial synthetic implementation');
  const old = [milestone('original-detail', source), milestone('original-launch', source)];
  repo.log(old, logPath); const base = repo.commit('Record original public history');
  return { ...repo, source, old, base };
}
function productChange(repo, file = APP) {
  repo.write(file, 'export const version = 2;\n'); return repo.commit('Implement isolated product improvement', '2026-10-20T08:00:00-03:00');
}
function recordedRelease(repo, entries, source = productChange(repo)) {
  const note = milestone('new-release', source, '2026-10-20');
  repo.log(entries ?? [note, ...repo.old]); const head = repo.commit('Document the implemented release', '2026-10-20T09:00:00-03:00');
  return { head, note, source };
}
function migrateApplication(repo) {
  mkdirSync(path.join(repo.cwd, 'apps'), { recursive: true });
  renameSync(path.join(repo.cwd, 'hypersnap'), path.join(repo.cwd, 'apps/web-client'));
}

// These functional integration cases create real repositories and spawn Git for
// each history check. One took 5,324 ms under full-suite load on 2026-10-22,
// exceeding Vitest's default 5 s without an assertion failure. Allow bounded
// subprocess/filesystem variance here only; static tests keep the default budget.
describe('release-note guard against real isolated Git history', { timeout: 15_000 }, () => {
  it('rejects a product change without an added milestone, including edits or same-day reordering of old notes', () => {
    const repo = seeded(); productChange(repo);
    for (const notes of [repo.old, [{ ...repo.old[0], title: 'Corrected old title' }, repo.old[1]], [...repo.old].reverse()]) {
      repo.log(notes);
      expect(() => checkDevLog({ base: repo.base, cwd: repo.cwd })).toThrow('without a new dev log milestone');
    }
  });

  it('accepts a new note pointing to a verified ancestor implementation and permits old-note corrections alongside it', () => {
    const repo = seeded(); const source = productChange(repo);
    const note = milestone('new-release', source, '2026-10-20');
    const release = recordedRelease(repo, [note, { ...repo.old[0], title: 'A factual correction' }, repo.old[1]], source);
    const result = checkDevLog({ base: repo.base, head: release.head, cwd: repo.cwd });
    expect(result).toMatchObject({ baseSha: repo.base, headSha: release.head, productFiles: ['apps/web-client/src/App.tsx'], addedIds: ['new-release'] });
  });

  it('checks a transferred release against historical owner URLs and permits canonical source links without losing milestones', () => {
    const repo = seeded();
    repo.log(repo.old.map((note, index) => ({ ...note, commit: note.commit.replace('/arcacomputer/opencaster/', index ? '/arcabotai/hypersnap-web/' : '/arcabotai/opencaster/') })));
    const historicalBase = repo.commit('Preserve the previous owner’s published source links');
    const release = recordedRelease(repo);
    expect(checkDevLog({ base: historicalBase, head: release.head, cwd: repo.cwd })).toMatchObject({ productFiles: ['apps/web-client/src/App.tsx'], addedIds: ['new-release'] });
  });

  it.each([true, false])('preserves pre-monorepo history across the application move (explicit head: %s)', explicit => {
    const repo = seeded({ legacy: true }); migrateApplication(repo);
    const source = repo.commit('Move the existing application into the monorepo', '2026-10-20T08:00:00-03:00');
    repo.log([milestone('monorepo-migration', source, '2026-10-20'), ...repo.old]);
    const head = explicit ? repo.commit('Record the repository migration', '2026-10-20T09:00:00-03:00') : undefined;
    const result = checkDevLog({ base: repo.base, ...(head ? { head } : {}), cwd: repo.cwd });
    expect(result.addedIds).toEqual(['monorepo-migration']);
    expect(result.productFiles).toEqual(expect.arrayContaining([APP, 'hypersnap/src/App.tsx']));
    // A named historical head still uses its former path even after the worktree moved.
    expect(checkDevLog({ base: repo.base, head: repo.base, cwd: repo.cwd })).toMatchObject({ productFiles: [], addedIds: [] });
  });

  it.each([true, false])('requires a new migration milestone without recounting historical IDs (explicit head: %s)', explicit => {
    const repo = seeded({ legacy: true }); migrateApplication(repo);
    const head = explicit ? repo.commit('Move application without a release note', '2026-10-20T08:00:00-03:00') : undefined;
    expect(() => checkDevLog({ base: repo.base, ...(head ? { head } : {}), cwd: repo.cwd })).toThrow('without a new dev log milestone');
  });

  it.each([true, false])('rejects dropping historical IDs while moving the public log (explicit head: %s)', explicit => {
    const repo = seeded({ legacy: true }); migrateApplication(repo);
    const source = repo.commit('Move application and public log', '2026-10-20T08:00:00-03:00');
    repo.log([milestone('monorepo-migration', source, '2026-10-20'), repo.old[0]]);
    const head = explicit ? repo.commit('Incorrectly omit part of the old history', '2026-10-20T09:00:00-03:00') : undefined;
    expect(() => checkDevLog({ base: repo.base, ...(head ? { head } : {}), cwd: repo.cwd })).toThrow('Preserve existing');
  });

  it('rejects ambiguous copies rather than selecting a stale public history', () => {
    const repo = seeded(); repo.log(repo.old, LEGACY_LOG);
    expect(() => checkDevLog({ base: repo.base, cwd: repo.cwd })).toThrow('Multiple public dev log locations');
    const head = repo.commit('Incorrectly retain a second public history');
    expect(() => checkDevLog({ base: repo.base, head, cwd: repo.cwd })).toThrow('Multiple public dev log locations');
  });

  it.each(['nonexistent', 'nonancestor', 'wrong-date'])('rejects a new milestone whose source is %s', failure => {
    const repo = seeded(); let reference;
    if (failure === 'nonancestor') {
      repo.git('checkout', '-b', 'unrelated-source'); repo.write('apps/web-client/src/other.ts', 'export const unrelated = true;'); reference = repo.commit('Unrelated branch implementation', '2026-10-20T07:00:00-03:00'); repo.git('checkout', 'main');
    }
    const source = productChange(repo); const note = milestone('new-release', failure === 'nonexistent' ? 'f'.repeat(40) : reference ?? source, failure === 'wrong-date' ? '2026-10-21' : '2026-10-20');
    repo.log([note, ...repo.old]); const head = repo.commit('Add unverified source note', '2026-10-21T09:00:00-03:00');
    expect(() => checkDevLog({ base: repo.base, head, cwd: repo.cwd })).toThrow('existing implementation commit in this history');
  });

  it('rejects deleting either an old milestone or the entire public history', () => {
    const repo = seeded(); const source = productChange(repo); repo.log([milestone('new-release', source, '2026-10-20'), repo.old[0]]);
    const head = repo.commit('Incorrectly drop an existing note', '2026-10-20T09:00:00-03:00');
    expect(() => checkDevLog({ base: repo.base, head, cwd: repo.cwd })).toThrow('Preserve existing');
    rmSync(path.join(repo.cwd, LOG)); const removed = repo.commit('Incorrectly remove public log', '2026-10-20T10:00:00-03:00');
    expect(() => checkDevLog({ base: repo.base, head: removed, cwd: repo.cwd })).toThrow('must not be removed');
  });

  it('allows docs, test, fixture, license and development E2E changes without inventing a product milestone', () => {
    const repo = seeded();
    for (const file of ['apps/web-client/README.md', 'apps/web-client/src/Example.test.tsx', 'apps/web-client/scripts/e2e-fixture.mjs', 'apps/web-client/licenses/NOTICE.txt', 'packages/protocol/src/message-golden.json', 'services/gateway/src/index.test.ts', 'scripts/check-devlog.mjs']) repo.write(file, 'isolated development material');
    repo.log([{ ...repo.old[0], summary: 'Correct an old typo without claiming a release.' }, repo.old[1]]);
    const head = repo.commit('Development-only edits');
    expect(checkDevLog({ base: repo.base, head, cwd: repo.cwd })).toMatchObject({ productFiles: [], addedIds: [] });
  });

  it('catches untracked shipped files in working-tree mode', () => {
    const repo = seeded(); repo.write('services/gateway/src/untracked-runtime.ts', 'export const handler = true;');
    expect(() => checkDevLog({ base: repo.base, cwd: repo.cwd })).toThrow('services/gateway/src/untracked-runtime.ts');
  });

  it.each([true, false])('covers runtime and dependencies across workspaces and root tooling (explicit head: %s)', explicit => {
    const repo = seeded();
    const files = ['apps/web-client/src/App.tsx', 'apps/signer/main.ts', 'apps/android-client/app/src/Main.kt', 'services/gateway/src/index.ts', 'services/analytics/src/worker.ts', 'packages/protocol/src/messageBuilder.ts', 'packages/core/src/index.ts', 'package.json', 'yarn.lock', 'tsconfig.base.json', 'scripts/build-signer.mjs'];
    for (const file of files) repo.write(file, 'initial runtime configuration');
    const base = repo.commit('Seed independent workspace runtime and root tooling');
    for (const file of files) repo.write(file, 'updated runtime configuration');
    const untracked = 'packages/future/src/new-runtime.ts'; repo.write(untracked, 'new runtime');
    const head = explicit ? repo.commit('Unannounced changes across monorepo workspaces') : undefined;
    let failure;
    try { checkDevLog({ base, ...(head ? { head } : {}), cwd: repo.cwd }); } catch (error) { failure = error; }
    expect(failure?.message).toContain('without a new dev log milestone');
    for (const file of [...files, untracked]) expect(failure.message).toContain(`  ${file}\n`);
  });

  it('checks only the named head when dirty and untracked working-tree files disagree with it', () => {
    const repo = seeded(); const release = recordedRelease(repo);
    repo.write('apps/web-client/src/App.tsx', 'uncommitted product version'); repo.write('apps/web-client/worker/untracked.ts', 'untracked product code'); repo.write(LOG, 'this dirty dev log is not valid data');
    expect(checkDevLog({ base: repo.base, head: release.head, cwd: repo.cwd })).toMatchObject({ productFiles: ['apps/web-client/src/App.tsx'], addedIds: ['new-release'] });
  });

  it('fails closed when the requested base revision has not been fetched', () => {
    const repo = seeded(); expect(() => checkDevLog({ base: 'refs/heads/not-fetched', head: repo.base, cwd: repo.cwd })).toThrow('Fetch the base and full history');
  });

  it('uses the merge base so a target branch’s unrelated note is neither required nor counted as a feature note', () => {
    const repo = seeded(); repo.git('branch', 'feature');
    const targetSource = productChange(repo, 'apps/web-client/src/target-only.ts'); repo.log([milestone('target-only-release', targetSource, '2026-10-20'), ...repo.old]); const target = repo.commit('Target branch release', '2026-10-20T09:00:00-03:00');
    repo.git('checkout', 'feature'); const source = productChange(repo, 'apps/web-client/src/feature-only.ts');
    expect(() => checkDevLog({ base: target, head: source, mergeBase: true, cwd: repo.cwd })).toThrow('without a new dev log milestone');
    const note = milestone('feature-release', source, '2026-10-20'); repo.log([note, ...repo.old]); const head = repo.commit('Feature release note', '2026-10-20T10:00:00-03:00');
    expect(checkDevLog({ base: target, head, mergeBase: true, cwd: repo.cwd })).toMatchObject({ baseSha: repo.base, productFiles: ['apps/web-client/src/feature-only.ts'], addedIds: ['feature-release'] });
  });

  it.each([true, false])('bootstraps an initial zero-SHA push without relying on an empty-tree object (explicit head: %s)', explicit => {
    const repo = seeded();
    const result = checkDevLog({ base: ZERO, ...(explicit ? { head: repo.base } : {}), cwd: repo.cwd });
    expect(result.productFiles).toEqual(['apps/web-client/src/App.tsx']); expect(result.addedIds).toEqual(repo.old.map(note => note.id));
  });
});

describe('release policy and static data validation', () => {
  it('accepts the organization’s repository and exact historical source URLs while rejecting other owners, repos and lookalikes', () => {
    const current = milestone('organization-release', 'a'.repeat(40));
    const renamed = { ...current, id: 'renamed-release', commit: current.commit.replace('/arcacomputer/', '/arcabotai/') };
    const original = { ...current, id: 'original-release', commit: current.commit.replace('/arcacomputer/opencaster/', '/arcabotai/hypersnap-web/') };
    expect(parseDevLog(`export const DEV_LOG = ${JSON.stringify([current, renamed, original])};`)).toEqual([current, renamed, original]);
    for (const commit of [current.commit.replace('/arcacomputer/', '/someone-else/'), current.commit.replace('/opencaster/', '/other/'), current.commit.replace('/opencaster/', '/hypersnap-web/'), renamed.commit.replace('/opencaster/', '/other/'), current.commit.replace('github.com/', 'github.com.evil.invalid/'), current.commit.replace('/arcacomputer/', '/arcacomputer-evil/')]) {
      expect(() => parseDevLog(`export const DEV_LOG = ${JSON.stringify([{ ...current, commit }])};`)).toThrow('implementation commit URL');
    }
  });

  it('requires a note for shipped dependencies, styles, workers, signer code, assets, build scripts and unknown product paths', () => {
    const paths = ['package.json', 'yarn.lock', 'tsconfig.base.json', 'scripts/build-signer.mjs', 'apps/web-client/package.json', 'apps/web-client/src/App.tsx', 'apps/web-client/src/style.scss', 'services/gateway/src/index.ts', 'services/gateway/wrangler.jsonc', 'services/analytics/src/worker.ts', 'apps/signer/main.ts', 'apps/web-client/public/quorum-symbol.svg', 'apps/web-client/public/InterVariable.ttf', 'apps/web-client/vite.config.ts', 'apps/web-client/unknown-runtime.config', 'apps/web-client/scripts/e2e-helpers/runtime.mjs', 'packages/protocol/src/messageBuilder.ts', 'packages/core/src/index.ts', 'packages/future/unknown.config', 'apps/ios-client/App.swift', 'hypersnap/package.json', 'hypersnap/yarn.lock', 'hypersnap/src/App.tsx', 'hypersnap/worker/index.ts', 'hypersnap/scripts/build-signer.mjs'];
    expect(paths.filter(needsReleaseNote)).toEqual(paths);
  });
  it('exempts only development/docs/license paths and the dev-log data itself', () => {
    const paths = ['src/App.tsx', 'README.md', LOG, LEGACY_LOG, 'scripts/check-devlog.mjs', 'scripts/check-devlog.test.mjs', 'scripts/e2e-browser-server.mjs', 'apps/web-client/AGENTS.md', 'apps/web-client/README.md', 'apps/web-client/licenses/LICENSE.md', 'apps/web-client/public/licenses/NOTICE.txt', 'apps/web-client/public/THIRD_PARTY_DEPENDENCY_LICENSES.txt', 'apps/web-client/src/Example.test.tsx', 'services/gateway/src/index.spec.ts', 'apps/signer/approve.test.ts', 'apps/web-client/scripts/e2e-feature-checks.ts', 'packages/protocol/src/keyadd-golden.json', 'packages/protocol/src/protocol.test.ts', 'packages/core/LICENSE', 'hypersnap/src/Example.test.tsx', 'hypersnap/scripts/check-devlog.mjs', 'hypersnap/scripts/e2e-feature-checks.ts', 'hypersnap/src/lib/protocol/keyadd-golden.json'];
    expect(paths.filter(needsReleaseNote)).toEqual([]);
  });
  it('reads literal data without evaluating expressions, spread properties or computed keys', () => {
    const note = milestone('release', 'a'.repeat(40)); const encoded = JSON.stringify(note);
    expect(parseDevLog(`export const DEV_LOG = [${encoded}];`)).toEqual([note]);
    for (const source of [`export const DEV_LOG = (() => { throw new Error('executed'); })();`, `export const DEV_LOG = [{ ...${encoded} }];`, `export const DEV_LOG = [{ ['id']: 'release' }];`, `export const DEV_LOG = [${encoded}].map(entry => entry);`]) expect(() => parseDevLog(source)).toThrow(/literal/);
  });
  it('rejects duplicate milestone IDs, invalid calendar dates and newest-first ordering errors', () => {
    const first = milestone('first', 'a'.repeat(40), '2026-10-20'); const second = milestone('second', 'b'.repeat(40), '2026-10-19');
    expect(() => parseDevLog(`export const DEV_LOG = ${JSON.stringify([first, first])};`)).toThrow('unique');
    expect(() => parseDevLog(`export const DEV_LOG = ${JSON.stringify([{ ...first, date: '2026-02-30' }])};`)).toThrow('Invalid milestone date');
    expect(() => parseDevLog(`export const DEV_LOG = ${JSON.stringify([second, first])};`)).toThrow('ordered newest first');
  });
});
