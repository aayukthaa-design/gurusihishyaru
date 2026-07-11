import { createStore, useStoreValue } from './store';

export interface ClassRecord {
  id: string;
  className: string;
  batchName: string;
  course: string;
  subject: string;
  assignedTeacherId: string;
  branchId: string;
  roomNumber: string;
  maxStudents: number;
  startDate: string;
  endDate: string;
  classTiming: string;
  daysOfWeek: string[];
  status: 'Active' | 'Inactive';
  createdAt: string;
}

interface ClassFormPayload {
  className: string;
  batchName: string;
  course: string;
  subject: string;
  assignedTeacherId: string;
  branchId: string;
  roomNumber: string;
  maxStudents: number;
  startDate: string;
  endDate: string;
  classTiming: string;
  daysOfWeek: string[];
  status: 'Active' | 'Inactive';
}

const STORAGE_KEY = 'guru-shishyaru-classes';

const seedClasses: ClassRecord[] = [
  {
    id: 'CLS001',
    className: '10th A',
    batchName: 'Batch A',
    course: 'Mathematics',
    subject: 'Mathematics',
    assignedTeacherId: 'TCH001',
    branchId: 'branch_rajajinagar',
    roomNumber: 'Room 101',
    maxStudents: 35,
    startDate: '2026-06-01',
    endDate: '2026-12-31',
    classTiming: '08:00-09:00',
    daysOfWeek: ['Monday', 'Wednesday', 'Friday'],
    status: 'Active',
    createdAt: new Date().toISOString(),
  },
];

function readClasses(): ClassRecord[] {
  if (typeof window === 'undefined') return seedClasses;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedClasses;
    const parsed = JSON.parse(raw) as ClassRecord[];
    return Array.isArray(parsed) && parsed.length ? parsed : seedClasses;
  } catch {
    return seedClasses;
  }
}

function persistClasses(classes: ClassRecord[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(classes));
  } catch {
    // ignore
  }
}

const classStore = createStore<ClassRecord[]>(readClasses());

export function getClasses(): ClassRecord[] {
  return classStore.getState();
}

export function useClasses() {
  return useStoreValue(classStore);
}

export function addClass(input: ClassFormPayload) {
  if (!input.className.trim()) return { success: false, error: 'Class name is required.' };
  if (!input.assignedTeacherId) return { success: false, error: 'Assigned teacher is required.' };
  const classRecord: ClassRecord = {
    id: `CLS${String(classStore.getState().length + 1).padStart(3, '0')}`,
    className: input.className.trim(),
    batchName: input.batchName.trim(),
    course: input.course.trim(),
    subject: input.subject.trim(),
    assignedTeacherId: input.assignedTeacherId,
    branchId: input.branchId,
    roomNumber: input.roomNumber.trim(),
    maxStudents: Number(input.maxStudents || 0),
    startDate: input.startDate,
    endDate: input.endDate,
    classTiming: input.classTiming,
    daysOfWeek: input.daysOfWeek,
    status: input.status,
    createdAt: new Date().toISOString(),
  };
  const next = [classRecord, ...classStore.getState()];
  classStore.setState(next);
  persistClasses(next);
  return { success: true, class: classRecord };
}

export function getClassesForBranch(branchId?: string) {
  return getClasses().filter((entry) => !branchId || entry.branchId === branchId);
}

export function getClassesForTeacher(teacherId?: string, branchId?: string) {
  return getClasses().filter((entry) => (!teacherId || entry.assignedTeacherId === teacherId) && (!branchId || entry.branchId === branchId));
}
