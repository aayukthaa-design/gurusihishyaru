import { useState, useEffect, useMemo } from 'react';
import { Header } from '../components/Header';
import { useAuth } from '../auth/AuthContext';
import { useBranches, getBranchName } from '../lib/branchService';
import { getStudentsForClass } from '../lib/studentService';
import { fetchAttendance as fetchAttendanceRecords } from '../lib/attendanceService';
import { saveAttendanceAPI } from '../lib/attendanceService';
import { CheckCircle2, XCircle, ChevronRight, Save, Mail, AlertCircle, MessageSquare, CalendarOff, PlaneTakeoff, Trash2 } from 'lucide-react';
import { apiFetch } from '../lib/apiClient';
import { useHolidays, refreshHolidays, isHoliday, useStudentLeaves, refreshStudentLeaves, createStudentLeave, deleteStudentLeave, isOnLeave } from '../lib/holidayService';
import { useClasses, getClassesForBranch, getClassesForTeacher } from '../lib/classService';

const TODAY = new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
const TODAY_ISO = new Date().toISOString().split('T')[0];

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
  const [attendance, setAttendance] = useState<Record<string, 'present' | 'absent' | 'leave'>>({});
  const [saved, setSaved] = useState(false);
  const [students, setStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [recentRecords, setRecentRecords] = useState<any[]>([]);
  const [showAllRecent, setShowAllRecent] = useState(false);

  // Holidays + per-student leave
  const holidays = useHolidays();
  const leaves = useStudentLeaves();
  const [showLeaveForm, setShowLeaveForm] = useState(false);
  const [leaveStudentId, setLeaveStudentId] = useState('');
  const [leaveStart, setLeaveStart] = useState(TODAY_ISO);
  const [leaveEnd, setLeaveEnd] = useState(TODAY_ISO);
  const [leaveReason, setLeaveReason] = useState('');
  const [isSavingLeave, setIsSavingLeave] = useState(false);

  useEffect(() => {
    void refreshHolidays({ branchId: branchFilter || undefined });
  }, [branchFilter]);

  useEffect(() => {
    if (selectedClass) void refreshStudentLeaves({ branchId: branchFilter || undefined, date: TODAY_ISO });
  }, [selectedClass, branchFilter]);

  const todaysHoliday = useMemo(() => isHoliday(holidays, TODAY_ISO, branchFilter || user?.branchId), [holidays, branchFilter, user?.branchId]);
  const activeLeaves = useMemo(() => leaves.filter((l) => isOnLeave([l], l.studentId, TODAY_ISO)), [leaves]);

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
    const groups = new Map<string, { class: string; date: string; present: number; total: number; sortKey: string }>();
    for (const r of records) {
      if (r.status === 'leave') continue; // approved leave doesn't count against attendance %
      const key = `${r.className}__${r.date}`;
      const g = groups.get(key) || { class: r.className, date: r.date, present: 0, total: 0, sortKey: r.date };
      g.total += 1;
      if (r.status === 'present') g.present += 1;
      groups.set(key, g);
    }
    const sorted = Array.from(groups.values()).sort((a, b) => b.sortKey.localeCompare(a.sortKey));
    setRecentRecords(sorted.map((g) => ({
      class: g.class,
      date: g.date === TODAY_ISO ? 'Today' : new Date(g.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
      present: g.present,
      total: g.total,
    })));
  };

  useEffect(() => {
    loadRecentAttendance();
  }, [branchFilter]);

  // Fetch students for selected class, board and branch
  useEffect(() => {
    if (!selectedClass || !selectedBoard) {
      setStudents([]);
      return;
    }
    setLoading(true);
    const url = `/api/students?className=${encodeURIComponent(selectedClass)}&batch=${encodeURIComponent(selectedBoard)}` +
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
          void fetchAttendanceRecords(selectedClass, TODAY_ISO).then((records) => {
            const map: Record<string, 'present' | 'absent' | 'leave'> = {};
            mapped.forEach((s: any) => {
              const r = Array.isArray(records) ? records.find((rec) => rec.studentId === s.id) : undefined;
              if (r) { map[s.id] = r.status; return; }
              map[s.id] = isOnLeave(leaves, s.id, TODAY_ISO) ? 'leave' : 'present';
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
          void fetchAttendanceRecords(selectedClass, TODAY_ISO).then((records) => {
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
        const local = getStudentsForClass(selectedClass, branchFilter, selectedBoard);
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
  }, [selectedClass, selectedBoard, branchFilter]);


  const markAll = (status: 'present' | 'absent') => {
    const all: Record<string, 'present' | 'absent' | 'leave'> = {};
    students.forEach((s) => { all[s.id] = status; });
    setAttendance(all);
    setSaved(false);
  };

  const handleMarkLeave = async () => {
    if (!leaveStudentId || !leaveStart || !leaveEnd) return;
    setIsSavingLeave(true);
    const student = students.find((s) => s.id === leaveStudentId);
    const created = await createStudentLeave({
      studentId: leaveStudentId,
      studentName: student?.name,
      startDate: leaveStart,
      endDate: leaveEnd,
      reason: leaveReason,
      branchId: branchFilter || user?.branchId,
    });
    setIsSavingLeave(false);
    if (created) {
      if (leaveStart <= TODAY_ISO && leaveEnd >= TODAY_ISO) {
        setAttendance((prev) => ({ ...prev, [leaveStudentId]: 'leave' }));
      }
      setShowLeaveForm(false);
      setLeaveStudentId('');
      setLeaveReason('');
    }
  };

  const handleCancelLeave = async (id: number) => {
    await deleteStudentLeave(id);
  };

  const handleSave = async () => {
    if (!selectedClass) return;
    const ok = await saveAttendanceAPI(selectedClass, TODAY_ISO, attendance, user?.name || 'Teacher');
    if (ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      loadRecentAttendance();
    } else {
      alert('Failed to save attendance records.');
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
      `This is to inform you that your ward *${student.name}* studying in *${student.className || selectedClass}* has been marked *ABSENT* for today's class.\n\n` +
      `📅 Date:\n${TODAY_ISO}\n\n` +
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

  // Trigger manual bulk WhatsApp for all absent students via Click-to-Chat URLs
  const sendBulkWhatsapp = async () => {
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
        `This is to inform you that your ward *${student.name}* studying in *${student.className || selectedClass}* has been marked *ABSENT* for today's class.\n\n` +
        `📅 Date:\n${TODAY_ISO}\n\n` +
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

      // Delay slightly between opening windows to let the browser process the popups
      await new Promise((resolve) => setTimeout(resolve, 800));
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
  const leaveCount   = Object.values(attendance).filter((v) => v === 'leave').length;
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
          <p className="text-sm font-medium text-muted-foreground">Today</p>
          <p className="mt-1 text-lg font-bold text-foreground">{TODAY}</p>
        </div>

        {todaysHoliday && (
          <div className="flex items-center gap-3 rounded-2xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-4">
            <CalendarOff className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
              Today is a holiday — <span className="font-semibold">{todaysHoliday.title}</span>. Attendance isn't required, but you can still mark it below if this is a makeup class.
            </p>
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
              {isTeacherOnly ? 'You have no assigned batches yet.' : 'No batches exist for this branch yet — create one from Batches first.'}
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
        {selectedClass && selectedBoard && (
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-foreground">
                <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">2</span>
                Mark Attendance — {selectedClass} ({selectedBoard})
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
                  onClick={() => setShowLeaveForm((v) => !v)}
                  className="flex items-center gap-1 rounded-lg bg-amber-100 dark:bg-amber-900/40 px-3 py-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400 transition-colors hover:bg-amber-200"
                >
                  <PlaneTakeoff className="h-3.5 w-3.5" /> Mark Leave
                </button>
              </div>
            </div>

            {showLeaveForm && (
              <div className="mb-4 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/20 p-4 space-y-3">
                <p className="text-sm font-semibold text-foreground">Mark a student on leave</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                  <select value={leaveStudentId} onChange={(e) => setLeaveStudentId(e.target.value)} className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:border-primary focus:outline-none sm:col-span-1">
                    <option value="">Select student</option>
                    {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <input type="date" value={leaveStart} onChange={(e) => setLeaveStart(e.target.value)} className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:border-primary focus:outline-none" />
                  <input type="date" value={leaveEnd} onChange={(e) => setLeaveEnd(e.target.value)} className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:border-primary focus:outline-none" />
                  <input type="text" value={leaveReason} onChange={(e) => setLeaveReason(e.target.value)} placeholder="Reason (optional)" className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:border-primary focus:outline-none" />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleMarkLeave}
                    disabled={!leaveStudentId || isSavingLeave}
                    className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
                  >
                    {isSavingLeave ? 'Saving...' : 'Save Leave'}
                  </button>
                  <button onClick={() => setShowLeaveForm(false)} className="rounded-lg border border-border px-4 py-2 text-xs font-medium text-foreground hover:bg-secondary">Cancel</button>
                </div>
                {activeLeaves.length > 0 && (
                  <div className="pt-2 border-t border-amber-200 dark:border-amber-900 space-y-1.5">
                    <p className="text-xs font-semibold text-muted-foreground uppercase">On leave today</p>
                    {activeLeaves.map((l) => (
                      <div key={l.id} className="flex items-center justify-between text-xs text-foreground">
                        <span>{l.studentName || l.studentId} — {l.startDate} to {l.endDate}{l.reason ? ` (${l.reason})` : ''}</span>
                        <button onClick={() => handleCancelLeave(l.id)} className="text-muted-foreground hover:text-red-500" title="Cancel leave">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {loading ? (
              <div className="text-center py-6 text-sm text-muted-foreground">Loading class student profiles...</div>
            ) : students.length === 0 ? (
              <div className="text-center py-6 text-sm text-muted-foreground">No students enrolled in {selectedClass} ({selectedBoard}) for this branch.</div>
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
                          : status === 'leave'
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
                            onClick={() => setAttendance((p) => ({ ...p, [s.id]: 'leave' }))}
                            className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all active:scale-95 ${
                              status === 'leave'
                                ? 'bg-amber-500 text-white'
                                : 'border border-border bg-card text-muted-foreground hover:bg-secondary'
                            }`}
                          >
                            <PlaneTakeoff className="h-3.5 w-3.5" />
                            Leave
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
                  {leaveCount > 0 && <span className="font-semibold text-amber-600 dark:text-amber-400">✈ Leave: {leaveCount}</span>}
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
              const pct = Math.round((r.present / r.total) * 100);
              return (
                <div key={i} className="flex items-center gap-4 rounded-xl border border-border bg-secondary/40 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">{r.class}</p>
                    <p className="text-xs text-muted-foreground">{r.date}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-foreground">{r.present}/{r.total}</p>
                    <p className={`text-xs font-medium ${pct >= 90 ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}>
                      {pct}%
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
                <span className="col-span-2 text-foreground font-semibold">{TODAY_ISO}</span>
              </div>
            </div>

            <div className="rounded-xl bg-secondary/80 p-4 border border-border/80">
              <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider block mb-2">Message Preview</span>
              <div className="text-xs text-foreground leading-relaxed whitespace-pre-line font-medium border-l-2 border-emerald-500 pl-3.5">
                📢 *Guru Shishyaru Tutorials*

                Dear Parent,

                This is to inform you that your ward *{activeStudent.name}* studying in *{activeStudent.className || selectedClass}* has been marked *ABSENT* for today's class.

                📅 Date:
                {TODAY_ISO}

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

