import { useState, useEffect, useMemo } from 'react';
import { Header } from '../components/Header';
import { useAuth } from '../auth/AuthContext';
import { useBranches, getBranchName } from '../lib/branchService';
import { getStudentsForClass } from '../lib/studentService';
import { fetchAttendance as fetchAttendanceRecords } from '../lib/attendanceService';
import { saveAttendanceAPI } from '../lib/attendanceService';
import { CheckCircle2, XCircle, ChevronRight, Save, Mail, AlertCircle, MessageSquare, CalendarOff, Trash2, FileDown, FileSpreadsheet } from 'lucide-react';
import { apiFetch } from '../lib/apiClient';
import { useHolidays, refreshHolidays, isHoliday, createHoliday, deleteHoliday } from '../lib/holidayService';
import { useClasses, getClassesForBranch, getClassesForTeacher } from '../lib/classService';
import { exportDailyAttendanceToExcel, exportMonthlyAttendanceToExcel, exportMonthlyAttendanceToPdf } from '../lib/reportExport';
import { attendancePercent, buildMonthlyAttendanceMatrix, countAttendance, type AttendanceMark } from '../lib/attendanceMath';

const TODAY = new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
const TODAY_ISO = new Date().toISOString().split('T')[0];
const YESTERDAY_ISO = new Date(Date.now() - 86400000).toISOString().split('T')[0];

