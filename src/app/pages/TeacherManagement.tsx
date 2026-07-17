import { useEffect, useState } from 'react';
import { Header } from '../components/Header';
import { useAuth } from '../auth/AuthContext';
import { getBranches, getBranchName, filterByBranch } from '../lib/branchService';
import {
  BookOpen, Plus, Search, Eye, Edit2, ChevronRight, X,
  Phone, Mail, Award, GraduationCap,
} from 'lucide-react';
import { apiFetch } from '../lib/apiClient';
import { createStore, useStoreValue } from '../lib/store';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Teacher {
  branchId?: string;
  id: string;
  firstName: string;
  lastName: string;
  mobile: string;
  email: string;
  qualification: string;
  experience: string;
  subjects: string;
  department?: string;
  salaryType: 'Monthly Fixed' | 'Per Class';
  salaryAmount: number;
  monthlySalary?: number;
  salaryPerClass?: number;
  status: 'Active' | 'Inactive';
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SUBJECTS = ['Mathematics', 'Physics', 'Chemistry', 'Biology', 'English', 'History', 'Geography', 'Computer Science', 'Physical Education', 'Kannada', 'Hindi'];

export const SEED_TEACHERS: Teacher[] = [];

const teacherProfileStore = createStore<Teacher[]>(SEED_TEACHERS);

export async function refreshTeacherProfiles(branchId?: string): Promise<Teacher[]> {
  try {
    const res = await apiFetch(`/api/teachers${branchId ? `?branchId=${encodeURIComponent(branchId)}` : ''}`);
    if (res.ok) {
      const data = await res.json();
      const mapped = Array.isArray(data) ? data : [];
      teacherProfileStore.setState(mapped);
      return mapped;
    }
  } catch (err) {
    console.error('Failed to fetch teacher profiles:', err);
  }
  return teacherProfileStore.getState();
}

// Initial load
void refreshTeacherProfiles();

export function getTeacherProfiles(): Teacher[] {
  return teacherProfileStore.getState();
}

export function useTeacherProfiles(): Teacher[] {
  return useStoreValue(teacherProfileStore);
}

const EMPTY: Omit<Teacher, 'id'> = {
  branchId: '',
  firstName: '', lastName: '', mobile: '', email: '',
  qualification: '', experience: '', subjects: '', department: '', salaryType: 'Monthly Fixed', salaryAmount: 0, monthlySalary: 0, salaryPerClass: 0, status: 'Active',
};

// ─── Form ─────────────────────────────────────────────────────────────────────

function TeacherForm({
  initial, isEdit, onSave, onClose, branchOptions, defaultBranchId,
}: {
  initial: Omit<Teacher, 'id'>;
  isEdit: boolean;
  onSave: (d: Omit<Teacher, 'id'>) => void;
  onClose: () => void;
  branchOptions: Array<{ id: string; name: string }>;
  defaultBranchId?: string;
}) {
  const { user } = useAuth();
  const [form, setForm] = useState(initial);
  useEffect(() => {
    setForm(initial);
  }, [initial]);

  const set = <K extends keyof typeof form>(k: K, v: typeof form[K]) => setForm((p) => ({ ...p, [k]: v }));

  const isSalaryEditable = (user?.role === 'admin' || user?.role === 'super_admin');

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            {isEdit ? 'Edit Teacher' : 'Add New Teacher'}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">Fields marked with * are required</p>
        </div>
        <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className="field-label">First Name <span className="text-destructive">*</span></label>
          <input value={form.firstName} onChange={(e) => set('firstName', e.target.value)} placeholder="e.g. Kavitha" className="field" />
        </div>
        <div>
          <label className="field-label">Last Name <span className="text-destructive">*</span></label>
          <input value={form.lastName} onChange={(e) => set('lastName', e.target.value)} placeholder="e.g. Rao" className="field" />
        </div>
        <div>
          <label className="field-label">Mobile Number <span className="text-destructive">*</span></label>
          <input type="tel" value={form.mobile} onChange={(e) => set('mobile', e.target.value)} placeholder="e.g. 9876543210" className="field" />
        </div>
        <div>
          <label className="field-label">Email Address <span className="text-destructive">*</span></label>
          <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="e.g. teacher@tutorials.com" className="field" />
        </div>
        <div>
          <label className="field-label">Qualification <span className="text-destructive">*</span></label>
          <input value={form.qualification} onChange={(e) => set('qualification', e.target.value)} placeholder="e.g. M.Sc Mathematics" className="field" />
        </div>
        <div>
          <label className="field-label">Experience</label>
          <input value={form.experience} onChange={(e) => set('experience', e.target.value)} placeholder="e.g. 5 years" className="field" />
        </div>
        <div className="sm:col-span-2">
          <label className="field-label">Subjects <span className="text-destructive">*</span></label>
          <select value={form.subjects} onChange={(e) => set('subjects', e.target.value)} className="field">
            <option value="">Select subject…</option>
            {SUBJECTS.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label">Department</label>
          <input value={form.department || ''} onChange={(e) => set('department', e.target.value)} placeholder="e.g. Mathematics" className="field" />
        </div>
        <div>
          <label className="field-label">Assigned Branch</label>
          <select value={form.branchId || defaultBranchId || ''} onChange={(e) => set('branchId', e.target.value)} className="field">
            <option value="">All branches</option>
            {branchOptions.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
        </div>
        {isSalaryEditable && (
          <>
            <div>
              <label className="field-label">Salary Type</label>
              <select value={form.salaryType} onChange={(e) => set('salaryType', e.target.value as Teacher['salaryType'])} className="field">
                <option value="Monthly Fixed">Monthly Fixed</option>
                <option value="Per Class">Per Class</option>
              </select>
            </div>
            <div>
              <label className="field-label">{form.salaryType === 'Per Class' ? 'Salary Per Class (₹)' : 'Monthly Salary (₹)'} <span className="text-destructive">*</span></label>
              <input
                type="number"
                value={form.salaryType === 'Per Class' ? (form.salaryPerClass ?? form.salaryAmount ?? '') : (form.monthlySalary ?? form.salaryAmount ?? '')}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  if (form.salaryType === 'Per Class') {
                    set('salaryPerClass', value);
                  } else {
                    set('monthlySalary', value);
                  }
                  set('salaryAmount', value);
                }}
                placeholder={form.salaryType === 'Per Class' ? 'e.g. 500' : 'e.g. 35000'}
                className="field"
              />
            </div>
          </>
        )}
        <div>
          <label className="field-label">Status</label>
          <select value={form.status} onChange={(e) => set('status', e.target.value as Teacher['status'])} className="field">
            <option>Active</option><option>Inactive</option>
          </select>
        </div>
      </div>

      <div className="mt-5 flex gap-3">
        <button onClick={() => onSave(form)} className="rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:opacity-90 active:scale-95">
          {isEdit ? 'Save Changes' : 'Add Teacher'}
        </button>
        <button onClick={onClose} className="rounded-xl border border-border px-6 py-2.5 text-sm font-medium transition-colors hover:bg-secondary">
          Cancel
        </button>
      </div>

      <style>{`
        .field-label { display:block; font-size:0.875rem; font-weight:500; color:var(--foreground); margin-bottom:0.375rem; }
        .field { width:100%; border-radius:0.75rem; border:1px solid var(--input); background:var(--input-background); padding:0.625rem 1rem; font-size:0.875rem; color:var(--foreground); outline:none; }
        .field:focus { border-color:var(--primary); box-shadow:0 0 0 2px color-mix(in srgb,var(--primary) 20%,transparent); }
      `}</style>
    </div>
  );
}

