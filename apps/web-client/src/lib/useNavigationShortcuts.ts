import { useEffect, useRef } from 'react';

export function useNavigationShortcuts({ onSearch, onHelp }: { onSearch(): void; onHelp(): void }) {
  const actions = useRef({ onSearch, onHelp });
  actions.current = { onSearch, onHelp };
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat || event.isComposing || event.altKey || document.querySelector('dialog[open]')) return;
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"]')) return;
      const commandSearch = (event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'k';
      const plain = !event.metaKey && !event.ctrlKey;
      if (commandSearch || (plain && event.key === '/')) { event.preventDefault(); actions.current.onSearch(); }
      else if (plain && event.key === '?') { event.preventDefault(); actions.current.onHelp(); }
    }
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, []);
}
