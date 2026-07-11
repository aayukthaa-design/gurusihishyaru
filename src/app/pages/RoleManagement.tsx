import { Header } from '../components/Header';
import { Shield, CheckCircle2 } from 'lucide-react';
import { ROLE_CONFIG } from '../auth/rbac';
import type { Role } from '../auth/types';

const ROLE_COLORS: Record<Role, { bg: string; text: string; border: string }> = {
  super_admin: { bg: 'bg-violet-500/10', text: 'text-violet-600 dark:text-violet-400', border: 'border-violet-500/20' },
  admin: { bg: 'bg-blue-500/10', text: 'text-blue-600 dark:text-blue-400', border: 'border-blue-500/20' },
  teacher: { bg: 'bg-emerald-500/10', text: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-500/20' },
  parent: { bg: 'bg-amber-500/10', text: 'text-amber-600 dark:text-amber-400', border: 'border-amber-500/20' },
  accountant: { bg: 'bg-rose-500/10', text: 'text-rose-600 dark:text-rose-400', border: 'border-rose-500/20' },
};

export function RoleManagement() {
  return (
    <div className="flex-1">
      <Header title="Role Management" />
      <div className="p-6 space-y-6">
        <p className="text-sm text-muted-foreground">
          Overview of all system roles and their assigned permissions and module access.
        </p>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {(Object.entries(ROLE_CONFIG) as [Role, typeof ROLE_CONFIG[Role]][]).map(([role, config]) => {
            const colors = ROLE_COLORS[role];
            return (
              <div
                key={role}
                className={`rounded-xl border bg-card p-6 transition-colors ${colors.border}`}
              >
                <div className="mb-4 flex items-center gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${colors.bg}`}>
                    <Shield className={`h-5 w-5 ${colors.text}`} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">{config.label}</h3>
                    <p className="text-xs text-muted-foreground capitalize">{role.replace('_', ' ')}</p>
                  </div>
                </div>

                {/* Permissions */}
                <div className="mb-4">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Permissions
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {config.permissions.map((p) => (
                      <span
                        key={p}
                        className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${colors.bg} ${colors.text}`}
                      >
                        <CheckCircle2 className="h-3 w-3" />
                        {p.replace('_', ' ')}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Module count */}
                <div className="rounded-lg bg-secondary px-3 py-2 text-sm">
                  <span className="text-muted-foreground">Module access: </span>
                  <span className="font-semibold text-foreground">{config.modules.length} modules</span>
                </div>

                {/* Module list */}
                <div className="mt-3 max-h-36 overflow-y-auto space-y-1">
                  {config.modules.map((mod) => (
                    <div key={mod} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${colors.bg.replace('/10', '/80')}`} style={{backgroundColor: 'currentColor'}} />
                      {mod.replace(/_/g, ' ')}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
