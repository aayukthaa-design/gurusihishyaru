import { useEffect, useMemo, useState } from 'react';
import { Header } from '../components/Header';
import { useAuth } from '../auth/AuthContext';
import { getBranches } from '../lib/branchService';
import { formatIndianCurrency } from '../lib/currency';
import { useStudents, refreshStudents } from '../lib/studentService';
import {
  useFeeRecords,
  refreshFeeRecords,
  useFeeStructures,
  refreshFeeStructures,
  createFeeStructureAPI,
  generateFeeRecordsAPI,
  recordFeePaymentAPI,
  fetchFeeStats,
  FeeStats,
  FeeRecord,
} from '../lib/feeService';
import { Search, CreditCard, ChevronRight, CheckCircle2, Clock, AlertCircle, Loader2, Settings2, Plus, UserPlus } from 'lucide-react';

const STATUS_CONFIG = {
  Paid:            { icon: CheckCircle2, color: 'text-green-600 dark:text-green-400',  bg: 'bg-green-100 dark:bg-green-900/40' },
  'Partially Paid': { icon: Clock,         color: 'text-sky-600 dark:text-sky-400',      bg: 'bg-sky-100 dark:bg-sky-900/40' },
  Pending:         { icon: Clock,         color: 'text-amber-600 dark:text-amber-400',  bg: 'bg-amber-100 dark:bg-amber-900/40' },
  Overdue:         { icon: AlertCircle,   color: 'text-red-600 dark:text-red-400',      bg: 'bg-red-100 dark:bg-red-900/40' },
} as const;

const CLASS_OPTIONS = ['8th A', '8th B', '9th A', '9th B', '10th A', '10th B', '10th C', '11th A', '11th B', '12th A', '12th B'];
const FEE_TYPES = ['Tuition', 'Admission', 'Exam', 'Transport', 'Other'];
const PAYMENT_MODES = ['Cash', 'UPI', 'Card', 'Bank Transfer', 'Cheque'];