// ─── Profile ──────────────────────────────────────────────────────────────────

function TeacherProfile({ teacher, onClose }: { teacher: Teacher; onClose: () => void }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="flex items-start justify-between mb-5">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-green-100 dark:bg-green-900/40 text-xl font-bold text-green-700 dark:text-green-400">
            {teacher.firstName.charAt(0)}{teacher.lastName.charAt(0)}
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground">{teacher.firstName} {teacher.lastName}</h2>
            <p className="text-sm text-muted-foreground">{teacher.id} · {teacher.subjects}</p>
          </div>
        </div>
        <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[
          { icon: Phone,        label: 'Mobile',        value: teacher.mobile },
          { icon: Mail,         label: 'Email',         value: teacher.email },
          { icon: GraduationCap,label: 'Qualification', value: teacher.qualification },
          { icon: Award,        label: 'Experience',    value: teacher.experience },
          { icon: BookOpen,     label: 'Subjects',      value: teacher.subjects },
        ].map(({ icon: Icon, label, value }) => (
          <div key={label} className="rounded-xl border border-border bg-secondary/50 p-4">
            <div className="flex items-center gap-2 mb-1">
              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">{label}</p>
            </div>
            <p className="text-sm font-semibold text-foreground">{value || '—'}</p>
          </div>
        ))}
        <div className="rounded-xl border border-border bg-secondary/50 p-4">
          <p className="text-xs text-muted-foreground mb-1">Branch</p>
          <p className="text-sm font-semibold text-foreground">{getBranchName(teacher.branchId)}</p>
        </div>
        <div className="rounded-xl border border-border bg-secondary/50 p-4">
          <p className="text-xs text-muted-foreground mb-1">Salary Configuration</p>
          <p className="text-sm font-semibold text-foreground">{teacher.salaryType} - ₹{teacher.salaryAmount}</p>
          {teacher.department && <p className="text-xs text-muted-foreground mt-1">Department: {teacher.department}</p>}
        </div>
        <div className="rounded-xl border border-border bg-secondary/50 p-4">
          <p className="text-xs text-muted-foreground mb-1">Status</p>
          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
            teacher.status === 'Active'
              ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
              : 'bg-secondary text-muted-foreground'
          }`}>{teacher.status}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function TeacherManagement() {
  const { user } = useAuth();
  const branches = getBranches();
  const teachers = useTeacherProfiles();
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState(user?.role === 'super_admin' ? '' : user?.branchId ?? '');
  const [panel, setPanel] = useState<'none' | 'add' | { type: 'edit' | 'view'; id: string }>('none');
  const [formError, setFormError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    void refreshTeacherProfiles(user?.role === 'super_admin' ? branchFilter || undefined : user?.branchId);
  }, [user?.role, user?.branchId, branchFilter]);

  const filtered = filterByBranch(teachers, user, branchFilter).filter((teacher) => {
    const matchesSearch = `${teacher.firstName} ${teacher.lastName} ${teacher.subjects} ${teacher.email}`.toLowerCase().includes(search.toLowerCase());
    return matchesSearch;
  });

  const handleAdd = async (data: Omit<Teacher, 'id'>) => {
    if (!data.firstName.trim() || !data.mobile.trim()) {
      setFormError('First name and mobile are required.');
      return;
    }
    const resolvedBranchId = data.branchId || user?.branchId || branchFilter || undefined;
    const res = await apiFetch('/api/teachers', {
      method: 'POST',
      body: { ...data, branchId: resolvedBranchId },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setFormError(err.error || 'Unable to create teacher.');
      return;
    }
    setFormError(null);
    await refreshTeacherProfiles(user?.role === 'super_admin' ? branchFilter || undefined : user?.branchId);
    setPanel('none');
  };
  const handleEdit = async (id: string, data: Omit<Teacher, 'id'>) => {
    const res = await apiFetch(`/api/teachers/${id}`, {
      method: 'PUT',
      body: data,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setFormError(err.error || 'Unable to update teacher.');
      return;
    }
    setFormError(null);
    await refreshTeacherProfiles(user?.role === 'super_admin' ? branchFilter || undefined : user?.branchId);
    setPanel('none');
  };

  const editTeacher = panel !== 'none' && typeof panel === 'object' && panel.type === 'edit'
    ? teachers.find((t) => t.id === panel.id) : null;
  const viewTeacher = panel !== 'none' && typeof panel === 'object' && panel.type === 'view'
    ? teachers.find((t) => t.id === panel.id) : null;

  return (
    <div className="flex-1 bg-background">
      <Header title="Teacher Management" />

      <div className="max-w-6xl mx-auto p-6 space-y-6">

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: 'Total',    value: teachers.length,                                              color: 'text-foreground' },
            { label: 'Active',   value: teachers.filter((t) => t.status === 'Active').length,         color: 'text-green-600 dark:text-green-400' },
            { label: 'Inactive', value: teachers.filter((t) => t.status === 'Inactive').length,       color: 'text-muted-foreground' },
            { label: 'Subjects', value: SUBJECTS.length,                                              color: 'text-sky-600 dark:text-sky-400' },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl border border-border bg-card px-5 py-4">
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Panel */}
        {formError && (panel === 'add' || editTeacher) && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/8 px-4 py-3 text-sm text-destructive">{formError}</div>
        )}
        {panel === 'add' && <TeacherForm initial={EMPTY} isEdit={false} onSave={handleAdd} onClose={() => { setPanel('none'); setFormError(null); }} branchOptions={branches.filter((branch) => branch.status === 'Active').map(({ id, name }) => ({ id, name }))} defaultBranchId={user?.role === 'super_admin' ? branchFilter || user?.branchId : user?.branchId} />}
        {editTeacher && <TeacherForm initial={{ ...editTeacher, branchId: editTeacher.branchId || '' }} isEdit onSave={(data) => handleEdit(editTeacher.id, data)} onClose={() => { setPanel('none'); setFormError(null); }} branchOptions={branches.filter((branch) => branch.status === 'Active').map(({ id, name }) => ({ id, name }))} defaultBranchId={editTeacher.branchId || (user?.role === 'super_admin' ? branchFilter || user?.branchId : user?.branchId)} />}
        {viewTeacher      && <TeacherProfile teacher={viewTeacher} onClose={() => setPanel('none')} />}

        {/* Toolbar */}
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              placeholder="Search by name, subject, email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-input bg-input-background py-2.5 pl-10 pr-4 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          {user?.role === 'super_admin' && (
            <select
              value={branchFilter}
              onChange={(event) => setBranchFilter(event.target.value)}
              className="rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none"
            >
              <option value="">All Branches</option>
              {branches.filter((branch) => branch.status === 'Active').map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          )}
          <button
            onClick={() => setPanel('add')}
            className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:opacity-90 active:scale-95"
          >
            <Plus className="h-4 w-4" />
            Add Teacher
          </button>
        </div>

        {/* Table */}
        <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-border">
            <h2 className="font-semibold text-foreground">
              Teacher List
              <span className="ml-2 text-sm font-normal text-muted-foreground">({filtered.length} teachers)</span>
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-secondary/40">
                  {['Teacher', 'Mobile', 'Email', 'Subjects', 'Experience', 'Status', ''].map((h) => (
                    <th key={h} className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.slice(0, showAll ? filtered.length : 5).map((t) => (
                  <tr key={t.id} className="transition-colors hover:bg-secondary/30">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/40 text-xs font-bold text-green-700 dark:text-green-400">
                          {t.firstName.charAt(0)}{t.lastName.charAt(0)}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-foreground">{t.firstName} {t.lastName}</p>
                          <p className="text-xs text-muted-foreground">{t.id}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-sm text-muted-foreground">{t.mobile}</td>
                    <td className="px-5 py-4 text-sm text-muted-foreground">{t.email}</td>
                    <td className="px-5 py-4 text-sm text-foreground">{t.subjects}</td>
                    <td className="px-5 py-4 text-sm text-muted-foreground">{t.experience}</td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                        t.status === 'Active'
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
                          : 'bg-secondary text-muted-foreground'
                      }`}>{t.status}</span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-1">
                        <button onClick={() => setPanel({ type: 'view', id: t.id })} className="rounded-lg p-1.5 hover:bg-secondary" title="View">
                          <Eye className="h-4 w-4 text-primary" />
                        </button>
                        <button onClick={() => setPanel({ type: 'edit', id: t.id })} className="rounded-lg p-1.5 hover:bg-secondary" title="Edit">
                          <Edit2 className="h-4 w-4 text-muted-foreground" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length > 5 && (
            <div className="border-t border-border px-6 py-4">
              <button onClick={() => setShowAll((v) => !v)} className="flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                {showAll ? 'Show less' : `View all ${filtered.length} teachers`} <ChevronRight className={`h-4 w-4 transition-transform ${showAll ? 'rotate-90' : ''}`} />
              </button>
            </div>
          )}
          {filtered.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <BookOpen className="h-10 w-10 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No teachers found</p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}


