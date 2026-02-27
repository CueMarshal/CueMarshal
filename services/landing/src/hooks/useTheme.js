import { useState, useEffect, useCallback } from 'react';
import { storage } from '../services/storage';

function getSystemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(resolvedTheme) {
  const root = document.documentElement;
  if (resolvedTheme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

export function useTheme() {
  const [preference, setPreference] = useState('system');
  const [resolvedTheme, setResolvedTheme] = useState('light');

  const resolve = useCallback((pref) => {
    return pref === 'system' ? getSystemTheme() : pref;
  }, []);

  useEffect(() => {
    storage.getTheme().then((saved) => {
      const pref = saved || 'system';
      setPreference(pref);
      const resolved = resolve(pref);
      setResolvedTheme(resolved);
      applyTheme(resolved);
    });
  }, [resolve]);

  useEffect(() => {
    if (preference !== 'system') return;

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      const resolved = getSystemTheme();
      setResolvedTheme(resolved);
      applyTheme(resolved);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [preference]);

  const setTheme = useCallback(async (newPref) => {
    setPreference(newPref);
    const resolved = resolve(newPref);
    setResolvedTheme(resolved);
    applyTheme(resolved);
    await storage.saveTheme(newPref);
  }, [resolve]);

  const toggleTheme = useCallback(() => {
    const next = resolvedTheme === 'dark' ? 'light' : 'dark';
    setTheme(next);
  }, [resolvedTheme, setTheme]);

  return { theme: resolvedTheme, preference, setTheme, toggleTheme };
}
