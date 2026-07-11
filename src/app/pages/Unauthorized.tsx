import { useNavigate } from 'react-router';
import { ShieldOff, ArrowLeft, Home } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { getDefaultRoute } from '../auth/rbac';
import { BrandLogo } from '../components/BrandLogo';

export function Unauthorized() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const homeRoute = user ? getDefaultRoute(user.role) : '/login';

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">

      {/* Logo */}
      <div className="mb-8">
        <BrandLogo height={52} showName layout="column" />
      </div>

      <div className="text-center">
        <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-3xl bg-destructive/10">
          <ShieldOff className="h-12 w-12 text-destructive" />
        </div>

        <h1 className="text-5xl font-bold text-foreground">403</h1>
        <h2 className="mt-2 text-2xl font-semibold text-foreground">Access Denied</h2>
        <p className="mt-3 max-w-sm text-muted-foreground">
          You don't have permission to view this page. Contact your administrator
          if you believe this is a mistake.
        </p>

        {user && (
          <div className="mt-4 inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm text-muted-foreground">
            Logged in as <span className="font-semibold text-foreground">{user.name}</span>
          </div>
        )}

        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 rounded-xl border border-border bg-card px-5 py-2.5 text-sm font-medium transition-colors hover:bg-secondary"
          >
            <ArrowLeft className="h-4 w-4" />
            Go Back
          </button>
          <button
            onClick={() => navigate(homeRoute)}
            className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-all hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, #15803D, #22C55E)' }}
          >
            <Home className="h-4 w-4" />
            Go to Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
