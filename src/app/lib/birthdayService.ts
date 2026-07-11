import { StudentRecord } from './studentService';
import { TeacherRecord } from './teacherService';
import { AppNotification, addNotification, getNotifications } from './notificationService';

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
