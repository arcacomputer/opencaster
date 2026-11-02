import { createContext, type ReactNode, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { LocalContent, type LocalContentSnapshot } from './localContent';
import { createLocalContentStorage } from './localContentStorage';

interface LocalContentContextValue {
  localContent: LocalContent;
  snapshot: LocalContentSnapshot;
}

const LocalContentContext = createContext<LocalContentContextValue | null>(null);

export function LocalContentProvider({ children }: { children: ReactNode }) {
  const [localContent] = useState(() => new LocalContent(createLocalContentStorage()));
  const snapshot = useSyncExternalStore(localContent.subscribe, localContent.getSnapshot, localContent.getSnapshot);
  useEffect(() => { void localContent.load(); }, [localContent]);
  const value = useMemo(() => ({ localContent, snapshot }), [localContent, snapshot]);
  return <LocalContentContext.Provider value={value}>{children}</LocalContentContext.Provider>;
}

export function useLocalContent(): LocalContentContextValue {
  const value = useContext(LocalContentContext);
  if (!value) throw new Error('LocalContentProvider is required.');
  return value;
}
