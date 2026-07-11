import { useState, useEffect, useMemo, useCallback } from 'react';
import { Header } from '../components/Header';
import {
  Users, Plus, Search, Shield, Edit2, Ban,
  CheckCircle2, XCircle, Eye, EyeOff, RefreshCw,
  UserCog, Wallet, ChevronRight, X,
} from 'lucide-react';
import { useLocation } from 'react-router';
import { getRoleLabel } from '../auth/rbac';
import type { Role } from '../auth/types';
import { getBranches } from '../lib/branchService';
import { apiJson } from '../lib/apiClient';

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'all' | 'admins' | 'accountants';

interface ApiUser {
  id: string;
  name: string;
  email: string | null;
  mobile: string;
  roles: Role[];
  role: Role;
  branchId?: string;
  status: 'Active' | 'Inactive';
  mustChangePassword: boolean;
  createdAt: string;
}

const ASSIGNABLE_ROLES: { value: Role; label: string }[] = [
  { value: 'super_admin', label: 'Super Admin' },
  { value: 'admin', label: 'Admin' },
  { value: 'teacher', label: 'Teacher' },
  { value: 'accountant', label: 'Accountant' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  super_admin: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  admin:       'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  teacher:     'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  parent:      'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  accountant:  'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
};

function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#';
  return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/);
  return { firstName: parts[0] ?? name, lastName: parts.slice(1).join(' ') || '' };
}

// ─── View Profile Panel ───────────────────────────────────────────────────────

