import { useState, type ReactNode } from 'react';
import { Lock, Eye, EyeOff, ShieldAlert } from 'lucide-react';
import { useAuth } from './AuthContext';
import { apiFetch } from '../lib/apiClient';
import { BrandLogo } from '../components/BrandLogo';

// Blocks access to the rest of the app until a user flagged with
// mustChangePassword (set on every new account — the initial password is
// just their mobile number) has set a real password of their own choosing.
export function ChangePasswordGate({ children }: { children: ReactNode }) {
  const { user, logout, updateUser } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  if (!user?.mustChangePassword) {
    return <>{children}</>;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }
    setIsSaving(true);
    try {
      const res = await apiFetch('/api/account/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Failed to change password.');
        setIsSaving(false);
        return;
      }
      updateUser({ mustChangePassword: false });
    } catch (err) {
      setError('Connection to server failed. Please try again.');
      setIsSaving(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <BrandLogo height={56} showName layout="column" />
        </div>
        <div className="rounded-2xl border border-border bg-card p-8 shadow-xl">
          <div className="mb-5 flex items-start gap-3 rounded-xl border border-amber-300/40 bg-amber-50 px-4 py-3 dark:border-amber-900 dark:bg-amber-950/30">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <p className="text-sm font-semibold text-foreground">Set a new password</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Your account was created with a temporary password. For security, please choose your own before continuing.
              </p>
            </div>
          </div>

          {error && (
            <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/8 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-foreground">Current (temporary) password</label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type={showPwd ? 'text' : 'password'}
                  required
                  autoFocus
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full rounded-xl border border-input bg-input-background py-3 pl-10 pr-12 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-foreground">New password</label>
              <input
                type={showPwd ? 'text' : 'password'}
                required
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 8 characters"
                className="w-full rounded-xl border border-input bg-input-background px-4 py-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-foreground">Confirm new password</label>
              <input
                type={showPwd ? 'text' : 'password'}
                required
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full rounded-xl border border-input bg-input-background px-4 py-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <button
              type="submit"
              disabled={isSaving}
              className="w-full rounded-xl bg-primary py-3.5 text-sm font-bold text-primary-foreground transition-all hover:opacity-90 disabled:opacity-50"
            >
              {isSaving ? 'Saving…' : 'Set Password & Continue'}
            </button>
            <button
              type="button"
              onClick={logout}
              className="w-full text-center text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Sign out instead
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