export function FeeManagement() {
  const { user } = useAuth();
  const branches = getBranches();
  const isAccountantOrAdmin = user?.role === 'accountant' || user?.role === 'admin' || user?.role === 'super_admin';

  const records = useFeeRecords();
  const structures = useFeeStructures();
  const students = useStudents();
  const [stats, setStats] = useState<FeeStats>({ totalCollected: 0, totalPending: 0, overdueCount: 0, paidCount: 0, totalRecords: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'All' | 'Paid' | 'Pending' | 'Overdue'>('All');
  const [branchFilter, setBranchFilter] = useState(user?.role === 'super_admin' ? '' : user?.branchId ?? '');
  const [showAll, setShowAll] = useState(false);

  const [collecting, setCollecting] = useState<FeeRecord | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMode, setPaymentMode] = useState(PAYMENT_MODES[0]);
  const [referenceNumber, setReferenceNumber] = useState('');
  const [isPaying, setIsPaying] = useState(false);

  const [showSetup, setShowSetup] = useState(false);
  const [structureForm, setStructureForm] = useState({ className: CLASS_OPTIONS[0], feeType: FEE_TYPES[0], amount: '', dueDate: '', academicYear: '' });
  const [isCreatingStructure, setIsCreatingStructure] = useState(false);
  const [isGenerating, setIsGenerating] = useState<number | null>(null);

  function loadAll() {
    setIsLoading(true);
    Promise.all([
      refreshFeeRecords(user),
      isAccountantOrAdmin ? refreshFeeStructures(user) : Promise.resolve([]),
      isAccountantOrAdmin ? fetchFeeStats(user) : Promise.resolve(null),
      isAccountantOrAdmin ? refreshStudents() : Promise.resolve([]),
    ]).then(([, , statsResult]) => {
      if (statsResult) setStats(statsResult);
    }).finally(() => setIsLoading(false));
  }

  useEffect(() => {
    if (user) loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const filtered = useMemo(() => records.filter((record) => {
    const matchSearch = record.studentName.toLowerCase().includes(search.toLowerCase()) || record.studentId.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === 'All' || record.status === filter || (filter === 'Pending' && record.status === 'Partially Paid');
    const matchesBranch = user?.role === 'super_admin' ? (!branchFilter || record.branchId === branchFilter) : true;
    return matchSearch && matchFilter && matchesBranch;
  }), [records, search, filter, branchFilter, user?.role]);

  const visible = filtered.slice(0, showAll ? filtered.length : 5);

  // Admitted students who don't have a single fee record yet — either no fee
  // structure exists for their class, or one was added after they were
  // admitted and "Generate for class" hasn't been re-run.
  const studentsWithoutFees = useMemo(() => {
    const recordedStudentIds = new Set(records.map((r) => r.studentId));
    return students.filter((s) => {
      if (s.status !== 'Active') return false;
      if (recordedStudentIds.has(s.id)) return false;
      if (user?.role === 'super_admin' && branchFilter) return s.branchId === branchFilter;
      return true;
    });
  }, [students, records, branchFilter, user?.role]);

  async function handleCreateStructure(e: React.FormEvent) {
    e.preventDefault();
    if (!structureForm.amount || !structureForm.dueDate) {
      setError('Amount and due date are required.');
      return;
    }
    setIsCreatingStructure(true);
    setError(null);
    try {
      await createFeeStructureAPI({
        className: structureForm.className,
        feeType: structureForm.feeType,
        amount: Number(structureForm.amount),
        dueDate: structureForm.dueDate,
        academicYear: structureForm.academicYear || new Date().getFullYear().toString(),
      }, user);
      setSuccess('Fee structure created. Use "Generate for class" below to create records for students.');
      setStructureForm({ className: CLASS_OPTIONS[0], feeType: FEE_TYPES[0], amount: '', dueDate: '', academicYear: '' });
    } catch (err: any) {
      setError(err.message || 'Failed to create fee structure.');
    } finally {
      setIsCreatingStructure(false);
    }
  }

  async function handleGenerate(structureId: number) {
    setIsGenerating(structureId);
    setError(null);
    try {
      const result = await generateFeeRecordsAPI(structureId, user);
      setSuccess(`Created ${result.createdCount} fee record(s)${result.skippedCount ? `, skipped ${result.skippedCount} already existing` : ''}.`);
      const statsResult = await fetchFeeStats(user);
      setStats(statsResult);
    } catch (err: any) {
      setError(err.message || 'Failed to generate fee records.');
    } finally {
      setIsGenerating(null);
    }
  }

  async function handleConfirmPayment() {
    if (!collecting) return;
    const amount = Number(paymentAmount);
    if (!amount || amount <= 0) {
      setError('Enter a valid payment amount.');
      return;
    }
    setIsPaying(true);
    setError(null);
    try {
      const result = await recordFeePaymentAPI(collecting.id, amount, paymentMode, referenceNumber, user);
      setSuccess(`Payment recorded. Receipt: ${result.receiptNumber}`);
      const statsResult = await fetchFeeStats(user);
      setStats(statsResult);
      setCollecting(null);
      setPaymentAmount('');
      setReferenceNumber('');
    } catch (err: any) {
      setError(err.message || 'Payment failed.');
    } finally {
      setIsPaying(false);
    }
  }

  return (
    <div className="flex-1 bg-background">
      <Header title="Fees" />

      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
            {error}
          </div>
        )}
        {success && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-400">
            {success}
          </div>
        )}

        {isAccountantOrAdmin && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-green-100 dark:border-green-900 bg-green-50 dark:bg-green-950/40 p-5">
              <p className="text-2xl font-bold text-green-700 dark:text-green-400">{formatIndianCurrency(stats.totalCollected)}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">Total Collected</p>
            </div>
            <div className="rounded-2xl border border-amber-100 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 p-5">
              <p className="text-2xl font-bold text-amber-700 dark:text-amber-400">{formatIndianCurrency(stats.totalPending)}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">Pending Fees</p>
            </div>
            <div className="rounded-2xl border border-red-100 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-5">
              <p className="text-2xl font-bold text-red-700 dark:text-red-400">{stats.overdueCount} students</p>
              <p className="mt-0.5 text-sm text-muted-foreground">Overdue</p>
            </div>
          </div>
        )}

        {isAccountantOrAdmin && (
          <div className="rounded-2xl border border-border bg-card shadow-sm">
            <button onClick={() => setShowSetup((v) => !v)} className="flex w-full items-center justify-between px-6 py-4">
              <div className="flex items-center gap-2">
                <Settings2 className="h-4 w-4 text-muted-foreground" />
                <span className="font-semibold text-foreground">Set Up Fee Structures</span>
              </div>
              <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${showSetup ? 'rotate-90' : ''}`} />
            </button>
            {showSetup && (
              <div className="border-t border-border p-6 space-y-6">
                <form onSubmit={handleCreateStructure} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5 items-end">
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className="font-medium text-foreground">Class</span>
                    <select value={structureForm.className} onChange={(e) => setStructureForm((f) => ({ ...f, className: e.target.value }))}
                      className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary">
                      {CLASS_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className="font-medium text-foreground">Fee Type</span>
                    <select value={structureForm.feeType} onChange={(e) => setStructureForm((f) => ({ ...f, feeType: e.target.value }))}
                      className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary">
                      {FEE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className="font-medium text-foreground">Amount (₹)</span>
                    <input type="number" min={0} value={structureForm.amount} onChange={(e) => setStructureForm((f) => ({ ...f, amount: e.target.value }))}
                      className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary" />
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className="font-medium text-foreground">Due Date</span>
                    <input type="date" value={structureForm.dueDate} onChange={(e) => setStructureForm((f) => ({ ...f, dueDate: e.target.value }))}
                      className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary" />
                  </label>
                  <button type="submit" disabled={isCreatingStructure} className="flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
                    {isCreatingStructure ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    Add Structure
                  </button>
                </form>

                <div className="space-y-2">
                  {structures.length === 0 && <p className="text-sm text-muted-foreground">No fee structures yet.</p>}
                  {structures.map((s) => (
                    <div key={s.id} className="flex items-center justify-between rounded-xl border border-border bg-secondary/40 px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">{s.className} · {s.feeType}</p>
                        <p className="text-xs text-muted-foreground">{formatIndianCurrency(s.amount)} · Due {s.dueDate}</p>
                      </div>
                      <button
                        onClick={() => handleGenerate(s.id)}
                        disabled={isGenerating === s.id}
                        className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-secondary disabled:opacity-50"
                      >
                        {isGenerating === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                        Generate for class
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {isAccountantOrAdmin && studentsWithoutFees.length > 0 && (
          <div className="rounded-2xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-5">
            <div className="flex items-start gap-3">
              <UserPlus className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                  {studentsWithoutFees.length} admitted student{studentsWithoutFees.length > 1 ? 's have' : ' has'} no fee record yet
                </p>
                <p className="mt-0.5 text-xs text-amber-700/80 dark:text-amber-400/80">
                  No fee structure exists yet for their class — set one up below and it'll generate their fee status automatically.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {studentsWithoutFees.slice(0, 8).map((s) => (
                    <button
                      key={s.id}
                      onClick={() => { setStructureForm((f) => ({ ...f, className: s.className })); setShowSetup(true); }}
                      className="rounded-full border border-amber-300 dark:border-amber-800 bg-card px-3 py-1 text-xs font-medium text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40"
                    >
                      {s.fullName} · {s.className}
                    </button>
                  ))}
                  {studentsWithoutFees.length > 8 && (
                    <span className="px-3 py-1 text-xs text-amber-700/70 dark:text-amber-400/70">+{studentsWithoutFees.length - 8} more</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

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

        {collecting && (
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-foreground">Collect Fee — {collecting.studentName}</h2>
              <button onClick={() => setCollecting(null)} className="text-sm text-muted-foreground hover:text-foreground">✕</button>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Amount Due</label>
                <input readOnly value={formatIndianCurrency(collecting.totalAmount - collecting.paidAmount)} className="w-full rounded-xl border border-input bg-secondary px-4 py-2.5 text-sm" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Amount to Collect (₹)</label>
                <input
                  type="number"
                  min={0}
                  max={collecting.totalAmount - collecting.paidAmount}
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  className="w-full rounded-xl border border-input bg-input-background px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Payment Mode</label>
                <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)} className="w-full rounded-xl border border-input bg-input-background px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20">
                  {PAYMENT_MODES.map((m) => <option key={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Reference No. (optional)</label>
                <input value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} className="w-full rounded-xl border border-input bg-input-background px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
              </div>
            </div>
            <div className="mt-4 flex gap-3">
              <button
                onClick={handleConfirmPayment}
                disabled={isPaying}
                className="flex items-center gap-2 rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:opacity-90 disabled:opacity-50"
              >
                {isPaying && <Loader2 className="h-4 w-4 animate-spin" />}
                Confirm Payment
              </button>
              <button onClick={() => setCollecting(null)} className="rounded-xl border border-border px-6 py-2.5 text-sm font-medium transition-colors hover:bg-secondary">
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-border">
            <h2 className="font-semibold text-foreground">
              Fee Records
              <span className="ml-2 text-sm font-normal text-muted-foreground">({filtered.length} records)</span>
            </h2>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
            </div>
          ) : (
            <div className="divide-y divide-border">
              {visible.map((r) => {
                const cfg = STATUS_CONFIG[r.status];
                const StatusIcon = cfg.icon;
                const pending = r.totalAmount - r.paidAmount;
                return (
                  <div key={r.id} className="flex items-center gap-4 px-6 py-4 transition-colors hover:bg-secondary/30">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                      {r.studentName.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground">{r.studentName}</p>
                      <p className="text-xs text-muted-foreground">{r.feeType} · {r.className}</p>
                    </div>
                    <div className="hidden sm:block text-right mr-4">
                      <p className="text-sm font-semibold text-foreground">{formatIndianCurrency(r.totalAmount)}</p>
                      {pending > 0 && <p className="text-xs text-red-500">{formatIndianCurrency(pending)} due</p>}
                    </div>
                    <span className={`hidden sm:inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${cfg.bg} ${cfg.color}`}>
                      <StatusIcon className="h-3 w-3" />
                      {r.status}
                    </span>
                    {isAccountantOrAdmin && r.status !== 'Paid' && (
                      <button
                        onClick={() => { setCollecting(r); setPaymentAmount(String(r.totalAmount - r.paidAmount)); }}
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
          )}

          {!isLoading && filtered.length > 5 && (
            <div className="border-t border-border px-6 py-4">
              <button onClick={() => setShowAll((v) => !v)} className="flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                {showAll ? 'Show less' : `View all ${filtered.length} records`} <ChevronRight className={`h-4 w-4 transition-transform ${showAll ? 'rotate-90' : ''}`} />
              </button>
            </div>
          )}

          {!isLoading && filtered.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <CreditCard className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No fee records found</p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
