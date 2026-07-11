import { NavLink, useNavigate } from 'react-router';
import { LogOut } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { getSidebarGroups } from '../auth/sidebarConfig';
import { getRoleLabel } from '../auth/rbac';
import { BrandLogo } from './BrandLogo';
import type { Role } from '../auth/types';

const ROLE_BADGE: Record<Role, string> = {
  super_admin: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  admin:       'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  teacher:     'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  parent:      'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  accountant:  'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
};

export function Sidebar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  if (!user) return null;

  const groups    = getSidebarGroups(user.role);
  const roleLabel = getRoleLabel(user.role);
  const isSimple  = groups.length === 1; // flat list for teacher/parent/accountant

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <aside className="fixed left-0 top-0 flex h-screen w-60 flex-col border-r border-sidebar-border bg-sidebar transition-colors duration-200">

      {/* ── Logo ── */}
      <div className="flex h-[68px] shrink-0 items-center justify-center border-b border-sidebar-border px-4">
        <BrandLogo height={44} showName={false} />
      </div>

      {/* ── Nav ── */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {groups.map((group) => (
          <div key={group.label}>
            {/* Only show group label for admin multi-group layout */}
            {!isSimple && (
              <p className="mb-1.5 px-2 text-[10px] font-bold uppercase tracking-widest text-sidebar-foreground/35">
                {group.label}
              </p>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={`${item.href}-${item.module}`}>
                  <NavLink
                    to={item.href}
                    end={item.href === '/'}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
                        isActive
                          ? 'bg-sidebar-primary text-sidebar-primary-foreground shadow-sm'
                          : 'text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                      }`
                    }
                  >
                    <item.icon className="h-[18px] w-[18px] shrink-0" />
                    <span>{item.name}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* ── User + logout ── */}
      <div className="shrink-0 border-t border-sidebar-border p-3">
        <div className="flex items-center gap-3 rounded-xl px-3 py-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-bold text-primary">
            {user.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-sidebar-foreground">{user.name}</p>
            <span className={`inline-block rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${ROLE_BADGE[user.role]}`}>
              {roleLabel}
            </span>
          </div>
          <button
            onClick={handleLogout}
            title="Sign out"
            className="shrink-0 rounded-lg p-1.5 text-sidebar-foreground/40 transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
