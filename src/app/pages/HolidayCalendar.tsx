import { useEffect, useState } from 'react';
import { Header } from '../components/Header';
import { useAuth } from '../auth/AuthContext';
import { useBranches } from '../lib/branchService';
import { useHolidays, refreshHolidays, createHoliday, deleteHoliday } from '../lib/holidayService';
import { CalendarOff, Plus, Trash2 } from 'lucide-react';

export function HolidayCalendarPage() {
  const { user } = useAuth();
  const branches = useBranches();
  const holidays = useHolidays();
  const [branchFilter, setBranchFilter] = useState(user?.role === 'super_admin' ? '' : user?.branchId ?? '');
  const [date, setDate] = useState('');
  const [title, setTitle] = useState('');
  const [scope, setScope] = useState<'branch' | 'institute'>('branch');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refreshHolidays({ branchId: branchFilter || undefined });
  }, [branchFilter]);

  const handleAdd = async () => {
    if (!date || !title.trim()) {
      setError('Date and title are required.');
      return;
    }
    setIsSaving(true);
    setError(null);
    const created = await createHoliday({
      date,
      title: title.trim(),
      branchId: user?.role === 'super_admin' && scope === 'institute' ? null : (branchFilter || user?.branchId),
    });
    setIsSaving(false);
    if (created) {
      setDate('');
      setTitle('');
    } else {
      setError('Failed to add holiday.');
    }
  };

  const handleDelete = async (id: number) => {
    await deleteHoliday(id);
  };

  const upcoming = [...holidays].sort((a, b) => a.date.localeCompare(b.date));
  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex-1 bg-background">
      <Header title="Holiday Calendar" />
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-foreground">Add a Holiday</h2>

          {user?.role === 'super_admin' && (
            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium text-foreground">Branch</label>
              <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="w-full rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none">
                <option value="">All Branches</option>
                {branches.filter((b) => b.status === 'Active').map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Date</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Title</label>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Independence Day" className="w-full rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none" />
            </div>
          </div>

          {user?.role === 'super_admin' && (
            <div className="mt-3 flex gap-4">
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input type="radio" checked={scope === 'branch'} onChange={() => setScope('branch')} /> This branch only
              </label>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input type="radio" checked={scope === 'institute'} onChange={() => setScope('institute')} /> Institute-wide (all branches)
              </label>
            </div>
          )}

          {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

          <button
            onClick={handleAdd}
            disabled={isSaving}
            className="mt-4 flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:opacity-90 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            {isSaving ? 'Saving...' : 'Add Holiday'}
          </button>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-foreground">Holidays</h2>
          {upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6 border border-dashed border-border rounded-2xl">No holidays declared yet.</p>
          ) : (
            <div className="space-y-2">
              {upcoming.map((h) => (
                <div key={h.id} className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 ${h.date >= todayIso ? 'border-border bg-secondary/30' : 'border-border/50 bg-secondary/10 opacity-70'}`}>
                  <div className="flex items-center gap-3">
                    <CalendarOff className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-foreground">{h.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(h.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                        {' · '}{h.branchId ? 'This branch' : 'Institute-wide'}
                      </p>
                    </div>
                  </div>
                  <button onClick={() => handleDelete(h.id)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary hover:text-red-500" title="Delete">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
