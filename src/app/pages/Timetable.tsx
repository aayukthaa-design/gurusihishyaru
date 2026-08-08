import { useEffect, useMemo, useState } from 'react';
import { Header } from '../components/Header';
import { apiFetch } from '../lib/apiClient';
import { useAuth } from '../auth/AuthContext';
import { useTeachers } from '../lib/teacherService';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Button } from '../components/ui/button';
import { Plus, X } from 'lucide-react';
import { formatTime12h } from '../lib/classConstants';
import { useClasses, getClassesForBranch, getClassesForTeacher } from '../lib/classService';
import {
  useTimetable, refreshTimetable, saveTimetableEntry, deleteTimetableEntry,
  sortByTime, displayTimeRange, type TimetableEntry,
} from '../lib/timetableService';
import { addNotification } from '../lib/notificationService';

// Each batch has its own separate timetable now: `className` on a timetable
// entry is the batch's name (classes.className), and entries are scoped to
// exactly one batch at a time via the selector below. Free start/end times
// replace the old fixed 6-slot grid so teachers/admins can set any timing.

const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const SUBJECTS = ['Mathematics', 'Physics', 'Chemistry', 'Biology', 'English', 'History', 'Geography', 'Computer Science', 'Physical Education', 'Kannada', 'Hindi'];

const colors: { [key: string]: string } = {
  Mathematics: 'bg-primary/10 text-primary border-primary',
  Physics: 'bg-accent/10 text-accent border-accent',
  Chemistry: 'bg-chart-3/10 text-chart-3 border-chart-3',
  English: 'bg-chart-4/10 text-chart-4 border-chart-4',
  Biology: 'bg-chart-2/10 text-chart-2 border-chart-2',
  History: 'bg-chart-5/10 text-chart-5 border-chart-5',
  'Physical Education': 'bg-muted text-muted-foreground border-border',
};
const defaultColor = 'bg-secondary/40 text-foreground border-border';

const EMPTY_FORM = { subject: '', teacherId: '', room: '', startTime: '', endTime: '', notes: '' };

