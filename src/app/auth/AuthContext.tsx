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
import { createToken, verifyToken } from './jwt';
import { findUserByEmailOrMobile } from './seedUsers';
import { hasModuleAccess, hasPermission, canAccessRoute } from './rbac';
import { refreshNotifications } from '../lib/notificationService';

// ─── Storage Keys ─────────────────────────────────────────────────────────────

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';

// ─── Reducer ─────────────────────────────────────────────────────────────────

type AuthAction =
  | { type: 'LOGIN_SUCCESS'; payload: { user: User; token: string } }
  | { type: 'LOGOUT' }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'RESTORE_SESSION'; payload: { user: User; token: string } };

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
    }
  }, [state.user]);

  // Restore session on mount
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
    const userJson = localStorage.getItem(USER_KEY) || sessionStorage.getItem(USER_KEY);

    if (token && userJson) {
      const payload = verifyToken(token);
      if (payload) {
        try {
          const user: User = JSON.parse(userJson);
          dispatch({ type: 'RESTORE_SESSION', payload: { user, token } });
          return;
        } catch {
          // fall through to logout
        }
      }
      // Token expired or invalid — clear storage
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(USER_KEY);
    }

    dispatch({ type: 'SET_LOADING', payload: false });
  }, []);

  // Login
  const login = useCallback(
    async (credentials: LoginCredentials): Promise<{ success: boolean; role?: Role; error?: string }> => {
      dispatch({ type: 'SET_LOADING', payload: true });

      // Simulate async authentication delay
      await new Promise((resolve) => setTimeout(resolve, 800));

      if (credentials.isParent) {
        try {
          const response = await fetch('http://localhost:4000/api/auth/parent-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mobile: credentials.email.trim() }),
          });
          if (response.ok) {
            const data = await response.json();
            if (data.success && data.user) {
              const user = data.user;
              const token = createToken(user, credentials.rememberMe);
              const storage = credentials.rememberMe ? localStorage : sessionStorage;

              storage.setItem(TOKEN_KEY, token);
              storage.setItem(USER_KEY, JSON.stringify(user));

              dispatch({ type: 'LOGIN_SUCCESS', payload: { user, token } });
              return { success: true, role: user.role };
            }
          } else {
            const data = await response.json().catch(() => ({}));
            dispatch({ type: 'SET_LOADING', payload: false });
            return { success: false, error: data.error || 'This mobile number is not registered with Guru Shishyaru Tutorials.' };
          }
        } catch (err) {
          console.error('Parent login API error:', err);
          dispatch({ type: 'SET_LOADING', payload: false });
          return { success: false, error: 'Connection to server failed. Please try again.' };
        }
      }

      const seedUser = findUserByEmailOrMobile(credentials.email);

      if (!seedUser) {
        dispatch({ type: 'SET_LOADING', payload: false });
        return { success: false, error: 'No account found with this email or mobile number.' };
      }

      if (credentials.password !== seedUser.password) {
        dispatch({ type: 'SET_LOADING', payload: false });
        return { success: false, error: 'Incorrect password. Please try again.' };
      }

      // Strip password from stored user
      const { password: _pw, ...user } = seedUser;

      const token = createToken(user, credentials.rememberMe);
      const storage = credentials.rememberMe ? localStorage : sessionStorage;

      storage.setItem(TOKEN_KEY, token);
      storage.setItem(USER_KEY, JSON.stringify(user));

      dispatch({ type: 'LOGIN_SUCCESS', payload: { user, token } });

      // Return role so callers can redirect without a second lookup
      return { success: true, role: user.role };
    },
    []
  );

  // Logout
  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    dispatch({ type: 'LOGOUT' });
  }, []);

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
    hasPermission: checkPermission,
    hasModuleAccess: checkModuleAccess,
    canAccess,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
