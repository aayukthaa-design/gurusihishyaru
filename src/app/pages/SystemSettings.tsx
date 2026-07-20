import { useState, useEffect } from 'react';
import { Header } from '../components/Header';
import { useAuth } from '../auth/AuthContext';
import { fetchWhatsappSettings, saveWhatsappSettingsAPI, sendTestWhatsappAPI } from '../lib/attendanceService';
import { apiFetch } from '../lib/apiClient';
import { Bell, Globe, Lock, Database, ShieldAlert, MessageSquare, Trash2 } from 'lucide-react';

export function SystemSettings() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';

  // ─── General / Security / Data Retention — all stored in the same key-value
  // settings store as the WhatsApp config below, fetched/saved together. ──────
  const [settings, setSettings] = useState<Record<string, string>>({
    enable_whatsapp: 'false',
    whatsapp_provider: 'WhatsApp Business Cloud API',
    api_token: '',
    phone_number_id: '',
    business_account_id: '',
    official_contact: '',
    template_name: 'attendance_absence_alert',
    retry_attempts: '3',
    business_name: 'Guru Shishyaru Tutorials',
    webhook_url: '',
    api_version: 'v17.0',
    institute_name: 'Guru Shishyaru Tutorials',
    institute_timezone: 'Asia/Kolkata',
    institute_language: 'English',
    institute_date_format: 'DD/MM/YYYY',
    session_timeout_minutes: '1440',
    remember_me_days: '7',
    min_password_length: '8',
    require_uppercase: 'false',
    require_number: 'false',
    require_symbol: 'false',
    data_retention_days: '365',
  });

  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [testMobile, setTestMobile] = useState('');
  const [testMessage, setTestMessage] = useState('This is a test WhatsApp message from Guru Shishyaru Tutorials system settings.');
  const [testStatus, setTestStatus] = useState<{ type: 'idle' | 'success' | 'error'; message?: string }>({ type: 'idle' });

  // ─── Notification preferences — per-user, own endpoint ─────────────────────
  const [notifPrefs, setNotifPrefs] = useState({ muteAll: false, highPriorityOnly: false });
  const [notifStatus, setNotifStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // ─── Data retention cleanup ─────────────────────────────────────────────────
  const [cleanupStatus, setCleanupStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [cleanupResult, setCleanupResult] = useState<{ notifications: number; salaryAuditLog: number; whatsappLogs: number } | null>(null);

  useEffect(() => {
    fetchWhatsappSettings().then((data) => {
      setSettings((prev) => ({ ...prev, ...data }));
    });
    apiFetch('/api/notification-preferences')
      .then((res) => res.json())
      .then((data) => setNotifPrefs({ muteAll: Boolean(data.muteAll), highPriorityOnly: Boolean(data.highPriorityOnly) }))
      .catch((err) => console.error('Failed to load notification preferences', err));
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSuperAdmin) return;
    setSaveStatus('saving');
    const ok = await saveWhatsappSettingsAPI(settings);
    if (ok) {
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } else {
      setSaveStatus('error');
    }
  };

  const handleSaveNotifPrefs = async () => {
    setNotifStatus('saving');
    try {
      const res = await apiFetch('/api/notification-preferences', { method: 'POST', body: notifPrefs });
      setNotifStatus(res.ok ? 'saved' : 'error');
      if (res.ok) setTimeout(() => setNotifStatus('idle'), 3000);
    } catch {
      setNotifStatus('error');
    }
  };

  const handleRunCleanup = async () => {
    if (!confirm(`This will permanently delete read notifications, salary audit log entries, and WhatsApp logs older than ${settings.data_retention_days} days. Continue?`)) return;
    setCleanupStatus('running');
    try {
      const res = await apiFetch('/api/data-retention/cleanup', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setCleanupResult(data.deleted);
        setCleanupStatus('done');
      } else {
        setCleanupStatus('error');
      }
    } catch {
      setCleanupStatus('error');
    }
  };

  const handleSendTest = async () => {
    if (!testMobile) {
      setTestStatus({ type: 'error', message: 'Mobile number is required' });
      return;
    }
    setTestStatus({ type: 'idle' });
    const res = await sendTestWhatsappAPI(testMobile, testMessage);
    if (res.success) {
      setTestStatus({ type: 'success', message: res.message || 'Test WhatsApp sent successfully!' });
    } else {
      setTestStatus({ type: 'error', message: res.error || 'Failed to send test WhatsApp.' });
    }
  };

  const inputClass = "w-full rounded-lg border border-input bg-input-background px-3 py-2 text-sm focus:border-primary focus:outline-none";

  return (
    <div className="flex-1 bg-background">
      <Header title="System Settings" />
      <div className="p-6 space-y-6 max-w-4xl mx-auto">

        <form onSubmit={handleSave} className="space-y-6">

          {/* General */}
          <div className="rounded-xl border border-border bg-card p-6">
            <div className="flex items-center gap-3 border-b border-border pb-4 mb-4">
              <Globe className="h-5 w-5 text-primary" />
              <div>
                <h3 className="font-semibold text-foreground">General</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Institute name, timezone, language, and date format used across the app.</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Institute Name</label>
                <input type="text" value={settings.institute_name || ''} disabled={!isSuperAdmin} onChange={(e) => setSettings((p) => ({ ...p, institute_name: e.target.value }))} className={inputClass} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Timezone</label>
                <input type="text" value={settings.institute_timezone || ''} disabled={!isSuperAdmin} onChange={(e) => setSettings((p) => ({ ...p, institute_timezone: e.target.value }))} placeholder="e.g. Asia/Kolkata" className={inputClass} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Language</label>
                <select value={settings.institute_language || 'English'} disabled={!isSuperAdmin} onChange={(e) => setSettings((p) => ({ ...p, institute_language: e.target.value }))} className={inputClass}>
                  <option>English</option>
                  <option>Kannada</option>
                  <option>Hindi</option>
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Date Format</label>
                <select value={settings.institute_date_format || 'DD/MM/YYYY'} disabled={!isSuperAdmin} onChange={(e) => setSettings((p) => ({ ...p, institute_date_format: e.target.value }))} className={inputClass}>
                  <option>DD/MM/YYYY</option>
                  <option>MM/DD/YYYY</option>
                  <option>YYYY-MM-DD</option>
                </select>
              </div>
            </div>
          </div>

          {/* Security */}
          <div className="rounded-xl border border-border bg-card p-6">
            <div className="flex items-center gap-3 border-b border-border pb-4 mb-4">
              <Lock className="h-5 w-5 text-primary" />
              <div>
                <h3 className="font-semibold text-foreground">Security</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Password policy and session timeout, enforced on login and password changes.</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Session Timeout (minutes)</label>
                <input type="number" min={5} value={settings.session_timeout_minutes || ''} disabled={!isSuperAdmin} onChange={(e) => setSettings((p) => ({ ...p, session_timeout_minutes: e.target.value }))} className={inputClass} />
                <p className="mt-1 text-xs text-muted-foreground">1440 = 24 hours. Applies to new logins.</p>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">"Remember Me" Duration (days)</label>
                <input type="number" min={1} value={settings.remember_me_days || ''} disabled={!isSuperAdmin} onChange={(e) => setSettings((p) => ({ ...p, remember_me_days: e.target.value }))} className={inputClass} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Minimum Password Length</label>
                <input type="number" min={6} max={64} value={settings.min_password_length || ''} disabled={!isSuperAdmin} onChange={(e) => setSettings((p) => ({ ...p, min_password_length: e.target.value }))} className={inputClass} />
              </div>
              <div className="flex flex-col justify-end gap-2 pb-1">
                {([
                  ['require_uppercase', 'Require an uppercase letter'],
                  ['require_number', 'Require a number'],
                  ['require_symbol', 'Require a symbol'],
                ] as const).map(([key, label]) => (
                  <label key={key} className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={settings[key] === 'true'}
                      disabled={!isSuperAdmin}
                      onChange={(e) => setSettings((p) => ({ ...p, [key]: e.target.checked ? 'true' : 'false' }))}
                      className="h-4 w-4 rounded border-input accent-primary"
                    />
                    <span className="text-sm text-foreground">{label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {isSuperAdmin && (
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={saveStatus === 'saving'}
                className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition-all hover:opacity-90 active:scale-95 disabled:opacity-50"
              >
                {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? '✓ Saved!' : 'Save General & Security Settings'}
              </button>
              {saveStatus === 'error' && (
                <span className="text-sm font-medium text-destructive">Failed to save settings. Please try again.</span>
              )}
            </div>
          )}
        </form>

        {/* Notifications (per-user) */}
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-center gap-3 border-b border-border pb-4 mb-4">
            <Bell className="h-5 w-5 text-primary" />
            <div>
              <h3 className="font-semibold text-foreground">Notifications</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Your personal notification preferences — only affects what you see.</p>
            </div>
          </div>
          <div className="space-y-2">
            <label className="flex cursor-pointer items-center gap-3 py-1.5">
              <input
                type="checkbox"
                checked={notifPrefs.muteAll}
                onChange={(e) => setNotifPrefs((p) => ({ ...p, muteAll: e.target.checked }))}
                className="h-4 w-4 rounded border-input accent-primary"
              />
              <div>
                <span className="text-sm font-semibold text-foreground">Mute all notifications</span>
                <p className="text-xs text-muted-foreground">Hides everything in your notifications list.</p>
              </div>
            </label>
            <label className="flex cursor-pointer items-center gap-3 py-1.5">
              <input
                type="checkbox"
                checked={notifPrefs.highPriorityOnly}
                disabled={notifPrefs.muteAll}
                onChange={(e) => setNotifPrefs((p) => ({ ...p, highPriorityOnly: e.target.checked }))}
                className="h-4 w-4 rounded border-input accent-primary disabled:opacity-50"
              />
              <div>
                <span className="text-sm font-semibold text-foreground">Only show high-priority notifications</span>
                <p className="text-xs text-muted-foreground">Hides medium and low priority notifications.</p>
              </div>
            </label>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={handleSaveNotifPrefs}
              disabled={notifStatus === 'saving'}
              className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition-all hover:opacity-90 active:scale-95 disabled:opacity-50"
            >
              {notifStatus === 'saving' ? 'Saving...' : notifStatus === 'saved' ? '✓ Saved!' : 'Save Notification Preferences'}
            </button>
            {notifStatus === 'error' && <span className="text-sm font-medium text-destructive">Failed to save. Please try again.</span>}
          </div>
        </div>

        {/* Data Retention */}
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-center justify-between border-b border-border pb-4 mb-4">
            <div className="flex items-center gap-3">
              <Database className="h-5 w-5 text-primary" />
              <div>
                <h3 className="font-semibold text-foreground">Data Retention</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Configure how long read notifications, audit logs, and WhatsApp logs are kept.</p>
              </div>
            </div>
            {!isSuperAdmin && (
              <span className="flex items-center gap-1 text-xs font-semibold text-amber-600 bg-amber-50 dark:bg-amber-950/20 dark:text-amber-400 px-2.5 py-1 rounded-full">
                <ShieldAlert className="h-3 w-3" />
                Read-only (Super Admin only)
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Retention Period (days)</label>
              <input
                type="number"
                min={30}
                value={settings.data_retention_days || ''}
                disabled={!isSuperAdmin}
                onChange={(e) => setSettings((p) => ({ ...p, data_retention_days: e.target.value }))}
                className={inputClass}
              />
              <p className="mt-1 text-xs text-muted-foreground">Save this above with General & Security settings first, then run cleanup.</p>
            </div>
          </div>
          {isSuperAdmin && (
            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                onClick={handleRunCleanup}
                disabled={cleanupStatus === 'running'}
                className="flex items-center gap-2 rounded-lg border border-destructive/40 px-5 py-2 text-sm font-semibold text-destructive transition-all hover:bg-destructive/10 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
                {cleanupStatus === 'running' ? 'Running Cleanup...' : 'Run Cleanup Now'}
              </button>
              {cleanupStatus === 'done' && cleanupResult && (
                <span className="text-sm text-foreground">
                  Deleted {cleanupResult.notifications} notifications, {cleanupResult.salaryAuditLog} audit log entries, {cleanupResult.whatsappLogs} WhatsApp logs.
                </span>
              )}
              {cleanupStatus === 'error' && <span className="text-sm font-medium text-destructive">Cleanup failed. Please try again.</span>}
            </div>
          )}
        </div>

        {/* WhatsApp Configuration Section */}
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-center justify-between border-b border-border pb-4 mb-4">
            <div className="flex items-center gap-3">
              <MessageSquare className="h-5 w-5 text-emerald-500" />
              <div>
                <h3 className="font-semibold text-foreground">WhatsApp Configuration</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Used for attendance alerts and parent login verification codes (OTP).
                </p>
              </div>
            </div>
            {!isSuperAdmin && (
              <span className="flex items-center gap-1 text-xs font-semibold text-amber-600 bg-amber-50 dark:bg-amber-950/20 dark:text-amber-400 px-2.5 py-1 rounded-full">
                <ShieldAlert className="h-3 w-3" />
                Read-only (Super Admin only)
              </span>
            )}
          </div>

          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="flex cursor-pointer items-center gap-3 py-1.5">
                  <input
                    type="checkbox"
                    checked={settings.enable_whatsapp === 'true'}
                    disabled={!isSuperAdmin}
                    onChange={(e) => setSettings(prev => ({ ...prev, enable_whatsapp: e.target.checked ? 'true' : 'false' }))}
                    className="h-4 w-4 rounded border-input accent-primary"
                  />
                  <div>
                    <span className="text-sm font-semibold text-foreground">Enable WhatsApp Messaging</span>
                    <p className="text-xs text-muted-foreground">Required for attendance alerts and parent login OTP codes to be sent.</p>
                  </div>
                </label>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">WhatsApp Provider</label>
                <select
                  value={settings.whatsapp_provider}
                  disabled={!isSuperAdmin}
                  onChange={(e) => setSettings(prev => ({ ...prev, whatsapp_provider: e.target.value }))}
                  className="w-full rounded-lg border border-input bg-input-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
                >
                  <option>WhatsApp Business Cloud API</option>
                  <option>Meta WhatsApp Business API</option>
                  <option>Twilio WhatsApp</option>
                  <option>Gupshup</option>
                  <option>Interakt</option>
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Business Name</label>
                <input
                  type="text"
                  value={settings.business_name || ''}
                  disabled={!isSuperAdmin}
                  onChange={(e) => setSettings(prev => ({ ...prev, business_name: e.target.value }))}
                  placeholder="e.g. Guru Shishyaru Tutorials"
                  className="w-full rounded-lg border border-input bg-input-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">API Token / API Key</label>
                <input
                  type="password"
                  value={settings.api_token || ''}
                  disabled={!isSuperAdmin}
                  onChange={(e) => setSettings(prev => ({ ...prev, api_token: e.target.value }))}
                  placeholder="••••••••••••••••••••••••"
                  className="w-full rounded-lg border border-input bg-input-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Phone Number ID</label>
                <input
                  type="text"
                  value={settings.phone_number_id || ''}
                  disabled={!isSuperAdmin}
                  onChange={(e) => setSettings(prev => ({ ...prev, phone_number_id: e.target.value }))}
                  placeholder="e.g. 1065749283749"
                  className="w-full rounded-lg border border-input bg-input-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Business Account ID / Account SID</label>
                <input
                  type="text"
                  value={settings.business_account_id || ''}
                  disabled={!isSuperAdmin}
                  onChange={(e) => setSettings(prev => ({ ...prev, business_account_id: e.target.value }))}
                  placeholder="e.g. 8472947295729 or ACxxxxx"
                  className="w-full rounded-lg border border-input bg-input-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">API Version</label>
                <input
                  type="text"
                  value={settings.api_version || ''}
                  disabled={!isSuperAdmin}
                  onChange={(e) => setSettings(prev => ({ ...prev, api_version: e.target.value }))}
                  placeholder="e.g. v17.0"
                  className="w-full rounded-lg border border-input bg-input-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Official Tutorial Contact Number <span className="text-destructive">*</span></label>
                <input
                  type="text"
                  value={settings.official_contact || ''}
                  disabled={!isSuperAdmin}
                  onChange={(e) => setSettings(prev => ({ ...prev, official_contact: e.target.value }))}
                  placeholder="e.g. 6363099546"
                  className="w-full rounded-lg border border-input bg-input-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">WhatsApp Template Name</label>
                <input
                  type="text"
                  value={settings.template_name || ''}
                  disabled={!isSuperAdmin}
                  onChange={(e) => setSettings(prev => ({ ...prev, template_name: e.target.value }))}
                  placeholder="e.g. attendance_absence_alert"
                  className="w-full rounded-lg border border-input bg-input-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Retry Attempts</label>
                <input
                  type="number"
                  min="0"
                  max="5"
                  value={settings.retry_attempts || '3'}
                  disabled={!isSuperAdmin}
                  onChange={(e) => setSettings(prev => ({ ...prev, retry_attempts: e.target.value }))}
                  className="w-full rounded-lg border border-input bg-input-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-sm font-medium text-foreground">Webhook URL</label>
                <input
                  type="text"
                  value={settings.webhook_url || ''}
                  disabled={!isSuperAdmin}
                  onChange={(e) => setSettings(prev => ({ ...prev, webhook_url: e.target.value }))}
                  placeholder="e.g. https://yourdomain.com/api/whatsapp/webhook"
                  className="w-full rounded-lg border border-input bg-input-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
                />
              </div>
            </div>

            {isSuperAdmin && (
              <div className="flex items-center gap-3 pt-2">
                <button
                  type="submit"
                  disabled={saveStatus === 'saving'}
                  className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition-all hover:opacity-90 active:scale-95 disabled:opacity-50"
                >
                  {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? '✓ Saved!' : 'Save Settings'}
                </button>
                {saveStatus === 'error' && (
                  <span className="text-sm font-medium text-destructive">Failed to save settings. Please try again.</span>
                )}
              </div>
            )}
          </form>
        </div>

        {/* Test WhatsApp block */}
        {isSuperAdmin && (
          <div className="rounded-xl border border-border bg-card p-6">
            <div className="flex items-center gap-3 border-b border-border pb-3 mb-4">
              <MessageSquare className="h-5 w-5 text-emerald-500" />
              <h3 className="font-semibold text-foreground">Test WhatsApp Gateway</h3>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground">Recipient Mobile Number</label>
                  <input
                    type="tel"
                    value={testMobile}
                    onChange={(e) => setTestMobile(e.target.value)}
                    placeholder="e.g. 9148478969"
                    className="w-full rounded-lg border border-input bg-input-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Test Message Body</label>
                <textarea
                  value={testMessage}
                  onChange={(e) => setTestMessage(e.target.value)}
                  rows={2}
                  className="w-full rounded-lg border border-input bg-input-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
                />
              </div>

              {testStatus.type !== 'idle' && (
                <div className={`p-3 rounded-lg text-sm ${testStatus.type === 'success' ? 'bg-green-50 text-green-700 dark:bg-green-950/20 dark:text-green-400' : 'bg-destructive/8 text-destructive'}`}>
                  {testStatus.message}
                </div>
              )}

              <button
                onClick={handleSendTest}
                className="rounded-lg border border-border px-5 py-2 text-sm font-semibold text-foreground hover:bg-secondary active:scale-95 transition-all"
              >
                Send Test WhatsApp
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
