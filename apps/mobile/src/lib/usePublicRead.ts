import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { publicReadError, type PublicReadState } from './publicReads';

export function usePublicRead<T>(key: string, read: ((signal: AbortSignal) => Promise<T>) | null) {
  const [attempt, setAttempt] = useState(0);
  const [stored, setStored] = useState<{ key: string; attempt: number; state: PublicReadState<T> }>({
    key,
    attempt,
    state: { phase: 'idle' },
  });

  useFocusEffect(useCallback(() => {
    if (!read) {
      setStored({ key, attempt, state: { phase: 'idle' } });
      return undefined;
    }

    const controller = new AbortController();
    let active = true;
    setStored({ key, attempt, state: { phase: 'loading' } });
    void read(controller.signal).then(
      value => {
        if (active && !controller.signal.aborted) setStored({ key, attempt, state: { phase: 'ready', value } });
      },
      error => {
        if (active && !controller.signal.aborted) setStored({ key, attempt, state: { phase: 'error', error: publicReadError(error) } });
      },
    );

    return () => {
      active = false;
      controller.abort();
    };
  }, [attempt, key, read]));

  const retry = useCallback(() => setAttempt(value => value + 1), []);
  const state = stored.key === key && stored.attempt === attempt
    ? stored.state
    : read ? { phase: 'loading' as const } : { phase: 'idle' as const };
  return { ...state, retry };
}
