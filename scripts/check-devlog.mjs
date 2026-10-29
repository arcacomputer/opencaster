import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

const logPath = 'apps/web-client/src/lib/devLog.ts';
const logPaths = [logPath, 'hypersnap/src/lib/devLog.ts'];
const emptyTree = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const zeroSha = '0'.repeat(40);
const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const tags = new Set(['Launch', 'Wallets', 'Security', 'Social', 'Reliability']);

// Unknown files default to requiring a note. Exemptions cover development-only
// material; every application, service and shared package is covered, including
// the former application location when comparing a pre-migration release.
export function needsReleaseNote(file) {
  const workspace = /^(?:(?:apps|services|packages)\/[^/]+|hypersnap)\//.test(file);
  if (!workspace && !file.startsWith('scripts/') && !['package.json', 'yarn.lock', 'tsconfig.base.json'].includes(file)) return false;
  if (logPaths.includes(file) || /\.md$/i.test(file)) return false;
  if (/(?:^|\/)licenses\//.test(file) || /(?:^|\/)(?:LICENSE(?:[.-][^/]*)?|THIRD_PARTY_DEPENDENCY_LICENSES\.txt)$/i.test(file)) return false;
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file)) return false;
  if (/^(?:hypersnap\/src\/lib\/protocol|packages\/protocol\/src)\/.*-golden\.json$/.test(file)) return false;
  if (/(?:^|\/)scripts\/(?:e2e-[^/]+|check-devlog\.mjs)$/.test(file)) return false;
  return true;
}

// Read only literal data. Never import/evaluate either revision of this file.
export function parseDevLog(source) {
  const ast = ts.createSourceFile(logPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (ast.parseDiagnostics.length) throw new Error('devLog.ts has invalid TypeScript syntax.');
  const declaration = ast.statements.filter(ts.isVariableStatement)
    .flatMap(statement => [...statement.declarationList.declarations])
    .find(node => ts.isIdentifier(node.name) && node.name.text === 'DEV_LOG');
  function literal(node) {
    if (node && ts.isStringLiteral(node)) return node.text;
    if (node && ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
    if (node && ts.isObjectLiteralExpression(node)) {
      const values = Object.create(null);
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property) ||
            !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
          throw new Error('DEV_LOG must contain literal object properties.');
        }
        const key = property.name.text;
        if (Object.hasOwn(values, key)) throw new Error(`Duplicate DEV_LOG property: ${key}`);
        values[key] = literal(property.initializer);
      }
      return values;
    }
    throw new Error('DEV_LOG must be a literal array of milestones (no executable expressions).');
  }
  const entries = literal(declaration?.initializer);
  if (!Array.isArray(entries) || !entries.length) throw new Error('DEV_LOG needs at least one milestone.');
  const ids = new Set();
  let previousDate = '9999-12-31';
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Invalid DEV_LOG milestone.');
    const text = value => typeof value === 'string' && value.trim().length > 0;
    if (!text(entry.id) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.id) || ids.has(entry.id)) {
      throw new Error(`DEV_LOG IDs must be unique lowercase slugs: ${entry.id}`);
    }
    ids.add(entry.id);
    if (!text(entry.date) || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date) ||
        !Number.isFinite(Date.parse(`${entry.date}T12:00:00Z`)) ||
        new Date(`${entry.date}T12:00:00Z`).toISOString().slice(0, 10) !== entry.date) {
      throw new Error(`Invalid milestone date: ${entry.id}`);
    }
    if (entry.date > previousDate) throw new Error('DEV_LOG must be ordered newest first.');
    previousDate = entry.date;
    // Historical logs can contain calendar dates alone. Recorded timestamps must
    // include an offset and retain that already-validated calendar date.
    if (Object.hasOwn(entry, 'timestamp') &&
        (typeof entry.timestamp !== 'string' ||
         !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(entry.timestamp) ||
         !Number.isFinite(Date.parse(entry.timestamp)) || entry.timestamp.slice(0, 10) !== entry.date)) {
      throw new Error(`Invalid milestone timestamp: ${entry.id}`);
    }
    if (![entry.title, entry.summary].every(text) || !Array.isArray(entry.changes) ||
        !entry.changes.length || !entry.changes.every(text) || !tags.has(entry.tag)) {
      throw new Error(`Milestone ${entry.id} needs a title, summary, changes and valid topic.`);
    }
    // Historical base revisions still contain the previous owner's source URLs.
    if (!text(entry.commit) || !/^https:\/\/github\.com\/(?:arcacomputer\/opencaster|arcabotai\/(?:opencaster|hypersnap-web))\/commit\/[a-f0-9]{40}$/.test(entry.commit)) {
      throw new Error(`Milestone ${entry.id} needs a full implementation commit URL in this repository.`);
    }
  }
  return entries;
}

