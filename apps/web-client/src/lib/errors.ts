export const ERROR_MESSAGE_LIMIT = 240;

export function errorMessage(error: unknown, fallback: string, maxLength = ERROR_MESSAGE_LIMIT): string {
  return error instanceof Error ? error.message.slice(0, maxLength) : fallback;
}
