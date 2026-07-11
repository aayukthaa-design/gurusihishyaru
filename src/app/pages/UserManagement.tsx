import { useState, useEffect, useMemo } from 'react';
import { Header } from '../components/Header';
import {
  Users, Plus, Search, Shield, Edit2, Ban,
  CheckCircle2, XCircle, Eye, EyeOff, RefreshCw,
  UserCog, Wallet, ChevronRight, X,
} from 'lucide-react';
import { SEED_USERS } from '../auth/seedUsers';
import { useLocation } from 'react-router';
import { getRoleLabel } from '../auth/rbac';
import type { Role } from '../auth/types';
import { getBranches } from '../lib/branchService';

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'all' | 'admins' | 'accountants';

interface ManagedUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  mobile: string;
  username: string;
  password: string;
  role: Role;
  status: 'Active' | 'Inactive';
  createdAt: string;
  branch?: string;
  notes?: string;
}

// ─── Seed data ────────────────────────────────────────────────────────────────

const INITIAL_USERS: ManagedUser[] = SEED_USERS
  .filter((u) => ['admin', 'accountant'].includes(u.role))
  .map((u, i) => {
    const parts = u.name.split(' ');
    return {
      id:        u.id,
      firstName: parts[0] ?? u.name,
      lastName:  parts[1] ?? 'User',
      email:     u.email,
      mobile:    `+91 98765 4${String(3210 + i).padStart(4, '0')}`,
      username:  u.email.split('@')[0],
      password:  'Password@123',
      role:      u.role,
      status:    'Active' as const,
      createdAt: '2026-06-01',
      branch:    'Main Center',
      notes:     '',
    };
  });

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

// ─── View Profile Panel ───────────────────────────────────────────────────────

function ViewProfile({ user, onClose }: { user: ManagedUser; onClose: () => void }) {
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
              {user.firstName.charAt(0)}{user.lastName.charAt(0)}
            </div>
            <div>
              <p className="text-lg font-bold text-foreground">{user.firstName} {user.lastName}</p>
              <p className="text-sm text-muted-foreground">@{user.username}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Email',    value: user.email },
              { label: 'Phone',    value: user.mobile },
              { label: 'Role',     value: getRoleLabel(user.role) },
              { label: 'Status',   value: user.status },
              { label: 'Joined',   value: user.createdAt.slice(0, 10) },
              { label: 'Username', value: user.username },
              { label: 'Branch',   value: user.branch ?? '-' },
              { label: 'Notes',    value: user.notes ?? '-' },
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
  defaultRole: 'admin' | 'accountant';
  onSave: (user: Omit<ManagedUser, 'id' | 'createdAt'>) => void;
  onClose: () => void;
}

