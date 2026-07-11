import React, { useEffect, useState } from 'react';
import { Header } from '../components/Header';
import { useAuth } from '../auth/AuthContext';
import { getBranches } from '../lib/branchService';
import { Edit2, Trash2, Plus } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Button } from '../components/ui/button';
import { addNotification } from '../lib/notificationService';
import { apiFetch } from '../lib/apiClient';
import { useTeacherProfiles, refreshTeacherProfiles } from './TeacherManagement';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Allocation {
  id: string;
  branchId?: string;
  teacherName: string;
  teacherId: string;
  class: string;
  subject: string;
  batch: string;
  students: number;
  weeklyHours: number;
  status: 'Assigned' | 'Pending' | 'Removed';
}

const CLASSES = ['8th A', '8th B', '9th A', '9th B', '10th A', '10th B', '10th C', '11th A', '11th B', '12th A', '12th B'];
const BATCHES = ['Batch A', 'Batch B', 'Batch C', 'Morning', 'Evening'];
const ALL_SUBJECTS = ['Mathematics', 'Physics', 'Chemistry', 'Biology', 'English', 'History', 'Computer Science', 'Physical Education', 'Kannada', 'Hindi'];

const EMPTY_FORM = { teacherId: '', teacherName: '', class: CLASSES[0], subject: ALL_SUBJECTS[0], batch: BATCHES[0], students: 0, weeklyHours: 0 };

