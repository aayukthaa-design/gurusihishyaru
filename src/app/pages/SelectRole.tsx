import { useNavigate } from 'react-router';
import { Shield, ChevronRight } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { getRoleLabel, defaultRouteForRole } from '../auth/rbac';
import { BrandLogo } from '../components/BrandLogo';

// ─── Select Role ──────────────────────────────────────────────────────────────
// Landing page for accounts holding more than one role (e.g. Super Admin +
// Teacher). Picking a role here only sets which dashboard/sidebar is shown —
// server-side authorization always checks the account's full set of roles.

export function SelectRole() {
  const navigate = useNavigate();
  const { user, switchRole } = useAuth();

  if (!user) return null;

  const choose = (role: (typeof user.roles)[number]) => {
    switchRole(role);
    navigate(defaultRouteForRole(role), { replace: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandLogo height={64} showName={false} />
          <h1 className="mt-6 text-2xl font-bold text-foreground">Choose how you'd like to sign in</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {user.name}, your account holds more than one role. Pick one to continue — you can switch anytime from the top bar.
          </p>
        </div>

        <div className="space-y-3">
          {user.roles.map((role) => (
            <button
              key={role}
              onClick={() => choose(role)}
              className="flex w-full items-center justify-between rounded-2xl border border-border bg-card px-5 py-4 text-left transition-all hover:border-primary hover:shadow-md active:scale-[0.99]"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Shield className="h-5 w-5" />
                </div>
                <span className="font-semibold text-foreground">{getRoleLabel(role)}</span>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
