export const PAIRING_SCOPES = [1, 3, 4] as const;
/** Requested only through an explicit "Enable social features" approval. */
export const FULL_SOCIAL_SCOPES = [1, 3, 4, 5, 6, 11] as const;
/** Cast removal is added only after a separate, explicit wallet approval. */
export const FULL_CLIENT_SCOPES = [1, 2, 3, 4, 5, 6, 11] as const;
