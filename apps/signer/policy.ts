import { PHRASE_MAX_LENGTH } from './approve';

/** Narrow IPC schemas keep this boundary auditable. Never return rejected input. */
export function validateApproveInput(value: unknown): { phrase: string; requestId: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid approval input.');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !== 'phrase,requestId'
      || typeof record.phrase !== 'string' || record.phrase.length > PHRASE_MAX_LENGTH
      || typeof record.requestId !== 'string' || !/^[a-f0-9]{64}$/.test(record.requestId)) {
    throw new Error('Invalid approval input.');
  }
  return { phrase: record.phrase, requestId: record.requestId };
}

/** Only exact bundled resources are allowed. Arbitrary local files are blocked. */
export function isAllowedResource(url: string, allowedResources: ReadonlySet<string>): boolean {
  return allowedResources.has(url);
}
