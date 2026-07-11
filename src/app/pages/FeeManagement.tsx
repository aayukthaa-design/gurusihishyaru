import { useMemo, useState } from 'react';
import { Header } from '../components/Header';
import { useAuth } from '../auth/AuthContext';
import { getBranches } from '../lib/branchService';
import { getStudentsByIds } from '../lib/studentService';
import { formatIndianCurrency } from '../lib/currency';
import { Search, CreditCard, ChevronRight, CheckCircle2, Clock, AlertCircle } from 'lucide-react';

const FEE_RECORDS = [
  { id: 'STU001', studentId: 'STU001', branchId: 'branch_rajajinagar', name: 'Alice Johnson',  grade: '10th A', total: 5000,  paid: 5000,  due: '2026-06-15', status: 'Paid' },
  { id: 'STU002', studentId: 'STU002', branchId: 'branch_jayanagar', name: 'Bob Smith',      grade: '9th B',  total: 4500,  paid: 2250,  due: '2026-06-20', status: 'Pending' },
  { id: 'STU003', studentId: 'STU003', branchId: 'branch_rajajinagar', name: 'Carol Davis',    grade: '11th A', total: 5500,  paid: 0,     due: '2026-06-10', status: 'Overdue' },
  { id: 'STU004', studentId: 'STU004', branchId: 'branch_vijayanagar', name: 'David Wilson',   grade: '10th C', total: 5000,  paid: 5000,  due: '2026-06-18', status: 'Paid' },
  { id: 'STU005', studentId: 'STU005', branchId: 'branch_hsr', name: 'Emma Brown',     grade: '12th B', total: 6000,  paid: 3000,  due: '2026-06-25', status: 'Pending' },
  { id: 'STU006', studentId: 'STU006', branchId: 'branch_rajajinagar', name: 'Arjun Sharma',   grade: '10th A', total: 5000,  paid: 5000,  due: '2026-06-15', status: 'Paid' },
  { id: 'STU007', studentId: 'STU007', branchId: 'branch_jayanagar', name: 'Priya Nair',     grade: '9th A',  total: 4500,  paid: 0,     due: '2026-06-05', status: 'Overdue' },
];

const STATUS_CONFIG = {
  Paid:    { icon: CheckCircle2, color: 'text-green-600 dark:text-green-400',  bg: 'bg-green-100 dark:bg-green-900/40' },
  Pending: { icon: Clock,         color: 'text-amber-600 dark:text-amber-400',  bg: 'bg-amber-100 dark:bg-amber-900/40' },
  Overdue: { icon: AlertCircle,   color: 'text-red-600 dark:text-red-400',      bg: 'bg-red-100 dark:bg-red-900/40' },
} as const;

