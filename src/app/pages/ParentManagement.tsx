import { useState, useEffect } from 'react';
import { Header } from '../components/Header';
import { useAuth } from '../auth/AuthContext';
import { getBranches, getBranchName, filterByBranch } from '../lib/branchService';
import { Users, Plus, Search, Eye, Edit2, ChevronRight, X, Phone, Mail, UserCheck } from 'lucide-react';

interface Parent {
  id: string;
  branchId?: string;
  firstName: string;
  lastName: string;
  mobile: string;
  email: string;
  occupation: string;
  address: string;
  linkedStudents: string;
  status: 'Active' | 'Inactive';
}

const SEED_PARENTS: Parent[] = [];

const EMPTY: Omit<Parent, 'id'> = {
  branchId: '', firstName: '', lastName: '', mobile: '', email: '',
  occupation: '', address: '', linkedStudents: '', status: 'Active',
};

function ParentForm({ initial, isEdit, onSave, onClose }: {
  initial: Omit<Parent, 'id'>; isEdit: boolean;
  onSave: (d: Omit<Parent, 'id'>) => void; onClose: () => void;
}) {
  const [form, setForm] = useState(initial);
  const set = (k: keyof typeof form, v: string) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-base font-semibold text-foreground">{isEdit ? 'Edit Parent' : 'Add Parent'}</h2>
        <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary"><X className="h-4 w-4" /></button>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[
          { key: 'firstName',      label: 'First Name',       type: 'text',  placeholder: 'e.g. Ravi',             req: true },
          { key: 'lastName',       label: 'Last Name',        type: 'text',  placeholder: 'e.g. Sharma',           req: true },
          { key: 'mobile',         label: 'Mobile',           type: 'tel',   placeholder: 'e.g. 9876543210',       req: true },
          { key: 'email',          label: 'Email',            type: 'email', placeholder: 'e.g.  ravi@email.com',   req: false },
          { key: 'occupation',     label: 'Occupation',       type: 'text',  placeholder: 'e.g. Engineer',         req: false },
          { key: 'linkedStudents', label: 'Linked Students',  type: 'text',  placeholder: 'e.g. STU001, STU002',   req: false },
        ].map(({ key, label, type, placeholder, req }) => (
          <div key={key}>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              {label} {req && <span className="text-destructive">*</span>}
            </label>
            <input
              type={type}
              value={(form as Record<string, string>)[key]}
              onChange={(e) => set(key as keyof typeof form, e.target.value)}
              placeholder={placeholder}
              className="w-full rounded-xl border border-input bg-input-background px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
        ))}
        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-sm font-medium text-foreground">Address</label>
          <input value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="e.g. Bangalore, Karnataka"
            className="w-full rounded-xl border border-input bg-input-background px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-foreground">Status</label>
          <select value={form.status} onChange={(e) => set('status', e.target.value as Parent['status'])}
            className="w-full rounded-xl border border-input bg-input-background px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20">
            <option>Active</option><option>Inactive</option>
          </select>
        </div>
      </div>
      <div className="mt-5 flex gap-3">
        <button onClick={() => onSave(form)} className="rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:opacity-90 active:scale-95">
          {isEdit ? 'Save Changes' : 'Add Parent'}
        </button>
        <button onClick={onClose} className="rounded-xl border border-border px-6 py-2.5 text-sm font-medium transition-colors hover:bg-secondary">Cancel</button>
      </div>
    </div>
  );
}

