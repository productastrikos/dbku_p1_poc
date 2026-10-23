import React, { createContext, useContext, useState } from 'react';

const KEY = 'astrikos-theme';
const ThemeContext = createContext({ theme: 'dark', toggleTheme: () => {} });

// Sets data-theme on <body>; the token blocks in theme.css switch on it.
export function applyTheme(mode /* 'dark' | 'light' */) {
  document.body.setAttribute('data-theme', mode);
  try { localStorage.setItem(KEY, mode); } catch (e) { /* storage unavailable */ }
}

// Called once before the first render (src/index.js). Dark is the default.
export function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) { /* storage unavailable */ }
  const prefersLight = window.matchMedia?.('(prefers-color-scheme: light)').matches;
  const mode = saved === 'light' || saved === 'dark' ? saved : prefersLight ? 'light' : 'dark';
  applyTheme(mode);
  return mode;
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => document.body.getAttribute('data-theme') || initTheme());

  // The attribute changes before the re-render, so charts read the new colours.
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    setTheme(next);
  };

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