export function Timetable() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';
  const isTeacherOnly = user?.role === 'teacher';

  useClasses(); // subscribe so the batch selector stays live
  const batchOptions = isTeacherOnly
    ? getClassesForTeacher(user?.id, user?.branchId)
    : getClassesForBranch(user?.branchId);

  const [selectedClass, setSelectedClass] = useState('');
  useEffect(() => {
    if (!selectedClass && batchOptions.length > 0) setSelectedClass(batchOptions[0].className);
    if (selectedClass && !batchOptions.some((b) => b.className === selectedClass) && batchOptions.length > 0) {
      setSelectedClass(batchOptions[0].className);
    }
  }, [batchOptions, selectedClass]);

  const selectedBatch = batchOptions.find((b) => b.className === selectedClass) || null;
  // A teacher may only edit timetable entries for a batch they're assigned to
  // (the backend enforces this too — this just keeps the UI honest).
  const canEdit = isSuperAdmin || (user?.role === 'admin') || (isTeacherOnly && selectedBatch?.assignedTeacherId === user?.id);

  const [specialClasses, setSpecialClasses] = useState<any[]>([]);
  const entries = useTimetable();
  const [loading, setLoading] = useState(true);
  const teachers = useTeachers();

  const [editSlot, setEditSlot] = useState<{ day: string; entry: TimetableEntry | null } | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedClass) return;
    setLoading(true);
    void refreshTimetable({ className: selectedClass, branchId: selectedBatch?.branchId }).finally(() => setLoading(false));
  }, [selectedClass, selectedBatch?.branchId]);

  useEffect(() => {
    if (!selectedClass) return;
    apiFetch(`/api/special-classes?className=${encodeURIComponent(selectedClass)}`)
      .then((res) => res.json())
      .then((data) => setSpecialClasses(Array.isArray(data) ? data : []))
      .catch((err) => console.error('Failed to load special classes for timetable', err));
  }, [selectedClass]);

  const entriesByDay = useMemo(() => {
    const map: Record<string, TimetableEntry[]> = {};
    for (const day of days) map[day] = sortByTime(entries.filter((e) => e.dayOfWeek === day));
    return map;
  }, [entries]);

  const getSpecialClassesForDay = (dayName: string) => {
    return specialClasses.filter((c) => {
      if (c.status === 'Cancelled') return false;
      const dateObj = new Date(c.date);
      const classDayName = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
      return classDayName === dayName;
    });
  };

  const openSlot = (day: string, entry: TimetableEntry | null) => {
    setEditSlot({ day, entry });
    setError(null);
    setForm(entry
      ? { subject: entry.subject, teacherId: entry.teacherId || '', room: entry.room || '', startTime: entry.startTime || '', endTime: entry.endTime || '', notes: entry.notes || '' }
      : EMPTY_FORM);
  };

  const saveSlot = async () => {
    if (!editSlot || !selectedClass) return;
    if (!form.startTime || !form.endTime) { setError('Start time and end time are required.'); return; }
    // Teachers only ever edit their own batch's timetable (the Teacher select
    // is hidden for them), so the entry's teacher is implicitly themselves.
    const effectiveTeacherId = isTeacherOnly ? user?.id : form.teacherId;
    const teacher = isTeacherOnly ? null : teachers.find((t) => t.id === form.teacherId);
    const result = await saveTimetableEntry({
      className: selectedClass,
      dayOfWeek: editSlot.day,
      startTime: form.startTime,
      endTime: form.endTime,
      subject: form.subject,
      teacherId: effectiveTeacherId || undefined,
      teacherName: isTeacherOnly ? (user?.name || undefined) : (teacher ? `${teacher.firstName} ${teacher.lastName}` : undefined),
      room: form.room,
      notes: form.notes,
      branchId: selectedBatch?.branchId,
    });
    if (!result.success) { setError(result.error ?? 'Failed to save timetable entry.'); return; }
    addNotification({
      title: editSlot.entry ? 'Timetable Edited' : 'Timetable Updated',
      message: `${selectedClass}'s timetable was updated for ${editSlot.day}.`,
      type: 'info', roles: ['teacher', 'admin', 'super_admin'], branchId: selectedBatch?.branchId,
      recipient: 'Teachers', notificationType: 'General Announcement', priority: 'low',
      recipientRole: 'teacher', classNames: [selectedClass],
    });
    setEditSlot(null);
  };

  const clearSlot = async () => {
    if (!editSlot?.entry) return;
    const result = await deleteTimetableEntry(editSlot.entry.id);
    if (!result.success) { setError(result.error ?? 'Failed to delete timetable entry.'); return; }
    setEditSlot(null);
  };

  return (
    <div className="flex-1">
      <Header title="Timetable Management" />

      <div className="p-6 space-y-6">
        <div className="mb-6 flex items-center gap-4">
          <select
            value={selectedClass}
            onChange={(e) => setSelectedClass(e.target.value)}
            className="rounded-lg border border-input bg-input-background px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {batchOptions.length === 0 && <option value="">No batches available</option>}
            {batchOptions.map((b) => <option key={b.id} value={b.className}>{b.className}{b.board ? ` (${b.board})` : ''}</option>)}
          </select>
          <p className="text-xs text-muted-foreground">
            {canEdit ? 'Click any entry to add or edit a class period.' : 'You can view this batch\'s timetable, but only its assigned teacher or an admin can edit it.'}
          </p>
        </div>

        {batchOptions.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            {isTeacherOnly ? 'You have no assigned batches yet.' : 'No batches exist for this branch yet — create one from Batches first.'}
          </div>
        )}

        {selectedClass && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {days.map((day) => (
              <div key={day} className="rounded-xl border border-border bg-card p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-foreground">{day}</h3>
                  {canEdit && (
                    <button onClick={() => openSlot(day, null)} className="rounded-lg p-1 hover:bg-secondary" title="Add period">
                      <Plus className="h-4 w-4 text-muted-foreground" />
                    </button>
                  )}
                </div>

                {entriesByDay[day].map((entry) => (
                  <button
                    key={entry.id}
                    onClick={() => canEdit && openSlot(day, entry)}
                    disabled={!canEdit}
                    className={`w-full rounded-lg border-l-4 p-3 text-left transition-opacity ${canEdit ? 'hover:opacity-80' : 'cursor-default'} ${colors[entry.subject] || defaultColor}`}
                  >
                    <p className="text-xs font-semibold opacity-80">{displayTimeRange(entry)}</p>
                    <p className="text-sm font-medium">{entry.subject || 'Untitled period'}</p>
                    {entry.teacherName && <p className="text-[10px] opacity-80">{entry.teacherName}{entry.room ? ` · ${entry.room}` : ''}</p>}
                    {entry.notes && <p className="text-[10px] opacity-70 italic">{entry.notes}</p>}
                  </button>
                ))}

                {getSpecialClassesForDay(day).map((sc) => (
                  <div key={sc.id} className="rounded-lg border-l-4 border-purple-500 bg-purple-50 dark:bg-purple-950/20 p-2.5 text-xs font-semibold text-purple-700 dark:text-purple-300">
                    <span className="inline-flex rounded-full bg-purple-200 dark:bg-purple-900 px-1.5 py-0.5 text-[9px] uppercase font-extrabold mr-1">Special Class</span>
                    <p className="font-bold line-clamp-1">{sc.title}</p>
                    <p className="text-[10px] text-muted-foreground">{formatTime12h(sc.startTime)} - {formatTime12h(sc.endTime)} ({sc.venue})</p>
                  </div>
                ))}

                {entriesByDay[day].length === 0 && getSpecialClassesForDay(day).length === 0 && (
                  <p className="text-xs text-muted-foreground italic py-2">No periods scheduled.</p>
                )}
              </div>
            ))}
            {loading && <p className="text-sm text-muted-foreground">Loading timetable…</p>}
          </div>
        )}
      </div>

      <Dialog open={!!editSlot} onOpenChange={(open) => !open && setEditSlot(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editSlot?.day} · {selectedClass}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium">Start Time</label>
                <input type="time" className="w-full border rounded px-2 py-1" value={form.startTime} onChange={(e) => setForm((p) => ({ ...p, startTime: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-medium">End Time</label>
                <input type="time" className="w-full border rounded px-2 py-1" value={form.endTime} onChange={(e) => setForm((p) => ({ ...p, endTime: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium">Subject</label>
              <select className="w-full border rounded px-2 py-1" value={form.subject} onChange={(e) => setForm((p) => ({ ...p, subject: e.target.value }))}>
                <option value="">No class (free period)</option>
                {SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            {!isTeacherOnly && (
              <div>
                <label className="block text-sm font-medium">Teacher</label>
                <select className="w-full border rounded px-2 py-1" value={form.teacherId} onChange={(e) => setForm((p) => ({ ...p, teacherId: e.target.value }))}>
                  <option value="">Unassigned</option>
                  {teachers.map((t) => <option key={t.id} value={t.id}>{t.firstName} {t.lastName}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium">Room</label>
              <input className="w-full border rounded px-2 py-1" value={form.room} onChange={(e) => setForm((p) => ({ ...p, room: e.target.value }))} placeholder="e.g. Room 101" />
            </div>
            <div>
              <label className="block text-sm font-medium">Notes</label>
              <textarea className="w-full border rounded px-2 py-1" rows={2} value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} placeholder="Optional notes for this period" />
            </div>
          </div>
          <DialogFooter>
            <div className="flex gap-2">
              {editSlot?.entry && <Button variant="ghost" onClick={clearSlot}><X className="mr-1 h-4 w-4" />Clear Slot</Button>}
              <Button variant="ghost" onClick={() => setEditSlot(null)}>Cancel</Button>
              <Button onClick={saveSlot}>Save</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
