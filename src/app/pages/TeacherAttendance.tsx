import { useEffect, useMemo, useState } from 'react';
import { Header } from '../components/Header';
import { useAuth } from '../auth/AuthContext';
import { useBranches, getBranchName } from '../lib/branchService';
import { useTeachers } from '../lib/teacherService';
import {
  fetchTeacherAttendance,
  fetchSalaryRecords,
  saveTeacherAttendanceBulk,
  saveSalaryRecord,
  finalizeSalaryRecord,
  pushSalaryRecordToAccountant,
  unlockSalaryRecord,
  summarizeTeacherAttendance,
  type SalaryRecord,
  type TeacherAttendanceEntry,
  type TeacherAttendanceStatus,
  validateAttendanceDuplicate,
  calculateSalaryFromClasses,
  calculateMonthlyFixedSalary,
} from '../lib/teacherSalaryService';
import { CalendarDays, Save, ClipboardCheck, AlertCircle, FileDown, FileSpreadsheet, CheckCircle2, Send, Unlock, Lock } from 'lucide-react';
import { formatAttendancePercent } from '../lib/attendanceMath';
import { formatIndianCurrency } from '../lib/currency';
import { exportAttendanceToExcel, exportAttendanceToPdf, type AttendanceExportRow } from '../lib/reportExport';

const TODAY = new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
const TODAY_ISO = new Date().toISOString().split('T')[0];

const statusOptions: Array<{ value: TeacherAttendanceStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All Status' },
  { value: 'present', label: 'Present' },
  { value: 'absent', label: 'Absent' },
  { value: 'holiday', label: 'Holiday' },
];

