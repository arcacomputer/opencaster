import { FARCASTER_EPOCH_SECONDS } from '@opencaster/protocol/farcasterEpoch';

export { FARCASTER_EPOCH_SECONDS };

/** Convert Farcaster epoch seconds (e.g. a request deadline) to Unix seconds. */
export function farcasterToUnixSeconds(farcasterSeconds: number): number {
  return farcasterSeconds + FARCASTER_EPOCH_SECONDS;
}
