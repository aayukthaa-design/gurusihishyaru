import { StudentRecord, getStudentById } from './studentService';
import { TeacherRecord, getTeachers } from './teacherService';
import { AppNotification, addNotification, getNotifications } from './notificationService';
import { openWhatsAppChat } from './whatsapp';

export interface BirthdayEntry {
  id: string;
  name: string;
  role: 'student' | 'teacher';
  branchId?: string;
  className?: string;
  department?: string;
  dob?: string; // ISO date
}

function monthDayOf(dateStr?: string) {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return null;
    return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  } catch {
    return null;
  }
}

export function findTodaysBirthdays(students: StudentRecord[], teachers: TeacherRecord[], branchId?: string) {
  const todayKey = monthDayOf(new Date().toISOString().slice(0, 10));
  const studentsToday = (students || []).filter((s) => {
    if (!s || !((s as any).dob)) return false;
    if (branchId && s.branchId !== branchId) return false;
    return monthDayOf((s as any).dob) === todayKey;
  }).map((s) => ({ id: s.id, name: s.fullName || s.firstName || '', role: 'student' as const, branchId: s.branchId, className: s.className, dob: (s as any).dob }));

  const teachersToday = (teachers || []).filter((t) => {
    if (!t || !t.dob) return false;
    if (branchId && t.branchId !== branchId) return false;
    return monthDayOf(t.dob) === todayKey;
  }).map((t) => ({ id: t.id, name: t.fullName || '', role: 'teacher' as const, branchId: t.branchId, department: (t as any).department, dob: t.dob }));

  return { students: studentsToday, teachers: teachersToday };
}

export function findUpcomingBirthdays(students: StudentRecord[], teachers: TeacherRecord[], days = 7, branchId?: string) {
  const res: BirthdayEntry[] = [];
  const now = new Date();
  for (let i = 1; i <= days; i++) {
    const d = new Date(now.getTime());
    d.setDate(now.getDate() + i);
    const key = `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}`;

    (students || []).forEach((s) => {
      const sd = (s as any).dob;
      if (!sd) return;
      if (branchId && s.branchId !== branchId) return;
      const sk = monthDayOf(sd);
      if (sk === key) res.push({ id: s.id, name: s.fullName || s.firstName || '', role: 'student', branchId: s.branchId, className: s.className, dob: sd });
    });

    (teachers || []).forEach((t) => {
      if (!t.dob) return;
      if (branchId && t.branchId !== branchId) return;
      const tk = monthDayOf(t.dob);
      if (tk === key) res.push({ id: t.id, name: t.fullName || '', role: 'teacher', branchId: t.branchId, department: (t as any).department, dob: t.dob });
    });
  }
  return res.sort((a, b) => (a.branchId || '').localeCompare(b.branchId || ''));
}

function getTodayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function getNotificationIsoDate(notification: AppNotification) {
  try {
    const date = new Date(notification.createdAt);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

function alreadyNotifiedToday(entity: BirthdayEntry) {
  const today = getTodayIsoDate();
  const notifications = getNotifications();
  return notifications.some((note) => {
    if (note.notificationType !== 'Birthday') return false;
    if (getNotificationIsoDate(note) !== today) return false;
    if (entity.role === 'student' && note.studentIds?.includes(entity.id)) return true;
    if (entity.role === 'teacher' && note.teacherIds?.includes(entity.id)) return true;
    return false;
  });
}

export function notifyBirthday(entry: BirthdayEntry) {
  if (alreadyNotifiedToday(entry)) return;
  const title = entry.role === 'student' ? `🎂 Today is ${entry.name}'s Birthday` : `🎉 Today is ${entry.name}'s Birthday`;
  const message = entry.role === 'student' ? `🎂 Today is Student ${entry.name}'s Birthday.` : `🎉 Today is Teacher ${entry.name}'s Birthday.`;

  addNotification({
    title,
    message,
    type: 'info',
    roles: ['admin', 'super_admin'],
    branchId: entry.branchId ?? undefined,
    notificationType: 'Birthday',
    studentIds: entry.role === 'student' ? [entry.id] : undefined,
    teacherIds: entry.role === 'teacher' ? [entry.id] : undefined,
    recipient: 'Admin',
    priority: 'low',
  } as any);
}

// wa.me click-to-chat requires the full international number (91 + 10 digits),
// not a bare local number — mirrors the same normalization Attendance.tsx
// already uses for the "student absent" WhatsApp messages.
function toIndiaWhatsAppNumber(mobile?: string | null): string | null {
  if (!mobile) return null;
  const digits = mobile.replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  return null;
}

/**
 * Opens a prefilled WhatsApp birthday wish — to the parent's number for a
 * student, or directly to the teacher's own number. Never sends automatically;
 * the user still has to press Send inside WhatsApp.
 */
export function sendBirthdayWhatsAppWish(role: 'student' | 'teacher', id: string): { success: boolean; error?: string } {
  if (role === 'student') {
    const student = getStudentById(id);
    if (!student) return { success: false, error: 'Student not found.' };
    const phone = toIndiaWhatsAppNumber(student.primaryParentMobile);
    if (!phone) return { success: false, error: `No valid parent mobile number on file for ${student.fullName}.` };
    const message =
      `🎂 *Guru Shishyaru Tutorials*\n\n` +
      `Dear Parent,\n\n` +
      `Wishing your child *${student.fullName}* a very Happy Birthday! 🎉\n\n` +
      `We hope this year brings them joy, success, and wonderful memories.\n\n` +
      `Warm wishes,\n*Guru Shishyaru Tutorials*`;
    openWhatsAppChat(phone, message);
    return { success: true };
  }

  const teacher = getTeachers().find((t) => t.id === id);
  if (!teacher) return { success: false, error: 'Teacher not found.' };
  const phone = toIndiaWhatsAppNumber(teacher.phone);
  if (!phone) return { success: false, error: `No valid mobile number on file for ${teacher.fullName}.` };
  const message =
    `🎉 *Guru Shishyaru Tutorials*\n\n` +
    `Dear *${teacher.fullName}*,\n\n` +
    `Wishing you a very Happy Birthday! 🎂\n\n` +
    `Thank you for all your dedication and hard work. Have a wonderful day!\n\n` +
    `Warm wishes,\n*Guru Shishyaru Tutorials*`;
  openWhatsAppChat(phone, message);
  return { success: true };
}
