import { useEffect, useMemo, useState } from 'react';
import { Header } from '../components/Header';
import { useAuth } from '../auth/AuthContext';
import { getBranches, getBranchName } from '../lib/branchService';
import { getTeacherProfiles, type Teacher } from './TeacherManagement';
import {
  getSalaryPerClassRecord,
  getSalaryRecordForMonth,
  getTeacherAttendanceRecords,
  getTeacherAttendanceHistory,
  saveTeacherAttendanceRecords,
  setSalaryPerClass,
  type SalaryRecord,
  type TeacherAttendanceEntry,
  type TeacherAttendanceStatus,
  validateAttendanceDuplicate,
  isSalaryLocked,
  calculateSalaryFromClasses,
} from '../lib/teacherSalaryService';
import { CalendarDays, Save, ClipboardCheck, AlertCircle } from 'lucide-react';

const TODAY = new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
const TODAY_ISO = new Date().toISOString().split('T')[0];

const statusOptions: Array<{ value: TeacherAttendanceStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All Status' },
  { value: 'present', label: 'Present' },
  { value: 'absent', label: 'Absent' },
  { value: 'half_day', label: 'Half Day' },
  { value: 'leave', label: 'Leave' },
];

export function TeacherAttendance() {
  const { user } = useAuth();
  const branches = getBranches();
  const teachers = useMemo(() => getTeacherProfiles(), []);
  const isAdminOrSuper = user?.role === 'admin' || user?.role === 'super_admin';
  const isReadOnly = user?.role === 'accountant' || user?.role === 'teacher';

  const [attendanceDate, setAttendanceDate] = useState(TODAY_ISO);
  const [salaryMonth, setSalaryMonth] = useState(TODAY_ISO.slice(0, 7));
  const [branchFilter, setBranchFilter] = useState(user?.role === 'super_admin' ? '' : user?.branchId ?? '');
  const [teacherFilter, setTeacherFilter] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | TeacherAttendanceStatus>('all');
  const [attendance, setAttendance] = useState<Record<string, TeacherAttendanceStatus>>({});
  const [saved, setSaved] = useState(false);
  const [salaryTeacherId, setSalaryTeacherId] = useState('');
  const [classesConducted, setClassesConducted] = useState(0);
  const [salaryPerClass, setSalaryPerClass] = useState(0);
  const [salarySaved, setSalarySaved] = useState(false);
  const [salaryRecord, setSalaryRecord] = useState<SalaryRecord | null>(null);

  const allowedTeachers = useMemo(() => {
    return teachers.filter((teacher) => {
      const branchMatches = user?.role === 'admin' ? teacher.branchId === user.branchId : true;
      const branchFilterMatches = !branchFilter || teacher.branchId === branchFilter;
      return branchMatches && branchFilterMatches;
    });
  }, [branchFilter, teachers, user]);

  useEffect(() => {
    if (!salaryTeacherId && allowedTeachers.length) {
      setSalaryTeacherId(allowedTeachers[0].id);
    }
  }, [allowedTeachers, salaryTeacherId]);

  useEffect(() => {
    if (!isAdminOrSuper) return;
    const records = getTeacherAttendanceRecords().filter((record) => record.date === attendanceDate);
    const nextState: Record<string, TeacherAttendanceStatus> = {};

    allowedTeachers.forEach((teacher) => {
      const current = records.find((record) => record.teacherId === teacher.id);
      nextState[teacher.id] = current?.status ?? 'present';
    });

    setAttendance(nextState);
    setSaved(false);
  }, [allowedTeachers, attendanceDate, isAdminOrSuper]);

  useEffect(() => {
    const teacher = allowedTeachers.find((item) => item.id === salaryTeacherId);
    if (!teacher) {
      setSalaryRecord(null);
      setClassesConducted(0);
      setSalaryPerClass(0);
      setSalarySaved(false);
      return;
    }

    const existing = getSalaryRecordForMonth(teacher.id, salaryMonth);
    const salaryClassRecord = getSalaryPerClassRecord(teacher.id, salaryMonth);
    setSalaryRecord(existing);
    setClassesConducted(salaryClassRecord?.classesConducted ?? 0);
    setSalaryPerClass(salaryClassRecord?.salaryPerClass ?? 0);
    setSalarySaved(false);
  }, [allowedTeachers, salaryTeacherId, salaryMonth]);

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
    const halfDay = filteredTeachers.filter((teacher) => attendance[teacher.id] === 'half_day').length;
    const leave = filteredTeachers.filter((teacher) => attendance[teacher.id] === 'leave').length;
    return { total, present, absent, halfDay, leave };
  }, [attendance, filteredTeachers]);

  const history = useMemo(() => {
    const month = attendanceDate.slice(0, 7);
    return filteredTeachers.map((teacher) => ({
      teacher,
      history: getTeacherAttendanceHistory(teacher.id, month),
    }));
  }, [attendanceDate, filteredTeachers]);

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

  const handleSave = () => {
    if (!isAdminOrSuper) {
      alert('Only Admin and Super Admin can mark teacher attendance.');
      return;
    }

    const entries: TeacherAttendanceEntry[] = filteredTeachers.map((teacher) => ({
      id: `${teacher.id}-${attendanceDate}`,
      teacherId: teacher.id,
      date: attendanceDate,
      status: attendance[teacher.id] || 'present',
      branchId: teacher.branchId,
      department: teacher.department,
      markedBy: user?.name || 'Admin',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));

    const duplicateError = validateAttendanceDuplicate(entries);
    if (duplicateError) {
      alert(duplicateError);
      return;
    }

    saveTeacherAttendanceRecords(entries);
    setSaved(true);
  };

  const selectedSalaryTeacher = allowedTeachers.find((teacher) => teacher.id === salaryTeacherId);
  const salaryAttendance = selectedSalaryTeacher ? getTeacherAttendanceHistory(selectedSalaryTeacher.id, salaryMonth) : null;
  const salaryLocked = salaryRecord?.isLocked ?? false;

  const handleSaveSalaryPerClass = () => {
    if (!isAdminOrSuper || !selectedSalaryTeacher) {
      alert('Only Admin and Super Admin can save salary settings.');
      return;
    }

    if (salaryLocked) {
      alert('Salary is locked for this teacher and month. Salary cannot be updated.');
      return;
    }

    if (classesConducted <= 0 || salaryPerClass <= 0) {
      alert('Enter valid values for Classes Conducted and Salary Per Class.');
      return;
    }

    setSalaryPerClass(selectedSalaryTeacher.id, salaryMonth, classesConducted, salaryPerClass, selectedSalaryTeacher.branchId);
    setSalarySaved(true);
    alert('Salary per class saved successfully. Accountant can now review and process the payslip.');
  };

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
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-5">
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
            <p className="text-sm text-muted-foreground">Half Day</p>
            <p className="mt-2 text-2xl font-bold text-amber-600">{summary.halfDay}</p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <p className="text-sm text-muted-foreground">Leave</p>
            <p className="mt-2 text-2xl font-bold text-sky-600">{summary.leave}</p>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Teacher Attendance Register</h2>
              <p className="text-sm text-muted-foreground">Teachers shown are limited to the active branch scope.</p>
            </div>
            <button type="button" onClick={handleSave} disabled={!isAdminOrSuper || isReadOnly} className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50">
              <Save className="h-4 w-4" />
              {saved ? 'Saved' : 'Save Attendance'}
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
                  <th className="py-3 pr-3 font-semibold">Half Day</th>
                  <th className="py-3 pr-3 font-semibold">Leave</th>
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
                        <button type="button" onClick={() => toggleStatus(teacher.id, 'half_day')} disabled={isReadOnly} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${status === 'half_day' ? 'bg-amber-500 text-white' : 'border border-border bg-secondary text-muted-foreground hover:bg-secondary/80'}`}>
                          Half Day
                        </button>
                      </td>
                      <td className="py-3 pr-3">
                        <button type="button" onClick={() => toggleStatus(teacher.id, 'leave')} disabled={isReadOnly} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${status === 'leave' ? 'bg-sky-600 text-white' : 'border border-border bg-secondary text-muted-foreground hover:bg-secondary/80'}`}>
                          Leave
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

        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Payroll Reference</h2>
              <p className="text-sm text-muted-foreground">Create a pending salary record for the selected teacher and month.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">Teacher</label>
                <select value={salaryTeacherId} onChange={(event) => setSalaryTeacherId(event.target.value)} className="w-full rounded-xl border border-input bg-input-background px-3 py-2 text-sm">
                  {allowedTeachers.map((teacher) => (
                    <option key={teacher.id} value={teacher.id}>{teacher.firstName} {teacher.lastName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">Salary Month</label>
                <input type="month" value={salaryMonth} onChange={(event) => setSalaryMonth(event.target.value)} className="w-full rounded-xl border border-input bg-input-background px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">Status</label>
                <div className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm text-foreground">
                  {salaryRecord ? 'Locked / Pending' : 'Editable'}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">Payroll Notes</label>
                <div className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm text-muted-foreground">
                  {salaryRecord ? 'Existing salary preserved and locked.' : 'Will save as pending salary for accountant review.'}
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-4">
            <div className="rounded-xl border border-border bg-secondary/25 p-4">
              <p className="text-xs text-muted-foreground">Attendance Present</p>
              <p className="mt-2 text-lg font-semibold text-foreground">{salaryAttendance?.present ?? 0}</p>
            </div>
            <div className="rounded-xl border border-border bg-secondary/25 p-4">
              <p className="text-xs text-muted-foreground">Absent</p>
              <p className="mt-2 text-lg font-semibold text-foreground">{salaryAttendance?.absent ?? 0}</p>
            </div>
            <div className="rounded-xl border border-border bg-secondary/25 p-4">
              <p className="text-xs text-muted-foreground">Half Day</p>
              <p className="mt-2 text-lg font-semibold text-foreground">{salaryAttendance?.halfDay ?? 0}</p>
            </div>
            <div className="rounded-xl border border-border bg-secondary/25 p-4">
              <p className="text-xs text-muted-foreground">Working Days</p>
              <p className="mt-2 text-lg font-semibold text-foreground">{salaryAttendance?.workingDays ?? 0}</p>
            </div>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">Salary Type</label>
              <div className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm text-foreground">
                {selectedSalaryTeacher?.salaryType || '—'}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">Classes Conducted</label>
              <input
                type="number"
                min={0}
                value={classesConducted}
                onChange={(event) => setClassesConducted(Number(event.target.value))}
                disabled={salaryLocked || !isAdminOrSuper}
                className="w-full rounded-xl border border-input bg-input-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">Salary Per Class</label>
              <input
                type="number"
                min={0}
                value={salaryPerClass}
                onChange={(event) => setSalaryPerClass(Number(event.target.value))}
                disabled={salaryLocked || !isAdminOrSuper}
                className="w-full rounded-xl border border-input bg-input-background px-3 py-2 text-sm"
              />
            </div>
            <div className="lg:col-span-2">
              <label className="mb-1 block text-sm font-medium text-foreground">Estimated Gross Salary</label>
              <div className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm text-foreground">
                {selectedSalaryTeacher ? `₹${calculateSalaryFromClasses(classesConducted, salaryPerClass)}` : '—'}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" onClick={handleSaveSalaryPerClass} disabled={!isAdminOrSuper || salaryLocked} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50">
              Save Salary Per Class
            </button>
            {salarySaved && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                Salary per class saved successfully for accountant review.
              </div>
            )}
            {salaryLocked && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                Pending salary record exists and is locked for accountant processing.
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">Monthly Attendance History</h2>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {history.map(({ teacher, history: summary }) => (
              <div key={teacher.id} className="rounded-xl border border-border bg-secondary/30 p-4">
                <p className="font-semibold text-foreground">{teacher.firstName} {teacher.lastName}</p>
                <p className="text-sm text-muted-foreground">{teacher.department || 'Department not set'} • {attendanceDate.slice(0, 7)}</p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-lg bg-background/70 p-2"><span className="block text-muted-foreground">Present</span><span className="font-semibold text-foreground">{summary.present}</span></div>
                  <div className="rounded-lg bg-background/70 p-2"><span className="block text-muted-foreground">Absent</span><span className="font-semibold text-foreground">{summary.absent}</span></div>
                  <div className="rounded-lg bg-background/70 p-2"><span className="block text-muted-foreground">Half Day</span><span className="font-semibold text-foreground">{summary.halfDay}</span></div>
                  <div className="rounded-lg bg-background/70 p-2"><span className="block text-muted-foreground">Leave</span><span className="font-semibold text-foreground">{summary.leave}</span></div>
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
