import { File, Paths } from 'expo-file-system';
import { MAX_LOCAL_CONTENT_BYTES, type LocalContentStorage } from './localContent';

export function createLocalContentStorage(): LocalContentStorage {
  const file = new File(Paths.document, 'opencaster-hidden-content.v1.json');
  return {
    async read() {
      if (!file.exists) return null;
      const size = file.info().size;
      if (!Number.isSafeInteger(size) || size === undefined || size < 1 || size > MAX_LOCAL_CONTENT_BYTES) {
        throw new Error('Invalid saved filter size.');
      }
      return file.text();
    },
    async write(value) {
      if (new TextEncoder().encode(value).byteLength > MAX_LOCAL_CONTENT_BYTES) throw new Error('Saved filters are too large.');
      if (!file.exists) file.create();
      file.write(value);
    },
  };
}
