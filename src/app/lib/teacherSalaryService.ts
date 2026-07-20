import { apiFetch } from './apiClient';

export type TeacherAttendanceStatus = 'present' | 'absent' | 'half_day' | 'leave';
export type SalaryStatus = 'Draft' | 'Paid';
export type AuditAction = 'Created' | 'Updated' | 'Marked_Paid' | 'Unlocked';

export interface TeacherSalaryProfile {
  id: string;
  firstName: string;
  lastName: string;
  branchId?: string;
  department?: string;
  salaryType?: 'Monthly Fixed' | 'Per Class';
  monthlySalary?: number;
  salaryPerClass?: number;
  salaryAmount?: number;
  dateOfJoining?: string;
  designation?: string;
}

export interface TeacherAttendanceEntry {
  id: number;
  teacherId: string;
  date: string;
  status: TeacherAttendanceStatus;
  branchId?: string;
  department?: string;
  markedBy?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface AttendanceSummary {
  teacherId: string;
  present: number;
  absent: number;
  halfDay: number;
  leave: number;
  workingDays: number;
}

export interface SalaryRecord {
  id: number;
  teacherId: string;
  teacherName: string;
  employeeId: string;
  branchId?: string;
  department?: string;
  designation?: string;
  month: string;
  salaryType?: 'Monthly Fixed' | 'Per Class';
  salaryAmount?: number;
  salaryPerClass: number;
  classesConducted: number;
  presentDays: number;
  halfDays: number;
  calculatedSalary: number;
  status: SalaryStatus;
  paidDate?: string;
  paidBy?: string;
  remarks: string;
  isLocked: boolean;
  lockedDate?: string;
  lockedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SalaryAuditLog {
  id: number;
  teacherId: string;
  teacherName: string;
  month: string;
  action: AuditAction;
  previousValue?: number;
  newValue?: number;
  changedBy: string;
  userRole: string;
  branchId?: string;
  timestamp: string;
}

function statusLabel(status: TeacherAttendanceStatus): string {
  switch (status) {
    case 'present':
      return 'Present';
    case 'absent':
      return 'Absent';
    case 'half_day':
      return 'Half Day';
    case 'leave':
      return 'Leave';
    default:
      return 'Present';
  }
}

// ─── Teacher Attendance (backed by the teacher_attendance table) ──────────────

export async function fetchTeacherAttendance(params?: { date?: string; month?: string; teacherId?: string; branchId?: string }): Promise<TeacherAttendanceEntry[]> {
  const qs = new URLSearchParams();
  if (params?.date) qs.set('date', params.date);
  if (params?.month) qs.set('month', params.month);
  if (params?.teacherId) qs.set('teacherId', params.teacherId);
  if (params?.branchId) qs.set('branchId', params.branchId);
  const query = qs.toString();
  const res = await apiFetch(`/api/teacher-attendance${query ? `?${query}` : ''}`);
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export async function saveTeacherAttendanceBulk(entries: Array<{ teacherId: string; date: string; status: TeacherAttendanceStatus; branchId?: string; department?: string }>): Promise<TeacherAttendanceEntry[]> {
  const res = await apiFetch('/api/teacher-attendance/bulk', {
    method: 'POST',
    body: { entries },
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Failed to save attendance');
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export function validateAttendanceDuplicate(entries: Array<{ teacherId: string; date: string; status: TeacherAttendanceStatus }>): string | null {
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = `${entry.teacherId}:${entry.date}`;
    if (seen.has(key)) return `Duplicate attendance detected for ${statusLabel(entry.status)} on ${entry.date}`;
    seen.add(key);
  }
  return null;
}

// Summarizes a pre-fetched list of attendance entries for one teacher —
// callers fetch entries via fetchTeacherAttendance and pass them in, rather
// than each summary triggering its own request.
export function summarizeTeacherAttendance(entries: TeacherAttendanceEntry[], teacherId: string, month?: string): AttendanceSummary {
  const filtered = entries.filter((entry) => entry.teacherId === teacherId && (!month || entry.date.startsWith(month)));
  return {
    teacherId,
    present: filtered.filter((entry) => entry.status === 'present').length,
    absent: filtered.filter((entry) => entry.status === 'absent').length,
    halfDay: filtered.filter((entry) => entry.status === 'half_day').length,
    leave: filtered.filter((entry) => entry.status === 'leave').length,
    workingDays: filtered.length,
  };
}

export function describeAttendanceSummary(summary: AttendanceSummary): string {
  return `Present ${summary.present} • Absent ${summary.absent} • Half Day ${summary.halfDay} • Leave ${summary.leave}`;
}

// ─── Salary / Payroll (backed by the salary_records table) ────────────────────

export function calculateSalaryFromClasses(classesConducted: number, salaryPerClass: number): number {
  if (classesConducted <= 0 || salaryPerClass <= 0) return 0;
  return classesConducted * salaryPerClass;
}

export function calculateSalaryForTeacher(params: {
  teacher: TeacherSalaryProfile;
  classesConducted: number;
  salaryPerClass: number;
}): number {
  if (params.teacher.salaryType === 'Monthly Fixed') {
    return params.teacher.monthlySalary ?? params.teacher.salaryAmount ?? 0;
  }
  return calculateSalaryFromClasses(params.classesConducted, params.salaryPerClass);
}

export async function fetchSalaryRecords(params?: { branchId?: string; teacherId?: string; month?: string; status?: string }): Promise<SalaryRecord[]> {
  const qs = new URLSearchParams();
  if (params?.branchId) qs.set('branchId', params.branchId);
  if (params?.teacherId) qs.set('teacherId', params.teacherId);
  if (params?.month) qs.set('month', params.month);
  if (params?.status) qs.set('status', params.status);
  const query = qs.toString();
  const res = await apiFetch(`/api/salary-records${query ? `?${query}` : ''}`);
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

// Creates (or updates, if still a Draft) the salary record for a teacher+month.
export async function saveSalaryRecord(params: {
  teacher: TeacherSalaryProfile;
  month: string;
  classesConducted: number;
  salaryPerClass: number;
  attendance: AttendanceSummary;
  remarks?: string;
}): Promise<SalaryRecord> {
  const res = await apiFetch('/api/salary-records', {
    method: 'POST',
    body: {
      teacherId: params.teacher.id,
      teacherName: `${params.teacher.firstName} ${params.teacher.lastName}`,
      employeeId: params.teacher.id,
      branchId: params.teacher.branchId,
      department: params.teacher.department,
      designation: params.teacher.designation,
      month: params.month,
      salaryType: params.teacher.salaryType,
      salaryAmount: params.teacher.salaryAmount ?? params.teacher.monthlySalary,
      classesConducted: params.teacher.salaryType === 'Monthly Fixed' ? params.attendance.workingDays : params.classesConducted,
      salaryPerClass: params.teacher.salaryType === 'Monthly Fixed' ? 0 : params.salaryPerClass,
      presentDays: params.attendance.present,
      halfDays: params.attendance.halfDay,
      remarks: params.remarks ?? '',
    },
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Failed to save salary record');
  return res.json();
}

export async function markSalaryRecordPaid(id: number): Promise<SalaryRecord> {
  const res = await apiFetch(`/api/salary-records/${id}/mark-paid`, { method: 'POST' });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Failed to mark salary as paid');
  return res.json();
}

export async function unlockSalaryRecord(id: number): Promise<SalaryRecord> {
  const res = await apiFetch(`/api/salary-records/${id}/unlock`, { method: 'POST' });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Failed to unlock salary record');
  return res.json();
}

export async function fetchSalaryAuditLog(params?: { teacherId?: string; month?: string }): Promise<SalaryAuditLog[]> {
  const qs = new URLSearchParams();
  if (params?.teacherId) qs.set('teacherId', params.teacherId);
  if (params?.month) qs.set('month', params.month);
  const query = qs.toString();
  const res = await apiFetch(`/api/salary-audit-log${query ? `?${query}` : ''}`);
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}
