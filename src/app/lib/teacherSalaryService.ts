export type TeacherAttendanceStatus = 'present' | 'absent' | 'half_day' | 'leave';
export type SalaryStatus = 'Draft' | 'Paid';
export type AuditAction = 'Created' | 'Updated' | 'Locked' | 'Unlocked' | 'Marked_Paid' | 'Regenerated';

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
  id: string;
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

export interface SalaryPerClassRecord {
  id: string;
  teacherId: string;
  month: string;
  classesConducted: number;
  salaryPerClass: number;
  branchId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SalaryRecord {
  id: string;
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

export interface SalaryLockRecord {
  id: string;
  teacherId: string;
  month: string;
  lockedDate: string;
  lockedBy: string;
  unlockedDate?: string;
  unlockedBy?: string;
  status: 'Locked' | 'Unlocked';
}

export interface SalaryAuditLog {
  id: string;
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

export interface SalarySlipArchive {
  id: string;
  teacherId: string;
  month: string;
  salaryRecordId: string;
  branchId?: string;
  fileName: string;
  base64Pdf: string;
  generatedBy: string;
  generatedByRole: string;
  createdAt: string;
}

const ATTENDANCE_STORAGE_KEY = 'guru-shishyaru-teacher-attendance';
const SALARY_STORAGE_KEY = 'guru-shishyaru-teacher-salaries';
const SALARY_PER_CLASS_STORAGE_KEY = 'guru-shishyaru-salary-per-class';
const SALARY_LOCK_STORAGE_KEY = 'guru-shishyaru-salary-locks';
const SALARY_AUDIT_LOG_STORAGE_KEY = 'guru-shishyaru-salary-audit-log';
const SALARY_SLIP_ARCHIVE_STORAGE_KEY = 'guru-shishyaru-salary-slip-archive';
const TEACHER_STORAGE_KEY = 'guru-shishyaru-teachers';

function readStorage<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeStorage<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore persistence errors
  }
}

function createId(prefix: string): string {
  if (typeof window === 'undefined') {
    return `${prefix}-${Date.now()}`;
  }
  const existing = window.localStorage.getItem(`${prefix}-counter`);
  const current = existing ? Number(existing) : 0;
  const next = current + 1;
  window.localStorage.setItem(`${prefix}-counter`, String(next));
  return `${prefix}-${next}`;
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

export function getTeacherAttendanceRecords(): TeacherAttendanceEntry[] {
  return readStorage<TeacherAttendanceEntry[]>(ATTENDANCE_STORAGE_KEY, []);
}

export function saveTeacherAttendanceRecords(entries: TeacherAttendanceEntry[]): TeacherAttendanceEntry[] {
  const existing = getTeacherAttendanceRecords();
  const next = [...existing.filter((record) => !entries.some((entry) => entry.teacherId === record.teacherId && entry.date === record.date)), ...entries];
  writeStorage(ATTENDANCE_STORAGE_KEY, next);
  return next;
}

// Salary Per Class Management
export function setSalaryPerClass(teacherId: string, month: string, classesConducted: number, salaryPerClass: number, branchId?: string): SalaryPerClassRecord {
  const records = readStorage<SalaryPerClassRecord[]>(SALARY_PER_CLASS_STORAGE_KEY, []);
  const existing = records.findIndex((r) => r.teacherId === teacherId && r.month === month);
  
  const record: SalaryPerClassRecord = {
    id: existing >= 0 ? records[existing].id : createId('spc'),
    teacherId,
    month,
    classesConducted,
    salaryPerClass,
    branchId,
    createdAt: existing >= 0 ? records[existing].createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (existing >= 0) {
    records[existing] = record;
  } else {
    records.push(record);
  }
  writeStorage(SALARY_PER_CLASS_STORAGE_KEY, records);
  return record;
}

export function getSalaryPerClassRecord(teacherId: string, month: string): SalaryPerClassRecord | null {
  const records = readStorage<SalaryPerClassRecord[]>(SALARY_PER_CLASS_STORAGE_KEY, []);
  return records.find((r) => r.teacherId === teacherId && r.month === month) ?? null;
}

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

// Create simplified salary record
export function createSalaryRecord(params: {
  teacher: TeacherSalaryProfile;
  month: string;
  classesConducted: number;
  salaryPerClass: number;
  attendance: AttendanceSummary;
  remarks?: string;
}): SalaryRecord {
  const calculatedSalary = calculateSalaryForTeacher({
    teacher: params.teacher,
    classesConducted: params.classesConducted,
    salaryPerClass: params.salaryPerClass,
  });
  
  return {
    id: createId('salary'),
    teacherId: params.teacher.id,
    teacherName: `${params.teacher.firstName} ${params.teacher.lastName}`,
    employeeId: params.teacher.id,
    branchId: params.teacher.branchId,
    department: params.teacher.department,
    designation: params.teacher.designation,
    month: params.month,
    salaryType: params.teacher.salaryType,
    salaryAmount: params.teacher.salaryAmount,
    classesConducted: params.teacher.salaryType === 'Monthly Fixed' ? params.attendance.workingDays : params.classesConducted,
    salaryPerClass: params.teacher.salaryType === 'Monthly Fixed' ? 0 : params.salaryPerClass,
    presentDays: params.attendance.present,
    halfDays: params.attendance.halfDay,
    calculatedSalary,
    status: 'Draft',
    remarks: params.remarks ?? '',
    isLocked: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// Salary Record CRUD
export function upsertSalaryRecord(record: SalaryRecord): SalaryRecord {
  const current = getSalaryRecords();
  const existingIndex = current.findIndex((item) => item.teacherId === record.teacherId && item.month === record.month);
  
  const updated = { ...record, updatedAt: new Date().toISOString() };
  
  if (existingIndex >= 0) {
    const prev = current[existingIndex];
    current[existingIndex] = updated;
    writeStorage(SALARY_STORAGE_KEY, current);
    // Log the update
    addAuditLog({
      teacherId: record.teacherId,
      teacherName: record.teacherName,
      month: record.month,
      action: 'Updated',
      previousValue: prev.calculatedSalary,
      newValue: record.calculatedSalary,
      changedBy: 'System',
      userRole: 'System',
      branchId: record.branchId,
    });
    return updated;
  }

  const next = [...current, updated];
  writeStorage(SALARY_STORAGE_KEY, next);
  // Log the creation
  addAuditLog({
    teacherId: record.teacherId,
    teacherName: record.teacherName,
    month: record.month,
    action: 'Created',
    newValue: record.calculatedSalary,
    changedBy: 'System',
    userRole: 'System',
    branchId: record.branchId,
  });
  return updated;
}

export function getSalaryRecordForMonth(teacherId: string, month: string): SalaryRecord | null {
  return getSalaryRecords().find((record) => record.teacherId === teacherId && record.month === month) ?? null;
}

export function getSalaryRecordsForView(params?: { branchId?: string; teacherId?: string; month?: string; status?: string }): SalaryRecord[] {
  return getSalaryRecords().filter((record) => {
    if (params?.branchId && record.branchId !== params.branchId) return false;
    if (params?.teacherId && record.teacherId !== params.teacherId) return false;
    if (params?.month && record.month !== params.month) return false;
    if (params?.status && record.status !== params.status) return false;
    return true;
  });
}

// Salary Lock/Unlock
export function lockSalary(teacherId: string, month: string, lockedBy: string): void {
  const record = getSalaryRecordForMonth(teacherId, month);
  if (record) {
    record.isLocked = true;
    record.lockedDate = new Date().toISOString();
    record.lockedBy = lockedBy;
    upsertSalaryRecord(record);
    
    addAuditLog({
      teacherId,
      teacherName: record.teacherName,
      month,
      action: 'Locked',
      changedBy: lockedBy,
      userRole: 'Accountant',
      branchId: record.branchId,
    });
  }
}

export function unlockSalary(teacherId: string, month: string, unlockedBy: string): void {
  const record = getSalaryRecordForMonth(teacherId, month);
  if (record) {
    record.isLocked = false;
    if (record.status === 'Paid') {
      record.status = 'Draft';
    }
    record.unlockedDate = new Date().toISOString();
    record.unlockedBy = unlockedBy;
    upsertSalaryRecord(record);
    
    addAuditLog({
      teacherId,
      teacherName: record.teacherName,
      month,
      action: 'Unlocked',
      changedBy: unlockedBy,
      userRole: 'Super Admin',
      branchId: record.branchId,
    });
  }
}

export function isSalaryLocked(teacherId: string, month: string): boolean {
  const record = getSalaryRecordForMonth(teacherId, month);
  return record?.isLocked ?? false;
}

export function markSalaryPaid(teacherId: string, month: string, paidBy: string): SalaryRecord | null {
  const record = getSalaryRecordForMonth(teacherId, month);
  if (record) {
    record.status = 'Paid';
    record.paidDate = new Date().toISOString();
    record.paidBy = paidBy;
    record.isLocked = true;
    record.lockedDate = new Date().toISOString();
    record.lockedBy = paidBy;
    
    const updated = upsertSalaryRecord(record);
    
    addAuditLog({
      teacherId,
      teacherName: record.teacherName,
      month,
      action: 'Marked_Paid',
      newValue: record.calculatedSalary,
      changedBy: paidBy,
      userRole: 'Accountant',
      branchId: record.branchId,
    });
    
    return updated;
  }
  return null;
}

// Audit Log
export function addAuditLog(log: Omit<SalaryAuditLog, 'id' | 'timestamp'>): void {
  const logs = readStorage<SalaryAuditLog[]>(SALARY_AUDIT_LOG_STORAGE_KEY, []);
  logs.push({
    id: createId('audit'),
    ...log,
    timestamp: new Date().toISOString(),
  });
  writeStorage(SALARY_AUDIT_LOG_STORAGE_KEY, logs);
}

export function getAuditLogs(params?: { teacherId?: string; month?: string; action?: AuditAction }): SalaryAuditLog[] {
  const logs = readStorage<SalaryAuditLog[]>(SALARY_AUDIT_LOG_STORAGE_KEY, []);
  return logs.filter((log) => {
    if (params?.teacherId && log.teacherId !== params.teacherId) return false;
    if (params?.month && log.month !== params.month) return false;
    if (params?.action && log.action !== params.action) return false;
    return true;
  });
}

export function archiveSalarySlip(archive: Omit<SalarySlipArchive, 'id' | 'createdAt'>): SalarySlipArchive {
  const archives = readStorage<SalarySlipArchive[]>(SALARY_SLIP_ARCHIVE_STORAGE_KEY, []);
  const existingIndex = archives.findIndex((item) => item.teacherId === archive.teacherId && item.month === archive.month);
  const record: SalarySlipArchive = {
    id: existingIndex >= 0 ? archives[existingIndex].id : createId('slip'),
    createdAt: existingIndex >= 0 ? archives[existingIndex].createdAt : new Date().toISOString(),
    ...archive,
  };

  if (existingIndex >= 0) {
    archives[existingIndex] = record;
  } else {
    archives.push(record);
  }

  writeStorage(SALARY_SLIP_ARCHIVE_STORAGE_KEY, archives);
  return record;
}

export function getSalarySlipArchive(teacherId: string, month: string): SalarySlipArchive | null {
  const archives = readStorage<SalarySlipArchive[]>(SALARY_SLIP_ARCHIVE_STORAGE_KEY, []);
  return archives.find((item) => item.teacherId === teacherId && item.month === month) ?? null;
}

export function getSalarySlipArchives(params?: { teacherId?: string; branchId?: string; month?: string }): SalarySlipArchive[] {
  const archives = readStorage<SalarySlipArchive[]>(SALARY_SLIP_ARCHIVE_STORAGE_KEY, []);
  return archives.filter((item) => {
    if (params?.teacherId && item.teacherId !== params.teacherId) return false;
    if (params?.branchId && item.branchId !== params.branchId) return false;
    if (params?.month && item.month !== params.month) return false;
    return true;
  });
}

export function getAttendanceEntriesForDate(date: string): TeacherAttendanceEntry[] {
  return getTeacherAttendanceRecords().filter((record) => record.date === date);
}

export function getAttendanceSummaryForDate(date: string): AttendanceSummary[] {
  return getAttendanceEntriesForDate(date).reduce<AttendanceSummary[]>((acc, entry) => {
    const existing = acc.find((item) => item.teacherId === entry.teacherId);
    if (existing) {
      if (entry.status === 'present') existing.present += 1;
      if (entry.status === 'absent') existing.absent += 1;
      if (entry.status === 'half_day') existing.halfDay += 1;
      if (entry.status === 'leave') existing.leave += 1;
      existing.workingDays += 1;
    } else {
      const summary: AttendanceSummary = {
        teacherId: entry.teacherId,
        present: entry.status === 'present' ? 1 : 0,
        absent: entry.status === 'absent' ? 1 : 0,
        halfDay: entry.status === 'half_day' ? 1 : 0,
        leave: entry.status === 'leave' ? 1 : 0,
        workingDays: 1,
      };
      acc.push(summary);
    }
    return acc;
  }, []);
}

export function getTeacherAttendanceHistory(teacherId: string, month: string): AttendanceSummary {
  const entries = getTeacherAttendanceRecords().filter((record) => record.teacherId === teacherId && record.date.startsWith(month));
  return {
    teacherId,
    present: entries.filter((entry) => entry.status === 'present').length,
    absent: entries.filter((entry) => entry.status === 'absent').length,
    halfDay: entries.filter((entry) => entry.status === 'half_day').length,
    leave: entries.filter((entry) => entry.status === 'leave').length,
    workingDays: entries.length,
  };
}

export function getSalaryRecords(): SalaryRecord[] {
  return readStorage<SalaryRecord[]>(SALARY_STORAGE_KEY, []);
}

export function buildSalarySnapshot(params: {
  teacher: TeacherSalaryProfile;
  month: string;
  attendance: AttendanceSummary;
  classesConducted: number;
  salaryPerClass: number;
  remarks?: string;
}): SalaryRecord {
  return createSalaryRecord({
    teacher: params.teacher,
    month: params.month,
    classesConducted: params.classesConducted,
    salaryPerClass: params.salaryPerClass,
    attendance: params.attendance,
    remarks: params.remarks,
  });
}

export function validateAttendanceDuplicate(entries: TeacherAttendanceEntry[]): string | null {
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = `${entry.teacherId}:${entry.date}`;
    if (seen.has(key)) return `Duplicate attendance detected for ${statusLabel(entry.status)} on ${entry.date}`;
    seen.add(key);
  }
  return null;
}

export function describeAttendanceSummary(summary: AttendanceSummary): string {
  return `Present ${summary.present} • Absent ${summary.absent} • Half Day ${summary.halfDay} • Leave ${summary.leave}`;
}