export function TeacherAttendance() {
  const { user } = useAuth();
  const branches = useBranches();
  const teachers = useTeachers();
  const isSuperAdmin = user?.role === 'super_admin';
  const isAdminOrSuper = user?.role === 'admin' || user?.role === 'super_admin';
  const isReadOnly = user?.role === 'accountant' || user?.role === 'teacher';
  const canViewPayrollMoney = user?.role === 'super_admin' || user?.role === 'admin' || user?.role === 'accountant';
  const canManageSalary = user?.role === 'super_admin' || user?.role === 'admin';

  const [attendanceDate, setAttendanceDate] = useState(TODAY_ISO);
  const [salaryMonth, setSalaryMonth] = useState(TODAY_ISO.slice(0, 7));
  const [branchFilter, setBranchFilter] = useState(user?.role === 'super_admin' ? '' : user?.branchId ?? '');
  const [teacherFilter, setTeacherFilter] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | TeacherAttendanceStatus>('all');
  const [attendance, setAttendance] = useState<Record<string, TeacherAttendanceStatus>>({});
  const [monthAttendance, setMonthAttendance] = useState<TeacherAttendanceEntry[]>([]);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [salaryTeacherId, setSalaryTeacherId] = useState('');
  const [classesConducted, setClassesConducted] = useState(0);
  const [salaryPerClass, setSalaryPerClass] = useState(0);
  const [salaryRemarks, setSalaryRemarks] = useState('');
  const [salaryRecord, setSalaryRecord] = useState<SalaryRecord | null>(null);
  const [branchSalaryRecords, setBranchSalaryRecords] = useState<SalaryRecord[]>([]);
  const [salaryMonthAttendance, setSalaryMonthAttendance] = useState<TeacherAttendanceEntry[]>([]);
  const [salaryDataLoaded, setSalaryDataLoaded] = useState(false);
  const [salaryActionBusy, setSalaryActionBusy] = useState(false);
  const [queueBusyTeacherId, setQueueBusyTeacherId] = useState<string | null>(null);
  const [queueFilter, setQueueFilter] = useState<'all' | 'not_saved' | 'draft' | 'finalized' | 'pushed'>('all');
  const [salaryFeedback, setSalaryFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const allowedTeachers = useMemo(() => {
    return teachers.filter((teacher) => {
      // Defense-in-depth against the shared teacher cache momentarily holding
      // another branch's data (e.g. right after a role switch in the same
      // tab) — every non-super_admin role is pinned to its own branch here,
      // not just 'admin'.
      const branchMatches = user?.role === 'super_admin' ? true : teacher.branchId === user?.branchId;
      const branchFilterMatches = !branchFilter || teacher.branchId === branchFilter;
      return branchMatches && branchFilterMatches && teacher.status !== 'Inactive';
    });
  }, [branchFilter, teachers, user]);

  useEffect(() => {
    // A teacher only ever sees their own payroll row, never a colleague's.
    if (user?.role === 'teacher') {
      if (user.id && salaryTeacherId !== user.id) setSalaryTeacherId(user.id);
      return;
    }
    if (!salaryTeacherId && allowedTeachers.length) {
      setSalaryTeacherId(allowedTeachers[0].id);
    }
  }, [allowedTeachers, salaryTeacherId, user]);

  const attendanceMonth = attendanceDate.slice(0, 7);
  const branchIdForQuery = user?.role === 'super_admin' ? (branchFilter || undefined) : user?.branchId;
  // Saving re-sends a status for every visible teacher, defaulting anyone not
  // explicitly touched to 'present' — if that happens while this month's real
  // data (which may include already-saved 'leave'/'absent' records) hasn't
  // finished loading yet, the save silently overwrites those records with
  // 'present'. Blocking Save until the fetch settles closes that window.
  const [loadingMonthAttendance, setLoadingMonthAttendance] = useState(true);

  const loadMonthAttendance = async () => {
    setLoadingMonthAttendance(true);
    const entries = await fetchTeacherAttendance({ month: attendanceMonth, branchId: branchIdForQuery });
    setMonthAttendance(entries);
    setLoadingMonthAttendance(false);
  };

  useEffect(() => {
    loadMonthAttendance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attendanceMonth, branchIdForQuery]);

  useEffect(() => {
    if (!isAdminOrSuper) return;
    const nextState: Record<string, TeacherAttendanceStatus> = {};
    allowedTeachers.forEach((teacher) => {
      const current = monthAttendance.find((record) => record.teacherId === teacher.id && record.date === attendanceDate);
      nextState[teacher.id] = current?.status ?? 'present';
    });
    setAttendance(nextState);
    setSaved(false);
  }, [allowedTeachers, attendanceDate, isAdminOrSuper, monthAttendance]);

  const loadSalaryMonthData = async () => {
    setSalaryDataLoaded(false);
    const [records, entries] = await Promise.all([
      fetchSalaryRecords({
        month: salaryMonth,
        branchId: branchIdForQuery,
        teacherId: user?.role === 'teacher' ? user.id : undefined,
      }),
      fetchTeacherAttendance({
        month: salaryMonth,
        branchId: branchIdForQuery,
        teacherId: user?.role === 'teacher' ? user.id : undefined,
      }),
    ]);
    setBranchSalaryRecords(records);
    setSalaryMonthAttendance(entries);
    setSalaryDataLoaded(true);
    return records;
  };

  useEffect(() => {
    void loadSalaryMonthData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salaryMonth, branchIdForQuery, user?.role, user?.id]);

  useEffect(() => {
    const teacher = allowedTeachers.find((item) => item.id === salaryTeacherId);
    if (!teacher || !salaryDataLoaded) {
      if (!teacher) {
        setSalaryRecord(null);
        setClassesConducted(0);
        setSalaryPerClass(0);
        setSalaryRemarks('');
      }
      return;
    }

    const existing = branchSalaryRecords.find((r) => r.teacherId === teacher.id) ?? null;
    const summaryForMonth = summarizeTeacherAttendance(salaryMonthAttendance, teacher.id, salaryMonth);
    setSalaryRecord(existing);
    if (existing) {
      setClassesConducted(existing.classesConducted ?? 0);
      setSalaryPerClass(existing.salaryPerClass ?? 0);
      setSalaryRemarks(existing.remarks ?? '');
    } else if (teacher.salaryType === 'Monthly Fixed') {
      setClassesConducted(summaryForMonth.workingDays);
      setSalaryPerClass(0);
      setSalaryRemarks('');
    } else {
      setClassesConducted(0);
      setSalaryPerClass(teacher.salaryPerClass ?? teacher.salaryAmount ?? 0);
      setSalaryRemarks('');
    }
  }, [allowedTeachers, salaryTeacherId, salaryMonth, salaryDataLoaded, branchSalaryRecords, salaryMonthAttendance]);

  const filteredTeachers = useMemo(() => {
    return allowedTeachers.filter((teacher) => {
      const matchesTeacher = !teacherFilter || teacher.id === teacherFilter;
      const matchesDepartment = !departmentFilter || (teacher.department || '').toLowerCase().includes(departmentFilter.toLowerCase());
      const status = attendance[teacher.id] || 'present';
      const matchesStatus = statusFilter === 'all' || status === statusFilter;
      return matchesTeacher && matchesDepartment && matchesStatus;
    });
  }, [allowedTeachers, attendance, departmentFilter, statusFilter, teacherFilter]);

  const summary = useMemo(() => {
    const total = filteredTeachers.length;
    const present = filteredTeachers.filter((teacher) => attendance[teacher.id] === 'present').length;
    const absent = filteredTeachers.filter((teacher) => attendance[teacher.id] === 'absent').length;
    const holiday = filteredTeachers.filter((teacher) => attendance[teacher.id] === 'holiday').length;
    return { total, present, absent, holiday };
  }, [attendance, filteredTeachers]);

  const history = useMemo(() => {
    return filteredTeachers.map((teacher) => ({
      teacher,
      history: summarizeTeacherAttendance(monthAttendance, teacher.id, attendanceMonth),
    }));
  }, [attendanceMonth, filteredTeachers, monthAttendance]);

  const toggleStatus = (teacherId: string, status: TeacherAttendanceStatus) => {
    setAttendance((prev) => ({ ...prev, [teacherId]: status }));
    setSaved(false);
  };

  const markAll = (status: TeacherAttendanceStatus) => {
    const next = filteredTeachers.reduce<Record<string, TeacherAttendanceStatus>>((acc, teacher) => {
      acc[teacher.id] = status;
      return acc;
    }, {});
    setAttendance((prev) => ({ ...prev, ...next }));
    setSaved(false);
  };

  const [exportMonth, setExportMonth] = useState(attendanceMonth);
  const handleExportMonth = async (format: 'pdf' | 'excel') => {
    const monthEntries = exportMonth === attendanceMonth ? monthAttendance : await fetchTeacherAttendance({ month: exportMonth, branchId: branchIdForQuery });
    // Same teacher/department filters as the on-screen list (status filter is a
    // per-day view, so it doesn't apply to a monthly report).
    const exportTeachers = allowedTeachers.filter((teacher) =>
      (!teacherFilter || teacher.id === teacherFilter)
      && (!departmentFilter || (teacher.department || '').toLowerCase().includes(departmentFilter.toLowerCase())));
    const rows: AttendanceExportRow[] = exportTeachers.map((teacher) => ({ teacher, history: summarizeTeacherAttendance(monthEntries, teacher.id, exportMonth) })).map(({ teacher, history: summary }) => ({
      name: `${teacher.firstName} ${teacher.lastName}`,
      id: teacher.id,
      present: summary.present,
      absent: summary.absent,
      holiday: summary.holiday,
      total: summary.totalClasses,
    }));
    const title = 'Teacher Attendance';
    if (format === 'excel') exportAttendanceToExcel(rows, title, exportMonth);
    else await exportAttendanceToPdf(rows, title, exportMonth, user?.name || 'Admin');
  };

  const handleSave = async () => {
    if (!isAdminOrSuper) {
      alert('Only Admin and Super Admin can mark teacher attendance.');
      return;
    }

    const entries = filteredTeachers.map((teacher) => ({
      teacherId: teacher.id,
      date: attendanceDate,
      status: attendance[teacher.id] || 'present',
      branchId: teacher.branchId,
      department: teacher.department,
    }));

    if (loadingMonthAttendance) {
      alert('Still loading this month\'s attendance — please wait a moment and try again.');
      return;
    }

    const duplicateError = validateAttendanceDuplicate(entries);
    if (duplicateError) {
      alert(duplicateError);
      return;
    }

    setSaving(true);
    try {
      await saveTeacherAttendanceBulk(entries);
      await loadMonthAttendance();
      if (attendanceDate.startsWith(salaryMonth)) {
        await loadSalaryMonthData();
      }
      setSaved(true);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save attendance.');
    } finally {
      setSaving(false);
    }
  };

  const selectedSalaryTeacher = allowedTeachers.find((teacher) => teacher.id === salaryTeacherId);
  const salaryAttendance = selectedSalaryTeacher
    ? summarizeTeacherAttendance(salaryMonthAttendance, selectedSalaryTeacher.id, salaryMonth)
    : null;
  const effectiveSalaryType = salaryRecord?.salaryType || selectedSalaryTeacher?.salaryType || 'Monthly Fixed';
  const isMonthlyFixedTeacher = effectiveSalaryType === 'Monthly Fixed';
  const configuredMonthlyAmount = salaryRecord
    ? Number(salaryRecord.salaryAmount ?? 0)
    : Number(selectedSalaryTeacher?.monthlySalary ?? selectedSalaryTeacher?.salaryAmount ?? 0);
  const isDraftEditable =
    canManageSalary &&
    !salaryRecord?.isFinalized &&
    !salaryRecord?.pushedToAccountant &&
    !salaryRecord?.isLocked &&
    salaryRecord?.status !== 'Paid';

  const effectiveWorkingDays = isMonthlyFixedTeacher
    ? (classesConducted > 0 ? classesConducted : (salaryAttendance?.workingDays ?? 0))
    : classesConducted;

  const estimatedPayrollSalary = !selectedSalaryTeacher
    ? 0
    : salaryRecord && (salaryRecord.isFinalized || salaryRecord.pushedToAccountant || salaryRecord.isLocked)
      ? salaryRecord.calculatedSalary
      : isMonthlyFixedTeacher
        ? calculateMonthlyFixedSalary(configuredMonthlyAmount, effectiveWorkingDays, salaryAttendance?.absent ?? 0)
        : calculateSalaryFromClasses(classesConducted, salaryPerClass);

  const getSalaryWorkflowBadge = (record: SalaryRecord | null) => {
    if (!record) return { label: 'Not Saved', className: 'bg-secondary text-muted-foreground' };
    if (!record.isFinalized) return { label: 'Draft (Unfinalized)', className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' };
    if (!record.pushedToAccountant) return { label: 'Finalized (Ready to Push)', className: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300' };
    if (record.payslipStatus === 'Generated') {
      return record.status === 'Paid'
        ? { label: 'Generated • Paid', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' }
        : { label: 'Payslip Generated', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' };
    }
    return { label: 'Pushed • Pending Generation', className: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300' };
  };

  const validateSalaryInputs = () => {
    if (!selectedSalaryTeacher) return 'Select a teacher first.';
    if (isMonthlyFixedTeacher) {
      if (configuredMonthlyAmount <= 0) {
        return 'Configured monthly salary is ₹0. Update the teacher salary in Teacher Management first.';
      }
      if (effectiveWorkingDays <= 0) {
        return 'Enter valid working days for this month.';
      }
      return null;
    }
    if (classesConducted <= 0 || salaryPerClass <= 0) {
      return 'Enter valid values for Classes Conducted and Salary Per Class.';
    }
    return null;
  };

  const handleSaveSalaryDraft = async () => {
    if (!canManageSalary || !selectedSalaryTeacher) {
      alert('Only Admin or Super Admin can save salary details.');
      return;
    }
    if (!isDraftEditable) {
      alert('Finalized or pushed salary records cannot be modified directly.');
      return;
    }
    const validationError = validateSalaryInputs();
    if (validationError) {
      alert(validationError);
      return;
    }

    setSalaryActionBusy(true);
    setSalaryFeedback(null);
    try {
      const savedDraft = await saveSalaryRecord({
        teacher: selectedSalaryTeacher,
        month: salaryMonth,
        classesConducted: effectiveWorkingDays,
        salaryPerClass: isMonthlyFixedTeacher ? 0 : salaryPerClass,
        attendance: salaryAttendance ?? { teacherId: selectedSalaryTeacher.id, present: 0, absent: 0, holiday: 0, totalClasses: 0, percent: null, workingDays: effectiveWorkingDays },
        remarks: salaryRemarks,
      });
      setSalaryRecord(savedDraft);
      await loadSalaryMonthData();
      setSalaryFeedback({ type: 'success', message: `Salary draft saved for ${selectedSalaryTeacher.firstName} ${selectedSalaryTeacher.lastName} (${salaryMonth}). Click "Finalize Salary" once verified.` });
    } catch (err) {
      setSalaryFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Failed to save salary draft.' });
    } finally {
      setSalaryActionBusy(false);
    }
  };

  const handleFinalizeSalary = async () => {
    if (!canManageSalary || !selectedSalaryTeacher) {
      alert('Only Admin or Super Admin can finalize salary details.');
      return;
    }
    if (salaryRecord?.isFinalized) {
      alert('Salary is already finalized for this teacher and month.');
      return;
    }
    const validationError = validateSalaryInputs();
    if (validationError) {
      alert(validationError);
      return;
    }

    setSalaryActionBusy(true);
    setSalaryFeedback(null);
    try {
      const targetDays = effectiveWorkingDays;
      const targetRate = isMonthlyFixedTeacher ? 0 : salaryPerClass;
      const att = salaryAttendance ?? { teacherId: selectedSalaryTeacher.id, present: 0, absent: 0, holiday: 0, totalClasses: 0, percent: null, workingDays: targetDays };
      const needsDraftSave =
        !salaryRecord ||
        salaryRecord.classesConducted !== targetDays ||
        salaryRecord.salaryPerClass !== targetRate ||
        (salaryRecord.remarks || '') !== salaryRemarks ||
        (salaryRecord.absentDays ?? 0) !== att.absent;

      let workingRecord = salaryRecord;
      if (needsDraftSave) {
        workingRecord = await saveSalaryRecord({
          teacher: selectedSalaryTeacher,
          month: salaryMonth,
          classesConducted: targetDays,
          salaryPerClass: targetRate,
          attendance: att,
          remarks: salaryRemarks,
        });
      }

      if (!workingRecord) throw new Error('Unable to create salary draft before finalizing.');
      const finalized = await finalizeSalaryRecord(workingRecord.id);
      setSalaryRecord(finalized);
      await loadSalaryMonthData();
      setSalaryFeedback({ type: 'success', message: `Salary finalized for ${finalized.teacherName} (${salaryMonth}). Click "Push to Accountant" to transfer for payslip generation.` });
    } catch (err) {
      setSalaryFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Failed to finalize salary.' });
    } finally {
      setSalaryActionBusy(false);
    }
  };

  const handlePushToAccountant = async () => {
    if (!canManageSalary || !salaryRecord) return;
    if (!salaryRecord.isFinalized) {
      alert('Only finalized salary records can be pushed to the Accountant. Please finalize the salary first.');
      return;
    }
    if (salaryRecord.pushedToAccountant) {
      alert('This salary record has already been pushed to the Accountant.');
      return;
    }

    setSalaryActionBusy(true);
    setSalaryFeedback(null);
    try {
      const pushed = await pushSalaryRecordToAccountant(salaryRecord.id);
      setSalaryRecord(pushed);
      await loadSalaryMonthData();
      setSalaryFeedback({ type: 'success', message: `Finalized salary pushed to Accountant for ${pushed.teacherName} (${salaryMonth}). Status is now Pending Generation.` });
    } catch (err) {
      setSalaryFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Failed to push salary to Accountant.' });
    } finally {
      setSalaryActionBusy(false);
    }
  };

  const handleUnlockSalary = async () => {
    if (!isSuperAdmin || !salaryRecord) return;
    setSalaryActionBusy(true);
    setSalaryFeedback(null);
    try {
      const unlocked = await unlockSalaryRecord(salaryRecord.id);
      setSalaryRecord(unlocked);
      await loadSalaryMonthData();
      setSalaryFeedback({ type: 'success', message: `Salary unlocked for ${unlocked.teacherName} (${salaryMonth}). Admin can now edit and re-finalize.` });
    } catch (err) {
      setSalaryFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Failed to unlock salary.' });
    } finally {
      setSalaryActionBusy(false);
    }
  };

  const handleRowFinalize = async (record: SalaryRecord) => {
    setQueueBusyTeacherId(record.teacherId);
    setSalaryFeedback(null);
    try {
      const finalized = await finalizeSalaryRecord(record.id);
      if (finalized.teacherId === salaryTeacherId) setSalaryRecord(finalized);
      await loadSalaryMonthData();
      setSalaryFeedback({ type: 'success', message: `Salary finalized for ${finalized.teacherName} (${finalized.month}).` });
    } catch (err) {
      setSalaryFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Failed to finalize salary.' });
    } finally {
      setQueueBusyTeacherId(null);
    }
  };

  const handleRowPush = async (record: SalaryRecord) => {
    if (!record.isFinalized) {
      alert('Only finalized salary records can be pushed to the Accountant.');
      return;
    }
    setQueueBusyTeacherId(record.teacherId);
    setSalaryFeedback(null);
    try {
      const pushed = await pushSalaryRecordToAccountant(record.id);
      if (pushed.teacherId === salaryTeacherId) setSalaryRecord(pushed);
      await loadSalaryMonthData();
      setSalaryFeedback({ type: 'success', message: `Pushed ${pushed.teacherName} (${pushed.month}) to Accountant.` });
    } catch (err) {
      setSalaryFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Failed to push salary to Accountant.' });
    } finally {
      setQueueBusyTeacherId(null);
    }
  };

  const handleRowUnlock = async (record: SalaryRecord) => {
    if (!isSuperAdmin) return;
    setQueueBusyTeacherId(record.teacherId);
    setSalaryFeedback(null);
    try {
      const unlocked = await unlockSalaryRecord(record.id);
      if (unlocked.teacherId === salaryTeacherId) setSalaryRecord(unlocked);
      await loadSalaryMonthData();
      setSalaryFeedback({ type: 'success', message: `Unlocked ${unlocked.teacherName} (${unlocked.month}) for editing.` });
    } catch (err) {
      setSalaryFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Failed to unlock salary.' });
    } finally {
      setQueueBusyTeacherId(null);
    }
  };

  const monthlyPayrollRows = useMemo(() => {
    return allowedTeachers
      .map((teacher) => {
        const record = branchSalaryRecords.find((r) => r.teacherId === teacher.id) ?? null;
        const att = summarizeTeacherAttendance(salaryMonthAttendance, teacher.id, salaryMonth);
        return { teacher, record, attendance: att };
      })
      .filter(({ record }) => {
        if (queueFilter === 'not_saved') return !record;
        if (queueFilter === 'draft') return Boolean(record && !record.isFinalized);
        if (queueFilter === 'finalized') return Boolean(record && record.isFinalized && !record.pushedToAccountant);
        if (queueFilter === 'pushed') return Boolean(record && record.pushedToAccountant);
        return true;
      });
  }, [allowedTeachers, branchSalaryRecords, queueFilter, salaryMonth, salaryMonthAttendance]);

  return (
    <div className="flex-1 bg-background">
      <Header title="Teacher Attendance" />

      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Today</p>
              <p className="mt-1 text-lg font-bold text-foreground">{TODAY}</p>
              {isReadOnly && <p className="mt-1 text-sm text-amber-600">Read-only view for accountants and teachers.</p>}
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-border bg-secondary/30 px-3 py-2 text-sm text-muted-foreground">
              <CalendarDays className="h-4 w-4" />
              <input type="date" value={attendanceDate} onChange={(event) => setAttendanceDate(event.target.value)} className="bg-transparent text-sm text-foreground outline-none" />
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {user?.role === 'super_admin' && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-foreground">Branch</label>
                  <select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)} className="w-full rounded-xl border border-input bg-input-background px-3 py-2 text-sm">
                    <option value="">All Branches</option>
                    {branches.filter((branch) => branch.status === 'Active').map((branch) => (
                      <option key={branch.id} value={branch.id}>{branch.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">Teacher</label>
                <select value={teacherFilter} onChange={(event) => setTeacherFilter(event.target.value)} className="w-full rounded-xl border border-input bg-input-background px-3 py-2 text-sm">
                  <option value="">All Teachers</option>
                  {allowedTeachers.map((teacher) => (
                    <option key={teacher.id} value={teacher.id}>{teacher.firstName} {teacher.lastName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">Department</label>
                <input value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)} placeholder="Search department" className="w-full rounded-xl border border-input bg-input-background px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">Status</label>
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | TeacherAttendanceStatus)} className="w-full rounded-xl border border-input bg-input-background px-3 py-2 text-sm">
                  {statusOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => markAll('present')} className="rounded-xl bg-green-100 px-3 py-2 text-sm font-semibold text-green-700 hover:bg-green-200 dark:bg-green-900/40 dark:text-green-400">Mark All Present</button>
              <button type="button" onClick={() => markAll('absent')} className="rounded-xl bg-red-100 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-200 dark:bg-red-900/40 dark:text-red-400">Mark All Absent</button>
              <button type="button" onClick={() => markAll('holiday')} className="rounded-xl bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-400">Mark All Holiday</button>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <p className="text-sm text-muted-foreground">Total Teachers</p>
            <p className="mt-2 text-2xl font-bold text-foreground">{summary.total}</p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <p className="text-sm text-muted-foreground">Present</p>
            <p className="mt-2 text-2xl font-bold text-green-600">{summary.present}</p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <p className="text-sm text-muted-foreground">Absent</p>
            <p className="mt-2 text-2xl font-bold text-red-500">{summary.absent}</p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <p className="text-sm text-muted-foreground">Holiday</p>
            <p className="mt-2 text-2xl font-bold text-sky-600">{summary.holiday}</p>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Teacher Attendance Register</h2>
              <p className="text-sm text-muted-foreground">Teachers shown are limited to the active branch scope.</p>
            </div>
            <button type="button" onClick={handleSave} disabled={!isAdminOrSuper || isReadOnly || saving || loadingMonthAttendance} className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50">
              <Save className="h-4 w-4" />
              {saving ? 'Saving…' : loadingMonthAttendance ? 'Loading…' : saved ? 'Saved' : 'Save Attendance'}
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="py-3 pr-3 font-semibold">Employee ID</th>
                  <th className="py-3 pr-3 font-semibold">Teacher Name</th>
                  <th className="py-3 pr-3 font-semibold">Department</th>
                  <th className="py-3 pr-3 font-semibold">Branch</th>
                  <th className="py-3 pr-3 font-semibold">Present</th>
                  <th className="py-3 pr-3 font-semibold">Absent</th>
                  <th className="py-3 pr-3 font-semibold">Holiday</th>
                </tr>
              </thead>
              <tbody>
                {filteredTeachers.map((teacher) => {
                  const status = attendance[teacher.id] || 'present';
                  return (
                    <tr key={teacher.id} className="border-b border-border/60 hover:bg-secondary/30">
                      <td className="py-3 pr-3 font-medium text-foreground">{teacher.id}</td>
                      <td className="py-3 pr-3 text-foreground">{teacher.firstName} {teacher.lastName}</td>
                      <td className="py-3 pr-3 text-muted-foreground">{teacher.department || '—'}</td>
                      <td className="py-3 pr-3 text-muted-foreground">{getBranchName(teacher.branchId) || '—'}</td>
                      <td className="py-3 pr-3">
                        <button type="button" onClick={() => toggleStatus(teacher.id, 'present')} disabled={isReadOnly} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${status === 'present' ? 'bg-green-600 text-white' : 'border border-border bg-secondary text-muted-foreground hover:bg-secondary/80'}`}>
                          Present
                        </button>
                      </td>
                      <td className="py-3 pr-3">
                        <button type="button" onClick={() => toggleStatus(teacher.id, 'absent')} disabled={isReadOnly} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${status === 'absent' ? 'bg-red-500 text-white' : 'border border-border bg-secondary text-muted-foreground hover:bg-secondary/80'}`}>
                          Absent
                        </button>
                      </td>
                      <td className="py-3 pr-3">
                        <button type="button" onClick={() => toggleStatus(teacher.id, 'holiday')} disabled={isReadOnly} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${status === 'holiday' ? 'bg-sky-600 text-white' : 'border border-border bg-secondary text-muted-foreground hover:bg-secondary/80'}`}>
                          Holiday
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {filteredTeachers.length === 0 && (
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-dashed border-border bg-secondary/30 p-3 text-sm text-muted-foreground">
              <AlertCircle className="h-4 w-4" />
              No teachers match the selected filters for this branch.
            </div>
          )}
        </div>

        <div id="payroll-reference-section" className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Payroll Reference</h2>
              <p className="text-sm text-muted-foreground">
                {canManageSalary
                  ? 'Enter or verify salary details, finalize the salary record, and push finalized records to Accountant.'
                  : 'Read-only view of attendance-driven payroll days.'}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">Teacher</label>
                <select value={salaryTeacherId} onChange={(event) => setSalaryTeacherId(event.target.value)} disabled={user?.role === 'teacher'} className="w-full rounded-xl border border-input bg-input-background px-3 py-2 text-sm disabled:opacity-70">
                  {(user?.role === 'teacher' ? allowedTeachers.filter((teacher) => teacher.id === user.id) : allowedTeachers).map((teacher) => (
                    <option key={teacher.id} value={teacher.id}>{teacher.firstName} {teacher.lastName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">Salary Month</label>
                <input type="month" value={salaryMonth} onChange={(event) => setSalaryMonth(event.target.value)} className="w-full rounded-xl border border-input bg-input-background px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">Workflow Status</label>
                <div className="flex items-center rounded-xl border border-input bg-input-background px-3 py-2 text-sm">
                  <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${getSalaryWorkflowBadge(salaryRecord).className}`}>
                    {getSalaryWorkflowBadge(salaryRecord).label}
                  </span>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">Remarks</label>
                <input
                  type="text"
                  value={salaryRemarks}
                  onChange={(event) => setSalaryRemarks(event.target.value)}
                  disabled={!isDraftEditable}
                  placeholder="Optional payroll note"
                  className="w-full rounded-xl border border-input bg-input-background px-3 py-2 text-sm disabled:opacity-70"
                />
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-4">
            <div className="rounded-xl border border-border bg-secondary/25 p-4">
              <p className="text-xs text-muted-foreground">Attendance Present</p>
              <p className="mt-2 text-lg font-semibold text-foreground">{salaryAttendance?.present ?? 0}</p>
            </div>
            <div className="rounded-xl border border-border bg-secondary/25 p-4">
              <p className="text-xs text-muted-foreground">Absent (LOP Days)</p>
              <p className="mt-2 text-lg font-semibold text-foreground">{salaryAttendance?.absent ?? 0}</p>
            </div>
            <div className="rounded-xl border border-border bg-secondary/25 p-4">
              <p className="text-xs text-muted-foreground">Attendance %</p>
              <p className="mt-2 text-lg font-semibold text-foreground">{formatAttendancePercent(salaryAttendance?.percent ?? null)}</p>
            </div>
            <div className="rounded-xl border border-border bg-secondary/25 p-4">
              <p className="text-xs text-muted-foreground">Working Days</p>
              <p className="mt-2 text-lg font-semibold text-foreground">{salaryAttendance?.workingDays ?? 0}</p>
            </div>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-4">
            {canViewPayrollMoney && (
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">Salary Type</label>
                <div className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm text-foreground">
                  {selectedSalaryTeacher ? effectiveSalaryType : '—'}
                </div>
              </div>
            )}
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">
                {isMonthlyFixedTeacher ? 'Total Working Days' : 'Total Number of Classes'}
              </label>
              <input
                type="number"
                min={0}
                value={classesConducted}
                onChange={(event) => setClassesConducted(Number(event.target.value))}
                disabled={!isDraftEditable}
                className="w-full rounded-xl border border-input bg-input-background px-3 py-2 text-sm disabled:opacity-70"
              />
            </div>
            {canViewPayrollMoney && (
              <>
                {isMonthlyFixedTeacher ? (
                  <div>
                    <label className="mb-1 block text-sm font-medium text-foreground">Configured Monthly Salary</label>
                    <div className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm font-medium text-foreground">
                      {selectedSalaryTeacher ? formatIndianCurrency(configuredMonthlyAmount) : '—'}
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="mb-1 block text-sm font-medium text-foreground">Salary Per Class (₹)</label>
                    <input
                      type="number"
                      min={0}
                      value={salaryPerClass}
                      onChange={(event) => setSalaryPerClass(Number(event.target.value))}
                      disabled={!isDraftEditable}
                      className="w-full rounded-xl border border-input bg-input-background px-3 py-2 text-sm disabled:opacity-70"
                    />
                  </div>
                )}
                <div>
                  <label className="mb-1 block text-sm font-medium text-foreground">
                    {salaryRecord?.isFinalized ? 'Finalized Net Salary' : 'Estimated Net Salary'}
                  </label>
                  <div className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                    {selectedSalaryTeacher ? formatIndianCurrency(estimatedPayrollSalary) : '—'}
                  </div>
                </div>
              </>
            )}
          </div>

          {canManageSalary && (
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleSaveSalaryDraft}
                disabled={!isDraftEditable || salaryActionBusy}
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-secondary px-4 py-2 text-sm font-semibold text-foreground hover:bg-secondary/80 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                Save Draft
              </button>

              <button
                type="button"
                onClick={handleFinalizeSalary}
                disabled={!isDraftEditable || salaryActionBusy}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <CheckCircle2 className="h-4 w-4" />
                {salaryRecord?.isFinalized ? 'Salary Finalized' : 'Finalize Salary'}
              </button>

              <button
                type="button"
                onClick={handlePushToAccountant}
                disabled={!salaryRecord?.isFinalized || Boolean(salaryRecord?.pushedToAccountant) || salaryActionBusy}
                title={
                  !salaryRecord?.isFinalized
                    ? 'Only finalized salary records can be pushed to the Accountant.'
                    : salaryRecord.pushedToAccountant
                      ? 'Already pushed to Accountant.'
                      : 'Transfer finalized salary record to Accountant Portal'
                }
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
                {salaryRecord?.pushedToAccountant ? 'Pushed to Accountant' : 'Push to Accountant'}
              </button>

              {isSuperAdmin && salaryRecord && (salaryRecord.isLocked || salaryRecord.isFinalized || salaryRecord.pushedToAccountant) && (
                <button
                  type="button"
                  onClick={handleUnlockSalary}
                  disabled={salaryActionBusy}
                  className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Unlock className="h-4 w-4" />
                  Unlock Salary
                </button>
              )}

              {salaryRecord?.isFinalized && !salaryRecord?.pushedToAccountant && (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-700 dark:text-indigo-300">
                  <Lock className="h-3.5 w-3.5" /> Finalized by {salaryRecord.finalizedBy || 'Admin'} — ready to push to Accountant.
                </span>
              )}
              {salaryRecord?.pushedToAccountant && (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-700 dark:text-sky-300">
                  <Lock className="h-3.5 w-3.5" /> Pushed by {salaryRecord.pushedBy || 'Admin'} • Payslip: {salaryRecord.payslipStatus || 'Pending Generation'}
                </span>
              )}
            </div>
          )}

          {salaryFeedback && (
            <div
              className={`mt-4 rounded-xl border px-3 py-2 text-sm ${
                salaryFeedback.type === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300'
                  : 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300'
              }`}
            >
              {salaryFeedback.message}
            </div>
          )}
        </div>

        {canManageSalary && (
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Monthly Salary Review &amp; Push Queue ({salaryMonth})</h2>
                <p className="text-sm text-muted-foreground">Review entered teacher salaries for {salaryMonth}, finalize verified drafts, and push finalized records to Accountant.</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ['all', 'All'],
                    ['not_saved', 'Not Saved'],
                    ['draft', 'Draft'],
                    ['finalized', 'Ready to Push'],
                    ['pushed', 'Pushed'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setQueueFilter(key)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                      queueFilter === key
                        ? 'bg-primary text-primary-foreground'
                        : 'border border-border bg-secondary text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="py-3 pr-3 font-semibold">Teacher</th>
                    <th className="py-3 pr-3 font-semibold">Branch</th>
                    <th className="py-3 pr-3 font-semibold">Salary Type</th>
                    <th className="py-3 pr-3 font-semibold">Attendance (P / A / W)</th>
                    <th className="py-3 pr-3 text-right font-semibold">Classes / Days</th>
                    <th className="py-3 pr-3 text-right font-semibold">Net Salary</th>
                    <th className="py-3 pr-3 font-semibold">Status</th>
                    <th className="py-3 pr-3 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyPayrollRows.map(({ teacher, record, attendance: att }) => {
                    const badge = getSalaryWorkflowBadge(record);
                    const rowBusy = queueBusyTeacherId === teacher.id;
                    return (
                      <tr key={teacher.id} className="border-b border-border/60 hover:bg-secondary/30">
                        <td className="py-3 pr-3">
                          <div className="font-medium text-foreground">{teacher.firstName} {teacher.lastName}</div>
                          <div className="font-mono text-xs text-muted-foreground">{teacher.id}</div>
                        </td>
                        <td className="py-3 pr-3 text-muted-foreground">{getBranchName(teacher.branchId) || '—'}</td>
                        <td className="py-3 pr-3 text-foreground">{record?.salaryType || teacher.salaryType || 'Monthly Fixed'}</td>
                        <td className="py-3 pr-3 text-muted-foreground">{att.present} / {att.absent} / {att.workingDays}</td>
                        <td className="py-3 pr-3 text-right text-foreground">{record ? record.classesConducted : '—'}</td>
                        <td className="py-3 pr-3 text-right font-semibold text-foreground">
                          {record ? formatIndianCurrency(record.calculatedSalary) : '—'}
                        </td>
                        <td className="py-3 pr-3">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${badge.className}`}>
                            {badge.label}
                          </span>
                        </td>
                        <td className="py-3 pr-3">
                          <div className="flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setSalaryTeacherId(teacher.id);
                                document.getElementById('payroll-reference-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                              }}
                              className="rounded-lg border border-border bg-secondary px-2.5 py-1.5 text-xs font-semibold text-foreground hover:bg-secondary/80"
                            >
                              {record?.isFinalized ? 'View' : 'Edit'}
                            </button>
                            {record && !record.isFinalized && !record.pushedToAccountant && !record.isLocked && (
                              <button
                                type="button"
                                disabled={rowBusy}
                                onClick={() => handleRowFinalize(record)}
                                className="rounded-lg bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                              >
                                Finalize
                              </button>
                            )}
                            {record && record.isFinalized && !record.pushedToAccountant && (
                              <button
                                type="button"
                                disabled={rowBusy}
                                onClick={() => handleRowPush(record)}
                                className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                              >
                                Push to Accountant
                              </button>
                            )}
                            {isSuperAdmin && record && (record.isLocked || record.isFinalized || record.pushedToAccountant) && (
                              <button
                                type="button"
                                disabled={rowBusy}
                                onClick={() => handleRowUnlock(record)}
                                className="rounded-lg bg-amber-500 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
                              >
                                Unlock
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {monthlyPayrollRows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-sm text-muted-foreground">
                        No teachers match the selected queue filter for {salaryMonth}.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold text-foreground">Monthly Attendance History</h2>
            </div>
            <div className="flex gap-2">
              <input type="month" value={exportMonth} onChange={(event) => setExportMonth(event.target.value)} className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm" />
              <button type="button" onClick={() => handleExportMonth('pdf')} className="flex items-center gap-2 rounded-xl border border-border bg-secondary px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-secondary/80">
                <FileDown className="h-4 w-4" /> Export PDF
              </button>
              <button type="button" onClick={() => handleExportMonth('excel')} className="flex items-center gap-2 rounded-xl border border-border bg-secondary px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-secondary/80">
                <FileSpreadsheet className="h-4 w-4" /> Export Excel
              </button>
            </div>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {history.map(({ teacher, history: summary }) => (
              <div key={teacher.id} className="rounded-xl border border-border bg-secondary/30 p-4">
                <p className="font-semibold text-foreground">{teacher.firstName} {teacher.lastName}</p>
                <p className="text-sm text-muted-foreground">{teacher.department || 'Department not set'} • {attendanceMonth}</p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-lg bg-background/70 p-2"><span className="block text-muted-foreground">Present</span><span className="font-semibold text-foreground">{summary.present}</span></div>
                  <div className="rounded-lg bg-background/70 p-2"><span className="block text-muted-foreground">Absent</span><span className="font-semibold text-foreground">{summary.absent}</span></div>
                  <div className="rounded-lg bg-background/70 p-2"><span className="block text-muted-foreground">Holiday</span><span className="font-semibold text-foreground">{summary.holiday}</span></div>
                  <div className="rounded-lg bg-background/70 p-2"><span className="block text-muted-foreground">Attendance %</span><span className="font-semibold text-foreground">{formatAttendancePercent(summary.percent)}</span></div>
                  <div className="col-span-2 rounded-lg bg-background/70 p-2"><span className="block text-muted-foreground">Working Days</span><span className="font-semibold text-foreground">{summary.workingDays}</span></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