export function checkDevLog({ base, head, mergeBase = false, cwd = repoRoot }) {
  const git = (...args) => execFileSync('git', ['-c', 'diff.relative=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const resolve = ref => {
    if (!ref || ref.startsWith('-')) throw new Error('Provide a valid Git revision.');
    try { return git('rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`); }
    catch { throw new Error(`Cannot read Git revision ${ref}. Fetch the base and full history before checking the dev log.`); }
  };
  const headSha = resolve(head || 'HEAD');
  let baseSha = base === zeroSha ? emptyTree : resolve(base);
  if (mergeBase) {
    if (baseSha === emptyTree) throw new Error('An initial push cannot use --merge-base.');
    baseSha = git('merge-base', baseSha, headSha);
  }
  const readSingleLog = (files, read) => {
    if (files.length > 1) throw new Error('Multiple public dev log locations found; keep one history at the current application path.');
    return files.length ? parseDevLog(read(files[0])) : [];
  };
  const readLog = revision => {
    const files = git('ls-tree', '-r', '--name-only', revision, '--', ...logPaths).split('\n').filter(Boolean);
    return readSingleLog(files, file => git('show', `${revision}:${file}`));
  };
  const before = baseSha === emptyTree ? [] : readLog(baseSha);
  const after = head ? readLog(headSha) : readSingleLog(logPaths.filter(file => existsSync(path.join(cwd, file))), file => readFileSync(path.join(cwd, file), 'utf8'));
  if (!after.length) throw new Error('The public dev log must not be removed.');
  // A bootstrap's empty-tree object need not exist in the local object store.
  // Enumerate its entire head snapshot instead of asking Git to read that tree.
  const changed = (baseSha === emptyTree
    ? git('ls-tree', '-r', '--name-only', '-z', headSha)
    : git('diff', '--name-only', '-z', '--no-renames', baseSha, ...(head ? [headSha] : [])))
    .split('\0').filter(Boolean);
  if (!head && baseSha === emptyTree) changed.push(...git('diff', '--name-only', '-z', '--no-renames', headSha).split('\0').filter(Boolean));
  if (!head) changed.push(...git('ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean));
  const productFiles = [...new Set(changed.filter(needsReleaseNote))];
  const existingIds = new Set(before.map(entry => entry.id));
  if (before.some(entry => !after.some(current => current.id === entry.id))) {
    throw new Error('Preserve existing DEV_LOG milestones; append a correction instead of removing history.');
  }
  const added = after.filter(entry => !existingIds.has(entry.id));
  if (productFiles.length && !added.length) {
    throw new Error(`Shipped Opencaster files changed without a new dev log milestone:\n${productFiles.map(file => `  ${file}`).join('\n')}\nAdd a new dated milestone to ${logPath} with a summary, changes and verified implementation commit URL. Editing an existing entry does not count.`);
  }
  for (const entry of added) {
    const sha = entry.commit.split('/').at(-1);
    try {
      git('merge-base', '--is-ancestor', sha, headSha);
      const commitTimestamp = git('show', '-s', '--format=%aI', sha);
      const commitDate = commitTimestamp.slice(0, 10);
      if (commitDate !== entry.date) throw new Error(`Use its recorded date ${commitDate}.`);
      if (commitTimestamp !== entry.timestamp) throw new Error(`Use its recorded timestamp ${commitTimestamp}.`);
    } catch (error) {
      throw new Error(`Milestone ${entry.id}: source must be an existing implementation commit in this history, dated as recorded by Git. ${error.message}`);
    }
  }
  return { productFiles, addedIds: added.map(entry => entry.id), baseSha, headSha };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = {};
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--merge-base') options.mergeBase = true;
      else if (['--base', '--head'].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('-')) options[args[i].slice(2)] = args[++i];
      else throw new Error(`Unknown or incomplete option: ${args[i]}`);
    }
    if (!options.base) throw new Error('Usage: yarn check:devlog --base <pre-release commit> [--head <commit>] [--merge-base]\nWithout --head, checks the current working tree, including untracked files.');
    const result = checkDevLog(options);
    console.log(`Dev log OK: ${result.productFiles.length} shipped file(s); ${result.addedIds.length ? `new milestones: ${result.addedIds.join(', ')}` : 'no new milestone needed'}.`);
  } catch (error) {
    console.error(`Dev log check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
