/**
 * api.js — Configured Axios instance.
 *
 * All HTTP calls in the app go through this instance so that:
 *  - The base URL is set once (not repeated in every service file)
 *  - Cookies are automatically sent with every request (withCredentials: true)
 *  - Every request declares which of the tab's two sessions it belongs to
 */

import axios from 'axios';
import { getTabSessionId } from '../utils/session';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000/api',
  withCredentials: true, // send the httpOnly cookie on every request
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor — tell the server which per-tab session this is.
// Each login owns its own httpOnly cookie (`qb_sess_<sid>`); only the opaque
// sid is stored in sessionStorage, never the JWT. Without a sid we send no
// hint at all: the server must answer 401 rather than guess another tab's
// cookie. Authorization always comes from the signed token's role.
api.interceptors.request.use((config) => {
  const sid = getTabSessionId();
  if (sid) config.headers.set('X-QB-Session', sid);
  return config;
});

// Response interceptor — automatically extract the `data` from axios responses
// so callers can do: const { user } = await authService.login(...)
// instead of: const { data: { user } } = await authService.login(...)
api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    // Normalize the error so callers always get a message string
    const message =
      error.response?.data?.message ||
      error.message ||
      'An unexpected error occurred.';
    return Promise.reject(new Error(message));
  }
);

export default api;
