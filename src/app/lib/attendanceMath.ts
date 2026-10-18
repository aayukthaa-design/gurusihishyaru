// Single source of truth for attendance maths. Every portal (teacher, admin,
// super admin, parent), dashboard, PDF and Excel export goes through here so
// the numbers can never disagree.
//
//   Attendance % = ((Total Classes − Absent Classes) / Total Classes) × 100
//
// Total Classes excludes holidays — both the 'holiday' status and any date on
// the holiday calendar — so a holiday is never counted as an absence.

export type AttendanceMark = 'present' | 'absent' | 'holiday';

/** Server may still hold rows saved before the Leave→Holiday rename; read them as holiday. */
export function normalizeAttendanceStatus(status?: string | null): AttendanceMark {
  if (status === 'absent') return 'absent';
  if (status === 'holiday' || status === 'leave') return 'holiday';
  return 'present'; // 'present' and the removed 'half_day'
}

export interface AttendanceCounts {
  present: number;
  absent: number;
  holiday: number;
  /** Classes that actually count: present + absent (holidays excluded). */
  total: number;
  /** null when there were no classes — callers render "—" instead of dividing by zero. */
  percent: number | null;
}

export function attendancePercent(total: number, absent: number): number | null {
  if (!total || total <= 0) return null;
  return Math.round(((total - absent) / total) * 100);
}

export function formatAttendancePercent(percent: number | null): string {
  return percent === null ? '—' : `${percent}%`;
}

export function countAttendance(
  records: Array<{ date?: string; status?: string | null }>,
  isHolidayDate?: (date: string) => boolean,
): AttendanceCounts {
  let present = 0;
  let absent = 0;
  let holiday = 0;
  for (const r of records) {
    const mark = normalizeAttendanceStatus(r.status);
    if (mark === 'holiday' || (r.date && isHolidayDate?.(r.date))) holiday += 1;
    else if (mark === 'absent') absent += 1;
    else present += 1;
  }
  const total = present + absent;
  return { present, absent, holiday, total, percent: attendancePercent(total, absent) };
}

// ─── Monthly matrix (shared by the Teacher and Parent PDF / Excel reports) ─────

export const TICK = '✓';
export const CROSS = '✗';
export const HOLIDAY_MARK = 'H';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface MonthlyAttendanceDay {
  date: string;
  dayOfMonth: number;
  weekday: string;
  holidayTitle?: string;
}

export interface MonthlyAttendanceRow {
  id: string;
  name: string;
  /** One entry per day: ✓, ✗, H (holiday) or '' (not marked). */
  cells: string[];
  counts: AttendanceCounts;
}

export interface MonthlyAttendanceMatrix {
  month: string;
  days: MonthlyAttendanceDay[];
  rows: MonthlyAttendanceRow[];
}

export function buildMonthlyAttendanceMatrix(input: {
  month: string; // YYYY-MM
  students: Array<{ id: string; name: string }>;
  records: Array<{ studentId: string; date: string; status?: string | null }>;
  holidays: Array<{ date: string; title?: string }>;
}): MonthlyAttendanceMatrix {
  const [y, m] = input.month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const holidayByDate = new Map(input.holidays.map((h) => [h.date, h.title || 'Holiday']));

  const days: MonthlyAttendanceDay[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${input.month}-${String(d).padStart(2, '0')}`;
    days.push({ date, dayOfMonth: d, weekday: WEEKDAYS[new Date(y, m - 1, d).getDay()], holidayTitle: holidayByDate.get(date) });
  }

  const byStudent = new Map<string, Map<string, string | null | undefined>>();
  for (const r of input.records) {
    if (!r.date.startsWith(input.month)) continue;
    if (!byStudent.has(r.studentId)) byStudent.set(r.studentId, new Map());
    byStudent.get(r.studentId)!.set(r.date, r.status);
  }

  const rows = input.students.map((s) => {
    const marks = byStudent.get(s.id) ?? new Map();
    const cells = days.map((day) => {
      if (day.holidayTitle) return HOLIDAY_MARK;
      if (!marks.has(day.date)) return '';
      const mark = normalizeAttendanceStatus(marks.get(day.date));
      return mark === 'present' ? TICK : mark === 'absent' ? CROSS : HOLIDAY_MARK;
    });
    const counts = countAttendance(
      [...marks.entries()].map(([date, status]) => ({ date, status })),
      (date) => holidayByDate.has(date),
    );
    return { id: s.id, name: s.name, cells, counts };
  });

  return { month: input.month, days, rows };
}
