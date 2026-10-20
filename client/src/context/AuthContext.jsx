/**
 * AuthContext.jsx — Global authentication state.
 *
 * Provides:
 *  - user: the logged-in user object (or null)
 *  - isLoading: true while checking if the user is already logged in
 *  - login(email, password): logs in and sets user
 *  - register(name, email, password): registers and sets user
 *  - logout(): logs out and clears user
 *
 * On app start, calls /api/auth/me to restore session from the httpOnly cookie.
 * If the cookie has expired, user is set to null and the app shows login.
 */

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import * as authService from '../services/authService';
import {
  sessionForRole,
  setTabSession,
  setTabSessionId,
  clearTabSessionId,
  clearTabSession,
} from '../utils/session';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true); // true on first load

  // Restore session from cookie on app start
  useEffect(() => {
    const restoreSession = async () => {
      try {
        const data = await authService.getMe();
        // Keep this tab's opaque session id in sync; the JWT stays in the
        // httpOnly cookie.
        if (data.session?.id) setTabSessionId(data.session.id);
        setUser(data.user);
      } catch {
        // Not logged in — that's fine
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    };
    restoreSession();
  }, []);

  const login = useCallback(async (email, password) => {
    const data = await authService.login(email, password);
    // Each login gets its own cookie and opaque id. This tab records only the
    // id, so logging in elsewhere cannot change who this tab is.
    if (data.session?.id) setTabSessionId(data.session.id);
    setTabSession(sessionForRole(data.user.role));
    setUser(data.user);
    return data;
  }, []);

  const register = useCallback(async (name, email, password) => {
    const data = await authService.register(name, email, password);
    // Self-registration is always a customer account
    if (data.session?.id) setTabSessionId(data.session.id);
    setTabSession('customer');
    setUser(data.user);
    return data;
  }, []);

  const logout = useCallback(async () => {
    try {
      // The request carries this tab's session id, so the server clears only
      // this tab's cookie — other tabs, even other employees, stay signed in.
      await authService.logout();
    } finally {
      clearTabSessionId();
      clearTabSession();
      setUser(null);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

/**
 * useAuth — convenience hook.
 * Usage: const { user, login, logout } = useAuth();
 */
export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
};
