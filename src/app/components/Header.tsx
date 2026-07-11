import { Bell, Search } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';
import { useAuth } from '../auth/AuthContext';
import { getRoleLabel } from '../auth/rbac';

interface HeaderProps {
  title: string;
}

export function Header({ title }: HeaderProps) {
  const { user } = useAuth();

  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-border bg-background px-6 transition-colors duration-200">
      <h2 className="text-xl font-semibold text-foreground">{title}</h2>

      <div className="flex items-center gap-3">
        {/* Search */}
        <div className="relative hidden sm:block">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            placeholder="Search…"
            className="h-9 w-56 rounded-lg border border-input bg-input-background pl-9 pr-4 text-sm transition-colors placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>

        {/* Notifications */}
        <button className="relative rounded-lg border border-border bg-card p-2 transition-all hover:bg-secondary">
          <Bell className="h-4 w-4" />
          <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-destructive" />
        </button>

        <ThemeToggle />

        {/* User chip */}
        {user && (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
              {user.name.charAt(0)}
            </div>
            <div className="hidden sm:block">
              <p className="text-xs font-medium text-foreground leading-none">{user.name}</p>
              <p className="mt-0.5 text-xs leading-none text-muted-foreground">
                {getRoleLabel(user.role)}
              </p>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
