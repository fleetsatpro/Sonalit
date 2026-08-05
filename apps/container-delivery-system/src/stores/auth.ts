import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface CDSUser {
  id: string;
  name: string;
  email: string;
  role: string;
  initials: string;
  shift: string;
  timezone: string;
  permissions: string[];
}

interface AuthState {
  user: CDSUser | null;
  token: string | null;
  setAuth: (token: string, user: CDSUser) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      setAuth: (token, user) => set({ token, user }),
      clearAuth: () => set({ token: null, user: null }),
    }),
    { name: 'cds-auth' },
  ),
);
