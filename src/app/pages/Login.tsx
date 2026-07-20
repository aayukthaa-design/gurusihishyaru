import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router';
import {
  Mail, Lock, Eye, EyeOff, CheckCircle2,
  AlertCircle, ChevronRight, Users, ClipboardCheck,
  CreditCard, TrendingUp, MessageCircle, Phone,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { ThemeToggle } from '../components/ThemeToggle';
import { BrandLogo } from '../components/BrandLogo';
import { getDefaultRoute } from '../auth/rbac';
import { apiFetch } from '../lib/apiClient';

// ─── Left panel features ──────────────────────────────────────────────────────
const FEATURES = [
  { icon: Users,          text: 'Student Management' },
  { icon: ClipboardCheck, text: 'Attendance Tracking' },
  { icon: CreditCard,     text: 'Fee Management' },
  { icon: TrendingUp,     text: 'Progress Reports' },
  { icon: MessageCircle,  text: 'Parent Communication' },
];

// ─── Component ────────────────────────────────────────────────────────────────
export function Login() {
  const navigate  = useNavigate();
  const location  = useLocation();
  const { login, loginParent } = useAuth();

  const [mode,        setMode]       = useState<'staff' | 'parent'>('staff');
  const [email,       setEmail]      = useState('');
  const [mobile,      setMobile]     = useState('');
  const [password,    setPassword]   = useState('');
  const [showPwd,     setShowPwd]    = useState(false);
  const [rememberMe,  setRememberMe] = useState(false);
  const [isLoading,   setIsLoading]  = useState(false);
  const [error,       setError]      = useState('');
  const [showForgot,  setShowForgot] = useState(false);
  const [forgotStep,  setForgotStep] = useState<'identifier' | 'code'>('identifier');
  const [forgotIdentifier, setForgotIdentifier] = useState('');
  const [forgotCode,  setForgotCode] = useState('');
  const [forgotNewPassword, setForgotNewPassword] = useState('');
  const [forgotConfirmPassword, setForgotConfirmPassword] = useState('');
  const [forgotInfo,  setForgotInfo] = useState('');
  const [forgotError, setForgotError] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotDone,  setForgotDone] = useState(false);

  const resetForgotState = () => {
    setShowForgot(false);
    setForgotStep('identifier');
    setForgotIdentifier('');
    setForgotCode('');
    setForgotNewPassword('');
    setForgotConfirmPassword('');
    setForgotInfo('');
    setForgotError('');
    setForgotDone(false);
  };

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname;

  const handleParentLogin = async () => {
    setError('');
    const trimmedMobile = mobile.trim();
    if (!/^\d{10}$/.test(trimmedMobile)) {
      setError('Please enter a valid 10-digit registered mobile number.');
      return;
    }
    setIsLoading(true);
    const result = await loginParent(trimmedMobile, rememberMe);
    setIsLoading(false);
    if (result.success) {
      navigate(from || '/parent', { replace: true });
    } else {
      setError(result.error || 'This mobile number is not registered.');
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (mode === 'parent') {
      await handleParentLogin();
      return;
    }

    // Standard Staff Login
    setIsLoading(true);
    const result = await login({ email, password, rememberMe });
    setIsLoading(false);
    if (result.success && result.roles) {
      navigate(from || getDefaultRoute(result.roles), { replace: true });
    } else {
      setError(result.error ?? 'Login failed. Please try again.');
    }
  };

  const handleRequestResetCode = async () => {
    setForgotError('');
    if (!forgotIdentifier.trim()) {
      setForgotError('Enter your email or mobile number.');
      return;
    }
    setForgotLoading(true);
    try {
      const res = await apiFetch('/api/auth/forgot-password/request-otp', {
        method: 'POST',
        skipAuth: true,
        body: { identifier: forgotIdentifier.trim() },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setForgotStep('code');
        setForgotInfo(data.message || 'If an account exists, a reset code has been sent to its registered email.');
      } else {
        setForgotError(data.error || 'Failed to send reset code.');
      }
    } catch {
      setForgotError('Connection to server failed. Please try again.');
    } finally {
      setForgotLoading(false);
    }
  };

  const handleConfirmReset = async () => {
    setForgotError('');
    if (!/^\d{6}$/.test(forgotCode.trim())) {
      setForgotError('Enter the 6-digit code sent to your email.');
      return;
    }
    if (!forgotNewPassword || forgotNewPassword !== forgotConfirmPassword) {
      setForgotError('New password and confirmation must match.');
      return;
    }
    setForgotLoading(true);
    try {
      const res = await apiFetch('/api/auth/forgot-password/verify-otp', {
        method: 'POST',
        skipAuth: true,
        body: { identifier: forgotIdentifier.trim(), code: forgotCode.trim(), newPassword: forgotNewPassword },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setForgotDone(true);
      } else {
        setForgotError(data.error || 'Invalid or expired code.');
      }
    } catch {
      setForgotError('Connection to server failed. Please try again.');
    } finally {
      setForgotLoading(false);
    }
  };

  const handleForgotSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (forgotStep === 'identifier') {
      void handleRequestResetCode();
    } else {
      void handleConfirmReset();
    }
  };

  return (
    <div className="flex min-h-screen bg-background">

      {/* ═══════════════════════════════════════════
          LEFT PANEL — Brand showcase
          ═══════════════════════════════════════════ */}
      <div className="relative hidden w-1/2 overflow-hidden lg:flex lg:flex-col">

        {/* Green → Brown brand gradient */}
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(155deg, #14532D 0%, #166534 35%, #854D0E 80%, #92400E 100%)' }}
        />

        {/* Subtle dot-grid overlay */}
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: 'radial-gradient(circle, #86EFAC 1.5px, transparent 1.5px)',
            backgroundSize: '36px 36px',
          }}
        />

        {/* Soft radial glow */}
        <div
          className="absolute left-1/2 top-2/5 h-80 w-80 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-15"
          style={{ background: 'radial-gradient(circle, #4ADE80, transparent 70%)' }}
        />

        {/* Content */}
        <div className="relative z-10 flex h-full flex-col justify-between px-12 py-10">

          {/* Center — large logo + headline */}
          <div className="flex flex-col items-center text-center">
            <div
              className="mb-8 overflow-hidden rounded-3xl shadow-2xl"
              style={{
                background: 'rgba(255,255,255,0.12)',
                backdropFilter: 'blur(12px)',
                border: '1px solid rgba(255,255,255,0.2)',
                padding: '24px 32px',
              }}
            >
              <BrandLogo height={180} showName={false} />
            </div>

            <h2 className="text-3xl font-bold text-white leading-snug">
              Welcome to<br />Guru Shishyaru Tutorials
            </h2>
            <p className="mt-3 text-base text-white/75 font-medium">
              Empowering Learning Through<br />Tradition and Technology
            </p>
            <p className="mt-2 text-sm italic text-white/55">
              "Rooted in Knowledge, Growing Towards Excellence"
            </p>
          </div>

          {/* Bottom — features */}
          <div className="space-y-3">
            <p className="text-[11px] font-bold uppercase tracking-widest text-white/40 mb-1">
              Everything you need
            </p>
            {FEATURES.map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-3">
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                  style={{ background: 'rgba(255,255,255,0.15)' }}
                >
                  <Icon className="h-4 w-4 text-white" />
                </div>
                <span className="text-sm text-white/85">✓ {text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════
          RIGHT PANEL — Login form
          ═══════════════════════════════════════════ */}
      <div className="flex w-full flex-col lg:w-1/2">

        {/* Top bar */}
        <div className="flex items-center justify-between px-6 py-4">
          {/* Mobile logo */}
          <div className="lg:hidden">
            <BrandLogo height={36} showName layout="row" />
          </div>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </div>

        {/* Form area */}
        <div className="flex flex-1 items-center justify-center px-6 pb-8">
          <div className="w-full max-w-[420px]">

            {!showForgot ? (
              <>
                {/* Heading */}
                <div className="mb-7">
                  <h1 className="text-3xl font-bold text-foreground">
                    {mode === 'parent' ? 'Parent Login' : 'Sign In'}
                  </h1>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {mode === 'parent'
                      ? 'Enter your registered mobile number'
                      : 'Enter your credentials to access your dashboard'}
                  </p>
                </div>

                {/* Mode toggle */}
                <div className="mb-5 flex rounded-xl border border-border overflow-hidden">
                  {(['staff', 'parent'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => { setMode(m); setError(''); }}
                      className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${
                        mode === m ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-secondary'
                      }`}
                    >
                      {m === 'staff' ? 'Staff & Teacher Login' : 'Parent Login'}
                    </button>
                  ))}
                </div>

                {/* Card */}
                <div className="rounded-2xl border border-border bg-card/95 p-8 shadow-xl shadow-black/5 backdrop-blur-sm">

                  {error && (
                    <div className="mb-5 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/8 px-4 py-3">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                      <p className="text-sm text-destructive">{error}</p>
                    </div>
                  )}

                  <form onSubmit={handleLogin} className="space-y-5">

                    {mode === 'parent' ? (
                      /* 📱 Parent Login — direct by registered mobile number */
                      <div>
                        <label htmlFor="mobile" className="mb-1.5 block text-sm font-semibold text-foreground">
                          Mobile Number
                        </label>
                        <div className="relative">
                          <Phone className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                          <input
                            id="mobile"
                            type="tel"
                            required
                            value={mobile}
                            onChange={(e) => { setMobile(e.target.value); setError(''); }}
                            placeholder="Enter Registered Mobile Number"
                            className="w-full rounded-xl border border-input bg-input-background py-3.5 pl-10 pr-4 text-base transition-all placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                          />
                        </div>
                        <label className="mt-4 flex cursor-pointer items-center gap-2">
                          <input
                            type="checkbox"
                            checked={rememberMe}
                            onChange={(e) => setRememberMe(e.target.checked)}
                            className="h-4 w-4 rounded border-input accent-primary"
                          />
                          <span className="text-sm text-muted-foreground">Remember me</span>
                        </label>
                      </div>
                    ) : (
                      /* 👤 Staff & Teachers Login Input */
                      <>
                        <div>
                          <label htmlFor="email" className="mb-1.5 block text-sm font-semibold text-foreground">
                            Email or Mobile
                          </label>
                          <div className="relative">
                            <Mail className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <input
                              id="email"
                              type="text"
                              required
                              autoComplete="username"
                              value={email}
                              onChange={(e) => { setEmail(e.target.value); setError(''); }}
                              placeholder="you@tutorials.com or 9876500001"
                              className="w-full rounded-xl border border-input bg-input-background py-3 pl-10 pr-4 text-sm transition-all placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                            />
                          </div>
                        </div>

                        <div>
                          <label htmlFor="password" className="mb-1.5 block text-sm font-semibold text-foreground">
                            Password
                          </label>
                          <div className="relative">
                            <Lock className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <input
                              id="password"
                              type={showPwd ? 'text' : 'password'}
                              required
                              autoComplete="current-password"
                              value={password}
                              onChange={(e) => { setPassword(e.target.value); setError(''); }}
                              placeholder="••••••••"
                              className="w-full rounded-xl border border-input bg-input-background py-3 pl-10 pr-12 text-sm transition-all placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                            />
                            <button
                              type="button"
                              onClick={() => setShowPwd((v) => !v)}
                              aria-label={showPwd ? 'Hide password' : 'Show password'}
                              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                            >
                              {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center justify-between">
                          <label className="flex cursor-pointer items-center gap-2">
                            <input
                              type="checkbox"
                              checked={rememberMe}
                              onChange={(e) => setRememberMe(e.target.checked)}
                              className="h-4 w-4 rounded border-input accent-primary"
                            />
                            <span className="text-sm text-muted-foreground">Remember me</span>
                          </label>
                          <button
                            type="button"
                            onClick={() => { setShowForgot(true); setError(''); }}
                            className="text-sm font-semibold text-primary transition-colors hover:underline"
                          >
                            Forgot password?
                          </button>
                        </div>
                      </>
                    )}

                    {/* Submit Button */}
                    <button
                      type="submit"
                      disabled={isLoading}
                      className="flex w-full items-center justify-center gap-2 rounded-xl py-4 text-sm font-bold text-white transition-all hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                      style={{ background: 'linear-gradient(135deg, #15803D 0%, #22C55E 100%)' }}
                    >
                      {isLoading ? (
                        <>
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                          Signing in…
                        </>
                      ) : (
                        <>
                          Sign In
                          <ChevronRight className="h-4 w-4" />
                        </>
                      )}
                    </button>
                  </form>
                </div>

              </>
            ) : (
              /* ── Forgot Password ── */
              <div>
                <button
                  onClick={resetForgotState}
                  className="mb-6 flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  ← Back to Sign In
                </button>

                <div className="mb-7">
                  <h1 className="text-3xl font-bold text-foreground">Reset Password</h1>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {forgotDone
                      ? 'Your password has been reset.'
                      : forgotStep === 'identifier'
                        ? "We'll email a 6-digit code to your registered address."
                        : 'Enter the code and choose a new password.'}
                  </p>
                </div>

                <div className="rounded-2xl border border-border bg-card/95 p-8 shadow-xl">
                  {forgotError && (
                    <div className="mb-5 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/8 px-4 py-3">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                      <p className="text-sm text-destructive">{forgotError}</p>
                    </div>
                  )}

                  {forgotDone ? (
                    <div className="flex flex-col items-center gap-4 py-6 text-center">
                      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                        <CheckCircle2 className="h-8 w-8 text-primary" />
                      </div>
                      <h3 className="text-lg font-bold text-foreground">Password Reset!</h3>
                      <p className="text-sm text-muted-foreground">
                        You can now sign in with your new password.
                      </p>
                      <button
                        onClick={resetForgotState}
                        className="mt-2 rounded-xl px-6 py-2.5 text-sm font-bold text-white transition-all hover:opacity-90"
                        style={{ background: 'linear-gradient(135deg, #15803D, #22C55E)' }}
                      >
                        Back to Sign In
                      </button>
                    </div>
                  ) : (
                    <form onSubmit={handleForgotSubmit} className="space-y-5">
                      {forgotStep === 'identifier' ? (
                        <div>
                          <label htmlFor="forgot-identifier" className="mb-1.5 block text-sm font-semibold text-foreground">
                            Email or Mobile
                          </label>
                          <div className="relative">
                            <Mail className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <input
                              id="forgot-identifier"
                              type="text"
                              required
                              autoFocus
                              value={forgotIdentifier}
                              onChange={(e) => { setForgotIdentifier(e.target.value); setForgotError(''); }}
                              placeholder="you@tutorials.com or 9876500001"
                              className="w-full rounded-xl border border-input bg-input-background py-3 pl-10 pr-4 text-sm transition-all placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                            />
                          </div>
                        </div>
                      ) : (
                        <>
                          {forgotInfo && (
                            <div className="flex items-start gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
                              <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                              <p className="text-xs text-foreground">{forgotInfo}</p>
                            </div>
                          )}
                          <div>
                            <label htmlFor="forgot-code" className="mb-1.5 block text-sm font-semibold text-foreground">
                              6-Digit Code
                            </label>
                            <input
                              id="forgot-code"
                              type="text"
                              inputMode="numeric"
                              maxLength={6}
                              required
                              autoFocus
                              value={forgotCode}
                              onChange={(e) => { setForgotCode(e.target.value.replace(/\D/g, '')); setForgotError(''); }}
                              placeholder="000000"
                              className="w-full rounded-xl border border-input bg-input-background py-3.5 px-4 text-base tracking-[0.3em] transition-all placeholder:text-muted-foreground placeholder:tracking-normal focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                            />
                          </div>
                          <div>
                            <label htmlFor="forgot-new-password" className="mb-1.5 block text-sm font-semibold text-foreground">
                              New Password
                            </label>
                            <div className="relative">
                              <Lock className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                              <input
                                id="forgot-new-password"
                                type={showPwd ? 'text' : 'password'}
                                required
                                autoComplete="new-password"
                                value={forgotNewPassword}
                                onChange={(e) => { setForgotNewPassword(e.target.value); setForgotError(''); }}
                                placeholder="••••••••"
                                className="w-full rounded-xl border border-input bg-input-background py-3 pl-10 pr-12 text-sm transition-all placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                              />
                              <button
                                type="button"
                                onClick={() => setShowPwd((v) => !v)}
                                aria-label={showPwd ? 'Hide password' : 'Show password'}
                                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                              >
                                {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                              </button>
                            </div>
                          </div>
                          <div>
                            <label htmlFor="forgot-confirm-password" className="mb-1.5 block text-sm font-semibold text-foreground">
                              Confirm New Password
                            </label>
                            <input
                              id="forgot-confirm-password"
                              type={showPwd ? 'text' : 'password'}
                              required
                              autoComplete="new-password"
                              value={forgotConfirmPassword}
                              onChange={(e) => { setForgotConfirmPassword(e.target.value); setForgotError(''); }}
                              placeholder="••••••••"
                              className="w-full rounded-xl border border-input bg-input-background py-3 px-4 text-sm transition-all placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => { setForgotStep('identifier'); setForgotCode(''); setForgotError(''); setForgotInfo(''); }}
                            className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                          >
                            ← Change email/mobile
                          </button>
                        </>
                      )}
                      <button
                        type="submit"
                        disabled={forgotLoading}
                        className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-bold text-white transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                        style={{ background: 'linear-gradient(135deg, #15803D, #22C55E)' }}
                      >
                        {forgotLoading ? (
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        ) : null}
                        {forgotStep === 'identifier' ? 'Send Reset Code' : 'Reset Password'}
                      </button>
                    </form>
                  )}
                </div>
              </div>
            )}

            <p className="mt-6 text-center text-xs text-muted-foreground">
              © 2026 Guru Shishyaru Tutorials. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
