import { create } from 'zustand';
import { persist } from 'zustand/middleware';
// Access token lives in module scope only — never persisted to localStorage (T1.2)
let _accessToken = null;
export function getAccessToken() {
    return _accessToken;
}
export function setAccessToken(token) {
    _accessToken = token;
}
export const useAuthStore = create()(persist((set) => ({
    user: null,
    setAuth: (token, user) => {
        _accessToken = token;
        set({ user });
    },
    clearAuth: () => {
        _accessToken = null;
        set({ user: null });
    },
}), 
// Only persist user profile — never the token (T1.2)
{ name: 'sonalit-auth', partialize: (s) => ({ user: s.user }) }));
