import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  org_id: string;
};

type AuthState = {
  user: AuthUser | null;
  setAuth: (token: string, user: AuthUser) => void;
  clearAuth: () => void;
};

// Access token lives in module scope only — never persisted to localStorage (T1.2)
let _accessToken: string | null = null;

export function getAccessToken(): string | null {
  return _accessToken;
}

export function setAccessToken(token: string | null): void {
  _accessToken = token;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      setAuth: (token: string, user: AuthUser) => {
        _accessToken = token;
        set({ user });
      },
      clearAuth: () => {
        _accessToken = null;
        set({ user: null });
      },
    }),
    // Only persist user profile — never the token (T1.2)
    { name: 'sonalit-auth', partialize: (s) => ({ user: s.user }) },
  ),
);