export function Attendance() {
  const { user } = useAuth();
  const branches = useBranches();
  const isAdminOrSuper = user?.role === 'admin' || user?.role === 'super_admin';
  const isTeacherOnly = user?.role === 'teacher';
  const [selectedClass, setSelectedClass] = useState('');
  const [selectedBoard, setSelectedBoard] = useState('');
  const [branchFilter, setBranchFilter] = useState(user?.role === 'super_admin' ? '' : user?.branchId ?? '');

  // Attendance is batch-based now: pick a batch (its board comes along with
  // it) instead of a fixed standard + a separately-chosen board.
  useClasses();
  const batchOptions = isTeacherOnly
    ? getClassesForTeacher(user?.id, user?.branchId)
    : getClassesForBranch(branchFilter || user?.branchId);
  const [attendance, setAttendance] = useState<Record<string, AttendanceMark>>({});
  const [saved, setSaved] = useState(false);
  const [students, setStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [recentRecords, setRecentRecords] = useState<any[]>([]);
  const [showAllRecent, setShowAllRecent] = useState(false);

  // Only super_admin can mark attendance for yesterday (e.g. catching up on a
  // missed submission) — everyone else stays locked to today, as before.
  const [markDate, setMarkDate] = useState(TODAY_ISO);
  const isSuperAdmin = user?.role === 'super_admin' || user?.role === 'admin'; // admins may also correct yesterday's attendance

  // Monthly export for the selected batch
  const [exportYear, setExportYear] = useState(Number(TODAY_ISO.slice(0, 4)));
  const [exportMonthNum, setExportMonthNum] = useState(Number(TODAY_ISO.slice(5, 7)));
  const exportMonth = `${exportYear}-${String(exportMonthNum).padStart(2, '0')}`;
  const [exporting, setExporting] = useState(false);

  // Holidays (the calendar is the single source of truth for non-class days)
  const holidays = useHolidays();
  const [showHolidayForm, setShowHolidayForm] = useState(false);
  const [holidayTitle, setHolidayTitle] = useState('');
  const [isSavingHoliday, setIsSavingHoliday] = useState(false);
  const [holidayError, setHolidayError] = useState<string | null>(null);

  useEffect(() => {
    void refreshHolidays({ branchId: branchFilter || undefined });
  }, [branchFilter]);

  const todaysHoliday = useMemo(() => isHoliday(holidays, markDate, branchFilter || user?.branchId), [holidays, branchFilter, user?.branchId, markDate]);

  // WhatsApp Specific States
  const [whatsappStatus, setWhatsappStatus] = useState<Record<string, 'idle' | 'sending' | 'success' | 'failed'>>({});
  const [officialContact, setOfficialContact] = useState('6363099546');

  // Modals States
  const [showSingleModal, setShowSingleModal] = useState(false);
  const [activeStudent, setActiveStudent] = useState<any>(null);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkSending, setBulkSending] = useState(false);

  // Fetch settings to load official tutorial contact number
  useEffect(() => {
    apiFetch('/api/settings')
      .then((res) => res.json())
      .then((data) => {
        if (data && data.official_contact) {
          setOfficialContact(data.official_contact);
        }
      })
      .catch((err) => console.error('Failed to load official contact settings', err));
  }, []);

  // Fetch recent attendance from the backend and aggregate present/total per class+date
  const loadRecentAttendance = async () => {
    // Server-side branch scoping (via the classes join added for batch-based
    // attendance) replaces the old client-side "is this a known standard"
    // filter, which didn't actually scope by branch at all.
    const records = await fetchAttendanceRecords(undefined, undefined, isAdminOrSuper ? (branchFilter || undefined) : user?.branchId);
    const groups = new Map<string, { class: string; date: string; present: number; absent: number; total: number; sortKey: string }>();
    for (const r of records) {
      const key = `${r.className}__${r.date}`;
      const g = groups.get(key) || { class: r.className, date: r.date, present: 0, absent: 0, total: 0, sortKey: r.date };
      // Holidays (marked or on the calendar) are never classes, so they stay out of the total.
      if (isHoliday(holidays, r.date.slice(0, 10), (r as any).branchId || branchFilter || user?.branchId)) continue;
      if (r.status === 'present') { g.present += 1; g.total += 1; }
      else if (r.status === 'absent') { g.absent += 1; g.total += 1; }
      groups.set(key, g);
    }
    const sorted = Array.from(groups.values()).sort((a, b) => b.sortKey.localeCompare(a.sortKey));
    setRecentRecords(sorted.filter((g) => g.total > 0).map((g) => ({
      class: g.class,
      percent: attendancePercent(g.total, g.absent),
      date: g.date === TODAY_ISO ? 'Today' : new Date(g.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
      present: g.present,
      total: g.total,
    })));
  };

  useEffect(() => {
    loadRecentAttendance();
  }, [branchFilter]);

  // Fetch students for selected class, board and branch. Board is optional —
  // most batches are created without one, and gating the roster on it made
  // those batches show an empty attendance sheet even with students enrolled.
  useEffect(() => {
    if (!selectedClass) {
      setStudents([]);
      return;
    }
    setLoading(true);
    const url = `/api/students?className=${encodeURIComponent(selectedClass)}` +
                (selectedBoard ? `&batch=${encodeURIComponent(selectedBoard)}` : '') +
                (branchFilter ? `&branchId=${encodeURIComponent(branchFilter)}` : '');

    apiFetch(url)
      .then((res) => res.json())
      .then((data) => {
        // Server returns students regardless of status; attendance is only taken for active enrollments
        // (also drops soft-deleted duplicate records, which otherwise show up as an extra row here).
        const activeData = Array.isArray(data) ? data.filter((s: any) => s.status !== 'Inactive') : data;
        if (Array.isArray(activeData) && activeData.length > 0) {
          const mapped = activeData.map((s: any) => ({
            id: s.id,
            name: `${s.firstName} ${s.lastName}`,
            branchId: s.branchId,
            className: s.className,
            primaryParentName: s.primaryParentName || 'Parent',
            primaryParentMobile: s.primaryParentMobile || ''
          }));
          setStudents(mapped);

          // Try to load existing attendance records (falls back to seeded attendance)
          void fetchAttendanceRecords(selectedClass, markDate).then((records) => {
            const map: Record<string, AttendanceMark> = {};
            mapped.forEach((s: any) => {
              const r = Array.isArray(records) ? records.find((rec) => rec.studentId === s.id) : undefined;
              if (r) { map[s.id] = r.status; return; }
              map[s.id] = isHoliday(holidays, markDate, branchFilter || s.branchId) ? 'holiday' : 'present';
            });
            setAttendance(map);
          });
          setWhatsappStatus({}); // Clear WhatsApp tracking status
          setSaved(false);
        } else {
          // Fallback to in-memory students when API returns no data
          const local = getStudentsForClass(selectedClass, branchFilter, selectedBoard).filter((s: any) => s.status !== 'Inactive');
          const mapped = local.map((s) => ({
            id: s.id,
            name: `${s.firstName} ${s.lastName}`,
            branchId: s.branchId,
            className: s.className,
            primaryParentName: s.primaryParentName || 'Parent',
            primaryParentMobile: s.primaryParentMobile || ''
          }));
          setStudents(mapped);
          // Load any existing/fallback attendance records
          void fetchAttendanceRecords(selectedClass, markDate).then((records) => {
            if (Array.isArray(records) && records.length > 0) {
              const map: Record<string, 'present' | 'absent'> = {};
              mapped.forEach((s: any) => {
                const r = records.find((rec) => rec.studentId === s.id);
                map[s.id] = r ? r.status : 'present';
              });
              setAttendance(map);
            } else {
              const initialAttendance: Record<string, 'present' | 'absent'> = {};
              mapped.forEach((s: any) => { initialAttendance[s.id] = 'present'; });
              setAttendance(initialAttendance);
            }
          });
          setWhatsappStatus({});
          setSaved(false);
        }
      })
      .catch((err) => {
        console.error('Failed to load students for class (API), falling back to local cache', err);
        const local = getStudentsForClass(selectedClass, branchFilter, selectedBoard).filter((s: any) => s.status !== 'Inactive');
        const mapped = local.map((s) => ({
          id: s.id,
          name: `${s.firstName} ${s.lastName}`,
          branchId: s.branchId,
          className: s.className,
          primaryParentName: s.primaryParentName || 'Parent',
          primaryParentMobile: s.primaryParentMobile || ''
        }));
        setStudents(mapped);
        const initialAttendance: Record<string, 'present' | 'absent'> = {};
        mapped.forEach((s: any) => { initialAttendance[s.id] = 'present'; });
        setAttendance(initialAttendance);
        setWhatsappStatus({});
        setSaved(false);
      })
      .finally(() => setLoading(false));
  }, [selectedClass, selectedBoard, branchFilter, markDate, holidays]);


  const markAll = (status: AttendanceMark) => {
    const all: Record<string, AttendanceMark> = {};
    students.forEach((s) => { all[s.id] = status; });
    setAttendance(all);
    setSaved(false);
  };

  // Marks the selected date as a holiday on the shared holiday calendar — it
  // then shows up in every portal, report and attendance percentage (holidays
  // are excluded from total classes, never counted as absences).
  const handleMarkHoliday = async () => {
    if (!holidayTitle.trim()) { setHolidayError('Enter a title for the holiday.'); return; }
    setIsSavingHoliday(true);
    setHolidayError(null);
    const created = await createHoliday({ date: markDate, title: holidayTitle.trim(), branchId: branchFilter || user?.branchId || undefined });
    setIsSavingHoliday(false);
    if (created) {
      setShowHolidayForm(false);
      setHolidayTitle('');
      await refreshHolidays({ branchId: branchFilter || undefined });
    } else {
      setHolidayError('Could not mark this date as a holiday (it may already be one).');
    }
  };

  const handleRemoveHoliday = async () => {
    if (!todaysHoliday) return;
    await deleteHoliday(todaysHoliday.id);
    await refreshHolidays({ branchId: branchFilter || undefined });
  };

  const handleSave = async () => {
    if (!selectedClass) return;
    const ok = await saveAttendanceAPI(selectedClass, markDate, attendance, user?.name || 'Teacher');
    if (ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      loadRecentAttendance();
    } else {
      alert('Failed to save attendance records.');
    }
  };

  // Same matrix feeds the Excel and the PDF (and the Parent portal's reports).
  const selectedBatch = batchOptions.find((b) => b.className === selectedClass);
  const reportBranchId = branchFilter || user?.branchId || selectedBatch?.branchId || '';
  const buildMonthlyMatrix = async () => {
    const records = await fetchAttendanceRecords(selectedClass, undefined, branchFilter || undefined, undefined, exportMonth);
    const branchHolidays = holidays.filter((h) => !h.branchId || h.branchId === reportBranchId);
    const matrix = buildMonthlyAttendanceMatrix({
      month: exportMonth,
      students: students.map((s) => ({ id: s.id, name: s.name })),
      records,
      holidays: branchHolidays,
    });
    const meta: Array<[string, string]> = [
      ['Class', selectedClass],
      ['Batch', selectedBoard || '—'],
      ['Branch', getBranchName(reportBranchId) || '—'],
    ];
    return { matrix, meta };
  };

  const handleExportDay = async () => {
    if (!selectedClass) return;
    const records = await fetchAttendanceRecords(selectedClass, markDate, branchFilter || undefined);
    const byId = new Map(records.map((r) => [r.studentId, r.status]));
    exportDailyAttendanceToExcel(
      students.map((s) => ({ name: s.name, id: s.id, status: byId.get(s.id) ?? 'not marked' })),
      `Attendance — ${selectedClass}`,
      markDate,
    );
  };

  const handleExportMonth = async (format: 'pdf' | 'excel') => {
    if (!selectedClass) return;
    setExporting(true);
    try {
      const { matrix, meta } = await buildMonthlyMatrix();
      const title = `Attendance — ${selectedClass}`;
      if (format === 'excel') exportMonthlyAttendanceToExcel(matrix, meta, title);
      else await exportMonthlyAttendanceToPdf(matrix, meta, title, user?.name || 'Admin');
    } finally {
      setExporting(false);
    }
  };

  // Trigger manual WhatsApp for a single student via Click-to-Chat URL
  const sendSingleWhatsapp = (student: any) => {
    setShowSingleModal(false);

    const mobile = student.primaryParentMobile;
    if (!mobile || mobile.trim() === '') {
      alert(`Parent mobile number not configured for ${student.name}`);
      setWhatsappStatus((prev) => ({ ...prev, [student.id]: 'failed' }));
      return;
    }

    // Clean mobile number to contain digits only
    let cleanMobile = mobile.replace(/\D/g, '');
    if (cleanMobile.length === 10) {
      cleanMobile = '91' + cleanMobile;
    } else if (cleanMobile.length === 12 && cleanMobile.startsWith('91')) {
      // already has 91 prefix
    } else {
      alert(`Invalid parent mobile number configured for ${student.name}: ${mobile}`);
      setWhatsappStatus((prev) => ({ ...prev, [student.id]: 'failed' }));
      return;
    }

    const message = `📢 *Guru Shishyaru Tutorials*\n\n` +
      `Dear Parent,\n\n` +
      `This is to inform you that your ward *${student.name}* studying in *${student.className || selectedClass}* has been marked *ABSENT* for the class on ${markDate}.\n\n` +
      `📅 Date:\n${markDate}\n\n` +
      `If this absence was unexpected, kindly contact the tutorial for clarification.\n\n` +
      `📞 Contact:\n${officialContact}\n\n` +
      `Thank you.\n\n` +
      `*Guru Shishyaru Tutorials*`;

    try {
      const url = `https://wa.me/${cleanMobile}?text=${encodeURIComponent(message)}`;
      window.open(url, '_blank');
      setWhatsappStatus((prev) => ({ ...prev, [student.id]: 'success' }));
    } catch (err) {
      console.error(err);
      setWhatsappStatus((prev) => ({ ...prev, [student.id]: 'failed' }));
    }
  };

  // Trigger manual bulk WhatsApp for all absent students via Click-to-Chat URLs.
  // Must stay synchronous: browsers only allow window.open() while a click's
  // "user activation" is still active. Any await (the old 800ms setTimeout
  // delay) between calls burns that activation, so every popup after the
  // first got silently blocked — this is why it looked like only one message
  // sent before it "stopped".
  const sendBulkWhatsapp = () => {
    setShowBulkModal(false);
    setBulkSending(true);

    const absentStudents = students.filter(
      (s) => attendance[s.id] === 'absent' && whatsappStatus[s.id] !== 'success'
    );

    // Loop through each absent student sequentially
    for (const student of absentStudents) {
      const mobile = student.primaryParentMobile;
      if (!mobile || mobile.trim() === '') {
        setWhatsappStatus((prev) => ({ ...prev, [student.id]: 'failed' }));
        continue;
      }

      let cleanMobile = mobile.replace(/\D/g, '');
      if (cleanMobile.length === 10) {
        cleanMobile = '91' + cleanMobile;
      } else if (cleanMobile.length === 12 && cleanMobile.startsWith('91')) {
        // already has 91 prefix
      } else {
        setWhatsappStatus((prev) => ({ ...prev, [student.id]: 'failed' }));
        continue;
      }

      const message = `📢 *Guru Shishyaru Tutorials*\n\n` +
        `Dear Parent,\n\n` +
        `This is to inform you that your ward *${student.name}* studying in *${student.className || selectedClass}* has been marked *ABSENT* for the class on ${markDate}.\n\n` +
        `📅 Date:\n${markDate}\n\n` +
        `If this absence was unexpected, kindly contact the tutorial for clarification.\n\n` +
        `📞 Contact:\n${officialContact}\n\n` +
        `Thank you.\n\n` +
        `*Guru Shishyaru Tutorials*`;

      try {
        const url = `https://wa.me/${cleanMobile}?text=${encodeURIComponent(message)}`;
        window.open(url, '_blank');
        setWhatsappStatus((prev) => ({ ...prev, [student.id]: 'success' }));
      } catch (err) {
        console.error(err);
        setWhatsappStatus((prev) => ({ ...prev, [student.id]: 'failed' }));
      }
    }

    setBulkSending(false);
  };

  const handleSingleWhatsappClick = (student: any) => {
    setActiveStudent(student);
    setShowSingleModal(true);
  };

  const handleBulkWhatsappClick = () => {
    setShowBulkModal(true);
  };

  const presentCount = Object.values(attendance).filter((v) => v === 'present').length;
  const absentCount  = Object.values(attendance).filter((v) => v === 'absent').length;
  const holidayCount = Object.values(attendance).filter((v) => v === 'holiday').length;
  const unmarked     = students.filter((s) => !attendance[s.id]).length;

  // Count absent students that have not successfully sent WhatsApp yet
  const pendingWhatsappCount = students.filter(
    (s) => attendance[s.id] === 'absent' && whatsappStatus[s.id] !== 'success'
  ).length;

  return (
    <div className="flex-1 bg-background">
      <Header title="Attendance" />

      <div className="max-w-3xl mx-auto p-6 space-y-6">

        {/* ── Date + Today summary ── */}
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Today</p>
              <p className="mt-1 text-lg font-bold text-foreground">{TODAY}</p>
            </div>
            {isSuperAdmin && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setMarkDate(TODAY_ISO); setSaved(false); }}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${markDate === TODAY_ISO ? 'bg-primary text-primary-foreground' : 'border border-border bg-secondary text-muted-foreground hover:bg-secondary/80'}`}
                >
                  Mark Today
                </button>
                <button
                  type="button"
                  onClick={() => { setMarkDate(YESTERDAY_ISO); setSaved(false); }}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${markDate === YESTERDAY_ISO ? 'bg-primary text-primary-foreground' : 'border border-border bg-secondary text-muted-foreground hover:bg-secondary/80'}`}
                >
                  Mark Yesterday
                </button>
                <input
                  type="date"
                  max={TODAY_ISO}
                  value={markDate}
                  onChange={(e) => { if (e.target.value) { setMarkDate(e.target.value); setSaved(false); } }}
                  className="rounded-lg border border-input bg-input-background px-2 py-1 text-xs focus:border-primary focus:outline-none"
                  aria-label="Attendance date"
                />
              </div>
            )}
          </div>
          {isSuperAdmin && markDate !== TODAY_ISO && (
            <p className="mt-3 text-xs font-semibold text-amber-600 dark:text-amber-400">Editing attendance for {markDate}.</p>
          )}
        </div>

        {todaysHoliday && (
          <div className="flex items-center gap-3 rounded-2xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-4">
            <CalendarOff className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
              {markDate === TODAY_ISO ? 'Today' : markDate} is a holiday — <span className="font-semibold">{todaysHoliday.title}</span>. Attendance isn't required, but you can still mark it below if this is a makeup class.
            </p>
            {isAdminOrSuper && (
              <button type="button" onClick={handleRemoveHoliday} className="ml-auto shrink-0 rounded-lg border border-amber-300 px-3 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100 dark:text-amber-300">Remove holiday</button>
            )}
          </div>
        )}

        {/* ── Step 1: Select Batch ── */}
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          {user?.role === 'super_admin' && (
            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium text-foreground">Branch</label>
              <select value={branchFilter} onChange={(event) => { setBranchFilter(event.target.value); setSelectedClass(''); setSelectedBoard(''); setAttendance({}); setSaved(false); }} className="w-full rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none">
                <option value="">All Branches</option>
                {branches.filter((branch) => branch.status === 'Active').map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </select>
            </div>
          )}
          <h2 className="mb-4 text-base font-semibold text-foreground">
            <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">1</span>
            Select Batch
          </h2>
          {batchOptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {isTeacherOnly ? 'No batch has been assigned yet.' : 'No batches exist for this branch yet — create one from Batches first.'}
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {batchOptions.map((b) => (
                <button
                  key={b.id}
                  onClick={() => { setSelectedClass(b.className); setSelectedBoard(b.board || ''); setAttendance({}); setSaved(false); }}
                  className={`rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition-all ${
                    selectedClass === b.className
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-secondary text-foreground hover:border-primary/40'
                  }`}
                >
                  <span className="block">{b.className}</span>
                  {b.board && <span className="block text-xs opacity-80">{b.board}</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Step 2: Mark Attendance ── */}
        {selectedClass && (
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-foreground">
                <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">2</span>
                Mark Attendance — {selectedClass}{selectedBoard ? ` (${selectedBoard})` : ''}{markDate !== TODAY_ISO ? ` — ${markDate}` : ''}
              </h2>
              <div className="flex gap-2">
                <button
                  onClick={() => markAll('present')}
                  className="rounded-lg bg-green-100 dark:bg-green-900/40 px-3 py-1.5 text-xs font-semibold text-green-700 dark:text-green-400 transition-colors hover:bg-green-200"
                >
                  All Present
                </button>
                <button
                  onClick={() => markAll('absent')}
                  className="rounded-lg bg-red-100 dark:bg-red-900/40 px-3 py-1.5 text-xs font-semibold text-red-600 dark:text-red-400 transition-colors hover:bg-red-200"
                >
                  All Absent
                </button>
                <button
                  onClick={() => { setShowHolidayForm((v) => !v); setHolidayError(null); }}
                  className="flex items-center gap-1 rounded-lg bg-amber-100 dark:bg-amber-900/40 px-3 py-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400 transition-colors hover:bg-amber-200"
                >
                  <CalendarOff className="h-3.5 w-3.5" /> Mark Holiday
                </button>
              </div>
            </div>

            {showHolidayForm && (
              <div className="mb-4 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/20 p-4 space-y-3">
                <p className="text-sm font-semibold text-foreground">Mark {markDate === TODAY_ISO ? 'today' : markDate} as a holiday</p>
                <input type="text" value={holidayTitle} onChange={(e) => setHolidayTitle(e.target.value)} placeholder="Holiday title (e.g. Diwali)" className="w-full rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:border-primary focus:outline-none" />
                {holidayError && <p className="text-xs text-destructive">{holidayError}</p>}
                <div className="flex gap-2">
                  <button onClick={handleMarkHoliday} disabled={isSavingHoliday} className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-amber-700 disabled:opacity-50">
                    {isSavingHoliday ? 'Saving...' : 'Save Holiday'}
                  </button>
                  <button onClick={() => setShowHolidayForm(false)} className="rounded-lg border border-border px-4 py-2 text-xs font-medium text-foreground hover:bg-secondary">Cancel</button>
                </div>
              </div>
            )}

            {loading ? (
              <div className="text-center py-6 text-sm text-muted-foreground">Loading class student profiles...</div>
            ) : students.length === 0 ? (
              <div className="text-center py-6 text-sm text-muted-foreground">No students enrolled in {selectedClass}{selectedBoard ? ` (${selectedBoard})` : ''} for this branch.</div>
            ) : (
              <div className="space-y-2">
                {students.map((s) => {
                  const status = attendance[s.id];
                  return (
                    <div
                      key={s.id}
                      className={`flex flex-wrap items-center justify-between gap-4 rounded-xl border px-4 py-3 transition-all ${
                        status === 'present'
                          ? 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30'
                          : status === 'absent'
                          ? 'border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30'
                          : status === 'holiday'
                          ? 'border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30'
                          : 'border-border bg-secondary/40'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-background text-sm font-bold text-foreground">
                          {s.name.charAt(0)}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground">{s.name}</p>
                          <p className="text-xs text-muted-foreground">{s.id}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {/* Toggle buttons */}
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              setAttendance((p) => ({ ...p, [s.id]: 'present' }));
                              // Clear WhatsApp status if changed to present
                              setWhatsappStatus((p) => {
                                const copy = { ...p };
                                delete copy[s.id];
                                return copy;
                              });
                            }}
                            className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all active:scale-95 ${
                              status === 'present'
                                ? 'bg-green-600 text-white'
                                : 'border border-border bg-card text-muted-foreground hover:bg-secondary'
                            }`}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Present
                          </button>
                          <button
                            onClick={() => setAttendance((p) => ({ ...p, [s.id]: 'absent' }))}
                            className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all active:scale-95 ${
                              status === 'absent'
                                ? 'bg-red-500 text-white'
                                : 'border border-border bg-card text-muted-foreground hover:bg-secondary'
                            }`}
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            Absent
                          </button>
                          <button
                            onClick={() => setAttendance((p) => ({ ...p, [s.id]: 'holiday' }))}
                            className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all active:scale-95 ${
                              status === 'holiday'
                                ? 'bg-amber-500 text-white'
                                : 'border border-border bg-card text-muted-foreground hover:bg-secondary'
                            }`}
                          >
                            <CalendarOff className="h-3.5 w-3.5" />
                            Holiday
                          </button>
                        </div>

                        {/* 📲 Send WhatsApp Action (Only for Absent) */}
                        {status === 'absent' && (
                          <div className="flex items-center gap-2">
                            {whatsappStatus[s.id] === 'success' ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/20 px-2.5 py-1.5 rounded-lg border border-green-200 dark:border-green-800">
                                ✅ WhatsApp Sent
                              </span>
                            ) : whatsappStatus[s.id] === 'failed' ? (
                              <div className="flex items-center gap-1.5">
                                <span className="text-[11px] font-semibold text-red-500 bg-red-50 dark:bg-red-950/20 px-2 py-1.5 rounded-lg border border-red-200 dark:border-red-900">
                                  ❌ Failed
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleSingleWhatsappClick(s)}
                                  className="rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1.5 text-[11px] font-bold transition-all active:scale-95"
                                >
                                  Retry
                                </button>
                              </div>
                            ) : whatsappStatus[s.id] === 'sending' ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 px-2.5 py-1.5 rounded-lg">
                                Sending...
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleSingleWhatsappClick(s)}
                                className="rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 text-[11px] font-bold transition-all active:scale-95"
                              >
                                📲 Send WhatsApp
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Summary + Save */}
            {students.length > 0 && !loading && (
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-secondary/60 px-4 py-3">
                <div className="flex gap-4 text-sm">
                  <span className="font-semibold text-green-600 dark:text-green-400">✓ Present: {presentCount}</span>
                  <span className="font-semibold text-red-500">✗ Absent: {absentCount}</span>
                  {holidayCount > 0 && <span className="font-semibold text-amber-600 dark:text-amber-400">🏖 Holiday: {holidayCount}</span>}
                  {unmarked > 0 && <span className="text-muted-foreground">○ Unmarked: {unmarked}</span>}
                </div>
                
                <div className="flex gap-2">
                  {/* Bulk WhatsApp Trigger Button */}
                  {pendingWhatsappCount > 0 && (
                    <button
                      type="button"
                      disabled={bulkSending}
                      onClick={handleBulkWhatsappClick}
                      className="flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white px-4 py-2.5 text-sm font-semibold transition-all active:scale-95"
                    >
                      <Mail className="h-4 w-4" />
                      {bulkSending ? 'Sending Bulk...' : '📲 Notify All Absent Parents'}
                    </button>
                  )}

                  <button
                    onClick={handleSave}
                    disabled={unmarked > 0}
                    className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${
                      saved ? 'bg-green-600' : 'bg-primary hover:opacity-90'
                    }`}
                  >
                    <Save className="h-4 w-4" />
                    {saved ? '✓ Saved!' : unmarked > 0 ? `Mark all (${unmarked} remaining)` : 'Save Attendance'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Monthly Export ── */}
        {selectedClass && (
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <h2 className="mb-4 text-base font-semibold text-foreground">Monthly Attendance Report — {selectedClass}</h2>
            <div className="flex flex-wrap items-center gap-3">
              <select value={exportMonthNum} onChange={(event) => setExportMonthNum(Number(event.target.value))} aria-label="Month" className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:border-primary focus:outline-none">
                {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map((name, i) => <option key={name} value={i + 1}>{name}</option>)}
              </select>
              <select value={exportYear} onChange={(event) => setExportYear(Number(event.target.value))} aria-label="Year" className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:border-primary focus:outline-none">
                {Array.from({ length: 6 }, (_, i) => Number(TODAY_ISO.slice(0, 4)) - 4 + i).map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              <button
                type="button"
                disabled={exporting}
                onClick={() => handleExportMonth('pdf')}
                className="flex items-center gap-2 rounded-xl border border-border bg-secondary px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-secondary/80 disabled:opacity-50"
              >
                <FileDown className="h-4 w-4" /> Export PDF
              </button>
              <button
                type="button"
                disabled={exporting}
                onClick={() => handleExportMonth('excel')}
                className="flex items-center gap-2 rounded-xl border border-border bg-secondary px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-secondary/80 disabled:opacity-50"
              >
                <FileSpreadsheet className="h-4 w-4" /> Monthly Excel
              </button>
              <button
                type="button"
                onClick={handleExportDay}
                className="flex items-center gap-2 rounded-xl border border-border bg-secondary px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-secondary/80"
              >
                <FileSpreadsheet className="h-4 w-4" /> Daily Excel ({markDate})
              </button>
            </div>
          </div>
        )}

        {/* ── Recent Records ── */}
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-foreground">Recent Attendance</h2>
            {recentRecords.length > 5 && (
              <button
                onClick={() => setShowAllRecent((v) => !v)}
                className="flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                {showAllRecent ? 'Show less' : `View all ${recentRecords.length}`} <ChevronRight className={`h-3.5 w-3.5 transition-transform ${showAllRecent ? 'rotate-90' : ''}`} />
              </button>
            )}
          </div>
          {recentRecords.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">No attendance records yet.</p>
          )}
          <div className="space-y-2">
            {recentRecords.slice(0, showAllRecent ? recentRecords.length : 5).map((r, i) => {
              const pct = r.percent;
              return (
                <div key={i} className="flex items-center gap-4 rounded-xl border border-border bg-secondary/40 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">{r.class}</p>
                    <p className="text-xs text-muted-foreground">{r.date}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-foreground">{r.present}/{r.total}</p>
                    <p className={`text-xs font-medium ${(pct ?? 0) >= 90 ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}>
                      {pct === null ? '—' : `${pct}%`}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

      </div>

      {/* ── Modal: Single WhatsApp Preview ── */}
      {showSingleModal && activeStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 border-b border-border pb-3">
              <MessageSquare className="h-5 w-5 text-emerald-500" />
              <h3 className="text-lg font-bold text-foreground">Confirm WhatsApp Alert</h3>
            </div>

            <div className="space-y-2 text-sm">
              <div className="grid grid-cols-3">
                <span className="text-muted-foreground font-medium">Student Name:</span>
                <span className="col-span-2 text-foreground font-semibold">{activeStudent.name}</span>
              </div>
              <div className="grid grid-cols-3">
                <span className="text-muted-foreground font-medium">Class:</span>
                <span className="col-span-2 text-foreground font-semibold">{activeStudent.className || selectedClass}</span>
              </div>
              <div className="grid grid-cols-3">
                <span className="text-muted-foreground font-medium">Branch:</span>
                <span className="col-span-2 text-foreground font-semibold">{getBranchName(activeStudent.branchId) || 'N/A'}</span>
              </div>
              <div className="grid grid-cols-3">
                <span className="text-muted-foreground font-medium">Parent Name:</span>
                <span className="col-span-2 text-foreground font-semibold">{activeStudent.primaryParentName}</span>
              </div>
              <div className="grid grid-cols-3">
                <span className="text-muted-foreground font-medium">Parent Mobile:</span>
                <span className="col-span-2 text-foreground font-mono font-semibold">{activeStudent.primaryParentMobile || 'N/A'}</span>
              </div>
              <div className="grid grid-cols-3">
                <span className="text-muted-foreground font-medium">Date:</span>
                <span className="col-span-2 text-foreground font-semibold">{markDate}</span>
              </div>
            </div>

            <div className="rounded-xl bg-secondary/80 p-4 border border-border/80">
              <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider block mb-2">Message Preview</span>
              <div className="text-xs text-foreground leading-relaxed whitespace-pre-line font-medium border-l-2 border-emerald-500 pl-3.5">
                📢 *Guru Shishyaru Tutorials*

                Dear Parent,

                This is to inform you that your ward *{activeStudent.name}* studying in *{activeStudent.className || selectedClass}* has been marked *ABSENT* for today's class.

                📅 Date:
                {markDate}

                If this absence was unexpected, kindly contact the tutorial for clarification.

                📞 Contact:
                {officialContact}

                Thank you.

                *Guru Shishyaru Tutorials*
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setShowSingleModal(false)}
                className="px-4 py-2 text-sm font-semibold rounded-xl border border-border text-foreground hover:bg-secondary transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => sendSingleWhatsapp(activeStudent)}
                className="px-5 py-2 text-sm font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white transition-all active:scale-95"
              >
                Send WhatsApp
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Bulk WhatsApp Preview ── */}
      {showBulkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 border-b border-border pb-3">
              <AlertCircle className="h-5 w-5 text-emerald-500" />
              <h3 className="text-lg font-bold text-foreground">Send Bulk WhatsApp Alerts</h3>
            </div>

            <p className="text-sm text-muted-foreground">
              You are about to dispatch WhatsApp absence alerts to parents of all absent students in this class.
            </p>

            <div className="grid grid-cols-2 gap-4 rounded-xl bg-secondary/80 p-4 border border-border text-center">
              <div>
                <span className="block text-2xl font-bold text-foreground">{pendingWhatsappCount}</span>
                <span className="text-xs text-muted-foreground font-semibold uppercase">Absent Students</span>
              </div>
              <div>
                <span className="block text-2xl font-bold text-foreground">{pendingWhatsappCount}</span>
                <span className="text-xs text-muted-foreground font-semibold uppercase">Parents / WhatsApp</span>
              </div>
            </div>

            <div className="flex justify-between items-center text-xs text-muted-foreground bg-secondary/30 px-3 py-2 rounded-lg">
              <span>Estimated WhatsApp Messages:</span>
              <span className="font-bold text-foreground">{pendingWhatsappCount}</span>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setShowBulkModal(false)}
                className="px-4 py-2 text-sm font-semibold rounded-xl border border-border text-foreground hover:bg-secondary transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={sendBulkWhatsapp}
                className="px-5 py-2 text-sm font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white transition-all active:scale-95"
              >
                Send WhatsApp
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

