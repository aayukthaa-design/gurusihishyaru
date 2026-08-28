import { useEffect, useMemo, useState } from 'react';
import { Header } from '../components/Header';
import { useAuth } from '../auth/AuthContext';
import { useBranches, getBranchName } from '../lib/branchService';
import { formatIndianCurrency } from '../lib/currency';
import { useStudents, refreshStudents } from '../lib/studentService';
import {
  useFeeRecords,
  refreshFeeRecords,
  useFeeStructures,
  refreshFeeStructures,
  createFeeStructureAPI,
  generateFeeRecordsAPI,
  generateMonthlyFeeRecordsAPI,
  createSingleFeeRecordAPI,
  updateFeeRecordAPI,
  recordFeePaymentAPI,
  deleteFeeRecordAPI,
  fetchFeeStats,
  fetchFeePayments,
  FeeStats,
  FeeRecord,
  FeePayment,
} from '../lib/feeService';
import { Search, CreditCard, ChevronRight, CheckCircle2, Clock, AlertCircle, Loader2, Settings2, Plus, UserPlus, Pencil, CalendarClock, History, Trash2 } from 'lucide-react';
import { useClasses, getClassesForBranch } from '../lib/classService';
import { WhatsAppButton } from '../components/WhatsAppButton';
import { composeWhatsAppMessage } from '../lib/whatsapp';
import type { StudentRecord } from '../lib/studentService';

