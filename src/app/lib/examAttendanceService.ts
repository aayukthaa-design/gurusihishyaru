import { PDFTemplateService } from './pdfTemplateService';
import { utils, writeFile } from 'xlsx';
import { createStore, useStoreValue } from './store';
import { addNotification } from './notificationService';

export type ExamAttendanceStatus = 'present' | 'absent';

export interface ExamAttendanceRecord {
  id: string;
  examId: string;
  studentId: string;
  studentName: string;
  rollNumber: string;
  admissionNumber: string;
  className: string;
  branchId: string;
  branchName: string;
  status: ExamAttendanceStatus;
  date: string;
  time: string;
  teacherId: string;
  teacherName: string;
  subjectId: string;
  subjectName: string;
  classId: string;
  recordedBy: string;
  isLocked: boolean;
  lockedBy?: string;
  lockedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExamAttendanceSubmission {
  examId: string;
  studentId: string;
  studentName: string;
  rollNumber: string;
  admissionNumber: string;
  className: string;
  branchId: string;
  branchName: string;
  status: ExamAttendanceStatus;
  date: string;
  time: string;
  teacherId: string;
  teacherName: string;
  subjectId: string;
  subjectName: string;
  classId: string;
  recordedBy: string;
}

export interface ExamAttendanceSummary {
  total: number;
  present: number;
  absent: number;
  late: number;
  medicalLeave: number;
  excused: number;
  presentPercentage: number;
  absentPercentage: number;
  latePercentage: number;
  medicalLeavePercentage: number;
  excusedPercentage: number;
}

interface ExamAttendanceFilterState {
  branchId?: string;
  className?: string;
  subjectName?: string;
  teacherId?: string;
  examId?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: ExamAttendanceStatus | 'all';
}

const STORAGE_KEY = 'guru-shishyaru-exam-attendance';

function readStoredRecords(): ExamAttendanceRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ExamAttendanceRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistRecords(records: ExamAttendanceRecord[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // ignore storage write issues
  }
}

const attendanceStore = createStore<ExamAttendanceRecord[]>(readStoredRecords());

export function subscribeExamAttendance(listener: (records: ExamAttendanceRecord[]) => void): () => void {
  return attendanceStore.subscribe(listener);
}

export function useExamAttendance(): ExamAttendanceRecord[] {
  return useStoreValue(attendanceStore);
}

export function getExamAttendanceRecords(): ExamAttendanceRecord[] {
  return attendanceStore.getState();
}

export function getExamAttendanceForExam(examId: string): ExamAttendanceRecord[] {
  return getExamAttendanceRecords().filter((record) => record.examId === examId);
}

export function getExamAttendanceSummary(examId: string): ExamAttendanceSummary {
  const records = getExamAttendanceForExam(examId);
  const total = records.length;
  const present = records.filter((record) => record.status === 'present').length;
  const absent = records.filter((record) => record.status === 'absent').length;
  const safePercent = (count: number) => (total ? Number(((count / total) * 100).toFixed(1)) : 0);

  return {
    total,
    present,
    absent,
    late: 0,
    medicalLeave: 0,
    excused: 0,
    presentPercentage: safePercent(present),
    absentPercentage: safePercent(absent),
    latePercentage: 0,
    medicalLeavePercentage: 0,
    excusedPercentage: 0,
  };
}

export function submitExamAttendanceRecords(
  submissions: ExamAttendanceSubmission[],
  teacher: { id: string; name: string; branchId?: string; role?: string } | null
): ExamAttendanceRecord[] {
  const records = getExamAttendanceRecords();
  const next: ExamAttendanceRecord[] = [...records];
  const now = new Date().toISOString();
  const saved: ExamAttendanceRecord[] = [];

  submissions.forEach((submission) => {
    const existingIndex = next.findIndex((record) => record.examId === submission.examId && record.studentId === submission.studentId);

    if (existingIndex >= 0) {
      const existing = next[existingIndex];
      if (existing.isLocked) {
        throw new Error('Attendance for this exam has been finalized.');
      }
      const updated: ExamAttendanceRecord = {
        ...existing,
        ...submission,
        status: submission.status,
        updatedAt: now,
        recordedBy: submission.recordedBy,
        teacherId: submission.teacherId,
        teacherName: submission.teacherName,
      };
      next[existingIndex] = updated;
      saved.push(updated);
      return;
    }

    const created: ExamAttendanceRecord = {
      id: `EAT${String(next.length + 1 + saved.length).padStart(3, '0')}`,
      ...submission,
      isLocked: false,
      createdAt: now,
      updatedAt: now,
    };
    next.push(created);
    saved.push(created);
  });

  attendanceStore.setState(next);
  persistRecords(next);

  const absentStudents = saved.filter((record) => record.status === 'absent');
  if (absentStudents.length > 0) {
    addNotification({
      title: 'Exam Attendance Submitted',
      message: `${absentStudents.length} student${absentStudents.length > 1 ? 's were' : ' was'} marked absent for an exam.`,
      type: 'warning',
      roles: ['admin', 'super_admin'],
      branchId: teacher?.branchId,
    });

    absentStudents.forEach((record) => {
      addNotification({
        title: `Exam attendance update for ${record.studentName}`,
        message: `${record.studentName} was marked absent for exam ${record.examId}.`,
        type: 'warning',
        roles: ['parent'],
        studentIds: [record.studentId],
        branchId: record.branchId,
      });
    });
  }

  return saved;
}

export function setExamAttendanceLock(examId: string, nextLocked: boolean, actor?: { id: string; name: string; role?: string; branchId?: string }): void {
  const records = getExamAttendanceRecords();
  const now = new Date().toISOString();
  const updated = records.map((record) => {
    if (record.examId !== examId) return record;
    return {
      ...record,
      isLocked: nextLocked,
      lockedBy: nextLocked ? actor?.name : undefined,
      lockedAt: nextLocked ? now : undefined,
      updatedAt: now,
    };
  });
  attendanceStore.setState(updated);
  persistRecords(updated);
}

export function getVisibleExamAttendanceRecords(filters: ExamAttendanceFilterState = {}, user?: { role?: string; branchId?: string; id?: string } | null): ExamAttendanceRecord[] {
  const records = getExamAttendanceRecords();
  return records.filter((record) => {
    if (user?.role === 'teacher' && user.branchId && record.branchId !== user.branchId) return false;
    if (user?.role === 'admin' && user.branchId && record.branchId !== user.branchId) return false;
    if (filters.branchId && record.branchId !== filters.branchId) return false;
    if (filters.className && record.className !== filters.className) return false;
    if (filters.subjectName && record.subjectName !== filters.subjectName) return false;
    if (filters.teacherId && record.teacherId !== filters.teacherId) return false;
    if (filters.examId && record.examId !== filters.examId) return false;
    if (filters.status && filters.status !== 'all' && record.status !== filters.status) return false;
    if (filters.dateFrom && record.date < filters.dateFrom) return false;
    if (filters.dateTo && record.date > filters.dateTo) return false;
    return true;
  });
}

export function buildExamAttendanceReportRows(filters: ExamAttendanceFilterState = {}, user?: { role?: string; branchId?: string; id?: string } | null): Array<Record<string, string | number | boolean>> {
  return getVisibleExamAttendanceRecords(filters, user).map((record) => ({
    date: record.date,
    examId: record.examId,
    studentName: record.studentName,
    rollNumber: record.rollNumber,
    admissionNumber: record.admissionNumber,
    className: record.className,
    branchName: record.branchName,
    subjectName: record.subjectName,
    status: record.status,
    recordedBy: record.recordedBy,
    locked: record.isLocked,
  }));
}

export async function exportExamAttendanceReport(format: 'pdf' | 'excel', rows: Array<Record<string, string | number | boolean>>, title = 'Exam Attendance Report'): Promise<void> {
  if (format === 'excel') {
    const worksheet = utils.json_to_sheet(rows);
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, worksheet, 'Exam Attendance');
    writeFile(workbook, `${title.replace(/\s+/g, '_').toLowerCase()}.xlsx`);
    return;
  }

