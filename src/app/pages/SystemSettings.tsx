import { Header } from '../components/Header';
import { Bell, Globe, Lock, Database } from 'lucide-react';

const SETTING_SECTIONS = [
  { icon: Bell, label: 'Notifications', desc: 'Configure email and in-app notification preferences' },
  { icon: Globe, label: 'General', desc: 'Institute name, timezone, language, and date format' },
  { icon: Lock, label: 'Security', desc: 'Password policy, session timeout, and 2FA settings' },
  { icon: Database, label: 'Data Retention', desc: 'Configure how long data is retained in the system' },
];

export function SystemSettings() {
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
      </div>
    </div>
  );
}
