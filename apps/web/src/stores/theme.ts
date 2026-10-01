import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const THEME_OPTIONS = [
  {
    id: 'dark',
    name: 'Obsidian Command',
    description: 'Deep-space command console with cyan/violet instrumentation.',
    mode: 'dark',
    accent: '#22e8ff',
    preview: ['#050813', '#0b1120', '#22e8ff'],
  },
  {
    id: 'arctic',
    name: 'Arctic Signal',
    description: 'High-clarity daylight operations with cool analytical contrast.',
    mode: 'light',
    accent: '#087f8c',
    preview: ['#edf3f7', '#ffffff', '#087f8c'],
  },
  {
    id: 'graphite',
    name: 'Graphite Pro',
    description: 'Quiet executive control-room neutral with restrained signal color.',
    mode: 'dark',
    accent: '#d5dde0',
    preview: ['#101214', '#171a1d', '#d5dde0'],
  },
  {
    id: 'copper',
    name: 'Copper Dusk',
    description: 'Warm field-operations palette for lower-light environments.',
    mode: 'dark',
    accent: '#ff9b66',
    preview: ['#140e0b', '#201512', '#ff9b66'],
  },
  {
    id: 'signal',
    name: 'Signal Lime',
    description: 'High-visibility tactical palette with Sonalit lime instrumentation.',
    mode: 'dark',
    accent: '#d9ff69',
    preview: ['#090d08', '#111711', '#d9ff69'],
  },
  {
    id: 'daylight',
    name: 'Ivory Daylight',
    description: 'Warm neutral daylight surface for field and executive review.',
    mode: 'light',
    accent: '#bf5a20',
    preview: ['#f6f4ef', '#fffdfa', '#bf5a20'],
  },
] as const;

export type ThemeId = typeof THEME_OPTIONS[number]['id'];

const LEGACY_THEME_MAP: Record<string, ThemeId> = {
  light: 'arctic',
  dark: 'dark',
};

function applyTheme(theme: ThemeId) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.style.colorScheme =
    THEME_OPTIONS.find((option) => option.id === theme)?.mode === 'light' ? 'light' : 'dark';
}

function readInitialTheme(): ThemeId {
  if (typeof window === 'undefined') return 'dark';
  const raw = window.localStorage.getItem('sonalit-theme');
  if (!raw) return 'dark';
  try {
    const parsed = JSON.parse(raw) as { state?: { theme?: string } };
    const theme = parsed.state?.theme;
    if (theme && THEME_OPTIONS.some((option) => option.id === theme)) return theme as ThemeId;
    return theme ? LEGACY_THEME_MAP[theme] ?? 'dark' : 'dark';
  } catch {
    return 'dark';
  }
}

type ThemeState = {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
};

const initialTheme = readInitialTheme();
applyTheme(initialTheme);

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: initialTheme,
      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },
    }),
    {
      name: 'sonalit-theme',
      version: 1,
      partialize: (state) => ({ theme: state.theme }),
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.theme);
      },
      migrate: (persistedState) => {
        if (!persistedState || typeof persistedState !== 'object') return { theme: 'dark' as ThemeId };
        const state = persistedState as { theme?: string };
        const theme = state.theme;
        if (theme && THEME_OPTIONS.some((option) => option.id === theme)) {
          return { theme: theme as ThemeId };
        }
        return { theme: theme ? LEGACY_THEME_MAP[theme] ?? 'dark' : 'dark' };
      },
    },
  ),
);
