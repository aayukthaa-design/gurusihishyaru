import { useMemo, useState } from 'react';
import { Header } from '../components/Header';
import { Building2, Plus, Search, Edit2, ToggleLeft, ToggleRight, Trash2, CheckCircle2, XCircle } from 'lucide-react';
import { addBranch, deleteBranch, getBranches, toggleBranchStatus, updateBranch } from '../lib/branchService';
import { useAuth } from '../auth/AuthContext';

interface BranchFormState {
  name: string;
  code: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  contactNumber: string;
  email: string;
  branchHead: string;
  openingDate: string;
  status: 'Active' | 'Inactive';
}

const EMPTY_FORM: BranchFormState = {
  name: '',
  code: '',
  address: '',
  city: '',
  state: '',
  pincode: '',
  contactNumber: '',
  email: '',
  branchHead: '',
  openingDate: '',
  status: 'Active',
};

export function BranchManagement() {
  const { user } = useAuth();
  const [branches, setBranches] = useState(getBranches());
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<BranchFormState>(EMPTY_FORM);
  const [message, setMessage] = useState<string>('');

  const refreshBranches = () => setBranches(getBranches());

  const filteredBranches = useMemo(() => branches.filter((branch) => {
    const query = search.toLowerCase();
    return [branch.name, branch.code, branch.city, branch.email, branch.branchHead].join(' ').toLowerCase().includes(query);
  }), [branches, search]);

  const handleSave = () => {
    if (!form.name || !form.code || !form.address || !form.city || !form.state || !form.pincode || !form.contactNumber || !form.email || !form.branchHead || !form.openingDate) {
      setMessage('Please fill all required branch details.');
      return;
    }

    if (editingId) {
      updateBranch(editingId, { ...form });
      setMessage('Branch updated successfully.');
    } else {
      addBranch({ ...form });
      setMessage('Branch created successfully.');
    }

    setForm(EMPTY_FORM);
    setEditingId(null);
    refreshBranches();
  };

  const startEdit = (branchId: string) => {
    const branch = branches.find((item) => item.id === branchId);
    if (!branch) return;
    setEditingId(branchId);
    setForm({
      name: branch.name,
      code: branch.code,
      address: branch.address,
      city: branch.city,
      state: branch.state,
      pincode: branch.pincode,
      contactNumber: branch.contactNumber,
      email: branch.email,
      branchHead: branch.branchHead,
      openingDate: branch.openingDate,
      status: branch.status,
    });
  };

  const handleToggleStatus = (branchId: string) => {
    toggleBranchStatus(branchId);
    refreshBranches();
  };

  const handleDelete = (branchId: string) => {
    deleteBranch(branchId);
    refreshBranches();
  };

  if (user?.role !== 'super_admin') {
    return <div className="p-6 text-sm text-muted-foreground">Access restricted to the Super Admin.</div>;
  }

  return (
    <div className="flex-1 bg-background">
      <Header title="Branch Management" />
      <div className="mx-auto max-w-7xl space-y-6 p-6">
        {message && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">{message}</div>}

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Branch Directory</p>
                <h2 className="text-lg font-semibold text-foreground">Manage institute branches</h2>
              </div>
              <div className="rounded-full bg-primary/10 p-3 text-primary">
                <Building2 className="h-5 w-5" />
              </div>
            </div>

            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} className="w-full rounded-xl border border-input bg-input-background py-2.5 pl-10 pr-4 text-sm" placeholder="Search branch" />
            </div>

            <div className="space-y-3">
              {filteredBranches.map((branch) => (
                <div key={branch.id} className="rounded-xl border border-border bg-background/70 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{branch.name}</p>
                      <p className="text-xs text-muted-foreground">{branch.code} • {branch.city}</p>
                    </div>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${branch.status === 'Active' ? 'bg-green-100 text-green-700' : 'bg-secondary text-muted-foreground'}`}>
                      {branch.status === 'Active' ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                      {branch.status}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>{branch.address}</span>
                    <span>•</span>
                    <span>{branch.contactNumber}</span>
                    <span>•</span>
                    <span>{branch.email}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button onClick={() => startEdit(branch.id)} className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary"><Edit2 className="h-3.5 w-3.5" /> Edit</button>
                    <button onClick={() => handleToggleStatus(branch.id)} className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary">
                      {branch.status === 'Active' ? <ToggleRight className="h-3.5 w-3.5" /> : <ToggleLeft className="h-3.5 w-3.5" />} {branch.status === 'Active' ? 'Deactivate' : 'Activate'}
                    </button>
                    <button onClick={() => handleDelete(branch.id)} className="flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400"><Trash2 className="h-3.5 w-3.5" /> Delete</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">{editingId ? 'Edit Branch' : 'Create Branch'}</p>
                <h2 className="text-lg font-semibold text-foreground">{editingId ? 'Update branch details' : 'Add a new branch'}</h2>
              </div>
              <button onClick={() => { setEditingId(null); setForm(EMPTY_FORM); }} className="rounded-lg border border-border px-3 py-1.5 text-sm">Reset</button>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {[
                ['name', 'Branch Name'],
                ['code', 'Branch Code'],
                ['address', 'Branch Address'],
                ['city', 'City'],
                ['state', 'State'],
                ['pincode', 'Pincode'],
                ['contactNumber', 'Contact Number'],
                ['email', 'Email'],
                ['branchHead', 'Branch Head'],
                ['openingDate', 'Opening Date'],
              ].map(([key, label]) => (
                <div key={key}>
                  <label className="mb-1.5 block text-sm font-medium text-foreground">{label}</label>
                  <input type={key === 'openingDate' ? 'date' : 'text'} value={form[key as keyof BranchFormState]} onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))} className="w-full rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm" />
                </div>
              ))}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Status</label>
                <select value={form.status} onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value as 'Active' | 'Inactive' }))} className="w-full rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm">
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </div>
            </div>

            <div className="mt-5 flex gap-3">
              <button onClick={handleSave} className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"><Plus className="h-4 w-4" /> {editingId ? 'Save Changes' : 'Create Branch'}</button>
              <button onClick={() => { setEditingId(null); setForm(EMPTY_FORM); }} className="rounded-xl border border-border px-5 py-2.5 text-sm">Cancel</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
