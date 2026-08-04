// Single source of truth for the grade and board dropdowns used across
// Student Management, Attendance, Class Allocation, Homework, Materials,
// Exams, Lesson Plans, and Special Classes. Previously each of those files
// hardcoded its own class list independently, and several had silently
// drifted out of sync (missing grades, stopping at 10th).
export const GRADES = [
  '1st', '2nd', '3rd', '4th', '5th', '6th',
  '7th', '8th', '9th', '10th', '11th', '12th',
];

// The `batch` field (on students/allocations/homework/materials/lesson_plans/
// special_classes/exams) now represents the academic board a class follows,
// not a session-time grouping (the old "Batch A"/"Morning"/"Evening" values
// had near-zero real usage — see the class-restructuring plan).
export const BOARDS = ['CBSE', 'State', 'ICSE'];

// Times are stored/edited as 24-hour "HH:MM" (native <input type="time"> value),
// but should always be displayed to users in 12-hour AM/PM form.
export function formatTime12h(value?: string): string {
  if (!value) return value || '';
  const [hStr, mStr] = value.split(':');
  const h = Number(hStr);
  if (Number.isNaN(h)) return value;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mStr} ${period}`;
}
