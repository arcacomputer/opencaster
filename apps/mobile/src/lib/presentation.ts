export function postTime(timestamp: string, now = Date.now()): string | null {
  const date = new Date(timestamp);
  const elapsed = now - date.getTime();
  if (!Number.isFinite(elapsed)) return null;
  if (elapsed < 0) return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (elapsed < 60_000) return 'now';
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h`;
  if (elapsed < 604_800_000) return `${Math.floor(elapsed / 86_400_000)}d`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(date.getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' as const } : {}) });
}

export function socialCount(value: number): string {
  return Number.isFinite(value) && value > 0
    ? new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
    : '';
}
