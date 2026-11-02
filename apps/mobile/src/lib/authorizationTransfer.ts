import { File, Paths } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import {
  validateSignerRequest,
  type SignerRequest,
} from '@opencaster/client-core/pairing';

const MAX_TRANSFER_BYTES = 16_384;

class TransferError extends Error {}

function fail(message: string): never {
  throw new TransferError(message);
}

function checkOptionalSize(size: number | undefined): void {
  if (size === undefined) return;
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_TRANSFER_BYTES) {
    fail('Authorization files must be at most 16 KiB.');
  }
}

function checkFileSize(size: number | null | undefined): void {
  if (size === null || size === undefined || !Number.isSafeInteger(size) || size < 0 || size > MAX_TRANSFER_BYTES) {
    fail('Authorization files must be at most 16 KiB.');
  }
}

function isInCache(uri: string): boolean {
  const cacheUri = Paths.cache.uri.endsWith('/') ? Paths.cache.uri : `${Paths.cache.uri}/`;
  return uri.startsWith(cacheUri);
}

function removeCacheFile(file: File | undefined, uri: string | undefined): void {
  if (!file || !uri || !isInCache(uri)) return;
  try {
    if (file.exists) file.delete();
  } catch {
    return;
  }
}

export async function shareAuthorizationRequest(value: unknown, nowMs = Date.now()): Promise<void> {
  let request: SignerRequest;
  try {
    request = validateSignerRequest(value, nowMs);
  } catch {
    throw new Error('This authorization request is invalid or expired. Generate a fresh request.');
  }

  const prefix = request.kind === 'arca.hypersnap.signer.revoke.request' ? 'revocation' : 'authorization';
  const file = new File(Paths.cache, `opencaster-${prefix}-${request.requestId}.json`);
  try {
    file.create({ intermediates: true, overwrite: true });
    file.write(JSON.stringify(request, null, 2));
    await Sharing.shareAsync(file.uri, {
      dialogTitle: 'Share public authorization request',
      mimeType: 'application/json',
    });
  } catch {
    throw new Error('The public authorization request could not be shared.');
  } finally {
    removeCacheFile(file, file.uri);
  }
}

export async function importAuthorizationApproval(): Promise<string | null> {
  let file: File | undefined;
  let uri: string | undefined;
  try {
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
      type: 'application/json',
    });
    if (result.canceled) return null;
    const asset = result.assets[0];
    if (!asset) fail('Choose a public authorization JSON file from the separate signer.');
    checkOptionalSize(asset.size);
    uri = asset.uri;
    if (!isInCache(uri)) fail('The selected authorization file could not be copied into app storage.');
    file = new File(uri);
    if (!file.exists) fail('The selected authorization file could not be read.');
    checkFileSize(file.info().size);
    const text = await file.text();
    if (new TextEncoder().encode(text).byteLength > MAX_TRANSFER_BYTES) {
      fail('Authorization files must be at most 16 KiB.');
    }
    return text;
  } catch (error) {
    if (error instanceof TransferError) throw error;
    throw new Error('The public authorization file could not be imported.');
  } finally {
    removeCacheFile(file, uri);
  }
}
