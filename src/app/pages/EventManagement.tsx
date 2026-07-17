import { useEffect, useMemo, useState } from 'react';
import { Header } from '../components/Header';
import { useAuth } from '../auth/AuthContext';
import { CalendarDays, Users, MapPin, Plus, Edit2, Trash2, X, Loader2 } from 'lucide-react';
import { subscribeExams } from '../lib/examService';
import { useEvents, refreshEvents, createEventAPI, updateEventAPI, deleteEventAPI, EventRecord } from '../lib/eventService';

const EVENT_TYPES = ['Sports', 'Academic', 'Meeting', 'Cultural', 'Other'];

const colors: Record<string, string> = {
  Sports: 'bg-chart-3 text-white',
  Academic: 'bg-primary text-white',
  Meeting: 'bg-chart-4 text-white',
  Cultural: 'bg-accent text-white',
  Other: 'bg-secondary text-foreground',
};

const EMPTY_FORM = { title: '', description: '', eventType: 'Other', date: '', time: '', venue: '', expectedAttendees: 0 };

export function EventManagement() {
  const { user } = useAuth();
  const events = useEvents();
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  const [examEvents, setExamEvents] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<'none' | 'create' | { type: 'view' | 'edit'; id: number }>('none');
  const [form, setForm] = useState(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const unsub = subscribeExams((items) => {
      const mapped = items.map((ex: any) => ({ id: `exam-${ex.id}`, title: `${ex.name} (${ex.subject})`, date: ex.date, time: '', venue: ex.className, expectedAttendees: 0, eventType: 'Academic', isExam: true }));
      setExamEvents(mapped);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!user) return;
    setIsLoading(true);
    refreshEvents(user).finally(() => setIsLoading(false));
  }, [user]);

  const combined = useMemo(() => {
    return [...events, ...examEvents].sort((a, b) => a.date.localeCompare(b.date));
  }, [events, examEvents]);

  function openCreate() {
    setForm(EMPTY_FORM);
    setPanel('create');
  }

  function openEdit(event: EventRecord) {
    setForm({
      title: event.title,
      description: event.description || '',
      eventType: event.eventType || 'Other',
      date: event.date,
      time: event.time || '',
      venue: event.venue || '',
      expectedAttendees: event.expectedAttendees || 0,
    });
    setPanel({ type: 'edit', id: event.id });
  }

  async function handleSave() {
    if (!form.title.trim() || !form.date) {
      setError('Title and date are required.');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      if (panel !== 'none' && panel !== 'create' && panel.type === 'edit') {
        await updateEventAPI(panel.id, form, user);
      } else {
        await createEventAPI(form, user);
      }
      setPanel('none');
    } catch (err: any) {
      setError(err.message || 'Failed to save event.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(id: number) {
    if (!window.confirm('Cancel/delete this event?')) return;
    try {
      await deleteEventAPI(id, user);
    } catch (err: any) {
      setError(err.message || 'Failed to delete event.');
    }
  }

  return (
    <div className="flex-1">
      <Header title="Event Management" />

      <div className="p-6 space-y-6">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
            {error}
          </div>
        )}

        {isAdmin && (
          <div className="mb-6">
            <button
              onClick={openCreate}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground transition-all hover:opacity-90"
            >
              <Plus className="h-4 w-4" />
              Create New Event
            </button>
          </div>
        )}

        {panel !== 'none' && (
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-foreground">
                {panel !== 'create' && panel.type === 'edit' ? 'Edit Event' : 'Create Event'}
              </h2>
              <button onClick={() => setPanel('none')} className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
                <span className="font-medium text-foreground">Title</span>
                <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary" />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium text-foreground">Type</span>
                <select value={form.eventType} onChange={(e) => setForm((f) => ({ ...f, eventType: e.target.value }))}
                  className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary">
                  {EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium text-foreground">Expected Attendees</span>
                <input type="number" min={0} value={form.expectedAttendees} onChange={(e) => setForm((f) => ({ ...f, expectedAttendees: Number(e.target.value) }))}
                  className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary" />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium text-foreground">Date</span>
                <input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                  className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary" />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium text-foreground">Time</span>
                <input type="time" value={form.time} onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))}
                  className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary" />
              </label>
              <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
                <span className="font-medium text-foreground">Venue</span>
                <input value={form.venue} onChange={(e) => setForm((f) => ({ ...f, venue: e.target.value }))}
                  className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary" />
              </label>
              <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
                <span className="font-medium text-foreground">Description (optional)</span>
                <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2}
                  className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary" />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-3">
              <button onClick={() => setPanel('none')} className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium hover:bg-secondary">Cancel</button>
              <button onClick={handleSave} disabled={isSaving} className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
                {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                Save Event
              </button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading events…
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {combined.length === 0 && (
              <p className="text-sm text-muted-foreground py-6 text-center col-span-2">No events scheduled yet.</p>
            )}
            {combined.map((event: any) => (
              <div key={event.id} className="rounded-xl border border-border bg-card p-6 transition-all duration-200 hover:shadow-lg">
                <div className="mb-4 flex items-start justify-between">
                  <h3 className="text-xl font-semibold text-card-foreground">{event.title}</h3>
                  <span className={`rounded-full px-3 py-1 text-xs font-medium ${colors[event.eventType] || colors.Other}`}>
                    {event.eventType}
                  </span>
                </div>
                <div className="space-y-2 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <CalendarDays className="h-4 w-4" />
                    <span>{event.date} {event.time ? `at ${event.time}` : ''}</span>
                  </div>
                  {event.venue && (
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4" />
                      <span>{event.venue}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    <span>{event.expectedAttendees || 0} expected attendees</span>
                  </div>
                </div>
                {isAdmin && !event.isExam && (
                  <div className="mt-4 flex gap-2">
                    <button onClick={() => openEdit(event)} className="flex items-center gap-1 rounded-lg border border-border bg-secondary px-3 py-1.5 text-xs transition-colors hover:bg-muted">
                      <Edit2 className="h-3.5 w-3.5" /> Edit Event
                    </button>
                    <button onClick={() => handleDelete(event.id)} className="flex items-center gap-1 rounded-lg border border-border bg-secondary px-3 py-1.5 text-xs text-red-600 transition-colors hover:bg-muted">
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
