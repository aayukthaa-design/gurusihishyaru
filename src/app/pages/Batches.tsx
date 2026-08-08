import React, { useState } from 'react';
import { Header } from '../components/Header';
import { useAuth } from '../auth/AuthContext';
import { useBranches, getBranchName } from '../lib/branchService';
import { Edit2, Trash2, Plus, Users as UsersIcon, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { addNotification } from '../lib/notificationService';
import { useTeachers, getTeachersForBranch, getTeacherById } from '../lib/teacherService';
import { BOARDS } from '../lib/classConstants';
import { useClasses, addClass, updateClass, deleteClass, type ClassRecord } from '../lib/classService';
import { getStudentsForClass, updateStudentAPI, useStudents, getAllStudents } from '../lib/studentService';

// Replaces the old standalone Class Allocation page: batches ARE the classes
// table now (className free-text batch name, board, teacher, timings). See
// the batch-restructuring plan for why classes/allocations were consolidated
// this way instead of building a parallel batches table.

const EMPTY_FORM = {
  className: '', batchName: '', board: '', description: '', course: '', subject: '',
  assignedTeacherId: '', branchId: '', roomNumber: '', maxStudents: '30',
  startDate: '', endDate: '', classTiming: '', daysOfWeek: [] as string[],
  status: 'Active' as 'Active' | 'Inactive',
};

export function Batches() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';
  const branches = useBranches();
  const allClasses = useClasses();
  useTeachers(); // subscribe so teacher name lookups stay fresh
  useStudents(); // subscribe so the roster below stays fresh after adds

  const [branchFilter, setBranchFilter] = useState(isSuperAdmin ? '' : (user?.branchId ?? ''));

  const visibleBatches = allClasses.filter((c) => c.status !== 'Archived' && (isSuperAdmin ? (!branchFilter || c.branchId === branchFilter) : (!user?.branchId || c.branchId === user.branchId)));

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM, branchId: isSuperAdmin ? branchFilter : (user?.branchId ?? '') });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [studentsBatch, setStudentsBatch] = useState<ClassRecord | null>(null);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [studentError, setStudentError] = useState<string | null>(null);

  function openCreate() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, branchId: isSuperAdmin ? branchFilter : (user?.branchId ?? '') });
    setError(null);
    setFormOpen(true);
  }

  function openEdit(batch: ClassRecord) {
    setEditingId(batch.id);
    setForm({
      className: batch.className, batchName: batch.batchName || '', board: batch.board || '',
      description: batch.description || '', course: batch.course || '', subject: batch.subject || '',
      assignedTeacherId: batch.assignedTeacherId || '', branchId: batch.branchId || '',
      roomNumber: batch.roomNumber || '', maxStudents: String(batch.maxStudents || 30),
      startDate: batch.startDate || '', endDate: batch.endDate || '', classTiming: batch.classTiming || '',
      daysOfWeek: batch.daysOfWeek || [], status: (batch.status === 'Inactive' ? 'Inactive' : 'Active'),
    });
    setError(null);
    setFormOpen(true);
  }

  async function handleSave() {
    if (!form.className.trim()) { setError('Batch name is required.'); return; }
    if (!form.assignedTeacherId) { setError('Assigned teacher is required.'); return; }
    const branchId = isSuperAdmin ? form.branchId : (user?.branchId ?? '');
    if (!branchId) { setError('Branch is required.'); return; }
    setSaving(true);
    setError(null);
    const payload = { ...form, branchId, maxStudents: Number(form.maxStudents || 30) };
    const result = editingId ? await updateClass(editingId, payload) : await addClass(payload);
    setSaving(false);
    if (!result.success) { setError(result.error ?? 'Unable to save batch.'); return; }

    if (editingId) {
      addNotification({
        title: 'Batch Updated',
        message: `${result.class?.className} was updated.`,
        type: 'info', roles: ['teacher', 'admin', 'super_admin'], branchId,
        recipient: 'Teachers', notificationType: 'General Announcement', priority: 'medium',
        recipientRole: 'teacher', classNames: [result.class?.className].filter(Boolean) as string[],
      });
    } else {
      addNotification({
        title: 'Batch Created',
        message: `${result.class?.className} was created${result.class?.subject ? ` for ${result.class.subject}` : ''}.`,
        type: 'info', roles: ['teacher', 'admin', 'super_admin'], branchId,
        recipient: 'Teachers', notificationType: 'General Announcement', priority: 'high',
        recipientRole: 'teacher', classNames: [result.class?.className].filter(Boolean) as string[],
      });
    }
    setFormOpen(false);
  }

  async function handleDelete(batch: ClassRecord) {
    const ok = confirm(`Archive "${batch.className}"? It will be hidden from active lists but its history (students, attendance, timetable) is preserved.`);
    if (!ok) return;
    const result = await deleteClass(batch.id);
    if (!result.success) { alert(result.error ?? 'Unable to delete batch.'); return; }
    addNotification({
      title: 'Batch Archived',
      message: `${batch.className} was archived.`,
      type: 'warning', roles: ['teacher', 'admin', 'super_admin'], branchId: batch.branchId,
      recipient: 'Teachers', notificationType: 'General Announcement', priority: 'medium',
      recipientRole: 'teacher', classNames: [batch.className],
    });
  }

  function openStudents(batch: ClassRecord) {
    setStudentsBatch(batch);
    setSelectedStudentId('');
    setStudentError(null);
  }

  const batchStudents = studentsBatch
    ? getStudentsForClass(studentsBatch.className, studentsBatch.branchId, studentsBatch.board)
    : [];

  // Existing students from the SAME branch who aren't already in this batch —
  // no separate "create new student" form here; assigning just re-points an
  // existing student record's className/batch at this batch (branch-locked,
  // same as the server-side same-branch enforcement on the students API).
  const availableStudents = studentsBatch
    ? getAllStudents().filter((s) => s.branchId === studentsBatch.branchId && s.status !== 'Inactive' && s.className !== studentsBatch.className)
    : [];

  async function handleAssignStudent() {
    if (!studentsBatch || !selectedStudentId) return;
    const student = availableStudents.find((s) => s.id === selectedStudentId);
    if (!student) return;
    setAssigning(true);
    setStudentError(null);
    // PUT /api/students/:id replaces the whole row (no partial-update
    // fallback server-side) — send every existing field back, only
    // overriding className/batch, or every other field gets wiped to NULL
    // (including primaryParentMobile, which would also orphan the parent link).
    const saved = await updateStudentAPI(selectedStudentId, {
      ...student,
      className: studentsBatch.className,
      batch: studentsBatch.board,
    });
    setAssigning(false);
    if (!saved) { setStudentError('Unable to add this student to the batch. Please try again.'); return; }
    addNotification({
      title: 'Student Added to Batch',
      message: `${saved.fullName} was added to ${studentsBatch.className}.`,
      type: 'info', roles: ['teacher', 'parent', 'admin'], branchId: studentsBatch.branchId,
      recipient: 'Teachers', notificationType: 'General Announcement', priority: 'low',
      recipientRole: 'teacher', classNames: [studentsBatch.className], studentIds: [saved.id],
    });
    setSelectedStudentId('');
  }

  async function handleRemoveStudent(student: (typeof batchStudents)[number]) {
    if (!studentsBatch) return;
    const ok = confirm(`Remove ${student.fullName} from ${studentsBatch.className}?`);
    if (!ok) return;
    // Same full-row-replace caveat as handleAssignStudent above.
    const saved = await updateStudentAPI(student.id, { ...student, className: '', batch: '' });
    if (!saved) { setStudentError('Unable to remove this student from the batch. Please try again.'); return; }
    addNotification({
      title: 'Student Removed from Batch',
      message: `${student.fullName} was removed from ${studentsBatch.className}.`,
      type: 'warning', roles: ['teacher', 'parent', 'admin'], branchId: studentsBatch.branchId,
      recipient: 'Teachers', notificationType: 'General Announcement', priority: 'low',
      recipientRole: 'teacher', classNames: [studentsBatch.className], studentIds: [student.id],
    });
  }

  return (
    <div className="space-y-6">
      <Header />

      <div>
        <h1 className="text-2xl font-bold">Batches</h1>
        <p className="text-muted-foreground">Create and manage batches — assign a teacher, set the board and timings, then add students.</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {isSuperAdmin ? (
          <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none">
            <option value="">All Branches</option>
            {branches.filter((b) => b.status === 'Active').map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        ) : <div />}
        <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" />New Batch</Button>
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h2 className="font-semibold text-foreground">
            Batches
            <span className="ml-2 text-sm font-normal text-muted-foreground">({visibleBatches.length})</span>
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-secondary/40">
                {['Batch', 'Board', 'Branch', 'Teacher', 'Timings', 'Status', ''].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visibleBatches.map((b) => {
                const teacher = getTeacherById(b.assignedTeacherId);
                return (
                  <tr key={b.id} className="transition-colors hover:bg-secondary/30">
                    <td className="px-5 py-4">
                      <p className="text-sm font-semibold text-foreground">{b.className}</p>
                      {b.batchName && <p className="text-xs text-muted-foreground">{b.batchName}</p>}
                    </td>
                    <td className="px-5 py-4 text-sm text-muted-foreground">{b.board || '—'}</td>
                    <td className="px-5 py-4 text-sm text-muted-foreground">{getBranchName(b.branchId)}</td>
                    <td className="px-5 py-4 text-sm text-foreground">{teacher?.fullName || '—'}</td>
                    <td className="px-5 py-4 text-sm text-muted-foreground">{b.classTiming || '—'}</td>
                    <td className="px-5 py-4">
                      <span className="inline-flex rounded-full px-2.5 py-1 text-xs font-semibold bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400">{b.status}</span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-1">
                        <button onClick={() => openStudents(b)} className="rounded-lg p-1.5 hover:bg-secondary" title="Manage Students">
                          <UsersIcon className="h-4 w-4 text-muted-foreground" />
                        </button>
                        <button onClick={() => openEdit(b)} className="rounded-lg p-1.5 hover:bg-secondary" title="Edit">
                          <Edit2 className="h-4 w-4 text-muted-foreground" />
                        </button>
                        <button onClick={() => handleDelete(b)} className="rounded-lg p-1.5 hover:bg-secondary" title="Delete">
                          <Trash2 className="h-4 w-4 text-muted-foreground" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {visibleBatches.length === 0 && (
                <tr><td colSpan={7} className="px-5 py-10 text-center text-sm text-muted-foreground">No batches yet. Click "New Batch" to create one.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create / Edit batch */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Batch' : 'New Batch'}</DialogTitle>
          </DialogHeader>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-3">
              <div><label className="mb-1 block text-sm font-medium">Batch Name</label><Input placeholder="e.g. NEET Morning Batch" value={form.className} onChange={(e) => setForm((p) => ({ ...p, className: e.target.value }))} /></div>
              <div><label className="mb-1 block text-sm font-medium">Board</label><select className="w-full rounded-xl border border-input bg-input-background px-3 py-2 text-sm" value={form.board} onChange={(e) => setForm((p) => ({ ...p, board: e.target.value }))}><option value="">Select board</option>{BOARDS.map((b) => <option key={b} value={b}>{b}</option>)}</select></div>
              {isSuperAdmin ? (
                <div><label className="mb-1 block text-sm font-medium">Branch</label><select className="w-full rounded-xl border border-input bg-input-background px-3 py-2 text-sm" value={form.branchId} onChange={(e) => setForm((p) => ({ ...p, branchId: e.target.value, assignedTeacherId: '' }))}><option value="">Select branch</option>{branches.filter((b) => b.status === 'Active').map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
              ) : (
                <div><label className="mb-1 block text-sm font-medium">Branch</label><Input value={getBranchName(user?.branchId)} readOnly /></div>
              )}
              <div><label className="mb-1 block text-sm font-medium">Assigned Teacher</label><select className="w-full rounded-xl border border-input bg-input-background px-3 py-2 text-sm" value={form.assignedTeacherId} onChange={(e) => setForm((p) => ({ ...p, assignedTeacherId: e.target.value }))}><option value="">Select teacher</option>{getTeachersForBranch(form.branchId || undefined).map((t) => <option key={t.id} value={t.id}>{t.fullName}</option>)}</select></div>
              <div><label className="mb-1 block text-sm font-medium">Subject</label><Input value={form.subject} onChange={(e) => setForm((p) => ({ ...p, subject: e.target.value }))} /></div>
              <div><label className="mb-1 block text-sm font-medium">Course</label><Input value={form.course} onChange={(e) => setForm((p) => ({ ...p, course: e.target.value }))} /></div>
            </div>
            <div className="space-y-3">
              <div><label className="mb-1 block text-sm font-medium">Timings</label><Input placeholder="e.g. Mon-Sat, 6:00-8:00 AM" value={form.classTiming} onChange={(e) => setForm((p) => ({ ...p, classTiming: e.target.value }))} /></div>
              <div><label className="mb-1 block text-sm font-medium">Room Number</label><Input value={form.roomNumber} onChange={(e) => setForm((p) => ({ ...p, roomNumber: e.target.value }))} /></div>
              <div><label className="mb-1 block text-sm font-medium">Maximum Students</label><Input type="number" value={form.maxStudents} onChange={(e) => setForm((p) => ({ ...p, maxStudents: e.target.value }))} /></div>
              <div><label className="mb-1 block text-sm font-medium">Status</label><select className="w-full rounded-xl border border-input bg-input-background px-3 py-2 text-sm" value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value as 'Active' | 'Inactive' }))}><option value="Active">Active</option><option value="Inactive">Inactive</option></select></div>
              <div><label className="mb-1 block text-sm font-medium">Description (optional)</label><textarea value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} className="w-full rounded-xl border border-input bg-input-background px-3 py-2 text-sm" rows={3} /></div>
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="ghost" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{editingId ? 'Save Changes' : 'Create Batch'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manage students */}
      <Dialog open={!!studentsBatch} onOpenChange={(open) => { if (!open) setStudentsBatch(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{studentsBatch?.className} — Students</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">{batchStudents.length} student(s) in this batch</p>
            {studentError && <p className="text-sm text-destructive">{studentError}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedStudentId}
                onChange={(e) => setSelectedStudentId(e.target.value)}
                className="flex-1 min-w-[200px] rounded-xl border border-input bg-input-background px-3 py-2 text-sm"
              >
                <option value="">
                  {availableStudents.length === 0 ? `No other students in ${getBranchName(studentsBatch?.branchId)}` : 'Select an existing student…'}
                </option>
                {availableStudents.map((s) => (
                  <option key={s.id} value={s.id}>{s.fullName}{s.className ? ` (currently: ${s.className})` : ''}</option>
                ))}
              </select>
              <Button size="sm" onClick={handleAssignStudent} disabled={!selectedStudentId || assigning}>
                <Plus className="mr-2 h-4 w-4" />Add to Batch
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Only students already enrolled in {getBranchName(studentsBatch?.branchId)} are shown — students can only be added to batches in their own branch.</p>
          </div>

          <div className="max-h-80 overflow-y-auto divide-y divide-border rounded-xl border border-border">
            {batchStudents.map((s) => (
              <div key={s.id} className="flex items-center justify-between px-4 py-2.5">
                <div>
                  <p className="text-sm font-medium text-foreground">{s.fullName}</p>
                  <p className="text-xs text-muted-foreground">Roll #{s.rollNumber || '—'}</p>
                </div>
                <button onClick={() => handleRemoveStudent(s)} className="rounded-lg p-1.5 hover:bg-secondary" title="Remove from batch">
                  <X className="h-4 w-4 text-muted-foreground" />
                </button>
              </div>
            ))}
            {batchStudents.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">No students in this batch yet.</p>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setStudentsBatch(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