function ViewProfile({ user, onClose }: { user: ApiUser; onClose: () => void }) {
  const { firstName, lastName } = splitName(user.name);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-base font-semibold text-foreground">User Profile</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-xl font-bold text-primary">
              {firstName.charAt(0)}{lastName.charAt(0)}
            </div>
            <div>
              <p className="text-lg font-bold text-foreground">{user.name}</p>
              <p className="text-sm text-muted-foreground">{user.roles.map((r) => getRoleLabel(r)).join(' + ')}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Email',    value: user.email || '-' },
              { label: 'Mobile',   value: user.mobile },
              { label: 'Roles',    value: user.roles.map((r) => getRoleLabel(r)).join(', ') },
              { label: 'Status',   value: user.status },
              { label: 'Joined',   value: user.createdAt.slice(0, 10) },
              { label: 'Branch',   value: user.roles.includes('super_admin') ? 'All Branches' : (user.branchId ?? '-') },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-xl border border-border bg-secondary/50 p-3">
                <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
                <p className={`text-sm font-semibold ${
                  value === 'Active' ? 'text-green-600 dark:text-green-400' :
                  value === 'Inactive' ? 'text-red-500' : 'text-foreground'
                }`}>{value}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="border-t border-border px-6 py-4">
          <button onClick={onClose} className="rounded-xl border border-border px-5 py-2 text-sm font-medium transition-colors hover:bg-secondary">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

interface ModalProps {
  defaultRole: Role;
  onSave: (payload: { name: string; email: string; mobile: string; roles: Role[]; branchId: string; password?: string; status: 'Active' | 'Inactive' }) => void;
  onClose: () => void;
  initialUser?: ApiUser | null;
}

function AddUserModal({ defaultRole, onSave, onClose, initialUser }: ModalProps) {
  const branches = getBranches();
  const initialPwd = generatePassword();
  const [form, setForm] = useState(() => ({
    fullName: initialUser ? initialUser.name : '',
    email: initialUser ? initialUser.email ?? '' : '',
    mobile: initialUser ? initialUser.mobile : '',
    password: initialUser ? '' : initialPwd,
    confirmPassword: initialUser ? '' : initialPwd,
    roles: initialUser ? initialUser.roles : [defaultRole],
    status: initialUser ? initialUser.status : 'Active' as 'Active' | 'Inactive',
    branchId: initialUser ? initialUser.branchId ?? '' : (branches[0]?.id ?? ''),
  }));
  const [showPwd, setShowPwd] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((p) => ({ ...p, [k]: v }));

  const toggleRole = (role: Role) => {
    setForm((p) => ({
      ...p,
      roles: p.roles.includes(role) ? p.roles.filter((r) => r !== role) : [...p.roles, role],
    }));
  };

  const needsBranch = !form.roles.includes('super_admin');

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.fullName.trim()) e.fullName = 'Required';
    if (!form.mobile.trim()) e.mobile = 'Required';
    if (form.roles.length === 0) e.roles = 'Select at least one role';
    if (!initialUser && !form.password) e.password = 'Required';
    if (form.password || form.confirmPassword) {
      if (form.password !== form.confirmPassword) e.confirmPassword = 'Passwords do not match';
    }
    if (needsBranch && !form.branchId) e.branchId = 'Required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card shadow-2xl">

        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              {initialUser ? 'Edit User' : 'Add New User'}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              A user can hold more than one role under a single login.
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Full Name <span className="text-destructive">*</span></label>
              <input type="text" value={form.fullName} onChange={(e) => set('fullName', e.target.value)} placeholder="e.g. Ravi Kumar"
                className={`w-full rounded-xl border px-4 py-2.5 text-sm bg-input-background focus:outline-none focus:ring-2 focus:ring-primary/20 ${errors.fullName ? 'border-destructive' : 'border-input focus:border-primary'}`} />
              {errors.fullName && <p className="mt-1 text-xs text-destructive">{errors.fullName}</p>}
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Email</label>
              <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="ravi@tutorials.com"
                className="w-full rounded-xl border border-input px-4 py-2.5 text-sm bg-input-background focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Mobile <span className="text-destructive">*</span></label>
              <input type="tel" value={form.mobile} onChange={(e) => set('mobile', e.target.value)} placeholder="9876543210"
                className={`w-full rounded-xl border px-4 py-2.5 text-sm bg-input-background focus:outline-none focus:ring-2 focus:ring-primary/20 ${errors.mobile ? 'border-destructive' : 'border-input focus:border-primary'}`} />
              {errors.mobile && <p className="mt-1 text-xs text-destructive">{errors.mobile}</p>}
            </div>
            {needsBranch && (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Assigned Branch <span className="text-destructive">*</span></label>
                <select value={form.branchId} onChange={(e) => set('branchId', e.target.value)} className="w-full rounded-xl border border-input bg-input-background px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20">
                  <option value="">Select branch…</option>
                  {branches.filter((branch) => branch.status === 'Active').map((branch) => (
                    <option key={branch.id} value={branch.id}>{branch.name}</option>
                  ))}
                </select>
                {errors.branchId && <p className="mt-1 text-xs text-destructive">{errors.branchId}</p>}
              </div>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Roles <span className="text-destructive">*</span></label>
            <div className="flex flex-wrap gap-2">
              {ASSIGNABLE_ROLES.map(({ value, label }) => (
                <label key={value} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors ${form.roles.includes(value) ? 'border-primary bg-primary/10 text-foreground' : 'border-input text-muted-foreground hover:bg-secondary'}`}>
                  <input type="checkbox" checked={form.roles.includes(value)} onChange={() => toggleRole(value)} className="h-4 w-4 accent-primary" />
                  {label}
                </label>
              ))}
            </div>
            {errors.roles && <p className="mt-1 text-xs text-destructive">{errors.roles}</p>}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                Password
                <span className="ml-2 text-xs font-normal text-muted-foreground">{initialUser ? '(leave blank to keep unchanged)' : '(auto-generated)'}</span>
              </label>
              <div className="relative">
                <input
                  type={showPwd ? 'text' : 'password'}
                  value={form.password}
                  onChange={(e) => set('password', e.target.value)}
                  className="w-full rounded-xl border border-input bg-secondary px-4 py-2.5 pr-20 text-sm font-mono focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
                  <button type="button" onClick={() => setShowPwd((v) => !v)} className="rounded-lg p-1 text-muted-foreground hover:text-foreground">
                    {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                  <button type="button" onClick={() => { const pwd = generatePassword(); set('password', pwd); set('confirmPassword', pwd); }} className="rounded-lg p-1 text-muted-foreground hover:text-foreground" title="Regenerate">
                    <RefreshCw className="h-4 w-4" />
                  </button>
                </div>
              </div>
              {errors.password && <p className="mt-1 text-xs text-destructive">{errors.password}</p>}
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Confirm Password</label>
              <input type="password" value={form.confirmPassword} onChange={(e) => set('confirmPassword', e.target.value)}
                className={`w-full rounded-xl border px-4 py-2.5 text-sm bg-input-background focus:outline-none focus:ring-2 focus:ring-primary/20 ${errors.confirmPassword ? 'border-destructive' : 'border-input focus:border-primary'}`} />
              {errors.confirmPassword && <p className="mt-1 text-xs text-destructive">{errors.confirmPassword}</p>}
            </div>
          </div>
        </div>

        <div className="flex gap-3 border-t border-border px-6 py-4">
          <button
            onClick={() => {
              if (!validate()) return;
              onSave({
                name: form.fullName.trim(),
                email: form.email.trim(),
                mobile: form.mobile.trim(),
                roles: form.roles,
                branchId: form.branchId,
                password: form.password || undefined,
                status: form.status,
              });
            }}
            className="rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:opacity-90 active:scale-95"
          >
            {initialUser ? 'Save Changes' : 'Create Account'}
          </button>
          <button onClick={onClose} className="rounded-xl border border-border px-6 py-2.5 text-sm font-medium transition-colors hover:bg-secondary">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── User Row ─────────────────────────────────────────────────────────────────

function UserRow({
  user,
  onView,
  onEdit,
  onToggle,
}: {
  user: ApiUser;
  onView: () => void;
  onEdit: () => void;
  onToggle: () => void;
}) {
  const { firstName, lastName } = splitName(user.name);
  return (
    <tr className="transition-colors hover:bg-secondary/30">
      <td className="px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
            {firstName.charAt(0)}{lastName.charAt(0)}
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">{user.name}</p>
            <p className="text-xs text-muted-foreground">{user.mobile}</p>
          </div>
        </div>
      </td>
      <td className="px-5 py-4 text-sm text-muted-foreground">{user.email || '-'}</td>
      <td className="px-5 py-4 text-sm text-muted-foreground hidden md:table-cell">{user.mobile}</td>
      <td className="px-5 py-4 text-sm text-muted-foreground hidden md:table-cell">{user.roles.includes('super_admin') ? 'All Branches' : (user.branchId ?? '-')}</td>
      <td className="px-5 py-4">
        <div className="flex flex-wrap gap-1">
          {user.roles.map((role) => (
            <span key={role} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${ROLE_COLORS[role]}`}>
              <Shield className="h-3 w-3" />
              {getRoleLabel(role)}
            </span>
          ))}
        </div>
      </td>
      <td className="px-5 py-4">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
          user.status === 'Active'
            ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
            : 'bg-secondary text-muted-foreground'
        }`}>
          {user.status === 'Active' ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
          {user.status}
        </span>
      </td>
      <td className="px-5 py-4">
        <div className="flex items-center gap-1.5">
          <button
            onClick={onView}
            className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-secondary"
            title="View profile"
          >
            <Eye className="h-3.5 w-3.5" />
            View
          </button>
          <button
            onClick={onEdit}
            className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-secondary"
            title="Edit user"
          >
            <Edit2 className="h-3.5 w-3.5" />
            Edit
          </button>
          <button
            onClick={onToggle}
            className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
              user.status === 'Active'
                ? 'border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30'
                : 'border border-green-200 dark:border-green-900 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950/30'
            }`}
            title={user.status === 'Active' ? 'Disable account' : 'Enable account'}
          >
            <Ban className="h-3.5 w-3.5" />
            {user.status === 'Active' ? 'Disable' : 'Enable'}
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function UserManagement() {
  const [activeTab, setActiveTab] = useState<Tab>('all');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'Active' | 'Inactive'>('all');
  const [showModal, setShowModal] = useState(false);
  const [addingRole, setAddingRole] = useState<Role>('admin');
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [viewingUser, setViewingUser] = useState<ApiUser | null>(null);
  const [editingUser, setEditingUser] = useState<ApiUser | null>(null);
  const location = useLocation();

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await apiJson<ApiUser[]>('/api/users');
      setUsers(data);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    try {
      const params = new URLSearchParams(location.search || '');
      const tabParam = params.get('tab');
      if (tabParam === 'admins' || tabParam === 'accountants') {
        setActiveTab(tabParam as Tab);
      }
      const action = params.get('action');
      if (action === 'add-admin') {
        setAddingRole('admin');
        setShowModal(true);
      } else if (action === 'add-accountant') {
        setAddingRole('accountant');
        setShowModal(true);
      }
    } catch {
      // ignore malformed search
    }
  }, [location.search]);

  const byTab = activeTab === 'all'
    ? users
    : activeTab === 'admins'
    ? users.filter((u) => u.roles.includes('admin'))
    : users.filter((u) => u.roles.includes('accountant'));

  const filtered = byTab.filter((u) => {
    const matchSearch = `${u.name} ${u.email ?? ''} ${u.mobile}`.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || u.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const openAdd = (role: Role) => {
    setEditingUser(null);
    setAddingRole(role);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingUser(null);
  };

  const handleSave = async (payload: { name: string; email: string; mobile: string; roles: Role[]; branchId: string; password?: string; status: 'Active' | 'Inactive' }) => {
    try {
      await apiJson('/api/users', { method: 'POST', body: payload });
      setShowModal(false);
      setToast(`✓ Account created for ${payload.name}`);
      setTimeout(() => setToast(null), 4000);
      void loadUsers();
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Failed to create user');
      setTimeout(() => setToast(null), 4000);
    }
  };

  const handleEditSave = async (payload: { name: string; email: string; mobile: string; roles: Role[]; branchId: string; password?: string; status: 'Active' | 'Inactive' }) => {
    if (!editingUser) return;
    try {
      await apiJson(`/api/users/${editingUser.id}`, { method: 'PUT', body: payload });
      setEditingUser(null);
      setToast(`✓ User ${payload.name} updated`);
      setTimeout(() => setToast(null), 4000);
      void loadUsers();
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Failed to update user');
      setTimeout(() => setToast(null), 4000);
    }
  };

  const toggleStatus = async (user: ApiUser) => {
    const nextStatus = user.status === 'Active' ? 'Inactive' : 'Active';
    try {
      await apiJson(`/api/users/${user.id}`, { method: 'PUT', body: { status: nextStatus } });
      void loadUsers();
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Failed to update status');
      setTimeout(() => setToast(null), 4000);
    }
  };

  const adminCount = useMemo(() => users.filter((u) => u.roles.includes('admin')).length, [users]);
  const accountantCount = useMemo(() => users.filter((u) => u.roles.includes('accountant')).length, [users]);
  const activeCount = useMemo(() => users.filter((u) => u.status === 'Active').length, [users]);

  return (
    <div className="flex-1 bg-background">
      <Header title="User Management" />

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-2xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground shadow-xl">
          {toast}
        </div>
      )}

      {viewingUser && (
        <ViewProfile user={viewingUser} onClose={() => setViewingUser(null)} />
      )}

      {editingUser && (
        <AddUserModal
          defaultRole={editingUser.roles[0] ?? 'admin'}
          onSave={handleEditSave}
          onClose={closeModal}
          initialUser={editingUser}
        />
      )}

      {showModal && (
        <AddUserModal defaultRole={addingRole} onSave={handleSave} onClose={closeModal} initialUser={null} />
      )}

      <div className="max-w-6xl mx-auto p-6 space-y-6">

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: 'Total Users', value: users.length, icon: Users, color: 'text-sky-600 dark:text-sky-400' },
            { label: 'Admins', value: adminCount, icon: UserCog, color: 'text-violet-600 dark:text-violet-400' },
            { label: 'Accountants', value: accountantCount, icon: Wallet, color: 'text-teal-600 dark:text-teal-400' },
            { label: 'Active', value: activeCount, icon: CheckCircle2, color: 'text-green-600 dark:text-green-400' },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl border border-border bg-card p-5">
              <s.icon className={`h-5 w-5 mb-2 ${s.color}`} />
              <p className="text-2xl font-bold text-foreground">{s.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-xl border border-border overflow-hidden shrink-0">
            {([
              { key: 'all', label: 'All Users', icon: Users },
              { key: 'admins', label: 'Admins', icon: UserCog },
              { key: 'accountants', label: 'Accountants', icon: Wallet },
            ] as const).map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                  activeTab === key ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-secondary'
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>

          <div className="relative flex-1 min-w-[160px]">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              placeholder="Search name, email or mobile…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-input bg-input-background py-2.5 pl-10 pr-4 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            className="rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none"
          >
            <option value="all">All Status</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>

          <button onClick={() => openAdd('admin')} className="flex items-center gap-2 rounded-xl bg-sky-600 hover:bg-sky-700 px-4 py-2.5 text-sm font-semibold text-white transition-all active:scale-95">
            <Plus className="h-4 w-4" /> Add Admin
          </button>
          <button onClick={() => openAdd('accountant')} className="flex items-center gap-2 rounded-xl bg-teal-600 hover:bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white transition-all active:scale-95">
            <Plus className="h-4 w-4" /> Add Accountant
          </button>
        </div>

        {activeTab === 'admins' && (
          <div className="flex items-center gap-3 rounded-xl border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/30 px-4 py-3">
            <UserCog className="h-4 w-4 text-sky-600 dark:text-sky-400 shrink-0" />
            <p className="text-sm text-sky-700 dark:text-sky-300">
              Admins manage students, fees, attendance, exams, timetable and admissions for their assigned branch only.
            </p>
          </div>
        )}
        {activeTab === 'accountants' && (
          <div className="flex items-center gap-3 rounded-xl border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/30 px-4 py-3">
            <Wallet className="h-4 w-4 text-teal-600 dark:text-teal-400 shrink-0" />
            <p className="text-sm text-teal-700 dark:text-teal-300">
              Accountants manage fees, expenses, inventory and financial reports.
            </p>
          </div>
        )}

        <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h2 className="font-semibold text-foreground">
              {activeTab === 'all' ? 'All Users' : activeTab === 'admins' ? 'Admin Accounts' : 'Accountant Accounts'}
              <span className="ml-2 text-sm font-normal text-muted-foreground">({filtered.length})</span>
            </h2>
          </div>

          {loading ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <p className="text-sm text-muted-foreground">Loading users…</p>
            </div>
          ) : loadError ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <p className="text-sm text-destructive">{loadError}</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-secondary/40">
                      {['User', 'Email', 'Mobile', 'Branch', 'Roles', 'Status', 'Actions'].map((h) => (
                        <th key={h} className={`px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground${h === 'Mobile' || h === 'Branch' ? ' hidden md:table-cell' : ''}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filtered.map((u) => (
                      <UserRow
                        key={u.id}
                        user={u}
                        onView={() => setViewingUser(u)}
                        onEdit={() => setEditingUser(u)}
                        onToggle={() => toggleStatus(u)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              {filtered.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-12 text-center">
                  <Users className="h-10 w-10 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">No users found</p>
                </div>
              )}

              {filtered.length > 0 && (
                <div className="flex items-center justify-between border-t border-border px-5 py-3">
                  <p className="text-sm text-muted-foreground">Showing {filtered.length} users</p>
                  <button className="flex items-center gap-1 text-xs text-primary hover:underline">
                    View all <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </>
          )}
        </div>

      </div>
    </div>
  );
}
