import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, session, type IpcMainInvokeEvent } from 'electron';
import { open, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  hashSignerRequest,
  PAIRING_REQUEST_MAX_BYTES,
  validateSignerRequest,
  type SignerApproval,
  type SignerRequest,
} from '@opencaster/client-core/pairing';
import { approveSignerRequest } from './approve';
import { isAllowedResource, validateApproveInput } from './policy';
import type { NativeResult, PairingDisplay } from './bridge';

// These switches supplement the renderer's deny-by-default session and CSP.
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-sync');
app.commandLine.appendSwitch('disable-domain-reliability');
app.commandLine.appendSwitch('disable-breakpad');
app.commandLine.appendSwitch('no-pings');
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND');
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp');
app.enableSandbox();
protocol.registerSchemesAsPrivileged([{ scheme: 'arca-signer', privileges: { standard: true, secure: true } }]);

let window: BrowserWindow | null = null;
let currentRequest: SignerRequest | null = null;
let currentApproval: SignerApproval | null = null;
let operationPending = false;
const indexUrl = 'arca-signer://app/index.html';
const resourceTypes: Record<string, string> = {
  'index.html': 'text/html; charset=utf-8',
  'renderer.js': 'application/javascript; charset=utf-8',
  'style.css': 'text/css; charset=utf-8',
  'quorum-symbol.svg': 'image/svg+xml',
};
const allowedResources = new Set(Object.keys(resourceTypes).map(name => `arca-signer://app/${name}`));
const csp = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; worker-src 'none'; frame-ancestors 'none'";

function clearState(): void {
  currentRequest = null;
  currentApproval = null;
}

function assertSender(event: IpcMainInvokeEvent): void {
  if (!window || window.isDestroyed() || event.sender !== window.webContents
      || event.senderFrame !== window.webContents.mainFrame
      || event.senderFrame.origin !== 'arca-signer://app'
      || event.senderFrame.url !== indexUrl) {
    throw new Error('Unauthorized signer window.');
  }
}

function assertNoArgs(args: unknown[]): void {
  if (args.length !== 0) throw new Error('This operation takes no arguments.');
}

function failure<T>(error: string): NativeResult<T> { return { ok: false, error }; }
function success<T>(value: T): NativeResult<T> { return { ok: true, value }; }

async function importRequest(): Promise<PairingDisplay | null> {
  if (!window) return null;
  clearState();
  const selected = await dialog.showOpenDialog(window, {
    title: 'Import a browser authorization or revocation request',
    buttonLabel: 'Review request',
    properties: ['openFile', 'dontAddToRecent'],
    filters: [{ name: 'Arca signer request', extensions: ['json'] }],
  });
  if (selected.canceled || selected.filePaths.length !== 1) return null;
  const file = await open(selected.filePaths[0], 'r');
  let bytes: Buffer | undefined;
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size <= 0 || info.size > PAIRING_REQUEST_MAX_BYTES) throw new Error('Invalid request file.');
    bytes = Buffer.alloc(PAIRING_REQUEST_MAX_BYTES + 1);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead > PAIRING_REQUEST_MAX_BYTES) throw new Error('Request file is too large.');
    const parsed: unknown = JSON.parse(bytes.subarray(0, bytesRead).toString('utf8'));
    currentRequest = validateSignerRequest(parsed);
    return { request: currentRequest, requestHash: hashSignerRequest(currentRequest) };
  } finally {
    bytes?.fill(0);
    await file.close();
  }
}

ipcMain.handle('arca:import-request', async (event, ...args): Promise<NativeResult<PairingDisplay | null>> => {
  assertSender(event);
  assertNoArgs(args);
  if (operationPending) return failure('Finish the current operation first.');
  operationPending = true;
  try { return success(await importRequest()); }
  catch { clearState(); return failure('This request could not be imported. Create a fresh request on opencaster.org and select its JSON file.'); }
  finally { operationPending = false; }
});

