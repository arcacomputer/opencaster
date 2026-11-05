import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import type { WalletSession } from './auth';
import { notifySessionChange, readSessionPersistence, subscribeSessionChanges, type SessionChangeKind } from './sessionPersistence';
import { errorMessage } from './errors';

export function useBrowserSession() {
  const [session, updateSession] = useState<WalletSession | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [restoreError, setRestoreError] = useState('');
  const active = useRef<WalletSession | null>(null);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(false);

  const setSession = useCallback((value: SetStateAction<WalletSession | null>) => {
    generation.current += 1;
    controller.current?.abort();
    const next = typeof value === 'function' ? value(active.current) : value;
    active.current = next;
    updateSession(next);
    setRestoring(false);
    setRestoreError('');
  }, []);

  const retryRestore = useCallback(async () => {
    const run = ++generation.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    active.current?.dispose();
    active.current = null;
    updateSession(null);
    setRestoreError('');
    setRestoring(true);
    const timeout = setTimeout(() => abort.abort(), 15_000);
    try {
      if (readSessionPersistence() === 'tab') return;
      const { restoreRememberedSession } = await import('./auth');
      const next = await restoreRememberedSession({ signal: abort.signal });
      if (!mounted.current || run !== generation.current || abort.signal.aborted) {
        next?.dispose();
        if (abort.signal.aborted && run === generation.current) throw new Error('Restoring your session timed out. Try again when the connection is available.');
        return;
      }
      active.current = next;
      updateSession(next);
    } catch (cause) {
      if (mounted.current && run === generation.current) setRestoreError(abort.signal.aborted
        ? 'Restoring your session timed out. Your saved device has not been removed.'
        : errorMessage(cause, 'Your saved session could not be restored.'));
    } finally {
      clearTimeout(timeout);
      if (mounted.current && run === generation.current) setRestoring(false);
    }
  }, []);

  const handleSessionChange = useCallback((kind: SessionChangeKind) => {
    if (kind === 'sign-out') {
      active.current?.dispose();
      setSession(null);
      return;
    }
    void retryRestore();
  }, [retryRestore, setSession]);

  useEffect(() => {
    mounted.current = true;
    void retryRestore();
    const unsubscribe = subscribeSessionChanges(handleSessionChange);
    return () => {
      mounted.current = false;
      generation.current += 1;
      controller.current?.abort();
      unsubscribe();
      active.current?.dispose();
      active.current = null;
    };
  }, [handleSessionChange, retryRestore]);

  const signOut = useCallback(async (expected: WalletSession) => {
    if (active.current?.publicKey !== expected.publicKey) return;
    expected.dispose();
    setSession(null);
    notifySessionChange('sign-out');
    try {
      const { deleteSavedSession } = await import('./auth');
      await deleteSavedSession(expected.publicKey, { notify: false });
    } catch {
      throw new Error('Your active session has ended, but the saved key could not be removed. Clear this site’s data before leaving this shared browser.');
    }
  }, [setSession]);

  return { session, setSession, restoring, restoreError, retryRestore, signOut };
}
