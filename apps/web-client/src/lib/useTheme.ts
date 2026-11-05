import { useEffect, useState } from 'react';
import { THEME_STORAGE_KEY } from './storageKeys';

/** Dark/light theme preference, applied to the document and saved on this browser. */
export function useTheme() {
  const [dark, setDark] = useState(() => { try { return localStorage.getItem(THEME_STORAGE_KEY) !== 'light'; } catch { return true; } });
  useEffect(() => { document.documentElement.classList.toggle('dark', dark); try { localStorage.setItem(THEME_STORAGE_KEY, dark ? 'dark' : 'light'); } catch { /* Theme still works for this tab. */ } }, [dark]);
  return [dark, setDark] as const;
}
