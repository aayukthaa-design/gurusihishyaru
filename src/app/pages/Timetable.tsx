import { useEffect, useState } from 'react';
import { Header } from '../components/Header';
import { apiFetch } from '../lib/apiClient';
import { useTeacherProfiles } from './TeacherManagement';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Button } from '../components/ui/button';
import { X } from 'lucide-react';
import { GRADES } from '../lib/classConstants';

const CLASSES = GRADES;
const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const periods = ['08:00-09:00', '09:00-10:00', '10:00-11:00', '11:30-12:30', '12:30-01:30', '02:00-03:00'];
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

interface TimetableEntry {
  id: number;
  className: string;
  dayOfWeek: string;
  period: string;
  subject: string;
  teacherId: string | null;
  teacherName: string | null;
  room: string;
}

const EMPTY_FORM = { subject: '', teacherId: '', room: '' };

export function Timetable() {
  const [selectedClass, setSelectedClass] = useState('10th A');
  const [specialClasses, setSpecialClasses] = useState<any[]>([]);
  const [entries, setEntries] = useState<TimetableEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const teachers = useTeacherProfiles();

  const [editSlot, setEditSlot] = useState<{ day: string; period: string; entry: TimetableEntry | null } | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const loadTimetable = async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/timetable?className=${encodeURIComponent(selectedClass)}`);
      if (res.ok) {
        const data = await res.json();
        setEntries(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Failed to load timetable', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTimetable();
  }, [selectedClass]);

  useEffect(() => {
    apiFetch(`/api/special-classes?className=${selectedClass}`)
      .then((res) => res.json())
      .then((data) => setSpecialClasses(Array.isArray(data) ? data : []))
      .catch((err) => console.error('Failed to load special classes for timetable', err));
  }, [selectedClass]);

  const getSpecialClassesForDayAndPeriod = (dayName: string, periodString: string) => {
    const [pStart, pEnd] = periodString.split('-');
    return specialClasses.filter((c) => {
      if (c.status === 'Cancelled') return false;
      const dateObj = new Date(c.date);
      const classDayName = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
      if (classDayName !== dayName) return false;
      return c.startTime >= pStart && c.startTime < pEnd;
    });
  };

  const getEntry = (day: string, period: string) => entries.find((e) => e.dayOfWeek === day && e.period === period) || null;

  const openSlot = (day: string, period: string) => {
    const entry = getEntry(day, period);
    setEditSlot({ day, period, entry });
    setForm(entry ? { subject: entry.subject, teacherId: entry.teacherId || '', room: entry.room || '' } : EMPTY_FORM);
  };

  const saveSlot = async () => {
    if (!editSlot) return;
    const teacher = teachers.find((t) => t.id === form.teacherId);
    try {
      const res = await apiFetch('/api/timetable', {
        method: 'POST',
        body: {
          className: selectedClass,
          dayOfWeek: editSlot.day,
          period: editSlot.period,
          subject: form.subject,
          teacherId: form.teacherId || undefined,
          teacherName: teacher ? `${teacher.firstName} ${teacher.lastName}` : undefined,
          room: form.room,
        },
      });
      if (res.ok) {
        await loadTimetable();
        setEditSlot(null);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Failed to save timetable entry.');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const clearSlot = async () => {
    if (!editSlot?.entry) return;
    try {
      const res = await apiFetch(`/api/timetable/${editSlot.entry.id}`, { method: 'DELETE' });
      if (res.ok) {
        await loadTimetable();
        setEditSlot(null);
      }
    } catch (err) {
      console.error(err);
    }
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
            {CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <p className="text-xs text-muted-foreground">Click any period to add or edit a class.</p>
        </div>

        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full">
            <thead className="border-b border-border bg-muted">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Time</th>
                {days.map((day) => (
                  <th key={day} className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">
                    {day}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {periods.map((period) => (
                <tr key={period} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-4 text-sm font-medium text-card-foreground">{period}</td>
                  {days.map((day) => {
                    const entry = getEntry(day, period);
                    return (
                      <td key={day} className="px-4 py-4 space-y-2">
                        <button
                          onClick={() => openSlot(day, period)}
                          className={`w-full rounded-lg border-l-4 p-3 text-left transition-opacity hover:opacity-80 ${
                            entry?.subject ? (colors[entry.subject] || defaultColor) : 'border-dashed border-border text-muted-foreground'
                          }`}
                        >
                          <p className="text-sm font-medium">{entry?.subject || '+ Add'}</p>
                          {entry?.teacherName && <p className="text-[10px] opacity-80">{entry.teacherName}{entry.room ? ` · ${entry.room}` : ''}</p>}
                        </button>

                        {getSpecialClassesForDayAndPeriod(day, period).map((sc) => (
                          <div key={sc.id} className="rounded-lg border-l-4 border-purple-500 bg-purple-50 dark:bg-purple-950/20 p-2.5 text-xs font-semibold text-purple-700 dark:text-purple-300">
                            <span className="inline-flex rounded-full bg-purple-200 dark:bg-purple-900 px-1.5 py-0.5 text-[9px] uppercase font-extrabold mr-1">Special Class</span>
                            <p className="font-bold line-clamp-1">{sc.title}</p>
                            <p className="text-[10px] text-muted-foreground">{sc.startTime} - {sc.endTime} ({sc.venue})</p>
                          </div>
                        ))}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {loading && (
                <tr><td colSpan={days.length + 1} className="px-4 py-6 text-center text-sm text-muted-foreground">Loading timetable...</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Weekend or Extra Hours Special Classes List */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-4">
          <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full bg-purple-500"></span>
            Special & Weekend Classes Scheduled ({selectedClass})
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {specialClasses.filter(c => c.status !== 'Cancelled').map((c) => (
              <div key={c.id} className="p-4 rounded-xl border border-purple-100 dark:border-purple-900/60 bg-purple-50/20 dark:bg-purple-950/5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="inline-flex rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 px-2 py-0.5 text-xs font-semibold">
                    {c.subject} · {c.purpose}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{c.status}</span>
                </div>
                <h4 className="text-sm font-bold text-foreground line-clamp-1">{c.title}</h4>
                <p className="text-xs text-muted-foreground">{c.date} · {c.startTime} - {c.endTime} · {c.venue}</p>
                <p className="text-xs text-muted-foreground font-semibold">Teacher: {c.teacherName}</p>
              </div>
            ))}
            {specialClasses.filter(c => c.status !== 'Cancelled').length === 0 && (
              <p className="text-xs text-muted-foreground italic py-2">No special classes scheduled for this section.</p>
            )}
          </div>
        </div>

      </div>

      <Dialog open={!!editSlot} onOpenChange={(open) => !open && setEditSlot(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editSlot?.day} · {editSlot?.period} · {selectedClass}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <label className="block text-sm font-medium">Subject</label>
              <select className="w-full border rounded px-2 py-1" value={form.subject} onChange={(e) => setForm((p) => ({ ...p, subject: e.target.value }))}>
                <option value="">No class (free period)</option>
                {SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium">Teacher</label>
              <select className="w-full border rounded px-2 py-1" value={form.teacherId} onChange={(e) => setForm((p) => ({ ...p, teacherId: e.target.value }))}>
                <option value="">Unassigned</option>
                {teachers.map((t) => <option key={t.id} value={t.id}>{t.firstName} {t.lastName}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium">Room</label>
              <input className="w-full border rounded px-2 py-1" value={form.room} onChange={(e) => setForm((p) => ({ ...p, room: e.target.value }))} placeholder="e.g. Room 101" />
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
