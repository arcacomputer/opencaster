import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { CastPageController, type CastPageReader } from './publicReads';

export function usePagedCasts(key: string, readPage: CastPageReader) {
  const controller = useMemo(() => new CastPageController(readPage), [key, readPage]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);

  useFocusEffect(useCallback(() => {
    void controller.refresh();
    return () => controller.cancel();
  }, [controller]));

  return { ...state, refresh: () => controller.refresh(), loadMore: () => controller.loadMore(), retry: () => controller.retry() };
}
