#!/usr/bin/env node
/**
 * Real-browser v16 -> current MessageDB and badge-hook parity, on a disposable
 * loopback origin with synthetic messages. Never opens a deployed origin,
 * connects to the relay, reads an existing user's data, or deletes a database.
 *
 * yarn node scripts/validate-mention-indexes-browser.mjs --port=5196
 * Open the printed URL in a real browser. Wait for MODULE READY, click Seed,
 * wait for V16 SEEDED AND CLOSED, reload, wait for MODULE READY, click Upgrade.
 * Use an unused port for each rerun: IndexedDB persists by origin.
 */
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baseline = '14550a1de59ac81c4c3a86ee9005d4e36b57c49f';
const portArg = process.argv.slice(2).find((arg) => arg.startsWith('--port='));
const port = Number(portArg?.slice('--port='.length) ?? 5196);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('Choose a loopback port between 1024 and 65535.');
}
const directory = realpathSync(
  mkdtempSync(resolve(tmpdir(), 'mention-index-browser-'))
);
const modules = resolve(root, 'node_modules');
const shared = realpathSync(resolve(modules, '@quilibrium/quorum-shared'));
const write = (name, text) => writeFileSync(resolve(directory, name), text);

// Use the exact previous application's implementation and full v16 schema,
// rather than a hand-written approximation of either the schema or old counts.
for (const [source, destination] of [
  ['src/db/messages.ts', 'messages16.ts'],
  ['src/hooks/business/mentions/useSpaceMentionCounts.ts', 'mentions16.ts'],
  ['src/hooks/business/replies/useSpaceReplyCounts.ts', 'replies16.ts'],
]) {
  let sourceText = execFileSync('git', ['show', `${baseline}:${source}`], {
    cwd: root,
    encoding: 'utf8',
  });
  sourceText = sourceText.replace(
    /(from\s*)(['"])([^'"]+)\2/g,
    (match, from, quote, path) => {
      return path.startsWith('.')
        ? `${from}${quote}${resolve(root, dirname(source), path)}${quote}`
        : match;
    }
  );
  if (destination === 'messages16.ts') {
    sourceText = sourceText.replace(
      resolve(root, 'src/db/dbVersion'),
      resolve(directory, 'version16')
    );
  }
  write(destination, sourceText);
}
write(
  'version16.ts',
  "export const QUORUM_DB_NAME = 'quorum_db'; export const QUORUM_DB_VERSION = 16;\n"
);
// Inject only the synthetic viewer and DB context. DB, query, hook and mention
// filtering implementations are real; credentials and network providers never mount.
write(
  'sdk.ts',
  "export const usePasskeysContext = () => ({ currentPasskeyInfo: { address: 'synthetic-viewer' } });\n"
);
write(
  'state.ts',
  "import { createContext, useContext } from 'react'; export const DbContext = createContext<any>(null); export const useMessageDB = () => ({ messageDB: useContext(DbContext) });\n"
);

// Narrow reexports avoid initializing unrelated UI from the shared barrel.
const sharedExports = {
  'utils/logger': ['logger'],
  'utils/validation': ['isValidIPFSCID'],
  'receipts/reconcile': ['resolveDeliveryAckPatch', 'resolveReadAckPatch'],
  'types/bookmark': ['BOOKMARKS_CONFIG'],
  'utils/mentions': ['isMentionedWithSettings'],
  'utils/notificationSettingsUtils': [
    'getDefaultNotificationSettings',
    'isNotificationTypeEnabled',
  ],
  'utils/permissions': ['getUserRoles'],
  'utils/dateFormatting': ['formatConversationTime', 'formatMessageDate'],
};
write(
  'shared.ts',
  Object.entries(sharedExports)
    .map(
      ([path, names]) =>
        `export { ${names.join(', ')} } from ${JSON.stringify(resolve(shared, 'src', path))};`
    )
    .join('\n')
);
write(
  'main.tsx',
  readFileSync(
    resolve(root, 'src/dev/tests/db/browser/mention-indexes.tsx.template'),
    'utf8'
  ).replaceAll('__CURRENT_ROOT__', root)
);
write(
  'index.html',
  `<!doctype html><title>Mention index browser validation</title>
<h1>Real-browser MessageDB migration</h1><p>Synthetic data only. Local test origin.</p>
<button id="seed">1. Create v16 database and record old badges</button>
<button id="upgrade">2. Upgrade existing v16 and compare current badges</button>
<pre id="status">Loading modules</pre><div id="react"></div>
<script type="module" src="/main.tsx"></script>`
);

const { createServer } = await import(
  pathToFileURL(resolve(modules, 'vite/dist/node/index.js')).href
);
const { default: react } = await import(
  pathToFileURL(resolve(modules, '@vitejs/plugin-react/dist/index.js')).href
);
const aliases = [
  {
    find: /^.*components\/context\/useMessageDB$/,
    replacement: resolve(directory, 'state.ts'),
  },
  {
    find: '@quilibrium/quilibrium-js-sdk-channels',
    replacement: resolve(directory, 'sdk.ts'),
  },
  {
    find: '@quilibrium/quorum-shared',
    replacement: resolve(directory, 'shared.ts'),
  },
  ...Object.entries({
    '@tanstack/react-query': '@tanstack/react-query/build/modern/index.js',
    minisearch: 'minisearch/dist/es/index.js',
    'react-dom/client': 'react-dom/client.js',
    'react-dom': 'react-dom/index.js',
    'react/jsx-dev-runtime': 'react/jsx-dev-runtime.js',
    'react/jsx-runtime': 'react/jsx-runtime.js',
    react: 'react/index.js',
  }).map(([find, path]) => ({ find, replacement: resolve(modules, path) })),
];
const server = await createServer({
  configFile: false,
  root: directory,
  cacheDir: resolve(directory, '.vite'),
  plugins: [
    react({
      babel: {
        plugins: [resolve(modules, '@lingui/babel-plugin-lingui-macro')],
      },
    }),
  ],
  resolve: { dedupe: ['react', 'react-dom'], alias: aliases },
  server: {
    host: '127.0.0.1',
    port,
    strictPort: true,
    fs: { allow: [directory, root, realpathSync(modules), shared] },
  },
});
await server.listen();
server.printUrls();
console.log(`Synthetic harness sources: ${directory}`);
console.log(
  'Wait for MODULE READY. Seed -> V16 SEEDED AND CLOSED -> reload -> MODULE READY -> Upgrade.'
);
