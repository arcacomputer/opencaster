export const MAX_HIDDEN_ITEMS = 500;
export const MAX_LOCAL_CONTENT_BYTES = 32_768;

export interface HiddenContent {
  readonly version: 1;
  readonly users: readonly number[];
  readonly casts: readonly string[];
}

export interface LocalContentStorage {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
}

export interface LocalContentSnapshot {
  readonly phase: 'loading' | 'ready' | 'error';
  readonly busy: boolean;
  readonly data: HiddenContent;
  readonly error?: string;
}

function fid(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 0xffffffff) {
    throw new Error('Choose a valid public FID.');
  }
  return value;
}

function hash(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:0x)?[0-9a-f]{40}$/i.test(value)) {
    throw new Error('Choose a valid public cast.');
  }
  return value.replace(/^0x/i, '').toLowerCase();
}

function content(users: readonly number[], casts: readonly string[]): HiddenContent {
  if (users.length + casts.length > MAX_HIDDEN_ITEMS) {
    throw new Error(`At most ${MAX_HIDDEN_ITEMS} hidden users and posts can be saved. Restore some items first.`);
  }
  return Object.freeze({ version: 1, users: Object.freeze([...new Set(users)]), casts: Object.freeze([...new Set(casts)]) });
}

export function decodeHiddenContent(value: string | null): HiddenContent {
  if (value === null) return content([], []);
  if (new TextEncoder().encode(value).byteLength > MAX_LOCAL_CONTENT_BYTES) throw new Error('Saved filters are too large.');
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Object.keys(parsed).sort().join(',') !== 'casts,users,version') throw new Error('Invalid saved filters.');
  const record = parsed as Record<string, unknown>;
  if (record.version !== 1 || !Array.isArray(record.users) || !Array.isArray(record.casts)
    || record.users.length + record.casts.length > MAX_HIDDEN_ITEMS) throw new Error('Invalid saved filters.');
  return content(record.users.map(fid), record.casts.map(hash));
}

export function isHiddenTarget(data: HiddenContent, target: { fid: number; hash: string }): boolean {
  return data.users.includes(target.fid) || data.casts.includes(target.hash.replace(/^0x/i, '').toLowerCase());
}

export class LocalContent {
  private snapshot: LocalContentSnapshot = { phase: 'loading', busy: false, data: content([], []) };
  private listeners = new Set<() => void>();

  constructor(private readonly storage: LocalContentStorage) {}

  getSnapshot = (): LocalContentSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(snapshot: LocalContentSnapshot): void {
    this.snapshot = snapshot;
    this.listeners.forEach(listener => listener());
  }

  async load(): Promise<void> {
    if (this.snapshot.busy) return;
    this.publish({ ...this.snapshot, phase: 'loading', busy: true, error: undefined });
    try {
      const data = decodeHiddenContent(await this.storage.read());
      this.publish({ phase: 'ready', busy: false, data });
    } catch {
      this.publish({ ...this.snapshot, phase: 'error', busy: false, error: 'Saved content filters could not be read. Public content stays hidden until you retry or explicitly reset the filters.' });
    }
  }

  private async change(update: (current: HiddenContent) => HiddenContent, reset = false): Promise<boolean> {
    const current = this.snapshot;
    if (current.busy || (!reset && current.phase !== 'ready')) return false;

    let data: HiddenContent;
    let serialized: string;
    try {
      const encoded = JSON.stringify(update(current.data));
      if (encoded === undefined) throw new Error('Content filters could not be updated.');
      serialized = encoded;
      data = decodeHiddenContent(serialized);
    } catch (error) {
      this.publish({
        ...current,
        busy: false,
        error: error instanceof Error ? error.message : 'Content filters could not be updated.',
      });
      return false;
    }

    this.publish({ ...current, busy: true, error: undefined });
    try {
      await this.storage.write(serialized);
      this.publish({ phase: 'ready', busy: false, data });
      return true;
    } catch {
      this.publish({ ...this.snapshot, phase: 'error', busy: false,
        error: 'Content filters could not be saved. No success was recorded. Retry reading the saved filters or explicitly reset them.' });
      return false;
    }
  }

  hideUser(value: number): Promise<boolean> {
    return this.change(current => content([...new Set([...current.users, fid(value)])], current.casts));
  }

  hideCast(value: string): Promise<boolean> {
    return this.change(current => content(current.users, [...new Set([...current.casts, hash(value)])]));
  }

  restoreUser(value: number): Promise<boolean> {
    return this.change(current => content(current.users.filter(item => item !== value), current.casts));
  }

  restoreCast(value: string): Promise<boolean> {
    return this.change(current => content(current.users, current.casts.filter(item => item !== hash(value))));
  }

  reset(): Promise<boolean> {
    return this.change(() => content([], []), true);
  }
}