export function ParentManagement() {
  const { user } = useAuth();
  const branches = getBranches();
  const [parents,  setParents]  = useState<Parent[]>([]);
  const [search,   setSearch]   = useState('');
  const [branchFilter, setBranchFilter] = useState(user?.role === 'super_admin' ? '' : user?.branchId ?? '');
  const [panel,    setPanel]    = useState<'none' | 'add' | { type: 'edit' | 'view'; id: string }>('none');

  const loadParents = async () => {
    try {
      const res = await fetch('/api/parents');
      if (res.ok) {
        const list = await res.json();
        setParents(list);
      }
    } catch (e) {
        console.error('Failed to load parents', e);
        setParents([]);
      }
  };

  useEffect(() => {
    void loadParents();
  }, []);

  const filtered = filterByBranch(parents, user, branchFilter).filter((p) =>
    `${p.firstName} ${p.lastName} ${p.mobile} ${p.linkedStudents}`.toLowerCase().includes(search.toLowerCase())
  );

  const handleAdd  = async (d: Omit<Parent, 'id'>) => {
    // Add via Student API or mock since parent is auto-created during student admission
    setParents((p) => [{ id: `PAR${Date.now()}`, ...d }, ...p]);
    setPanel('none');
  };

  const handleEdit = async (id: string, d: Omit<Parent, 'id'>) => {
    setParents((p) => p.map((x) => x.id === id ? { id, ...d } : x));
    setPanel('none');
  };

  const editParent = panel !== 'none' && typeof panel === 'object' && panel.type === 'edit' ? parents.find((p) => p.id === panel.id) : null;

  return (
    <div className="flex-1 bg-background">
      <Header title="Parent Management" />
      <div className="max-w-6xl mx-auto p-6 space-y-6">

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {[
            { label: 'Total Parents', value: parents.length,                                           color: 'text-foreground' },
            { label: 'Active',        value: parents.filter((p) => p.status === 'Active').length,      color: 'text-green-600 dark:text-green-400' },
            { label: 'Linked',        value: parents.filter((p) => p.linkedStudents).length,           color: 'text-sky-600 dark:text-sky-400' },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl border border-border bg-card px-5 py-4">
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        {panel === 'add'  && <ParentForm initial={EMPTY} isEdit={false} onSave={handleAdd} onClose={() => setPanel('none')} />}
        {editParent       && <ParentForm initial={{ ...editParent }} isEdit onSave={(d) => handleEdit(editParent.id, d)} onClose={() => setPanel('none')} />}

        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input type="search" placeholder="Search by name or mobile…" value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-input bg-input-background py-2.5 pl-10 pr-4 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
          {user?.role === 'super_admin' && (
            <select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)} className="rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none">
              <option value="">All Branches</option>
              {branches.filter((branch) => branch.status === 'Active').map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          )}
          <button onClick={() => setPanel('add')} className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:opacity-90 active:scale-95">
            <Plus className="h-4 w-4" />Add Parent
          </button>
        </div>

        <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-border">
            <h2 className="font-semibold text-foreground">Parent List <span className="ml-2 text-sm font-normal text-muted-foreground">({filtered.length})</span></h2>
          </div>
          <div className="divide-y divide-border">
            {filtered.slice(0, 5).map((p) => (
              <div key={p.id} className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-secondary/30">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/40 text-sm font-bold text-amber-700 dark:text-amber-400">
                  {p.firstName.charAt(0)}{p.lastName.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">{p.firstName} {p.lastName}</p>
                  <p className="text-xs text-muted-foreground">{p.mobile} · {p.linkedStudents}</p>
                </div>
                <span className="hidden sm:inline-block text-xs text-muted-foreground">{p.occupation}</span>
                <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${p.status === 'Active' ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' : 'bg-secondary text-muted-foreground'}`}>
                  {p.status}
                </span>
                <div className="flex gap-1">
                  <button onClick={() => setPanel({ type: 'view', id: p.id })} className="rounded-lg p-1.5 hover:bg-secondary"><Eye className="h-4 w-4 text-primary" /></button>
                  <button onClick={() => setPanel({ type: 'edit', id: p.id })} className="rounded-lg p-1.5 hover:bg-secondary"><Edit2 className="h-4 w-4 text-muted-foreground" /></button>
                </div>
              </div>
            ))}
          </div>
          {filtered.length > 5 && (
            <div className="border-t border-border px-6 py-4">
              <button className="flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                View all {filtered.length} parents <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
          {filtered.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Users className="h-10 w-10 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No parents found</p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
