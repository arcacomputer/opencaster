import type { SignerRequest } from '@opencaster/client-core/pairing';

export interface PairingDisplay {
  request: SignerRequest;
  requestHash: string;
}

export type NativeResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface ArcaSignerBridge {
  importRequest(): Promise<NativeResult<PairingDisplay | null>>;
  approve(input: { phrase: string; requestId: string }): Promise<NativeResult<true>>;
  exportApproval(): Promise<NativeResult<boolean>>;
  clear(): Promise<void>;
  quit(): Promise<void>;
}

declare global {
  interface Window { arcaSigner: ArcaSignerBridge }
}
