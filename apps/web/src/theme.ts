import { useEffect, useState } from 'react';

export type ThemeChoice = 'system' | 'day' | 'night';
const KEY = 'ailab.theme';

function read(): ThemeChoice {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'day' || value === 'night' ? value : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice === 'day' ? 'light' : 'dark');
}

/** Day, night, or follow the system. Remembered per browser. */
export function useTheme(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>(read);
  useEffect(() => {
    applyTheme(choice);
    try {
      localStorage.setItem(KEY, choice);
    } catch {
      // Private windows may refuse storage; the theme still applies for this visit.
    }
  }, [choice]);
  return [choice, setChoice];
}

applyTheme(read());
