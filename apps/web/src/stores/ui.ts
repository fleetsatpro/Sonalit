import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getTheme, normalizeTheme, type SonalitTheme } from '../styles/themes.js';

export type Theme = SonalitTheme;
export type TypographyProfile = 'strong' | 'maximum';
const DEFAULT_TYPOGRAPHY: TypographyProfile = 'maximum';
export function normalizeTypographyProfile(value: unknown): TypographyProfile {
  return value === 'strong' || value === 'maximum' ? value : DEFAULT_TYPOGRAPHY;
}
function applyTypographyProfile(profile: TypographyProfile) {
  if (typeof document !== 'undefined') document.documentElement.setAttribute('data-typography', profile);
}
function readPersistedTypographyProfile(): TypographyProfile {
  if (typeof window === 'undefined') return DEFAULT_TYPOGRAPHY;
  try {
    const raw = window.localStorage.getItem('sonalit-ui');
    if (!raw) return DEFAULT_TYPOGRAPHY;
    const parsed = JSON.parse(raw) as { state?: { typographyProfile?: unknown } };
    return normalizeTypographyProfile(parsed?.state?.typographyProfile);
  } catch {
    return DEFAULT_TYPOGRAPHY;
  }
}
function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const definition = getTheme(theme);
  root.setAttribute('data-theme', definition.id);
  root.classList.toggle('dark', definition.mode === 'dark');
  root.style.colorScheme = definition.mode;
  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (themeColor) themeColor.content = definition.chrome;
}
function readPersistedTheme(): Theme {
  if (typeof window === 'undefined') return 'obsidian';
  try {
    const raw = window.localStorage.getItem('sonalit-ui');
    if (!raw) return 'obsidian';
    const parsed = JSON.parse(raw) as { state?: { theme?: unknown } };
    return normalizeTheme(parsed?.state?.theme);
  } catch {
    return 'obsidian';
  }
}
const initialTheme = readPersistedTheme();
const initialTypographyProfile = readPersistedTypographyProfile();
applyTheme(initialTheme);
applyTypographyProfile(initialTypographyProfile);

type UIState = {
  sidebarOpen: boolean;
  theme: Theme;
  typographyProfile: TypographyProfile;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setTheme: (theme: Theme) => void;
  setTypographyProfile: (profile: TypographyProfile) => void;
};
const defaultSidebarOpen = typeof window !== 'undefined'
  ? window.matchMedia('(min-width: 768px)').matches
  : false;
export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarOpen: defaultSidebarOpen,
      theme: initialTheme,
      typographyProfile: initialTypographyProfile,
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setTheme: (theme) => { applyTheme(theme); set({ theme }); },
      setTypographyProfile: (profile) => {
        const normalized = normalizeTypographyProfile(profile);
        applyTypographyProfile(normalized);
        set({ typographyProfile: normalized });
      },
    }),
    {
      name: 'sonalit-ui',
      partialize: (s) => ({ theme: s.theme, typographyProfile: s.typographyProfile }),
      version: 4,
      migrate: (persistedState) => {
        const prior = (persistedState ?? {}) as Partial<UIState>;
        return {
          ...prior,
          theme: normalizeTheme(prior.theme),
          typographyProfile: normalizeTypographyProfile(prior.typographyProfile),
        };
      },
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const theme = normalizeTheme(state.theme);
        const typographyProfile = normalizeTypographyProfile(state.typographyProfile);
        if (theme !== state.theme) state.setTheme(theme);
        else applyTheme(theme);
        if (typographyProfile !== state.typographyProfile) state.setTypographyProfile(typographyProfile);
        else applyTypographyProfile(typographyProfile);
      },
    },
  ),
);