export function FeeManagement() {
  const { user } = useAuth();
  const branches = getBranches();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'All' | 'Paid' | 'Pending' | 'Overdue'>('All');
  const [branchFilter, setBranchFilter] = useState(user?.role === 'super_admin' ? '' : user?.branchId ?? '');
  const [collecting, setCollecting] = useState<string | null>(null);

  const parentLinkedStudentIds = user?.role === 'parent' ? user.linkedStudentIds ?? [] : [];
  const linkedStudentNames = useMemo(
    () => getStudentsByIds(parentLinkedStudentIds).map((student) => student.fullName),
    [parentLinkedStudentIds]
  );

  const filtered = FEE_RECORDS.filter((record) => {
    const matchSearch = record.name.toLowerCase().includes(search.toLowerCase()) || record.id.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === 'All' || record.status === filter;
    const matchesBranch = user?.role === 'super_admin'
      ? (!branchFilter || record.branchId === branchFilter)
      : (!user?.branchId || record.branchId === user.branchId);
    const matchesParent = user?.role === 'parent'
      ? parentLinkedStudentIds.includes(record.studentId)
      : true;
    return matchSearch && matchFilter && matchesBranch && matchesParent;
  });

  const visible = filtered.slice(0, 5);
  const totalPending = filtered.filter((record) => record.status !== 'Paid').reduce((sum, record) => sum + (record.total - record.paid), 0);
  const totalOverdue = filtered.filter((record) => record.status === 'Overdue').length;

  return (
    <div className="flex-1 bg-background">
      <Header title="Fees" />

      <div className="max-w-5xl mx-auto p-6 space-y-6">

        {/* ── 3 Key numbers ── */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-green-100 dark:border-green-900 bg-green-50 dark:bg-green-950/40 p-5">
            <p className="text-2xl font-bold text-green-700 dark:text-green-400">₹8,68,000</p>
            <p className="mt-0.5 text-sm text-muted-foreground">Total Collected</p>
          </div>
          <div className="rounded-2xl border border-amber-100 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 p-5">
            <p className="text-2xl font-bold text-amber-700 dark:text-amber-400">{formatIndianCurrency(totalPending)}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">Pending Fees</p>
          </div>
          <div className="rounded-2xl border border-red-100 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-5">
            <p className="text-2xl font-bold text-red-700 dark:text-red-400">{totalOverdue} students</p>
            <p className="mt-0.5 text-sm text-muted-foreground">Overdue</p>
          </div>
        </div>

        {/* ── Search + Filter ── */}
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              placeholder="Search student name or ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-input bg-input-background py-3 pl-10 pr-4 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          {user?.role === 'super_admin' && (
            <select
              value={branchFilter}
              onChange={(event) => setBranchFilter(event.target.value)}
              className="rounded-xl border border-input bg-input-background px-3 py-3 text-sm focus:border-primary focus:outline-none"
            >
              <option value="">All Branches</option>
              {branches.filter((branch) => branch.status === 'Active').map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          )}
          <div className="flex rounded-xl border border-border overflow-hidden">
            {(['All', 'Paid', 'Pending', 'Overdue'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-4 py-3 text-sm font-medium transition-colors ${
                  filter === f
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-card text-muted-foreground hover:bg-secondary'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* ── Collect Fee modal ── */}
        {collecting && (
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-foreground">Collect Fee</h2>
              <button onClick={() => setCollecting(null)} className="text-sm text-muted-foreground hover:text-foreground">✕</button>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {[
                { label: 'Student ID', value: collecting, readOnly: true },
                { label: 'Amount (₹)', value: '', readOnly: false },
                { label: 'Payment Mode', value: '', readOnly: false, select: ['Cash', 'Online', 'Cheque', 'DD'] },
                { label: 'Receipt No.', value: '', readOnly: false },
              ].map(({ label, value, readOnly, select }) => (
                <div key={label}>
                  <label className="mb-1.5 block text-sm font-medium text-foreground">{label}</label>
                  {select ? (
                    <select className="w-full rounded-xl border border-input bg-input-background px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20">
                      <option value="">Select…</option>
                      {select.map((o) => <option key={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input
                      defaultValue={value}
                      readOnly={readOnly}
                      className={`w-full rounded-xl border border-input px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 ${readOnly ? 'bg-secondary' : 'bg-input-background'}`}
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="mt-4 flex gap-3">
              <button
                onClick={() => setCollecting(null)}
                className="rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:opacity-90"
              >
                Confirm Payment
              </button>
              <button onClick={() => setCollecting(null)} className="rounded-xl border border-border px-6 py-2.5 text-sm font-medium transition-colors hover:bg-secondary">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ── Fee Table ── */}
        {user?.role === 'parent' && (
          <div className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
            Showing fee details for {linkedStudentNames.length > 0 ? linkedStudentNames.join(', ') : 'your linked student'}.
          </div>
        )}
        <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-border">
            <h2 className="font-semibold text-foreground">
              Pending Fees
              <span className="ml-2 text-sm font-normal text-muted-foreground">({filtered.length} records)</span>
            </h2>
          </div>

          <div className="divide-y divide-border">
            {visible.map((r) => {
              const cfg = STATUS_CONFIG[r.status as keyof typeof STATUS_CONFIG];
              const StatusIcon = cfg.icon;
              const pending = r.total - r.paid;
              return (
                <div key={r.id} className="flex items-center gap-4 px-6 py-4 transition-colors hover:bg-secondary/30">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                    {r.name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">{r.name}</p>
                    <p className="text-xs text-muted-foreground">{r.id} · {r.grade}</p>
                  </div>
                  <div className="hidden sm:block text-right mr-4">
                    <p className="text-sm font-semibold text-foreground">{formatIndianCurrency(r.total)}</p>
                    {pending > 0 && <p className="text-xs text-red-500">{formatIndianCurrency(pending)} due</p>}
                  </div>
                  <span className={`hidden sm:inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${cfg.bg} ${cfg.color}`}>
                    <StatusIcon className="h-3 w-3" />
                    {r.status}
                  </span>
                  {r.status !== 'Paid' && (
                    <button
                      onClick={() => setCollecting(r.id)}
                      className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-all hover:opacity-90 active:scale-95"
                    >
                      <CreditCard className="h-3.5 w-3.5" />
                      Collect
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {filtered.length > 5 && (
            <div className="border-t border-border px-6 py-4">
              <button className="flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                View all {filtered.length} records <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}

          {filtered.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <CreditCard className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No records found</p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