ipcMain.handle('arca:approve', async (event, ...args): Promise<NativeResult<true>> => {
  assertSender(event);
  if (operationPending) return failure('Finish the current operation first.');
  if (args.length !== 1) return failure('Invalid approval input.');
  // eslint-disable-next-line no-useless-assignment -- Initialize sensitive local state empty before input validation.
  let phrase = '';
  try {
    const input = validateApproveInput(args[0]);
    phrase = input.phrase;
    input.phrase = '';
    // Release the deserialized IPC object reference before deriving any key.
    (args[0] as { phrase: string }).phrase = '';
    args.length = 0;
    if (!currentRequest || input.requestId !== currentRequest.requestId) return failure('Import and review a fresh request first.');
    currentApproval = null;
    currentApproval = approveSignerRequest(currentRequest, phrase);
    return success(true);
  } catch (error) {
    currentApproval = null;
    const message = error instanceof Error ? error.message : '';
    if (message === 'Enter a valid 24-word English recovery phrase. Check its spelling and word order.'
        || message === 'This recovery phrase does not match the custody address in the request. No approval was created.') return failure(message);
    return failure('Approval failed. Check your request is current and contains the expected account.');
  } finally {
    // eslint-disable-next-line no-useless-assignment -- Best-effort local reference release; JavaScript strings cannot be reliably erased.
    phrase = '';
    args.length = 0;
  }
});

ipcMain.handle('arca:export-approval', async (event, ...args): Promise<NativeResult<boolean>> => {
  assertSender(event);
  assertNoArgs(args);
  if (operationPending) return failure('Finish the current operation first.');
  if (!currentApproval || !currentRequest || !window) return failure('Approve a request before exporting.');
  operationPending = true;
  try {
    validateSignerRequest(currentRequest);
    const revoking = currentRequest.kind === 'arca.hypersnap.signer.revoke.request';
    const selected = await dialog.showSaveDialog(window, {
      title: revoking ? 'Save your public revocation approval' : 'Save your public pairing approval',
      buttonLabel: 'Save approval',
      defaultPath: `arca-${revoking ? 'revocation-' : ''}approval-${currentRequest.requestId.slice(0, 12)}.json`,
      filters: [{ name: 'Arca pairing approval', extensions: ['json'] }],
      properties: ['dontAddToRecent'],
    });
    if (selected.canceled || !selected.filePath) return success(false);
    if (!currentApproval || !window || window.isDestroyed()) return failure('Approval cleared. Please start again.');
    await writeFile(selected.filePath, `${JSON.stringify(currentApproval, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    clearState();
    return success(true);
  } catch { return failure('Could not save the approval. It may have expired; create a fresh request if necessary.'); }
  finally { operationPending = false; }
});

ipcMain.handle('arca:clear', (event, ...args) => { assertSender(event); assertNoArgs(args); clearState(); });
ipcMain.handle('arca:quit', (event, ...args) => { assertSender(event); assertNoArgs(args); clearState(); app.quit(); });

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  // No persist: prefix: Chromium cookies/cache/session data stay in memory.
  const isolatedSession = session.fromPartition(`arca-offline-${randomUUID()}`, { cache: false });
  await isolatedSession.closeAllConnections();
  isolatedSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    callback({ cancel: !isAllowedResource(details.url, allowedResources) });
  });
  // A custom origin has no file:// filesystem privileges. No request can map to
  // an arbitrary path: only exact, fixed build assets are read from this folder.
  isolatedSession.protocol.handle('arca-signer', async request => {
    if (request.method !== 'GET' || !isAllowedResource(request.url, allowedResources)) return new Response(null, { status: 404 });
    const filename = new URL(request.url).pathname.slice(1);
    try {
      const bytes = await readFile(join(__dirname, filename));
      return new Response(new Uint8Array(bytes).buffer, {
        headers: {
          'Content-Type': resourceTypes[filename],
          'Content-Security-Policy': csp,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-store',
        },
      });
    } catch { return new Response(null, { status: 404 }); }
  });
  isolatedSession.setPermissionCheckHandler(() => false);
  isolatedSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  isolatedSession.setDevicePermissionHandler(() => false);
  isolatedSession.on('will-download', event => event.preventDefault());
  window = new BrowserWindow({
    title: 'Arca Signer',
    width: 980, height: 900, minWidth: 760, minHeight: 720,
    backgroundColor: '#0d1017', show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      session: isolatedSession,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      devTools: !app.isPackaged,
      safeDialogs: true,
      navigateOnDragDrop: false,
      spellcheck: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-frame-navigate', event => event.preventDefault());
  window.webContents.on('will-redirect', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('render-process-gone', () => { clearState(); app.quit(); });
  window.webContents.on('unresponsive', () => { clearState(); app.quit(); });
  window.once('ready-to-show', () => window?.show());
  window.on('close', clearState);
  window.on('closed', () => { clearState(); window = null; app.quit(); });
  await window.loadURL(indexUrl);
}).catch(() => { clearState(); app.quit(); });

app.on('window-all-closed', () => { clearState(); app.quit(); });
app.on('before-quit', clearState);
app.on('certificate-error', (event, _contents, _url, _error, _certificate, callback) => { event.preventDefault(); callback(false); });
