import { Navigate, useLocation } from 'react-router';
import { useEffect } from 'react';
import { useAuth } from './AuthContext';
import { getDefaultRoute } from './rbac';
import type { Module } from './types';

// ─── Protected Route ──────────────────────────────────────────────────────────

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredModule?: Module;
}

export function ProtectedRoute({ children, requiredModule }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, hasModuleAccess, canAccess, user } = useAuth();
  const location = useLocation();

  useEffect(() => {
    if (!user || user.role === 'super_admin' || !isAuthenticated) {
      return;
    }

    const params = new URLSearchParams(location.search);
    const requestedBranchId = params.get('branchId');
    if (requestedBranchId && requestedBranchId !== user.branchId) {
      params.delete('branchId');
      const nextSearch = params.toString();
      const nextUrl = `${location.pathname}${nextSearch ? `?${nextSearch}` : ''}`;
      window.history.replaceState({}, '', nextUrl);
    }
  }, [isAuthenticated, location.pathname, location.search, user]);

  // Show nothing while restoring session
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading session…</p>
        </div>
      </div>
    );
  }

  // Not authenticated → redirect to login
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Check module-level access
  if (requiredModule && !hasModuleAccess(requiredModule)) {
    return <Navigate to="/unauthorized" replace />;
  }

  // Check route-level access only when a module requirement is specified
  // (The outer Layout wrapper doesn't specify a module, so skip route check there)
  if (requiredModule && !canAccess(location.pathname)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return <>{children}</>;
}

// ─── Guest-only Route (redirect to dashboard if already logged in) ─────────

interface GuestRouteProps {
  children: React.ReactNode;
}

export function GuestRoute({ children }: GuestRouteProps) {
  const { isAuthenticated, isLoading, user } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (isAuthenticated && user) {
    return <Navigate to={getDefaultRoute(user.roles)} replace />;
  }

  return <>{children}</>;
}
