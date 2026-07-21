import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useCallback,
  type ReactNode,
} from 'react';
import type {
  AuthContextType,
  AuthState,
  LoginCredentials,
  Module,
  Permission,
  Role,
  User,
} from './types';
import { isTokenExpired } from './jwt';
import { hasModuleAccess, hasPermission, canAccessRoute, getPrimaryRole } from './rbac';
import { refreshNotifications } from '../lib/notificationService';
import { refreshStudents } from '../lib/studentService';
import { apiFetch, setUnauthorizedHandler } from '../lib/apiClient';

// ─── Storage Keys ─────────────────────────────────────────────────────────────

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';

// ─── Reducer ─────────────────────────────────────────────────────────────────

type AuthAction =
  | { type: 'LOGIN_SUCCESS'; payload: { user: User; token: string } }
  | { type: 'LOGOUT' }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'RESTORE_SESSION'; payload: { user: User; token: string } }
  | { type: 'SWITCH_ROLE'; payload: { role: Role } }
  | { type: 'UPDATE_USER'; payload: { user: User } };

const initialState: AuthState = {
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: true,
};

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'LOGIN_SUCCESS':
    case 'RESTORE_SESSION':
      return {
        ...state,
        user: action.payload.user,
        token: action.payload.token,
        isAuthenticated: true,
        isLoading: false,
      };
    case 'LOGOUT':
      return {
        ...state,
        user: null,
        token: null,
        isAuthenticated: false,
        isLoading: false,
      };
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };
    case 'SWITCH_ROLE':
      return state.user ? { ...state, user: { ...state.user, role: action.payload.role } } : state;
    case 'UPDATE_USER':
      return { ...state, user: action.payload.user };
    default:
      return state;
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, initialState);

  useEffect(() => {
    if (state.user) {
      void refreshNotifications(state.user);
      // The module-level initial fetch in studentService runs before login (no
      // token yet) and silently no-ops, so the parent/homework/materials pages
      // that read the student cache synchronously would otherwise stay empty
      // for the entire session — re-fetch now that we have an authenticated user.
      void refreshStudents();
    }
  }, [state.user]);

  // Logout
  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    dispatch({ type: 'LOGOUT' });
  }, []);

  // Any authenticated API call that comes back 401 (expired/invalid/revoked
  // token) forces a logout — the server is the real authority, not the
  // locally-decoded exp check used only for the initial session restore.
  useEffect(() => {
    setUnauthorizedHandler(logout);
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  // Restore session on mount
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
    const userJson = localStorage.getItem(USER_KEY) || sessionStorage.getItem(USER_KEY);

    if (token && userJson && !isTokenExpired(token)) {
      try {
        const user: User = JSON.parse(userJson);
        dispatch({ type: 'RESTORE_SESSION', payload: { user, token } });
        return;
      } catch {
        // fall through to logout
      }
    }

    if (token || userJson) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(USER_KEY);
    }

    dispatch({ type: 'SET_LOADING', payload: false });
  }, []);

  // Parent login: direct login by registered mobile number, no OTP step.
  const loginParent = useCallback(
    async (mobile: string, rememberMe = false): Promise<{ success: boolean; error?: string }> => {
      dispatch({ type: 'SET_LOADING', payload: true });
      try {
        const response = await apiFetch('/api/auth/parent-login', {
          method: 'POST',
          skipAuth: true,
          body: { mobile: mobile.trim() },
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success || !data.user || !data.token) {
          dispatch({ type: 'SET_LOADING', payload: false });
          return { success: false, error: data.error || 'This mobile number is not registered with Guru Shishyaru Tutorials.' };
        }

        const user: User = { ...data.user, roles: ['parent'] };
        const token: string = data.token;
        const storage = rememberMe ? localStorage : sessionStorage;

        storage.setItem(TOKEN_KEY, token);
        storage.setItem(USER_KEY, JSON.stringify(user));

        dispatch({ type: 'LOGIN_SUCCESS', payload: { user, token } });
        return { success: true };
      } catch (err) {
        console.error('Parent login error:', err);
        dispatch({ type: 'SET_LOADING', payload: false });
        return { success: false, error: 'Connection to server failed. Please try again.' };
      }
    },
    []
  );

  // Login (staff/teacher/admin — password-based)
  const login = useCallback(
    async (credentials: LoginCredentials): Promise<{ success: boolean; role?: Role; roles?: Role[]; error?: string }> => {
      dispatch({ type: 'SET_LOADING', payload: true });

      try {
        const response = await apiFetch('/api/auth/login', {
          method: 'POST',
          skipAuth: true,
          body: {
            identifier: credentials.email.trim(),
            password: credentials.password,
            rememberMe: credentials.rememberMe,
          },
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          dispatch({ type: 'SET_LOADING', payload: false });
          return { success: false, error: data.error || 'Invalid credentials.' };
        }

        const data = await response.json();
        const roles: Role[] = data.user.roles;
        const user: User = { ...data.user, role: getPrimaryRole(roles) };
        const token: string = data.token;
        const storage = credentials.rememberMe ? localStorage : sessionStorage;

        storage.setItem(TOKEN_KEY, token);
        storage.setItem(USER_KEY, JSON.stringify(user));

        dispatch({ type: 'LOGIN_SUCCESS', payload: { user, token } });
        return { success: true, role: user.role, roles };
      } catch (err) {
        console.error('Login API error:', err);
        dispatch({ type: 'SET_LOADING', payload: false });
        return { success: false, error: 'Connection to server failed. Please try again.' };
      }
    },
    []
  );

  // Switch active role (multi-role users only) — UI/UX only, does not re-issue
  // the token; server-side authorization always checks the full `roles` array.
  const switchRole = useCallback(
    (role: Role) => {
      if (!state.user || !state.user.roles.includes(role)) return;
      const updatedUser: User = { ...state.user, role };
      const storage = localStorage.getItem(USER_KEY) ? localStorage : sessionStorage;
      storage.setItem(USER_KEY, JSON.stringify(updatedUser));
      dispatch({ type: 'SWITCH_ROLE', payload: { role } });
    },
    [state.user]
  );

  // Patches the cached user object (both in-memory and storage) — used after
  // actions like changing a temporary password, so a page refresh doesn't
  // re-read the stale flag from storage and re-trigger something like the
  // forced password-change gate.
  const updateUser = useCallback(
    (patch: Partial<User>) => {
      if (!state.user) return;
      const updatedUser: User = { ...state.user, ...patch };
      const storage = localStorage.getItem(USER_KEY) ? localStorage : sessionStorage;
      storage.setItem(USER_KEY, JSON.stringify(updatedUser));
      dispatch({ type: 'UPDATE_USER', payload: { user: updatedUser } });
    },
    [state.user]
  );

  // Permission check
  const checkPermission = useCallback(
    (module: Module, permission: Permission): boolean => {
      if (!state.user) return false;
      return hasPermission(state.user.role, module, permission);
    },
    [state.user]
  );

  // Module access check
  const checkModuleAccess = useCallback(
    (module: Module): boolean => {
      if (!state.user) return false;
      return hasModuleAccess(state.user.role, module);
    },
    [state.user]
  );

  // Route access check
  const canAccess = useCallback(
    (path: string): boolean => {
      if (!state.user) return false;
      return canAccessRoute(state.user.role, path);
    },
    [state.user]
  );

  const value: AuthContextType = {
    ...state,
    login,
    logout,
    switchRole,
    hasPermission: checkPermission,
    hasModuleAccess: checkModuleAccess,
    canAccess,
    loginParent,
    updateUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