function formatMonthLabel(month?: string | null): string {
  if (!month) return '';
  const [year, mon] = month.split('-').map(Number);
  if (!year || !mon) return month;
  return new Date(year, mon - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

function nextMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** Mirrors the server's computeDiscount() so the form shows the same numbers it's about to submit — the server always recomputes and persists these, this is purely a live preview. */
function computeDiscountPreview(originalAmountInput: string, discountPercentInput: string) {
  const originalAmount = Number(originalAmountInput) || 0;
  const discountPercent = Math.max(0, Math.min(100, Number(discountPercentInput) || 0));
  const discountAmount = Math.round(((originalAmount * discountPercent) / 100) * 100) / 100;
  const finalAmount = Math.round((originalAmount - discountAmount) * 100) / 100;
  return { discountAmount, finalAmount };
}

/** Fee-situation-specific WhatsApp message for one record — content (and which
 * of paid/pending/due it leads with) changes with the record's own status, so
 * this is never the same static text for every student. */
function feeWhatsAppMessage(record: FeeRecord, student?: StudentRecord): string {
  const parentName = student?.primaryParentName || `${record.studentName}'s Parent`;
  const pending = record.totalAmount - record.paidAmount;
  const feeLabel = `${record.feeType}${record.month ? ` (${formatMonthLabel(record.month)})` : ''}`;

  if (record.status === 'Paid') {
    return composeWhatsAppMessage({
      greeting: parentName,
      intro: `This is to confirm we've received full payment of ${record.studentName}'s ${feeLabel}. Thank you!`,
      sections: [[
        { label: 'Student', value: record.studentName },
        { label: 'Amount Paid', value: formatIndianCurrency(record.paidAmount) },
      ]],
      closing: 'Thank you for your prompt payment.',
    });
  }

  if (record.status === 'Overdue') {
    return composeWhatsAppMessage({
      greeting: parentName,
      intro: `${record.studentName}'s ${feeLabel} is now overdue. Kindly clear the pending amount at the earliest.`,
      sections: [[
        { label: 'Student', value: record.studentName },
        { label: 'Total Fee', value: formatIndianCurrency(record.totalAmount) },
        { label: 'Paid', value: formatIndianCurrency(record.paidAmount) },
        { label: 'Pending', value: formatIndianCurrency(pending) },
        { label: 'Was Due', value: record.dueDate },
      ]],
      closing: 'Please contact us if you have already paid or need assistance.',
    });
  }

  if (record.status === 'Partially Paid') {
    return composeWhatsAppMessage({
      greeting: parentName,
      intro: `A partial payment has been received for ${record.studentName}'s ${feeLabel}. A balance is still pending.`,
      sections: [[
        { label: 'Student', value: record.studentName },
        { label: 'Total Fee', value: formatIndianCurrency(record.totalAmount) },
        { label: 'Paid So Far', value: formatIndianCurrency(record.paidAmount) },
        { label: 'Balance Pending', value: formatIndianCurrency(pending) },
        { label: 'Due Date', value: record.dueDate },
      ]],
      closing: 'Kindly clear the balance by the due date.',
    });
  }

  // Pending (not yet due/overdue) — a plain reminder of the upcoming fee.
  return composeWhatsAppMessage({
    greeting: parentName,
    intro: `This is a reminder that ${record.studentName}'s ${feeLabel} is due soon.`,
    sections: [[
      { label: 'Student', value: record.studentName },
      { label: 'Amount Due', value: formatIndianCurrency(pending) },
      { label: 'Due Date', value: record.dueDate },
    ]],
    closing: 'Please make the payment on or before the due date.',
  });
}

const CATEGORY_SUGGESTIONS = ['Tuition', 'CBSE Batch', 'State Batch', 'Crash Course', 'Special Coaching', 'Exam Preparation'];

const STATUS_CONFIG = {
  Paid:            { icon: CheckCircle2, color: 'text-green-600 dark:text-green-400',  bg: 'bg-green-100 dark:bg-green-900/40' },
  'Partially Paid': { icon: Clock,         color: 'text-sky-600 dark:text-sky-400',      bg: 'bg-sky-100 dark:bg-sky-900/40' },
  Pending:         { icon: Clock,         color: 'text-amber-600 dark:text-amber-400',  bg: 'bg-amber-100 dark:bg-amber-900/40' },
  Overdue:         { icon: AlertCircle,   color: 'text-red-600 dark:text-red-400',      bg: 'bg-red-100 dark:bg-red-900/40' },
} as const;

const FEE_TYPES = ['Tuition', 'Admission', 'Exam', 'Transport', 'Other'];
const PAYMENT_MODES = ['Cash', 'UPI', 'Card', 'Bank Transfer', 'Cheque'];

export function FeeManagement() {
  const { user } = useAuth();
  const branches = useBranches();
  const isAccountantOrAdmin = user?.role === 'accountant' || user?.role === 'admin' || user?.role === 'super_admin';

  const records = useFeeRecords();
  const structures = useFeeStructures();
  const students = useStudents();
  const [stats, setStats] = useState<FeeStats>({ totalCollected: 0, totalPending: 0, overdueCount: 0, paidCount: 0, totalRecords: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'All' | 'Paid' | 'Pending' | 'Partial' | 'Overdue'>('All');
  const [branchFilter, setBranchFilter] = useState(user?.role === 'super_admin' ? '' : user?.branchId ?? '');
  const [showAll, setShowAll] = useState(false);
  useClasses();
  const classOptions = getClassesForBranch(branchFilter || user?.branchId || undefined);

  const [collecting, setCollecting] = useState<FeeRecord | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMode, setPaymentMode] = useState(PAYMENT_MODES[0]);
  const [referenceNumber, setReferenceNumber] = useState('');
  const [isPaying, setIsPaying] = useState(false);

  const [showSetup, setShowSetup] = useState(false);
  const [structureForm, setStructureForm] = useState({
    className: '', feeType: FEE_TYPES[0], originalAmount: '', discountPercent: '', category: '',
    startDate: '', endDate: '', dueDate: '', academicYear: '',
  });
  const [isCreatingStructure, setIsCreatingStructure] = useState(false);
  const [isGenerating, setIsGenerating] = useState<number | null>(null);

  const [showMonthly, setShowMonthly] = useState(false);
  const [monthlyTarget, setMonthlyTarget] = useState<'student' | 'batch'>('student');
  const [monthlyStudentSearch, setMonthlyStudentSearch] = useState('');
  const [monthlyForm, setMonthlyForm] = useState({
    studentId: '', className: '', feeType: 'Tuition', originalAmount: '', discountPercent: '', category: '',
    startDate: '', endDate: '', academicYear: '',
    startMonth: nextMonthValue(), months: '12', dueDay: '5',
  });
  const [isGeneratingMonthly, setIsGeneratingMonthly] = useState(false);
  const monthlyStudentMatches = useMemo(() => {
    if (!monthlyStudentSearch.trim()) return [];
    const query = monthlyStudentSearch.toLowerCase();
    return students
      .filter((s) => s.status === 'Active' && (s.fullName.toLowerCase().includes(query) || s.id.toLowerCase().includes(query)))
      .slice(0, 20);
  }, [students, monthlyStudentSearch]);

  const [showIndividual, setShowIndividual] = useState(false);
  const [individualSearch, setIndividualSearch] = useState('');
  const [individualForm, setIndividualForm] = useState({
    studentId: '', feeType: FEE_TYPES[0], originalAmount: '', discountPercent: '', category: '',
    startDate: '', endDate: '', dueDate: '', month: '',
  });
  const [isAddingIndividual, setIsAddingIndividual] = useState(false);

  const [editingRecord, setEditingRecord] = useState<FeeRecord | null>(null);
  const [editOriginalAmount, setEditOriginalAmount] = useState('');
  const [editDiscountPercent, setEditDiscountPercent] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editStartDate, setEditStartDate] = useState('');
  const [editEndDate, setEditEndDate] = useState('');
  const [editDueDate, setEditDueDate] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const [historyRecord, setHistoryRecord] = useState<FeeRecord | null>(null);
  const [historyPayments, setHistoryPayments] = useState<FeePayment[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

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
    const matchFilter = filter === 'All' || record.status === filter || (filter === 'Partial' && record.status === 'Partially Paid');
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

  // Every admitted student (status === 'Active' — the same definition the
  // rest of this page already uses, including students that predate this
  // table and never went through the Admission CRM at all) with a fee status
  // derived from their fee_records, not stored anywhere of its own — so an
  // approval, a payment, or a brand-new assignment all show up here the
  // moment the underlying data changes, with no separate sync step.
  const admittedStudentsWithFeeStatus = useMemo(() => {
    const totalsByStudent = new Map<string, { total: number; paid: number }>();
    records.forEach((r) => {
      const agg = totalsByStudent.get(r.studentId) || { total: 0, paid: 0 };
      agg.total += r.totalAmount;
      agg.paid += r.paidAmount;
      totalsByStudent.set(r.studentId, agg);
    });
    return students
      .filter((s) => s.status === 'Active')
      .filter((s) => (user?.role === 'super_admin' ? (!branchFilter || s.branchId === branchFilter) : true))
      .map((s) => {
        const agg = totalsByStudent.get(s.id);
        let feeStatus: 'Fee Not Assigned' | 'Fee Assigned' | 'Partially Paid' | 'Fully Paid';
        if (!agg || agg.total <= 0) feeStatus = 'Fee Not Assigned';
        else if (agg.paid <= 0) feeStatus = 'Fee Assigned';
        else if (agg.paid >= agg.total) feeStatus = 'Fully Paid';
        else feeStatus = 'Partially Paid';
        return { student: s, feeStatus };
      })
      .sort((a, b) => a.student.fullName.localeCompare(b.student.fullName));
  }, [students, records, branchFilter, user?.role]);

  const [studentFeeStatusFilter, setStudentFeeStatusFilter] = useState<'All' | 'Fee Not Assigned' | 'Fee Assigned' | 'Partially Paid' | 'Fully Paid'>('All');
  const visibleAdmittedStudents = useMemo(
    () => admittedStudentsWithFeeStatus.filter((row) => studentFeeStatusFilter === 'All' || row.feeStatus === studentFeeStatusFilter),
    [admittedStudentsWithFeeStatus, studentFeeStatusFilter]
  );

  function openAssignFeeFor(studentId: string) {
    setIndividualForm((f) => ({ ...f, studentId }));
    setShowIndividual(true);
  }

  async function handleCreateStructure(e: React.FormEvent) {
    e.preventDefault();
    if (!structureForm.originalAmount || !structureForm.dueDate) {
      setError('Original amount and due date are required.');
      return;
    }
    setIsCreatingStructure(true);
    setError(null);
    try {
      await createFeeStructureAPI({
        className: structureForm.className,
        feeType: structureForm.feeType,
        originalAmount: Number(structureForm.originalAmount),
        discountPercent: Number(structureForm.discountPercent) || 0,
        category: structureForm.category,
        startDate: structureForm.startDate,
        endDate: structureForm.endDate,
        dueDate: structureForm.dueDate,
        academicYear: structureForm.academicYear || new Date().getFullYear().toString(),
      }, user);
      setSuccess('Fee structure created. Use "Generate for class" below to create records for students.');
      setStructureForm({ className: '', feeType: FEE_TYPES[0], originalAmount: '', discountPercent: '', category: '', startDate: '', endDate: '', dueDate: '', academicYear: '' });
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

  async function handleGenerateMonthly(e: React.FormEvent) {
    e.preventDefault();
    if (!monthlyForm.originalAmount || !monthlyForm.startMonth) {
      setError('Monthly original amount and start month are required.');
      return;
    }
    if (monthlyTarget === 'student' && !monthlyForm.studentId) {
      setError('Select a student.');
      return;
    }
    if (monthlyTarget === 'batch' && !monthlyForm.className) {
      setError('Select a batch.');
      return;
    }
    setIsGeneratingMonthly(true);
    setError(null);
    try {
      const result = await generateMonthlyFeeRecordsAPI({
        studentId: monthlyTarget === 'student' ? monthlyForm.studentId : undefined,
        className: monthlyTarget === 'batch' ? monthlyForm.className : undefined,
        feeType: monthlyForm.feeType,
        originalAmount: Number(monthlyForm.originalAmount),
        discountPercent: Number(monthlyForm.discountPercent) || 0,
        category: monthlyForm.category,
        startDate: monthlyForm.startDate,
        endDate: monthlyForm.endDate,
        academicYear: monthlyForm.academicYear || new Date().getFullYear().toString(),
        startMonth: monthlyForm.startMonth,
        months: Number(monthlyForm.months) || 12,
        dueDay: Number(monthlyForm.dueDay) || 5,
      }, user);
      setSuccess(`Created ${result.createdCount} monthly fee record(s) for ${result.studentCount} student(s)${result.skippedCount ? `, skipped ${result.skippedCount} already existing` : ''}.`);
      setMonthlyForm((f) => ({ ...f, studentId: '' }));
      setMonthlyStudentSearch('');
      const statsResult = await fetchFeeStats(user);
      setStats(statsResult);
    } catch (err: any) {
      setError(err.message || 'Failed to generate monthly fee records.');
    } finally {
      setIsGeneratingMonthly(false);
    }
  }

  const individualStudentMatches = useMemo(() => {
    if (!individualSearch.trim()) return [];
    const query = individualSearch.toLowerCase();
    return students
      .filter((s) => s.status === 'Active' && (s.fullName.toLowerCase().includes(query) || s.id.toLowerCase().includes(query)))
      .slice(0, 20);
  }, [students, individualSearch]);

  async function handleAddIndividualFee(e: React.FormEvent) {
    e.preventDefault();
    if (!individualForm.studentId || !individualForm.originalAmount || !individualForm.dueDate) {
      setError('Student, original amount and due date are required.');
      return;
    }
    setIsAddingIndividual(true);
    setError(null);
    try {
      const result = await createSingleFeeRecordAPI({
        studentId: individualForm.studentId,
        feeType: individualForm.feeType,
        originalAmount: Number(individualForm.originalAmount),
        discountPercent: Number(individualForm.discountPercent) || 0,
        category: individualForm.category,
        startDate: individualForm.startDate,
        endDate: individualForm.endDate,
        dueDate: individualForm.dueDate,
        academicYear: new Date().getFullYear().toString(),
        month: individualForm.month || undefined,
      }, user);
      // Admin/accountant: nothing is live yet — it's a Pending request until
      // Super Admin approves it (see fee_approval_requests). Super Admin's
      // own calls still apply immediately, same as before this workflow existed.
      setSuccess(result.pendingApproval ? 'Fee request sent for Super Admin approval.' : 'Individual fee record created.');
      setIndividualForm({ studentId: '', feeType: FEE_TYPES[0], originalAmount: '', discountPercent: '', category: '', startDate: '', endDate: '', dueDate: '', month: '' });
      setIndividualSearch('');
      const statsResult = await fetchFeeStats(user);
      setStats(statsResult);
    } catch (err: any) {
      setError(err.message || 'Failed to create fee record.');
    } finally {
      setIsAddingIndividual(false);
    }
  }

  function startEditRecord(record: FeeRecord) {
    setEditingRecord(record);
    setEditOriginalAmount(String(record.originalAmount ?? record.totalAmount));
    setEditDiscountPercent(String(record.discountPercent ?? 0));
    setEditCategory(record.category ?? '');
    setEditStartDate(record.startDate ?? '');
    setEditEndDate(record.endDate ?? '');
    setEditDueDate(record.dueDate);
  }

  async function handleSaveEdit() {
    // The whole body used to run outside any try/catch until after validation,
    // so a click that reached "nothing happens" (no error, no network request,
    // per production debugging) is consistent with an uncaught synchronous
    // throw here — event-handler errors never reach the page's ErrorBoundary
    // (that only catches render-phase errors), so it would fail completely
    // silently. Wrapping the whole thing guarantees the user always sees why,
    // and isSavingEdit can never get stuck true if something throws before
    // the old try block started.
    try {
      if (!editingRecord) return;
      const originalAmount = Number(editOriginalAmount);
      if (!originalAmount || originalAmount <= 0) {
        setError('Enter a valid original amount.');
        return;
      }
      const { finalAmount } = computeDiscountPreview(editOriginalAmount, editDiscountPercent);
      if (finalAmount < editingRecord.paidAmount) {
        setError(`Final amount can't be less than the ${formatIndianCurrency(editingRecord.paidAmount)} already paid.`);
        return;
      }
      setIsSavingEdit(true);
      setError(null);
      const result = await updateFeeRecordAPI(editingRecord.id, {
        originalAmount, discountPercent: Number(editDiscountPercent) || 0,
        category: editCategory, startDate: editStartDate, endDate: editEndDate, dueDate: editDueDate,
      }, user);
      // The existing amount stays active until Super Admin approves the change
      // (Super Admin's own edits still apply immediately, as before).
      setSuccess(result.pendingApproval
        ? `Fee change for ${editingRecord.studentName} sent for Super Admin approval — the current amount stays active until then.`
        : `Fee updated for ${editingRecord.studentName}.`);
      const statsResult = await fetchFeeStats(user);
      setStats(statsResult);
      setEditingRecord(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to update fee.');
    } finally {
      setIsSavingEdit(false);
    }
  }

  async function openHistoryFor(record: FeeRecord) {
    setHistoryRecord(record);
    setIsLoadingHistory(true);
    try {
      const payments = await fetchFeePayments(record.id);
      setHistoryPayments(payments);
    } finally {
      setIsLoadingHistory(false);
    }
  }

  async function handleDeleteRecord(record: FeeRecord) {
    if (!confirm(`Delete this fee entry for ${record.studentName}? This also removes its payment history and cannot be undone.`)) return;
    setError(null);
    try {
      await deleteFeeRecordAPI(record.id, user);
      const statsResult = await fetchFeeStats(user);
      setStats(statsResult);
      setSuccess('Fee entry deleted.');
    } catch (err: any) {
      setError(err.message || 'Failed to delete fee entry.');
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
      <datalist id="fee-category-suggestions">
        {CATEGORY_SUGGESTIONS.map((c) => <option key={c} value={c} />)}
      </datalist>

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
                <form onSubmit={handleCreateStructure} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 items-end">
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className="font-medium text-foreground">Batch</span>
                    <select value={structureForm.className} onChange={(e) => setStructureForm((f) => ({ ...f, className: e.target.value }))}
                      className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary">
                      <option value="">Select batch…</option>
                      {classOptions.map((c) => <option key={c.id} value={c.className}>{c.className}</option>)}
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
                    <span className="font-medium text-foreground">Category</span>
                    <input list="fee-category-suggestions" value={structureForm.category} onChange={(e) => setStructureForm((f) => ({ ...f, category: e.target.value }))} placeholder="e.g. Tuition"
                      className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary" />
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className="font-medium text-foreground">Due Date</span>
                    <input type="date" value={structureForm.dueDate} onChange={(e) => setStructureForm((f) => ({ ...f, dueDate: e.target.value }))}
                      className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary" />
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className="font-medium text-foreground">Original Amount (₹)</span>
                    <input type="number" min={0} value={structureForm.originalAmount} onChange={(e) => setStructureForm((f) => ({ ...f, originalAmount: e.target.value }))}
                      className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary" />
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className="font-medium text-foreground">Discount (%)</span>
                    <input type="number" min={0} max={100} step="0.01" value={structureForm.discountPercent} onChange={(e) => setStructureForm((f) => ({ ...f, discountPercent: e.target.value }))}
                      className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary" />
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className="font-medium text-foreground">Discount Amount</span>
                    <input readOnly value={formatIndianCurrency(computeDiscountPreview(structureForm.originalAmount, structureForm.discountPercent).discountAmount)}
                      className="rounded-xl border border-input bg-secondary px-3 py-2 text-sm text-muted-foreground" />
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className="font-medium text-foreground">Final Amount</span>
                    <input readOnly value={formatIndianCurrency(computeDiscountPreview(structureForm.originalAmount, structureForm.discountPercent).finalAmount)}
                      className="rounded-xl border border-input bg-secondary px-3 py-2 text-sm font-semibold text-foreground" />
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className="font-medium text-foreground">Start Date</span>
                    <input type="date" value={structureForm.startDate} onChange={(e) => setStructureForm((f) => ({ ...f, startDate: e.target.value }))}
                      className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary" />
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className="font-medium text-foreground">End Date</span>
                    <input type="date" value={structureForm.endDate} onChange={(e) => setStructureForm((f) => ({ ...f, endDate: e.target.value }))}
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
                        <p className="text-sm font-medium text-foreground">{s.className} · {s.feeType}{s.category ? ` · ${s.category}` : ''}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatIndianCurrency(s.originalAmount ?? s.amount)}
                          {s.discountPercent ? ` − ${s.discountPercent}% (${formatIndianCurrency(s.discountAmount)}) = ${formatIndianCurrency(s.amount)}` : ''}
                          {' '}· Due {s.dueDate}
                          {s.startDate && s.endDate ? ` · ${s.startDate} to ${s.endDate}` : ''}
                        </p>
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

        {isAccountantOrAdmin && (
          <div className="rounded-2xl border border-border bg-card shadow-sm">
            <button onClick={() => setShowMonthly((v) => !v)} className="flex w-full items-center justify-between px-6 py-4">
              <div className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-muted-foreground" />
                <span className="font-semibold text-foreground">Generate Monthly Fees</span>
              </div>
              <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${showMonthly ? 'rotate-90' : ''}`} />
            </button>
            {showMonthly && (
              <div className="border-t border-border p-6 space-y-4">
                <p className="text-xs text-muted-foreground">
                  Creates one fee record per month, so each month can be tracked and paid separately. Generate for a single student, or for every active student in a batch at once.
                </p>
                <div className="flex rounded-xl border border-border overflow-hidden w-fit">
                  {(['student', 'batch'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setMonthlyTarget(t)}
                      className={`px-4 py-2 text-sm font-medium transition-colors ${
                        monthlyTarget === t ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-secondary'
                      }`}
                    >
                      {t === 'student' ? 'Individual Student' : 'Whole Batch'}
                    </button>
                  ))}
                </div>
                <form onSubmit={handleGenerateMonthly} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {monthlyTarget === 'student' ? (
                    <label className="flex flex-col gap-1.5 text-sm sm:col-span-2 lg:col-span-1">
                      <span className="font-medium text-foreground">Student</span>
                      <input
                        value={monthlyForm.studentId ? (students.find((s) => s.id === monthlyForm.studentId)?.fullName ?? '') : monthlyStudentSearch}
                        onChange={(e) => { setMonthlyStudentSearch(e.target.value); setMonthlyForm((f) => ({ ...f, studentId: '' })); }}
                        placeholder="Search student by name or ID…"
                        className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary"
                      />
                      {monthlyStudentSearch && !monthlyForm.studentId && monthlyStudentMatches.length > 0 && (
                        <div className="max-h-40 overflow-y-auto rounded-xl border border-border bg-card divide-y divide-border">
                          {monthlyStudentMatches.map((s) => (
                            <button
                              type="button"
                              key={s.id}
                              onClick={() => { setMonthlyForm((f) => ({ ...f, studentId: s.id })); setMonthlyStudentSearch(''); }}
                              className="block w-full px-3 py-2 text-left text-sm hover:bg-secondary"
                            >
                              {s.fullName} <span className="text-xs text-muted-foreground">· {s.className} · {s.id}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </label>
                  ) : (
                    <label className="flex flex-col gap-1.5 text-sm">
                      <span className="font-medium text-foreground">Batch</span>
                      <select value={monthlyForm.className} onChange={(e) => setMonthlyForm((f) => ({ ...f, className: e.target.value }))}
                        className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary">
                        <option value="">Select batch…</option>
                        {classOptions.map((c) => <option key={c.id} value={c.className}>{c.className}</option>)}
                      </select>
                    </label>
                  )}
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className="font-medium text-foreground">Fee Type</span>
                    <input value={monthlyForm.feeType} onChange={(e) => setMonthlyForm((f) => ({ ...f, feeType: e.target.value }))} placeholder="e.g. Tuition"
                      className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary" />
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className="font-medium text-foreground">Category</span>
                    <input list="fee-category-suggestions" value={monthlyForm.category} onChange={(e) => setMonthlyForm((f) => ({ ...f, category: e.target.value }))} placeholder="e.g. CBSE Batch"
                      className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary" />
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className="font-medium text-foreground">Monthly Original Amount (₹)</span>
                    <input type="number" min={0} value={monthlyForm.originalAmount} onChange={(e) => setMonthlyForm((f) => ({ ...f, originalAmount: e.target.value }))}
                      className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary" />
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className="font-medium text-foreground">Discount (%)</span>
                    <input type="number" min={0} max={100} step="0.01" value={monthlyForm.discountPercent} onChange={(e) => setMonthlyForm((f) => ({ ...f, discountPercent: e.target.value }))}
                      className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary" />
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className="font-medium text-foreground">Final Monthly Amount</span>
                    <input readOnly value={formatIndianCurrency(computeDiscountPreview(monthlyForm.originalAmount, monthlyForm.discountPercent).finalAmount)}
                      className="rounded-xl border border-input bg-secondary px-3 py-2 text-sm font-semibold text-foreground" />
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className="font-medium text-foreground">Fee Duration Start</span>
                    <input type="date" value={monthlyForm.startDate} onChange={(e) => setMonthlyForm((f) => ({ ...f, startDate: e.target.value }))}
                      className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary" />
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className="font-medium text-foreground">Fee Duration End</span>
                    <input type="date" value={monthlyForm.endDate} onChange={(e) => setMonthlyForm((f) => ({ ...f, endDate: e.target.value }))}
                      className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary" />
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className="font-medium text-foreground">Start Month</span>
                    <input type="month" value={monthlyForm.startMonth} onChange={(e) => setMonthlyForm((f) => ({ ...f, startMonth: e.target.value }))}
                      className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary" />
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className="font-medium text-foreground">Number of Months</span>
                    <input type="number" min={1} max={24} value={monthlyForm.months} onChange={(e) => setMonthlyForm((f) => ({ ...f, months: e.target.value }))}
                      className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary" />
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className="font-medium text-foreground">Due Day of Month</span>
                    <input type="number" min={1} max={28} value={monthlyForm.dueDay} onChange={(e) => setMonthlyForm((f) => ({ ...f, dueDay: e.target.value }))}
                      className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary" />
                  </label>
                  <button type="submit" disabled={isGeneratingMonthly} className="flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50 sm:col-span-2 lg:col-span-1">
                    {isGeneratingMonthly ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    Generate Monthly Fees
                  </button>
                </form>
              </div>
            )}
          </div>
        )}

        {isAccountantOrAdmin && (
          <div className="rounded-2xl border border-border bg-card shadow-sm">
            <button onClick={() => setShowIndividual((v) => !v)} className="flex w-full items-center justify-between px-6 py-4">
              <div className="flex items-center gap-2">
                <UserPlus className="h-4 w-4 text-muted-foreground" />
                <span className="font-semibold text-foreground">Add Individual Student Fee</span>
              </div>
              <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${showIndividual ? 'rotate-90' : ''}`} />
            </button>
            {showIndividual && (
              <div className="border-t border-border p-6 space-y-4">
                <p className="text-xs text-muted-foreground">
                  For a single student whose fee doesn't match their class — a scholarship, a custom plan, or a one-off charge.
                </p>
                <form onSubmit={handleAddIndividualFee} className="space-y-4">
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className="font-medium text-foreground">Student</span>
                    <input
                      value={individualForm.studentId ? (students.find((s) => s.id === individualForm.studentId)?.fullName ?? '') : individualSearch}
                      onChange={(e) => { setIndividualSearch(e.target.value); setIndividualForm((f) => ({ ...f, studentId: '' })); }}
                      placeholder="Search student by name or ID…"
                      className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary"
                    />
                    {individualSearch && !individualForm.studentId && individualStudentMatches.length > 0 && (
                      <div className="max-h-40 overflow-y-auto rounded-xl border border-border bg-card divide-y divide-border">
                        {individualStudentMatches.map((s) => (
                          <button
                            type="button"
                            key={s.id}
                            onClick={() => { setIndividualForm((f) => ({ ...f, studentId: s.id })); setIndividualSearch(''); }}
                            className="block w-full px-3 py-2 text-left text-sm hover:bg-secondary"
                          >
                            {s.fullName} <span className="text-xs text-muted-foreground">· {s.className} · {s.id}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </label>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 items-end">
                    <label className="flex flex-col gap-1.5 text-sm">
                      <span className="font-medium text-foreground">Fee Type</span>
                      <select value={individualForm.feeType} onChange={(e) => setIndividualForm((f) => ({ ...f, feeType: e.target.value }))}
                        className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary">
                        {FEE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1.5 text-sm">
                      <span className="font-medium text-foreground">Category</span>
                      <input list="fee-category-suggestions" value={individualForm.category} onChange={(e) => setIndividualForm((f) => ({ ...f, category: e.target.value }))} placeholder="e.g. Crash Course"
                        className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary" />
                    </label>
                    <label className="flex flex-col gap-1.5 text-sm">
                      <span className="font-medium text-foreground">Due Date</span>
                      <input type="date" value={individualForm.dueDate} onChange={(e) => setIndividualForm((f) => ({ ...f, dueDate: e.target.value }))}
                        className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary" />
                    </label>
                    <label className="flex flex-col gap-1.5 text-sm">
                      <span className="font-medium text-foreground">Month (optional)</span>
                      <input type="month" value={individualForm.month} onChange={(e) => setIndividualForm((f) => ({ ...f, month: e.target.value }))}
                        className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary" />
                    </label>
                    <label className="flex flex-col gap-1.5 text-sm">
                      <span className="font-medium text-foreground">Original Amount (₹)</span>
                      <input type="number" min={0} value={individualForm.originalAmount} onChange={(e) => setIndividualForm((f) => ({ ...f, originalAmount: e.target.value }))}
                        className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary" />
                    </label>
                    <label className="flex flex-col gap-1.5 text-sm">
                      <span className="font-medium text-foreground">Discount (%)</span>
                      <input type="number" min={0} max={100} step="0.01" value={individualForm.discountPercent} onChange={(e) => setIndividualForm((f) => ({ ...f, discountPercent: e.target.value }))}
                        className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary" />
                    </label>
                    <label className="flex flex-col gap-1.5 text-sm">
                      <span className="font-medium text-foreground">Discount Amount</span>
                      <input readOnly value={formatIndianCurrency(computeDiscountPreview(individualForm.originalAmount, individualForm.discountPercent).discountAmount)}
                        className="rounded-xl border border-input bg-secondary px-3 py-2 text-sm text-muted-foreground" />
                    </label>
                    <label className="flex flex-col gap-1.5 text-sm">
                      <span className="font-medium text-foreground">Final Amount</span>
                      <input readOnly value={formatIndianCurrency(computeDiscountPreview(individualForm.originalAmount, individualForm.discountPercent).finalAmount)}
                        className="rounded-xl border border-input bg-secondary px-3 py-2 text-sm font-semibold text-foreground" />
                    </label>
                    <label className="flex flex-col gap-1.5 text-sm">
                      <span className="font-medium text-foreground">Fee Duration Start</span>
                      <input type="date" value={individualForm.startDate} onChange={(e) => setIndividualForm((f) => ({ ...f, startDate: e.target.value }))}
                        className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary" />
                    </label>
                    <label className="flex flex-col gap-1.5 text-sm">
                      <span className="font-medium text-foreground">Fee Duration End</span>
                      <input type="date" value={individualForm.endDate} onChange={(e) => setIndividualForm((f) => ({ ...f, endDate: e.target.value }))}
                        className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary" />
                    </label>
                  </div>
                  <button type="submit" disabled={isAddingIndividual || !individualForm.studentId} className="flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
                    {isAddingIndividual ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    Add Fee for Student
                  </button>
                </form>
              </div>
            )}
          </div>
        )}

        {isAccountantOrAdmin && (
          <div className="rounded-2xl border border-border bg-card shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
              <div className="flex items-center gap-2">
                <UserPlus className="h-4 w-4 text-muted-foreground" />
                <span className="font-semibold text-foreground">Admitted Students ({admittedStudentsWithFeeStatus.length})</span>
              </div>
              <select
                value={studentFeeStatusFilter}
                onChange={(e) => setStudentFeeStatusFilter(e.target.value as typeof studentFeeStatusFilter)}
                className="rounded-xl border border-input bg-input-background px-3 py-1.5 text-xs focus:outline-none focus:border-primary"
              >
                <option value="All">All fee statuses</option>
                <option value="Fee Not Assigned">Fee Not Assigned</option>
                <option value="Fee Assigned">Fee Assigned</option>
                <option value="Partially Paid">Partially Paid</option>
                <option value="Fully Paid">Fully Paid</option>
              </select>
            </div>
            {admittedStudentsWithFeeStatus.length === 0 ? (
              <p className="border-t border-border px-6 py-8 text-center text-sm text-muted-foreground">No admitted students yet.</p>
            ) : (
              <div className="overflow-x-auto border-t border-border">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-6 py-3 font-medium">Student Name</th>
                      {user?.role === 'super_admin' && <th className="px-4 py-3 font-medium">Branch</th>}
                      <th className="px-4 py-3 font-medium">Batch</th>
                      <th className="px-4 py-3 font-medium">Admission Date</th>
                      <th className="px-4 py-3 font-medium">Fee Status</th>
                      <th className="px-6 py-3 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {visibleAdmittedStudents.map(({ student, feeStatus }) => (
                      <tr key={student.id} className="hover:bg-secondary/30">
                        <td className="px-6 py-3 font-medium text-foreground">{student.fullName}</td>
                        {user?.role === 'super_admin' && <td className="px-4 py-3 text-muted-foreground">{getBranchName(student.branchId)}</td>}
                        <td className="px-4 py-3 text-muted-foreground">{student.className || '—'}</td>
                        <td className="px-4 py-3 text-muted-foreground">{student.admissionDate || '—'}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                            feeStatus === 'Fee Not Assigned' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                            : feeStatus === 'Fee Assigned' ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300'
                            : feeStatus === 'Partially Paid' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                            : 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
                          }`}>
                            {feeStatus}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => openAssignFeeFor(student.id)}
                            className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            {feeStatus === 'Fee Not Assigned' ? 'Assign Fee' : 'Add / Edit Fee'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
            {(['All', 'Paid', 'Pending', 'Partial', 'Overdue'] as const).map((f) => (
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

        {editingRecord && (
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-foreground">
                Edit Fee — {editingRecord.studentName}
                {editingRecord.month && <span className="ml-2 text-sm font-normal text-muted-foreground">({formatMonthLabel(editingRecord.month)})</span>}
              </h2>
              <button onClick={() => setEditingRecord(null)} className="text-sm text-muted-foreground hover:text-foreground">✕</button>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Original Amount (₹)</label>
                <input
                  type="number"
                  min={0}
                  value={editOriginalAmount}
                  onChange={(e) => setEditOriginalAmount(e.target.value)}
                  className="w-full rounded-xl border border-input bg-input-background px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                {editingRecord.paidAmount > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">{formatIndianCurrency(editingRecord.paidAmount)} already paid — final amount can't go below this.</p>
                )}
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Discount (%)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={editDiscountPercent}
                  onChange={(e) => setEditDiscountPercent(e.target.value)}
                  className="w-full rounded-xl border border-input bg-input-background px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Discount Amount</label>
                <input readOnly value={formatIndianCurrency(computeDiscountPreview(editOriginalAmount, editDiscountPercent).discountAmount)}
                  className="w-full rounded-xl border border-input bg-secondary px-4 py-2.5 text-sm text-muted-foreground" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Final Amount</label>
                <input readOnly value={formatIndianCurrency(computeDiscountPreview(editOriginalAmount, editDiscountPercent).finalAmount)}
                  className="w-full rounded-xl border border-input bg-secondary px-4 py-2.5 text-sm font-semibold text-foreground" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Category</label>
                <input list="fee-category-suggestions" value={editCategory} onChange={(e) => setEditCategory(e.target.value)}
                  className="w-full rounded-xl border border-input bg-input-background px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Due Date</label>
                <input
                  type="date"
                  value={editDueDate}
                  onChange={(e) => setEditDueDate(e.target.value)}
                  className="w-full rounded-xl border border-input bg-input-background px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Fee Duration Start</label>
                <input
                  type="date"
                  value={editStartDate}
                  onChange={(e) => setEditStartDate(e.target.value)}
                  className="w-full rounded-xl border border-input bg-input-background px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Fee Duration End</label>
                <input
                  type="date"
                  value={editEndDate}
                  onChange={(e) => setEditEndDate(e.target.value)}
                  className="w-full rounded-xl border border-input bg-input-background px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>
            <div className="mt-4 flex gap-3">
              <button
                onClick={handleSaveEdit}
                disabled={isSavingEdit}
                className="flex items-center gap-2 rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:opacity-90 disabled:opacity-50"
              >
                {isSavingEdit && <Loader2 className="h-4 w-4 animate-spin" />}
                Save Changes
              </button>
              <button onClick={() => setEditingRecord(null)} className="rounded-xl border border-border px-6 py-2.5 text-sm font-medium transition-colors hover:bg-secondary">
                Cancel
              </button>
            </div>
          </div>
        )}

        {historyRecord && (
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-foreground">Fee Collection History — {historyRecord.studentName}</h2>
              <button onClick={() => setHistoryRecord(null)} className="text-sm text-muted-foreground hover:text-foreground">✕</button>
            </div>
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-border bg-secondary/40 p-3">
                <p className="text-xs text-muted-foreground">Original Amount</p>
                <p className="text-sm font-semibold text-foreground">{formatIndianCurrency(historyRecord.originalAmount)}</p>
              </div>
              <div className="rounded-xl border border-border bg-secondary/40 p-3">
                <p className="text-xs text-muted-foreground">Discount</p>
                <p className="text-sm font-semibold text-foreground">{historyRecord.discountPercent}% ({formatIndianCurrency(historyRecord.discountAmount)})</p>
              </div>
              <div className="rounded-xl border border-border bg-secondary/40 p-3">
                <p className="text-xs text-muted-foreground">Final Amount</p>
                <p className="text-sm font-semibold text-foreground">{formatIndianCurrency(historyRecord.totalAmount)}</p>
              </div>
              <div className="rounded-xl border border-border bg-secondary/40 p-3">
                <p className="text-xs text-muted-foreground">Balance Pending</p>
                <p className="text-sm font-semibold text-foreground">{formatIndianCurrency(historyRecord.totalAmount - historyRecord.paidAmount)}</p>
              </div>
            </div>
            {isLoadingHistory ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
              </div>
            ) : historyPayments.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No payments collected yet for this fee.</p>
            ) : (
              <div className="divide-y divide-border rounded-xl border border-border">
                {historyPayments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between px-4 py-3 text-sm">
                    <div>
                      <p className="font-medium text-foreground">{formatIndianCurrency(p.amount)} · {p.paymentMode}</p>
                      <p className="text-xs text-muted-foreground">Receipt {p.receiptNumber} · {p.paymentDate}{p.referenceNumber ? ` · Ref ${p.referenceNumber}` : ''}</p>
                    </div>
                    <p className="text-xs text-muted-foreground">{p.receivedBy}</p>
                  </div>
                ))}
              </div>
            )}
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
                const student = students.find((s) => s.id === r.studentId);
                const parentPhone = student?.primaryParentMobile || student?.fatherMobile || student?.motherMobile;
                return (
                  <div key={r.id} className="flex items-center gap-4 px-6 py-4 transition-colors hover:bg-secondary/30">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                      {r.studentName.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground">{r.studentName}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.feeType}{r.category ? ` · ${r.category}` : ''}{r.month ? ` · ${formatMonthLabel(r.month)}` : ''} · {r.className}
                      </p>
                      {r.startDate && r.endDate && (
                        <p className="text-[11px] text-muted-foreground/80">{r.startDate} → {r.endDate}</p>
                      )}
                    </div>
                    <div className="hidden sm:block text-right mr-4">
                      <p className="text-sm font-semibold text-foreground">{formatIndianCurrency(r.totalAmount)}</p>
                      {!!r.discountPercent && (
                        <p className="text-[11px] text-muted-foreground">{formatIndianCurrency(r.originalAmount)} − {r.discountPercent}%</p>
                      )}
                      <p className="text-xs text-green-600 dark:text-green-400">{formatIndianCurrency(r.paidAmount)} collected</p>
                      {pending > 0 && <p className="text-xs text-red-500">{formatIndianCurrency(pending)} due</p>}
                    </div>
                    <span className={`hidden sm:inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${cfg.bg} ${cfg.color}`}>
                      <StatusIcon className="h-3 w-3" />
                      {r.status}
                    </span>
                    <button
                      onClick={() => openHistoryFor(r)}
                      title="View payment history"
                      className="flex items-center gap-1 rounded-xl border border-border px-2.5 py-2 text-xs font-medium text-muted-foreground transition-all hover:bg-secondary hover:text-foreground"
                    >
                      <History className="h-3.5 w-3.5" />
                    </button>
                    {parentPhone && (
                      <WhatsAppButton
                        variant="outline"
                        phone={parentPhone}
                        label="WhatsApp"
                        message={() => feeWhatsAppMessage(r, student)}
                      />
                    )}
                    {isAccountantOrAdmin && (
                      <button
                        onClick={() => startEditRecord(r)}
                        title="Edit this student's fee"
                        className="flex items-center gap-1 rounded-xl border border-border px-2.5 py-2 text-xs font-medium text-muted-foreground transition-all hover:bg-secondary hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {isAccountantOrAdmin && (
                      <button
                        onClick={() => handleDeleteRecord(r)}
                        title="Delete this fee entry"
                        className="flex items-center gap-1 rounded-xl border border-border px-2.5 py-2 text-xs font-medium text-red-500 transition-all hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
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