function AddUserModal({ defaultRole, onSave, onClose, initialUser }: ModalProps & { initialUser?: ManagedUser | null }) {
  const branches = getBranches();
  const initialPwd = generatePassword();
  const [form, setForm] = useState(() => ({
    fullName: initialUser ? `${initialUser.firstName} ${initialUser.lastName}` : '',
    email: initialUser ? initialUser.email : '',
    mobile: initialUser ? initialUser.mobile : '',
    username: initialUser ? initialUser.username : '',
    password: initialUser ? '' : initialPwd,
    confirmPassword: initialUser ? '' : initialPwd,
    role: (initialUser ? initialUser.role : defaultRole) as 'admin' | 'accountant',
    status: initialUser ? initialUser.status : 'Active' as 'Active' | 'Inactive',
    branch: initialUser ? initialUser.branch ?? '' : '',
    notes: initialUser ? initialUser.notes ?? '' : '',
  }));
  const [showPwd, setShowPwd] = useState(false);
  const [errors,  setErrors]  = useState<Record<string, string>>({});

  const set = (k: keyof typeof form, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.fullName.trim()) e.fullName = 'Required';
    if (!form.email.trim())     e.email     = 'Required';
    else if (!/\S+@\S+\.\S+/.test(form.email)) e.email = 'Invalid email';
    if (!form.mobile.trim())    e.mobile    = 'Required';
    if (!form.username.trim())  e.username  = 'Required';
    // Password is required only when creating a new user. For edits, it's optional.
    if (!initialUser && !form.password) e.password = 'Required';
    if (form.password || form.confirmPassword) {
      if (form.password !== form.confirmPassword) e.confirmPassword = 'Passwords do not match';
    }
    if (!form.branch.trim())    e.branch    = 'Required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const field = (key: string, label: string, type = 'text', placeholder = '') => (
    <div key={key}>
      <label className="mb-1.5 block text-sm font-medium text-foreground">
        {label} {key !== 'notes' && <span className="text-destructive">*</span>}
      </label>
      {key === 'notes' ? (
        <textarea
          value={(form as Record<string, string>)[key]}
          onChange={(e) => set(key as keyof typeof form, e.target.value)}
          placeholder={placeholder}
          className={`w-full rounded-xl border px-4 py-2.5 text-sm bg-input-background focus:outline-none focus:ring-2 focus:ring-primary/20 ${(errors as Record<string, string>)[key] ? 'border-destructive' : 'border-input focus:border-primary'}`}
        />
      ) : (
        <input
          type={type}
          value={(form as Record<string, string>)[key]}
          onChange={(e) => {
            set(key as keyof typeof form, e.target.value);
            if (key === 'email') set('username', e.target.value.split('@')[0]);
          }}
          placeholder={placeholder}
          className={`w-full rounded-xl border px-4 py-2.5 text-sm bg-input-background focus:outline-none focus:ring-2 focus:ring-primary/20 ${(errors as Record<string, string>)[key] ? 'border-destructive' : 'border-input focus:border-primary'}`}
        />
      )}
      {(errors as Record<string, string>)[key] && (
        <p className="mt-1 text-xs text-destructive">{(errors as Record<string, string>)[key]}</p>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              Add New {form.role === 'admin' ? 'Admin' : 'Accountant'}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Role assigned automatically. User must change password on first login.
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {field('fullName', 'Full Name', 'text', 'e.g. Ravi Kumar')}
            {field('email',    'Email',     'email','ravi@tutorials.com')}
            {field('mobile',   'Phone',     'tel',  '9876543210')}
            {field('username', 'Username',  'text', 'ravi.kumar')}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Assigned Branch <span className="text-destructive">*</span></label>
              <select value={form.branch} onChange={(e) => set('branch', e.target.value)} className="w-full rounded-xl border border-input bg-input-background px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20">
                <option value="">Select branch…</option>
                {branches.filter((branch) => branch.status === 'Active').map((branch) => (
                  <option key={branch.id} value={branch.name}>{branch.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Role</label>
              <select
                value={form.role}
                onChange={(e) => set('role', e.target.value)}
                className="w-full rounded-xl border border-input bg-input-background px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="admin">Admin</option>
                <option value="accountant">Accountant</option>
              </select>
            </div>
          </div>

          {/* Passwords */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                Password
                <span className="ml-2 text-xs font-normal text-muted-foreground">(auto-generated)</span>
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
            </div>

            <div>
              {field('confirmPassword', 'Confirm Password', 'password')}
            </div>
          </div>

          {field('notes', 'Notes (optional)', 'text', 'Optional notes')}
        </div>

        {/* Footer */}
        <div className="flex gap-3 border-t border-border px-6 py-4">
          <button
            onClick={() => {
              if (!validate()) return;
              // Build payload with firstName/lastName split from fullName
              const parts = form.fullName.trim().split(/\s+/);
              const firstName = parts.shift() || '';
              const lastName = parts.join(' ') || 'User';
              const payload: Omit<ManagedUser, 'id' | 'createdAt'> = {
                firstName,
                lastName,
                email: form.email,
                mobile: form.mobile,
                username: form.username,
                password: form.password,
                role: form.role as Role,
                status: form.status as 'Active' | 'Inactive',
                branch: form.branch,
                notes: form.notes,
              } as Omit<ManagedUser, 'id' | 'createdAt'>;
              onSave(payload);
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
  user: ManagedUser;
  onView: () => void;
  onEdit: () => void;
  onToggle: () => void;
}) {
  return (
    <tr className="transition-colors hover:bg-secondary/30">
      <td className="px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
            {user.firstName.charAt(0)}{user.lastName.charAt(0)}
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">{user.firstName} {user.lastName}</p>
            <p className="text-xs text-muted-foreground">@{user.username}</p>
          </div>
        </div>
      </td>
      <td className="px-5 py-4 text-sm text-muted-foreground">{user.email}</td>
      <td className="px-5 py-4 text-sm text-muted-foreground hidden md:table-cell">{user.mobile}</td>
      <td className="px-5 py-4 text-sm text-muted-foreground hidden md:table-cell">{user.branch ?? '-'}</td>
      <td className="px-5 py-4">
        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${ROLE_COLORS[user.role]}`}>
          <Shield className="h-3 w-3" />
          {getRoleLabel(user.role)}
        </span>
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
          {/* View */}
          <button
            onClick={onView}
            className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-secondary"
            title="View profile"
          >
            <Eye className="h-3.5 w-3.5" />
            View
          </button>
          {/* Edit */}
          <button
            onClick={onEdit}
            className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-secondary"
            title="Edit user"
          >
            <Edit2 className="h-3.5 w-3.5" />
            Edit
          </button>
          {/* Disable / Enable */}
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
  const [activeTab,  setActiveTab]  = useState<Tab>('all');
  const [search,     setSearch]     = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'Active' | 'Inactive'>('all');
  const [showModal,  setShowModal]  = useState(false);
  const [addingRole, setAddingRole] = useState<'admin' | 'accountant'>('admin');
  const [users,      setUsers]      = useState<ManagedUser[]>(INITIAL_USERS);
  const [toast,      setToast]      = useState<string | null>(null);
  const [viewingUser, setViewingUser] = useState<ManagedUser | null>(null);
  const [editingUser, setEditingUser] = useState<ManagedUser | null>(null);
  const location = useLocation();

  // query / navigation handling moved below after allUsers is computed

  // Build the complete "all users" view including seed users not in INITIAL_USERS
  const seedBase = useMemo<ManagedUser[]>(() => SEED_USERS.map((u) => {
    const parts = u.name.split(' ');
    return {
      id: u.id, firstName: parts[0] ?? '', lastName: parts[1] ?? '',
      email: u.email, mobile: '+91 98765 43210', username: u.email.split('@')[0],
      password: 'Password@123', role: u.role, status: 'Active' as const, createdAt: '2026-06-01',
      branch: 'Main Center', notes: '',
    };
  }), []);
  const allUsers = useMemo(() => {
    const seedIds = new Set(seedBase.map((u) => u.id));
    const newUsers = users.filter((u) => !seedIds.has(u.id));
    return [...seedBase, ...newUsers];
  }, [seedBase, users]);

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
        return;
      }
      if (action === 'add-accountant') {
        setAddingRole('accountant');
        setShowModal(true);
        return;
      }
      if (action === 'edit') {
        const id = params.get('id');
        if (id) {
          const u = allUsers.find((x) => x.id === id);
          if (u) {
            setEditingUser(u);
            setActiveTab(u.role === 'admin' ? 'admins' : 'accountants');
            return;
          }
        }
      }

      // fallback: navigation state
      const st = (location as any).state;
      if (st && st.openAdd) {
        const role = st.role ?? (tabParam === 'admins' ? 'admin' : tabParam === 'accountants' ? 'accountant' : 'admin');
        setAddingRole(role);
        setShowModal(true);
      }
    } catch (e) {
      // ignore malformed search
    }
  }, [location.search, location.state]);

  const byTab = activeTab === 'all'
    ? allUsers
    : activeTab === 'admins'
    ? users.filter((u) => u.role === 'admin')
    : users.filter((u) => u.role === 'accountant');

  const filtered = byTab.filter((u) => {
    const matchSearch = `${u.firstName} ${u.lastName} ${u.email} ${u.username}`
      .toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || u.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const openAdd = (role: 'admin' | 'accountant') => {
    setEditingUser(null);
    setAddingRole(role);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingUser(null);
  };

  const handleSave = (data: Omit<ManagedUser, 'id' | 'createdAt'>) => {
    const newUser: ManagedUser = { ...data, id: `usr_${Date.now()}`, createdAt: new Date().toISOString() };
    setUsers((prev) => [newUser, ...prev]);
    setShowModal(false);
    setActiveTab(data.role === 'admin' ? 'admins' : 'accountants');
    const label = data.role === 'admin' ? 'Admin' : 'Accountant';
    setToast(`✓ ${label} account created for ${data.firstName} ${data.lastName}`);
    setTimeout(() => setToast(null), 4000);
  };

  const handleEditSave = (data: Omit<ManagedUser, 'id' | 'createdAt'>) => {
    if (!editingUser) return;
    setUsers((prev) => prev.map((u) =>
      u.id === editingUser.id ? { ...u, ...data } : u
    ));
    setEditingUser(null);
    setToast(`✓ User ${data.firstName} ${data.lastName} updated`);
    setTimeout(() => setToast(null), 4000);
  };

  const toggleStatus = (id: string) => {
    setUsers((prev) => prev.map((u) =>
      u.id === id ? { ...u, status: u.status === 'Active' ? 'Inactive' : 'Active' } : u
    ));
  };

  return (
    <div className="flex-1 bg-background">
      <Header title="User Management" />

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-2xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground shadow-xl">
          {toast}
        </div>
      )}

      {/* View Profile Modal */}
      {viewingUser && (
        <ViewProfile user={viewingUser} onClose={() => setViewingUser(null)} />
      )}

      {/* Edit Modal */}
      {editingUser && (
        <AddUserModal
          defaultRole={editingUser.role as 'admin' | 'accountant'}
          onSave={handleEditSave}
          onClose={closeModal}
          initialUser={editingUser}
        />
      )}

      {/* Add Modal */}
      {showModal && (
        <AddUserModal defaultRole={addingRole} onSave={handleSave} onClose={closeModal} initialUser={null} />
      )}

      <div className="max-w-6xl mx-auto p-6 space-y-6">

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: 'Total Users', value: allUsers.length,                                       icon: Users,        color: 'text-sky-600 dark:text-sky-400' },
            { label: 'Admins',      value: users.filter((u) => u.role === 'admin').length,         icon: UserCog,      color: 'text-violet-600 dark:text-violet-400' },
            { label: 'Accountants', value: users.filter((u) => u.role === 'accountant').length,    icon: Wallet,       color: 'text-teal-600 dark:text-teal-400' },
            { label: 'Active',      value: users.filter((u) => u.status === 'Active').length,      icon: CheckCircle2, color: 'text-green-600 dark:text-green-400' },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl border border-border bg-card p-5">
              <s.icon className={`h-5 w-5 mb-2 ${s.color}`} />
              <p className="text-2xl font-bold text-foreground">{s.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3">

          {/* Tabs */}
          <div className="flex rounded-xl border border-border overflow-hidden shrink-0">
            {([
              { key: 'all',         label: 'All Users',   icon: Users },
              { key: 'admins',      label: 'Admins',      icon: UserCog },
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

          {/* Search */}
          <div className="relative flex-1 min-w-[160px]">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              placeholder="Search name or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-input bg-input-background py-2.5 pl-10 pr-4 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            className="rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none"
          >
            <option value="all">All Status</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>

          {/* Add buttons */}
          <button onClick={() => openAdd('admin')} className="flex items-center gap-2 rounded-xl bg-sky-600 hover:bg-sky-700 px-4 py-2.5 text-sm font-semibold text-white transition-all active:scale-95">
            <Plus className="h-4 w-4" /> Add Admin
          </button>
          <button onClick={() => openAdd('accountant')} className="flex items-center gap-2 rounded-xl bg-teal-600 hover:bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white transition-all active:scale-95">
            <Plus className="h-4 w-4" /> Add Accountant
          </button>
        </div>

        {/* Context notes */}
        {activeTab === 'admins' && (
          <div className="flex items-center gap-3 rounded-xl border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/30 px-4 py-3">
            <UserCog className="h-4 w-4 text-sky-600 dark:text-sky-400 shrink-0" />
            <p className="text-sm text-sky-700 dark:text-sky-300">
              Admins manage students, fees, attendance, exams, timetable and admissions.
              <span className="ml-1 font-medium">No access to system settings or role management.</span>
            </p>
          </div>
        )}
        {activeTab === 'accountants' && (
          <div className="flex items-center gap-3 rounded-xl border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/30 px-4 py-3">
            <Wallet className="h-4 w-4 text-teal-600 dark:text-teal-400 shrink-0" />
            <p className="text-sm text-teal-700 dark:text-teal-300">
              Accountants manage fees, expenses, inventory and financial reports.
              <span className="ml-1 font-medium">No access to student management or admissions.</span>
            </p>
          </div>
        )}

        {/* Table */}
        <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h2 className="font-semibold text-foreground">
              {activeTab === 'all' ? 'All Users' : activeTab === 'admins' ? 'Admin Accounts' : 'Accountant Accounts'}
              <span className="ml-2 text-sm font-normal text-muted-foreground">({filtered.length})</span>
            </h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-secondary/40">
                  {['User', 'Email', 'Mobile', 'Branch', 'Role', 'Status', 'Actions'].map((h) => (
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
                    onToggle={() => toggleStatus(u.id)}
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
        </div>

      </div>
    </div>
  );
}
