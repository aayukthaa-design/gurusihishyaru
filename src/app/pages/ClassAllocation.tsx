import React, { useState } from 'react';
import { Header } from '../components/Header';
import { useAuth } from '../auth/AuthContext';
import { getBranches } from '../lib/branchService';
import { Edit2, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Button } from '../components/ui/button';
import { addNotification } from '../lib/notificationService';
import { updateAllocationAPI, removeAllocationAPI } from '../lib/api';

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

const TEACHERS = [
  { id: 'TCH001', name: 'Kavitha Rao', subjects: ['Mathematics'] },
  { id: 'TCH002', name: 'Ramesh Kumar', subjects: ['Physics', 'Chemistry'] },
  { id: 'TCH003', name: 'Sunita Patil', subjects: ['English'] },
  { id: 'TCH004', name: 'Mahesh Gowda', subjects: ['Biology'] },
  { id: 'TCH005', name: 'Anjali Singh', subjects: ['Computer Science'] },
];
const CLASSES = ['8th A', '8th B', '9th A', '9th B', '10th A', '10th B', '10th C', '11th A', '11th B', '12th A', '12th B'];
const BATCHES = ['Batch A', 'Batch B', 'Batch C', 'Morning', 'Evening'];
const ALL_SUBJECTS = ['Mathematics', 'Physics', 'Chemistry', 'Biology', 'English', 'History', 'Computer Science', 'Physical Education', 'Kannada', 'Hindi'];

// No demo allocations - keep allocations empty until real data is imported
const SEED: Allocation[] = [];

export function ClassAllocation() {
  const { user } = useAuth();
  const branches = getBranches();
  const [allocations, setAllocations] = useState<Allocation[]>(SEED);
  const [branchFilter, setBranchFilter] = useState(user?.role === 'super_admin' ? '' : user?.branchId ?? '');
  const [editOpen, setEditOpen] = useState(false);
  const [selected, setSelected] = useState<Allocation | null>(null);
  const visibleAllocations = allocations.filter((allocation) => user?.role === 'super_admin' ? (!branchFilter || allocation.branchId === branchFilter) : (!user?.branchId || allocation.branchId === user.branchId));

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

    // Optimistic update of UI
    setAllocations((prev) => prev.map((a) => (a.id === selected.id ? selected : a)));

    const ok = await updateAllocationAPI(selected);
      if (ok) {
        addNotification({ title: 'Allocation Updated', message: `Allocation ${selected.id} updated on server`, type: 'success', classNames: [selected.class], teacherIds: [selected.teacherId], roles: ['teacher'] });
      } else {
        addNotification({ title: 'Allocation Updated (Local)', message: `Allocation ${selected.id} updated locally (no server)`, type: 'warning', classNames: [selected.class], teacherIds: [selected.teacherId], roles: ['teacher'] });
      }
      addNotification({ title: `Allocation changed for ${selected.teacherName}`, message: `Your allocation for ${selected.class} - ${selected.subject} (${selected.batch}) was updated.`, type: 'info', classNames: [selected.class], teacherIds: [selected.teacherId], roles: ['teacher'] });

    setEditOpen(false);
  }

  async function removeAllocation(id: string) {
    const ok = confirm('Remove this allocation? This will mark it as Removed.');
    if (!ok) return;
    const removed = allocations.find((a) => a.id === id) || null;

    // Soft-delete: set status to Removed
    setAllocations((prev) => prev.map((a) => (a.id === id ? { ...a, status: 'Removed' } : a)));

    const backendOk = await removeAllocationAPI(id);
      if (backendOk) {
        addNotification({ title: 'Allocation Removed', message: `Allocation ${removed.id} removed on server`, type: 'warning', classNames: [removed.class], teacherIds: [removed.teacherId], roles: ['teacher'] });
      } else {
        addNotification({ title: 'Allocation Removed (Local)', message: `Allocation ${removed.id} marked Removed locally`, type: 'warning', classNames: [removed.class], teacherIds: [removed.teacherId], roles: ['teacher'] });
      }
      if (removed) {
        addNotification({ title: `Allocation removed for ${removed.teacherName}`, message: `Your allocation for ${removed.class} - ${removed.subject} (${removed.batch}) was removed.`, type: 'info', classNames: [removed.class], teacherIds: [removed.teacherId], roles: ['teacher'] });
    }
  }

  return (
    <div className="space-y-6">
      <Header />

      <div>
        <h1 className="text-2xl font-bold">Class Allocation</h1>
        <p className="text-muted-foreground">Assign and manage teachers for classes, subjects and batches.</p>
      </div>

      {user?.role === 'super_admin' && (
        <div className="flex justify-end">
          <select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)} className="rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none">
            <option value="">All Branches</option>
            {branches.filter((branch) => branch.status === 'Active').map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
        </div>
      )}

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
                  const t = TEACHERS.find((x) => x.id === id);
                  handleChange('teacherId', id);
                  handleChange('teacherName', t ? t.name : '');
                }}>
                  {TEACHERS.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
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
    </div>
  );
}