  const pdfService = new PDFTemplateService();
  pdfService.addTitle(title);

  const tableRows = rows.map((row) => [
    row.date,
    row.examId,
    row.studentName,
    row.rollNumber,
    row.admissionNumber,
    row.className,
    row.branchName,
    row.subjectName,
    row.status,
    row.recordedBy,
    row.locked ? 'Locked' : 'Editable',
  ]);

  const headers = ['Date', 'Exam', 'Student', 'Roll', 'Admission', 'Class', 'Branch', 'Subject', 'Status', 'Recorded By', 'Lock'];
  pdfService.addTable([headers], tableRows);

  await pdfService.exportWithLetterhead(`${title.replace(/\s+/g, '_').toLowerCase()}.pdf`);
}

export function getTeacherExamAttendanceDashboard(user: { role?: string; branchId?: string; id?: string } | null, exams: Array<{ id: string; date: string; className?: string; subject?: string; teacherId?: string }>, students: Array<{ id: string; className?: string; branchId?: string }>) {
  const records = getExamAttendanceRecords().filter((record) => {
    if (user?.role === 'teacher' && user.branchId && record.branchId !== user.branchId) return false;
    if (user?.role === 'admin' && user.branchId && record.branchId !== user.branchId) return false;
    return true;
  });
  const today = new Date().toISOString().slice(0, 10);
  const visibleExams = exams.filter((exam) => {
    if (user?.role === 'teacher' && user.branchId && exam.className && exam.className !== '') return true;
    return true;
  });
  const todaysExams = visibleExams.filter((exam) => exam.date === today);
  const pendingAttendance = visibleExams.filter((exam) => !records.some((record) => record.examId === exam.id));
  const completedAttendance = visibleExams.filter((exam) => records.some((record) => record.examId === exam.id));
  const presentCount = records.filter((record) => record.status === 'present').length;
  const absentCount = records.filter((record) => record.status === 'absent').length;
  const percentage = records.length ? Number(((presentCount / records.length) * 100).toFixed(1)) : 0;

  return {
    todaysExams: todaysExams.length,
    pendingExamAttendance: pendingAttendance.length,
    completedExamAttendance: completedAttendance.length,
    studentsPresent: presentCount,
    studentsAbsent: absentCount,
    attendancePercentage: percentage,
    totalStudents: students.length,
  };
}
