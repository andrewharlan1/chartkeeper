import { useEffect, useState } from 'react';

export function useDarkMode() {
  const [dark, setDark] = useState<boolean>(() => {
    return localStorage.getItem('theme') === 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    localStorage.setItem('theme', dark ? 'dark' : 'light');

    // Scorva tweaks: editorial voice always; midnight palette on dark
    document.body.dataset.voice = 'editorial';
    if (dark) document.body.dataset.pal = 'midnight';
    else delete document.body.dataset.pal;
  }, [dark]);

  // Apply on mount without waiting for a state change
  useEffect(() => {
    const isDark = localStorage.getItem('theme') === 'dark';
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    document.body.dataset.voice = 'editorial';
    if (isDark) document.body.dataset.pal = 'midnight';
    else delete document.body.dataset.pal;
  }, []);

  return [dark, setDark] as const;
}
