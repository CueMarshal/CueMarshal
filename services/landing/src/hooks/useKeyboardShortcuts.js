import { useEffect, useCallback } from 'react';

/**
 * Register global keyboard shortcuts.
 * @param {Object} handlers - { 'mod+k': fn, 'mod+/': fn, ... }
 */
export function useKeyboardShortcuts(handlers) {
  const handleKeyDown = useCallback((e) => {
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();

    let combo = '';
    if (mod) combo += 'mod+';
    if (e.shiftKey) combo += 'shift+';
    combo += key;

    const handler = handlers[combo];
    if (handler) {
      e.preventDefault();
      handler(e);
    }
  }, [handlers]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
