import { useEffect, useState } from 'react';
import { Header } from '../components/Header';
import { useAuth } from '../auth/AuthContext';
import { useBranches } from '../lib/branchService';
import { fetchCasualLeaves, reviewCasualLeave, type CasualLeaveRequest } from '../lib/casualLeaveService';
import { CalendarClock, Check, X } from 'lucide-react';

const STATUS_STYLES: Record<CasualLeaveRequest['status'], string> = {
  Pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
  Approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400',
  Rejected: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
};

export function CasualLeaveManagement() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';
  const branches = useBranches();
  const [branchFilter, setBranchFilter] = useState(isSuperAdmin ? '' : user?.branchId ?? '');
  const [statusFilter, setStatusFilter] = useState('');
  const [requests, setRequests] = useState<CasualLeaveRequest[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = () => {
    fetchCasualLeaves({ branchId: branchFilter || undefined, status: statusFilter || undefined }).then(setRequests);
  };

  useEffect(load, [branchFilter, statusFilter]);

  const handleReview = async (id: number, status: 'Approved' | 'Rejected') => {
    setBusyId(id);
    try {
      await reviewCasualLeave(id, status);
      load();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex-1 bg-background">
      <Header title="Casual Leave" />
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-foreground">
            <CalendarClock className="h-5 w-5 text-primary" /> Leave Requests
          </h2>
          <div className="mb-4 flex flex-wrap gap-3">
            {isSuperAdmin && (
              <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:border-primary focus:outline-none">
                <option value="">All Branches</option>
                {branches.filter((b) => b.status === 'Active').map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            )}
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:border-primary focus:outline-none">
              <option value="">All Statuses</option>
              <option value="Pending">Pending</option>
              <option value="Approved">Approved</option>
              <option value="Rejected">Rejected</option>
            </select>
          </div>

          {requests.length === 0 ? (
            <p className="text-sm text-muted-foreground">No leave requests found.</p>
          ) : (
            <div className="space-y-3">
              {requests.map((r) => (
                <div key={r.id} className="flex items-center justify-between rounded-xl border border-border p-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{r.teacherName}</p>
                    <p className="text-xs text-muted-foreground">{r.startDate} → {r.endDate}</p>
                    {r.reason && <p className="text-xs text-muted-foreground">{r.reason}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLES[r.status]}`}>{r.status}</span>
                    {r.status === 'Pending' && (
                      <>
                        <button type="button" onClick={() => handleReview(r.id, 'Approved')} disabled={busyId === r.id} title="Approve" className="rounded-lg bg-emerald-100 p-1.5 text-emerald-700 hover:bg-emerald-200 disabled:opacity-50 dark:bg-emerald-900/40 dark:text-emerald-400">
                          <Check className="h-4 w-4" />
                        </button>
                        <button type="button" onClick={() => handleReview(r.id, 'Rejected')} disabled={busyId === r.id} title="Reject" className="rounded-lg bg-red-100 p-1.5 text-red-700 hover:bg-red-200 disabled:opacity-50 dark:bg-red-900/40 dark:text-red-400">
                          <X className="h-4 w-4" />
                        </button>
                      </>
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
