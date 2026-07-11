import { useState, useEffect, useMemo } from 'react';
import { Header } from '../components/Header';
import { useAuth } from '../auth/AuthContext';
import { getBranches, getBranchName } from '../lib/branchService';
import { getStudentsForClass } from '../lib/studentService';
import { fetchAttendance as fetchAttendanceRecords } from '../lib/attendanceService';
import { saveAttendanceAPI } from '../lib/attendanceService';
import { saveTeacherAttendanceRecords, getAttendanceEntriesForDate, getTeacherAttendanceHistory, type TeacherAttendanceStatus, validateAttendanceDuplicate } from '../lib/teacherSalaryService';
import { getTeacherProfiles, type Teacher } from './TeacherManagement';
import { CheckCircle2, XCircle, ChevronRight, Save, Mail, AlertCircle, MessageSquare, Users, CalendarDays } from 'lucide-react';


const CLASSES = ['8th A', '8th B', '9th A', '9th B', '10th A', '10th B', '10th C', '11th A', '11th B', '12th A', '12th B'];

const TODAY = new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
const TODAY_ISO = new Date().toISOString().split('T')[0];

export function Attendance() {
  const { user } = useAuth();
  const branches = getBranches();
  const teachers = useMemo(() => getTeacherProfiles(), []);
  const isAdminOrSuper = user?.role === 'admin' || user?.role === 'super_admin';
  const [selectedClass, setSelectedClass] = useState('');
  const [branchFilter, setBranchFilter] = useState(user?.role === 'super_admin' ? '' : user?.branchId ?? '');
  const [attendance, setAttendance] = useState<Record<string, 'present' | 'absent'>>({});
  const [saved, setSaved] = useState(false);
  const [students, setStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [recentRecords, setRecentRecords] = useState<any[]>([]);
  const [teacherAttendanceDate, setTeacherAttendanceDate] = useState(TODAY_ISO);
  const [teacherBranchFilter, setTeacherBranchFilter] = useState(user?.role === 'super_admin' ? '' : user?.branchId ?? '');
  const [teacherDepartmentFilter, setTeacherDepartmentFilter] = useState('');
  const [teacherSearch, setTeacherSearch] = useState('');
  const [teacherSelectedTeacher, setTeacherSelectedTeacher] = useState('');
  const [teacherStatusFilter, setTeacherStatusFilter] = useState<'all' | TeacherAttendanceStatus>('all');
  const [teacherAttendance, setTeacherAttendance] = useState<Record<string, TeacherAttendanceStatus>>({});
  const [teacherAttendanceSaved, setTeacherAttendanceSaved] = useState(false);

  // WhatsApp Specific States
  const [whatsappStatus, setWhatsappStatus] = useState<Record<string, 'idle' | 'sending' | 'success' | 'failed'>>({});
  const [officialContact, setOfficialContact] = useState('6363099546');
  
  // Modals States
  const [showSingleModal, setShowSingleModal] = useState(false);
  const [activeStudent, setActiveStudent] = useState<any>(null);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkSending, setBulkSending] = useState(false);

  useEffect(() => {
    if (!isAdminOrSuper) return;
    const entries = getAttendanceEntriesForDate(teacherAttendanceDate);
    const initialState: Record<string, TeacherAttendanceStatus> = {};
    teachers.filter((teacher) => !teacherBranchFilter || teacher.branchId === teacherBranchFilter).forEach((teacher) => {
      const current = entries.find((entry) => entry.teacherId === teacher.id);
      initialState[teacher.id] = current?.status ?? 'present';
    });
    setTeacherAttendance(initialState);
  }, [teacherAttendanceDate, teacherBranchFilter, teachers, isAdminOrSuper]);

  // Fetch settings to load official tutorial contact number
  useEffect(() => {
    fetch('http://localhost:4000/api/settings')
      .then((res) => res.json())
      .then((data) => {
        if (data && data.official_contact) {
          setOfficialContact(data.official_contact);
        }
      })
      .catch((err) => console.error('Failed to load official contact settings', err));
  }, []);

  // Fetch recent attendance from logs/attendance to populate the list
  const loadRecentAttendance = () => {
    setRecentRecords([
      { class: '10th A', date: 'Today',     present: 28, total: 30 },
      { class: '9th B',  date: 'Today',     present: 18, total: 20 },
      { class: '11th A', date: 'Yesterday', present: 25, total: 28 },
      { class: '8th B',  date: 'Yesterday', present: 22, total: 25 },
      { class: '12th A', date: '2 days ago', present: 20, total: 22 },
    ]);
  };

  useEffect(() => {
    loadRecentAttendance();
  }, []);

  // Fetch students for selected class and branch
  useEffect(() => {
    if (!selectedClass) {
      setStudents([]);
      return;
    }
    setLoading(true);
    const url = `http://localhost:4000/api/students?className=${encodeURIComponent(selectedClass)}` + 
                (branchFilter ? `&branchId=${encodeURIComponent(branchFilter)}` : '');
    
    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          const mapped = data.map((s: any) => ({
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
          setWhatsappStatus({}); // Clear WhatsApp tracking status
          setSaved(false);
        } else {
          // Fallback to in-memory students when API returns no data
          const local = getStudentsForClass(selectedClass, branchFilter);
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
        const local = getStudentsForClass(selectedClass, branchFilter);
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
  }, [selectedClass, branchFilter]);


  const toggle = (id: string) => {
    setAttendance((prev) => ({
      ...prev,
      [id]: prev[id] === 'present' ? 'absent' : 'present',
    }));
    setSaved(false);
  };

  const markAll = (status: 'present' | 'absent') => {
    const all: Record<string, 'present' | 'absent'> = {};
    students.forEach((s) => { all[s.id] = status; });
    setAttendance(all);
    setSaved(false);
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

  const filteredTeachers = useMemo(() => teachers.filter((teacher) => {
    const matchesBranch = !teacherBranchFilter || teacher.branchId === teacherBranchFilter;
    const matchesTeacher = !teacherSelectedTeacher || teacher.id === teacherSelectedTeacher;
    const matchesDepartment = !teacherDepartmentFilter || (teacher.department || '').toLowerCase().includes(teacherDepartmentFilter.toLowerCase());
    const matchesSearch = !teacherSearch || `${teacher.firstName} ${teacher.lastName} ${teacher.department || ''}`.toLowerCase().includes(teacherSearch.toLowerCase());
    return matchesBranch && matchesTeacher && matchesDepartment && matchesSearch;
  }), [teacherBranchFilter, teacherDepartmentFilter, teacherSearch, teacherSelectedTeacher, teachers]);

  const teacherAttendanceSummary = useMemo(() => {
    const total = filteredTeachers.length;
    const present = filteredTeachers.filter((teacher) => teacherAttendance[teacher.id] === 'present').length;
    const absent = filteredTeachers.filter((teacher) => teacherAttendance[teacher.id] === 'absent').length;
    const halfDay = filteredTeachers.filter((teacher) => teacherAttendance[teacher.id] === 'half_day').length;
    const leave = filteredTeachers.filter((teacher) => teacherAttendance[teacher.id] === 'leave').length;
    return { total, present, absent, halfDay, leave };
  }, [filteredTeachers, teacherAttendance]);

  const teacherHistory = useMemo(() => {
    const month = teacherAttendanceDate.slice(0, 7);
    return filteredTeachers.map((teacher) => ({ teacher, history: getTeacherAttendanceHistory(teacher.id, month) }));
  }, [filteredTeachers, teacherAttendanceDate]);

  const presentCount = Object.values(attendance).filter((v) => v === 'present').length;
  const absentCount  = Object.values(attendance).filter((v) => v === 'absent').length;
  const unmarked     = students.filter((s) => !attendance[s.id]).length;

  // Count absent students that have not successfully sent WhatsApp yet
  const pendingWhatsappCount = students.filter(
    (s) => attendance[s.id] === 'absent' && whatsappStatus[s.id] !== 'success'
  ).length;

  const toggleTeacherAttendance = (teacherId: string, status: TeacherAttendanceStatus) => {
    setTeacherAttendance((prev) => ({ ...prev, [teacherId]: status }));
    setTeacherAttendanceSaved(false);
  };

  const markAllTeacherAttendance = (status: TeacherAttendanceStatus) => {
    const next = filteredTeachers.reduce<Record<string, TeacherAttendanceStatus>>((acc, teacher) => {
      acc[teacher.id] = status;
      return acc;
    }, {});
    setTeacherAttendance((prev) => ({ ...prev, ...next }));
    setTeacherAttendanceSaved(false);
  };

  const handleSaveTeacherAttendance = () => {
    if (!isAdminOrSuper) {
      alert('Only Admin and Super Admin can manage teacher attendance.');
      return;
    }

    const entries = filteredTeachers.map((teacher) => ({
      id: `${teacher.id}-${teacherAttendanceDate}`,
      teacherId: teacher.id,
      date: teacherAttendanceDate,
      status: teacherAttendance[teacher.id] || 'present',
      branchId: teacher.branchId,
      department: teacher.department,
      createdAt: new Date().toISOString(),
    }));

    const duplicateError = validateAttendanceDuplicate(entries);
    if (duplicateError) {
      alert(duplicateError);
      return;
    }

    saveTeacherAttendanceRecords(entries);
    setTeacherAttendanceSaved(true);
  };


  return (
    <div className="flex-1 bg-background">
      <Header title="Attendance" />

      <div className="max-w-3xl mx-auto p-6 space-y-6">

        {/* ── Date + Today summary ── */}
        <div className="rounded-2xl border border-border bg-card p-5">
          <p className="text-sm font-medium text-muted-foreground">Today</p>
          <p className="mt-1 text-lg font-bold text-foreground">{TODAY}</p>
        </div>

        {/* ── Step 1: Select Class ── */}
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          {user?.role === 'super_admin' && (
            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium text-foreground">Branch</label>
              <select value={branchFilter} onChange={(event) => { setBranchFilter(event.target.value); setSelectedClass(''); setAttendance({}); setSaved(false); }} className="w-full rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none">
                <option value="">All Branches</option>
                {branches.filter((branch) => branch.status === 'Active').map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </select>
            </div>
          )}
          <h2 className="mb-4 text-base font-semibold text-foreground">
            <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">1</span>
            Select Class
          </h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {CLASSES.map((cls) => (
              <button
                key={cls}
                onClick={() => { setSelectedClass(cls); setAttendance({}); setSaved(false); }}
                className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition-all ${
                  selectedClass === cls
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-secondary text-foreground hover:border-primary/40'
                }`}
              >
                {cls}
              </button>
            ))}
          </div>
        </div>

        {/* ── Step 2: Mark Attendance ── */}
        {selectedClass && (
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-foreground">
                <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">2</span>
                Mark Attendance — {selectedClass}
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
              </div>
            </div>

            {loading ? (
              <div className="text-center py-6 text-sm text-muted-foreground">Loading class student profiles...</div>
            ) : students.length === 0 ? (
              <div className="text-center py-6 text-sm text-muted-foreground">No students enrolled in {selectedClass} for this branch.</div>
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
            <button className="flex items-center gap-1 text-sm font-medium text-primary hover:underline">
              View all <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="space-y-2">
            {recentRecords.map((r, i) => {
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

