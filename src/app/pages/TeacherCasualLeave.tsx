import { useEffect, useState } from 'react';
import { Header } from '../components/Header';
import { useAuth } from '../auth/AuthContext';
import { fetchCasualLeaves, requestCasualLeave, cancelCasualLeave, type CasualLeaveRequest } from '../lib/casualLeaveService';
import { CalendarClock, X } from 'lucide-react';

const STATUS_STYLES: Record<CasualLeaveRequest['status'], string> = {
  Pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
  Approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400',
  Rejected: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
};

export function TeacherCasualLeave() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<CasualLeaveRequest[]>([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    if (!user) return;
    fetchCasualLeaves({ teacherId: user.id }).then(setRequests);
  };

  useEffect(load, [user]);

  const handleSubmit = async () => {
    if (!startDate || !endDate) {
      setError('Start date and end date are required.');
      return;
    }
    if (endDate < startDate) {
      setError('End date cannot be before start date.');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await requestCasualLeave({ startDate, endDate, reason: reason.trim() });
      setStartDate('');
      setEndDate('');
      setReason('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit leave request.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = async (id: number) => {
    await cancelCasualLeave(id);
    load();
  };

  return (
    <div className="flex-1 bg-background">
      <Header title="Casual Leave" />
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-foreground">
            <CalendarClock className="h-5 w-5 text-primary" /> Request Leave
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Start Date</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">End Date</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none" />
            </div>
          </div>
          <div className="mt-3">
            <label className="mb-1.5 block text-sm font-medium text-foreground">Reason</label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Reason for leave (optional)" className="w-full rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none" />
          </div>
          {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
          <button type="button" onClick={handleSubmit} disabled={isSaving} className="mt-4 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50">
            {isSaving ? 'Submitting...' : 'Submit Request'}
          </button>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-foreground">My Requests</h2>
          {requests.length === 0 ? (
            <p className="text-sm text-muted-foreground">No leave requests yet.</p>
          ) : (
            <div className="space-y-3">
              {requests.map((r) => (
                <div key={r.id} className="flex items-center justify-between rounded-xl border border-border p-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{r.startDate} → {r.endDate}</p>
                    {r.reason && <p className="text-xs text-muted-foreground">{r.reason}</p>}
                    {r.status !== 'Pending' && r.reviewedBy && (
                      <p className="text-xs text-muted-foreground">Reviewed by {r.reviewedBy}{r.reviewRemarks ? ` — ${r.reviewRemarks}` : ''}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLES[r.status]}`}>{r.status}</span>
                    {r.status === 'Pending' && (
                      <button type="button" onClick={() => handleCancel(r.id)} title="Withdraw request" className="text-muted-foreground hover:text-red-500">
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
