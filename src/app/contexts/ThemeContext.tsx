import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

type Theme = 'light' | 'dark';

export interface AccentColor {
  name: string;
  value: string;        // hex e.g. "#15803D"
  darkValue: string;    // slightly brighter variant for dark mode
}

// ─── Storage keys ─────────────────────────────────────────────────────────────

const STORAGE_THEME       = 'gst_theme';       // 'light' | 'dark'
const STORAGE_ACCENT      = 'gst_accent';      // hex string
const STORAGE_FONT_SIZE   = 'gst_font_size';   // number (px)

// ─── Default accent colours ───────────────────────────────────────────────────

export const ACCENT_PRESETS: AccentColor[] = [
  { name: 'Forest Green (Brand)', value: '#15803D', darkValue: '#22C55E' },
  { name: 'Leaf Green',           value: '#22C55E', darkValue: '#4ADE80' },
  { name: 'Earth Brown',          value: '#B45309', darkValue: '#D97706' },
  { name: 'Sky Blue',             value: '#0369A1', darkValue: '#38BDF8' },
  { name: 'Violet',               value: '#7C3AED', darkValue: '#A78BFA' },
  { name: 'Teal',                 value: '#0F766E', darkValue: '#2DD4BF' },
];

const DEFAULT_ACCENT    = ACCENT_PRESETS[0].value;   // Forest Green
const DEFAULT_FONT_SIZE = 16;
const MIN_FONT_SIZE     = 13;
const MAX_FONT_SIZE     = 20;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Apply an accent hex colour by writing to CSS custom properties on <html>.
 * Works for both light and dark because we always set both --primary and
 * the sidebar-primary token so the whole UI picks it up immediately.
 */
function applyAccent(hex: string, isDark: boolean): void {
  const root = document.documentElement;
  // Find preset to get the right dark variant
  const preset = ACCENT_PRESETS.find((p) => p.value === hex);
  const active  = isDark && preset ? preset.darkValue : hex;

  root.style.setProperty('--primary',              active);
  root.style.setProperty('--ring',                 active);
  root.style.setProperty('--sidebar-primary',      active);
  root.style.setProperty('--sidebar-ring',         active);
  // Keep foreground colours readable
  root.style.setProperty('--primary-foreground',          '#ffffff');
  root.style.setProperty('--sidebar-primary-foreground',  isDark ? '#052E16' : '#ffffff');
}

function applyFontSize(px: number): void {
  document.documentElement.style.setProperty('--font-size', `${px}px`);
}

function clampFontSize(value: number): number {
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, value));
}

// ─── Context type ─────────────────────────────────────────────────────────────

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  // Accent
  accentColor: string;
  setAccentColor: (hex: string) => void;
  // Font size
  fontSize: number;
  setFontSize: (px: number) => void;
}

// ─── Context + Provider ───────────────────────────────────────────────────────

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {

  // ── Light / dark ──────────────────────────────────────────────────────────
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem(STORAGE_THEME) as Theme | null;
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem(STORAGE_THEME, theme);
    // Re-apply accent so the dark variant is used when switching modes
    applyAccent(accentColor, theme === 'dark');
  }, [theme]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Accent colour ─────────────────────────────────────────────────────────
  const [accentColor, setAccentState] = useState<string>(() => {
    return localStorage.getItem(STORAGE_ACCENT) ?? DEFAULT_ACCENT;
  });

  // Apply on first paint (before React paints, so no flash)
  useEffect(() => {
    applyAccent(accentColor, theme === 'dark');
  }, [accentColor, theme]);

  // ── Font size ─────────────────────────────────────────────────────────────
  const [fontSize, setFontSizeState] = useState<number>(() => {
    const saved = Number(localStorage.getItem(STORAGE_FONT_SIZE));
    return clampFontSize(isNaN(saved) ? DEFAULT_FONT_SIZE : saved);
  });

  useEffect(() => {
    applyFontSize(fontSize);
    localStorage.setItem(STORAGE_FONT_SIZE, String(fontSize));
  }, [fontSize]);

  // ── Public setters ────────────────────────────────────────────────────────

  const toggleTheme = () =>
    setThemeState((prev) => (prev === 'light' ? 'dark' : 'light'));

  const setTheme = (t: Theme) => setThemeState(t);

  const setAccentColor = (hex: string) => {
    setAccentState(hex);
    localStorage.setItem(STORAGE_ACCENT, hex);
  };

  const setFontSize = (px: number) => {
    const clamped = clampFontSize(px);
    setFontSizeState(clamped);
  };

  return (
    <ThemeContext.Provider
      value={{ theme, toggleTheme, setTheme, accentColor, setAccentColor, fontSize, setFontSize }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useTheme(): ThemeContextType {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within <ThemeProvider>');
  return ctx;
}
