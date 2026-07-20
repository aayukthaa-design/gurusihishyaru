import { useState, useEffect } from 'react';
import { Header } from '../components/Header';
import { useAuth } from '../auth/AuthContext';
import { fetchWhatsappSettings, saveWhatsappSettingsAPI, sendTestWhatsappAPI } from '../lib/attendanceService';
import { Bell, Globe, Lock, Database, ShieldAlert, MessageSquare } from 'lucide-react';

const SETTING_SECTIONS = [
  { icon: Bell, label: 'Notifications', desc: 'Configure email and in-app notification preferences' },
  { icon: Globe, label: 'General', desc: 'Institute name, timezone, language, and date format' },
  { icon: Lock, label: 'Security', desc: 'Password policy, session timeout, and 2FA settings' },
  { icon: Database, label: 'Data Retention', desc: 'Configure how long data is retained in the system' },
];

export function SystemSettings() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';

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
  });

  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [testMobile, setTestMobile] = useState('');
  const [testMessage, setTestMessage] = useState('This is a test WhatsApp message from Guru Shishyaru Tutorials system settings.');
  const [testStatus, setTestStatus] = useState<{ type: 'idle' | 'success' | 'error'; message?: string }>({ type: 'idle' });

  useEffect(() => {
    fetchWhatsappSettings().then((data) => {
      setSettings((prev) => ({ ...prev, ...data }));
    });
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

  return (
    <div className="flex-1 bg-background">
      <Header title="System Settings" />
      <div className="p-6 space-y-6 max-w-4xl mx-auto">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {SETTING_SECTIONS.map(({ icon: Icon, label, desc }) => (
            <div
              key={label}
              className="flex items-start gap-4 rounded-xl border border-border bg-card p-6 text-left opacity-70"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Icon className="h-5 w-5 text-primary" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-foreground">{label}</h3>
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Coming soon</span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
              </div>
            </div>
          ))}
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