export function ClassAllocation() {
  const { user } = useAuth();
  const branches = getBranches();
  const teachers = useTeacherProfiles();
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [branchFilter, setBranchFilter] = useState(user?.role === 'super_admin' ? '' : user?.branchId ?? '');
  const [editOpen, setEditOpen] = useState(false);
  const [selected, setSelected] = useState<Allocation | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_FORM);
  const visibleAllocations = allocations.filter((allocation) => user?.role === 'super_admin' ? (!branchFilter || allocation.branchId === branchFilter) : (!user?.branchId || allocation.branchId === user.branchId));

  const loadAllocations = async () => {
    setLoading(true);
    try {
      const scopedBranch = user?.role === 'super_admin' ? branchFilter : user?.branchId;
      const res = await apiFetch(`/api/allocations/all${scopedBranch ? `?branchId=${encodeURIComponent(scopedBranch)}` : ''}`);
      if (res.ok) {
        const data = await res.json();
        setAllocations(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Failed to load allocations', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAllocations();
    void refreshTeacherProfiles(user?.role === 'super_admin' ? branchFilter || undefined : user?.branchId);
  }, [user?.role, user?.branchId, branchFilter]);

  const openEdit = (alloc: Allocation) => {
    setSelected({ ...alloc });
    setEditOpen(true);
  };

  function handleChange(field: keyof Allocation, value: any) {
    if (!selected) return;
    setSelected({ ...selected, [field]: value });
  }

  async function saveChanges() {
    if (!selected) return;
    try {
      const res = await apiFetch(`/api/allocations/${selected.id}`, {
        method: 'PUT',
        body: { teacherId: selected.teacherId, class: selected.class, subject: selected.subject, batch: selected.batch, students: selected.students, weeklyHours: selected.weeklyHours },
      });
      if (res.ok) {
        await loadAllocations();
        addNotification({ title: 'Allocation Updated', message: `Allocation for ${selected.teacherName} updated`, type: 'success', classNames: [selected.class], teacherIds: [selected.teacherId], roles: ['teacher'] });
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Failed to update allocation.');
      }
    } catch (err) {
      console.error(err);
    }
    setEditOpen(false);
  }

  async function removeAllocation(id: string) {
    const ok = confirm('Remove this allocation? This will mark it as Removed.');
    if (!ok) return;
    const removed = allocations.find((a) => a.id === id) || null;
    try {
      const res = await apiFetch(`/api/allocations/${id}`, { method: 'DELETE' });
      if (res.ok) {
        await loadAllocations();
        if (removed) {
          addNotification({ title: 'Allocation Removed', message: `Allocation for ${removed.teacherName} removed`, type: 'warning', classNames: [removed.class], teacherIds: [removed.teacherId], roles: ['teacher'] });
        }
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function createAllocation() {
    if (!addForm.teacherId) {
      alert('Please select a teacher.');
      return;
    }
    const teacher = teachers.find((t) => t.id === addForm.teacherId);
    try {
      const res = await apiFetch('/api/allocations', {
        method: 'POST',
        body: {
          teacherId: addForm.teacherId,
          class: addForm.class,
          subject: addForm.subject,
          batch: addForm.batch,
          students: addForm.students,
          weeklyHours: addForm.weeklyHours,
          branchId: user?.role === 'super_admin' ? (branchFilter || undefined) : user?.branchId,
        },
      });
      if (res.ok) {
        await loadAllocations();
        setAddOpen(false);
        setAddForm(EMPTY_FORM);
        addNotification({
          title: 'New Class Allocation',
          message: `${teacher ? `${teacher.firstName} ${teacher.lastName}` : 'Teacher'} assigned to ${addForm.class} - ${addForm.subject} (${addForm.batch})`,
          type: 'info', classNames: [addForm.class], teacherIds: [addForm.teacherId], roles: ['teacher'],
        });
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Failed to create allocation.');
      }
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div className="space-y-6">
      <Header />

      <div>
        <h1 className="text-2xl font-bold">Class Allocation</h1>
        <p className="text-muted-foreground">Assign and manage teachers for classes, subjects and batches.</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {user?.role === 'super_admin' ? (
          <select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)} className="rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none">
            <option value="">All Branches</option>
            {branches.filter((branch) => branch.status === 'Active').map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
        ) : <div />}
        <Button onClick={() => setAddOpen(true)}><Plus className="mr-2 h-4 w-4" />New Allocation</Button>
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h2 className="font-semibold text-foreground">
            Class Allocations
            <span className="ml-2 text-sm font-normal text-muted-foreground">({visibleAllocations.length} allocations)</span>
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-secondary/40">
                {['Teacher', 'Class', 'Subject', 'Batch', 'Students', 'Hours', 'Status', ''].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visibleAllocations.map((a) => (
                <tr key={a.id} className={`transition-colors hover:bg-secondary/30 ${a.status === 'Removed' ? 'opacity-60 line-through' : ''}`}>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/40 text-xs font-bold text-green-700 dark:text-green-400">{a.teacherName.charAt(0)}</div>
                      <div>
                        <p className="text-sm font-semibold text-foreground">{a.teacherName}</p>
                        <p className="text-xs text-muted-foreground">{a.id}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-sm text-muted-foreground">{a.class}</td>
                  <td className="px-5 py-4 text-sm text-foreground">{a.subject}</td>
                  <td className="px-5 py-4 text-sm text-muted-foreground">{a.batch}</td>
                  <td className="px-5 py-4 text-sm text-muted-foreground">{a.students}</td>
                  <td className="px-5 py-4 text-sm text-muted-foreground">{a.weeklyHours}</td>
                  <td className="px-5 py-4">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                      a.status === 'Assigned' ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' :
                      a.status === 'Pending' ? 'bg-secondary text-muted-foreground' :
                      'bg-destructive/10 text-destructive'
                    }`}>{a.status}</span>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-1">
                      <button onClick={() => openEdit(a)} className="rounded-lg p-1.5 hover:bg-secondary" title="Edit">
                        <Edit2 className="h-4 w-4 text-muted-foreground" />
                      </button>
                      <button onClick={() => removeAllocation(a.id)} className="rounded-lg p-1.5 hover:bg-secondary" title="Remove">
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && visibleAllocations.length === 0 && (
                <tr><td colSpan={8} className="px-5 py-10 text-center text-sm text-muted-foreground">No class allocations yet. Click "New Allocation" to assign a teacher to a class.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Allocation</DialogTitle>
          </DialogHeader>

          {selected && (
            <div className="space-y-4 mt-2">
              <div>
                <label className="block text-sm font-medium">Teacher</label>
                <select className="w-full border rounded px-2 py-1" value={selected.teacherId} onChange={(e) => {
                  const id = e.target.value;
                  const t = teachers.find((x) => x.id === id);
                  handleChange('teacherId', id);
                  handleChange('teacherName', t ? `${t.firstName} ${t.lastName}` : '');
                }}>
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>{t.firstName} {t.lastName}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium">Class</label>
                <select className="w-full border rounded px-2 py-1" value={selected.class} onChange={(e) => handleChange('class', e.target.value)}>
                  {CLASSES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium">Subject</label>
                <select className="w-full border rounded px-2 py-1" value={selected.subject} onChange={(e) => handleChange('subject', e.target.value)}>
                  {ALL_SUBJECTS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium">Batch</label>
                <select className="w-full border rounded px-2 py-1" value={selected.batch} onChange={(e) => handleChange('batch', e.target.value)}>
                  {BATCHES.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium">Students</label>
                  <input type="number" className="w-full border rounded px-2 py-1" value={selected.students} onChange={(e) => handleChange('students', Number(e.target.value))} />
                </div>
                <div>
                  <label className="block text-sm font-medium">Weekly Hours</label>
                  <input type="number" className="w-full border rounded px-2 py-1" value={selected.weeklyHours} onChange={(e) => handleChange('weeklyHours', Number(e.target.value))} />
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button onClick={saveChanges}>Save Changes</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Class Allocation</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            <div>
              <label className="block text-sm font-medium">Teacher</label>
              <select className="w-full border rounded px-2 py-1" value={addForm.teacherId} onChange={(e) => setAddForm((p) => ({ ...p, teacherId: e.target.value }))}>
                <option value="">Select teacher…</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>{t.firstName} {t.lastName}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium">Class</label>
              <select className="w-full border rounded px-2 py-1" value={addForm.class} onChange={(e) => setAddForm((p) => ({ ...p, class: e.target.value }))}>
                {CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium">Subject</label>
              <select className="w-full border rounded px-2 py-1" value={addForm.subject} onChange={(e) => setAddForm((p) => ({ ...p, subject: e.target.value }))}>
                {ALL_SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium">Batch</label>
              <select className="w-full border rounded px-2 py-1" value={addForm.batch} onChange={(e) => setAddForm((p) => ({ ...p, batch: e.target.value }))}>
                {BATCHES.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium">Students</label>
                <input type="number" className="w-full border rounded px-2 py-1" value={addForm.students} onChange={(e) => setAddForm((p) => ({ ...p, students: Number(e.target.value) }))} />
              </div>
              <div>
                <label className="block text-sm font-medium">Weekly Hours</label>
                <input type="number" className="w-full border rounded px-2 py-1" value={addForm.weeklyHours} onChange={(e) => setAddForm((p) => ({ ...p, weeklyHours: Number(e.target.value) }))} />
              </div>
            </div>
          </div>

          <DialogFooter>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button onClick={createAllocation}>Create Allocation</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
