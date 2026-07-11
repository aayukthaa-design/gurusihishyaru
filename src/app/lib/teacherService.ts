import { createStore, useStoreValue } from './store';

export interface TeacherRecord {
  id: string;
  employeeId: string;
  fullName: string;
  gender: string;
  dob: string;
  phone: string;
  email: string;
  address: string;
  qualification: string;
  experience: string;
  specialization: string;
  branchId: string;
  dateOfJoining: string;
  username: string;
  password: string;
  employmentType: string;
  status: 'Active' | 'Inactive';
  profilePhoto?: string;
  role: 'teacher';
}

interface TeacherFormPayload {
  fullName: string;
  gender: string;
  dob: string;
  phone: string;
  email: string;
  address: string;
  qualification: string;
  experience: string;
  specialization: string;
  branchId: string;
  dateOfJoining: string;
  username: string;
  password: string;
  confirmPassword: string;
  employmentType: string;
  status: 'Active' | 'Inactive';
  profilePhoto?: string;
}

const STORAGE_KEY = 'guru-shishyaru-teachers';

const today = new Date();

// Start with no demo teachers - keep teacher list empty until real data is imported
const seedTeachers: TeacherRecord[] = [];

function readTeachers(): TeacherRecord[] {
  if (typeof window === 'undefined') return seedTeachers;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedTeachers;
    const parsed = JSON.parse(raw) as TeacherRecord[];
    if (!Array.isArray(parsed) || parsed.length === 0) return seedTeachers;
    return parsed;
  } catch {
    return seedTeachers;
  }
}

function persistTeachers(teachers: TeacherRecord[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(teachers));
  } catch {
    // ignore
  }
}

const teacherStore = createStore<TeacherRecord[]>(readTeachers());

export function getTeachers(): TeacherRecord[] {
  return teacherStore.getState();
}

export function useTeachers() {
  return useStoreValue(teacherStore);
}

function generateEmployeeId(existing: TeacherRecord[]) {
  const next = existing.length + 1;
  return `EMP${String(next).padStart(3, '0')}`;
}

function generateTeacherId(existing: TeacherRecord[]) {
  const next = existing.length + 1;
  return `TCH${String(next).padStart(3, '0')}`;
}

function isEmailTaken(email: string, existing: TeacherRecord[], ignoreId?: string) {
  return existing.some((teacher) => teacher.email.toLowerCase() === email.toLowerCase() && teacher.id !== ignoreId);
}

function isUsernameTaken(username: string, existing: TeacherRecord[], ignoreId?: string) {
  return existing.some((teacher) => teacher.username.toLowerCase() === username.toLowerCase() && teacher.id !== ignoreId);
}

function isPhoneTaken(phone: string, existing: TeacherRecord[], ignoreId?: string) {
  return existing.some((teacher) => teacher.phone === phone && teacher.id !== ignoreId);
}

function normalizeTeacher(input: TeacherFormPayload, branchId: string, existing: TeacherRecord[], id?: string): TeacherRecord {
  const employeeId = input.employeeId || generateEmployeeId(existing);
  const teacherId = id || generateTeacherId(existing);
  return {
    id: teacherId,
    employeeId,
    fullName: input.fullName.trim(),
    gender: input.gender,
    dob: input.dob,
    phone: input.phone,
    email: input.email.trim(),
    address: input.address.trim(),
    qualification: input.qualification.trim(),
    experience: input.experience.trim(),
    specialization: input.specialization.trim(),
    branchId,
    dateOfJoining: input.dateOfJoining,
    username: input.username.trim(),
    password: input.password,
    employmentType: input.employmentType,
    status: input.status,
    profilePhoto: input.profilePhoto,
    role: 'teacher',
  };
}

export function addTeacher(input: TeacherFormPayload, branchId: string) {
  const existing = teacherStore.getState();
  if (!input.fullName.trim()) return { success: false, error: 'Full name is required.' };
  if (!input.email.trim()) return { success: false, error: 'Email is required.' };
  if (!input.username.trim()) return { success: false, error: 'Username is required.' };
  if (!input.phone.trim()) return { success: false, error: 'Phone number is required.' };
  if (!input.password || input.password !== input.confirmPassword) return { success: false, error: 'Passwords do not match.' };
  if (isEmailTaken(input.email, existing)) return { success: false, error: 'Email is already in use.' };
  if (isUsernameTaken(input.username, existing)) return { success: false, error: 'Username is already in use.' };
  if (!/^\d{10}$/.test(input.phone.replace(/\D/g, ''))) return { success: false, error: 'Phone number must be 10 digits.' };
  if (isPhoneTaken(input.phone, existing)) return { success: false, error: 'Phone number is already in use.' };

  const teacher = normalizeTeacher(input, branchId, existing);
  const next = [teacher, ...existing];
  teacherStore.setState(next);
  persistTeachers(next);
  return { success: true, teacher };
}

export function updateTeacher(id: string, input: TeacherFormPayload, branchId: string) {
  const existing = teacherStore.getState();
  if (!input.fullName.trim()) return { success: false, error: 'Full name is required.' };
  if (!input.email.trim()) return { success: false, error: 'Email is required.' };
  if (!input.username.trim()) return { success: false, error: 'Username is required.' };
  if (!input.phone.trim()) return { success: false, error: 'Phone number is required.' };
  if (!input.password || input.password !== input.confirmPassword) return { success: false, error: 'Passwords do not match.' };
  if (isEmailTaken(input.email, existing, id)) return { success: false, error: 'Email is already in use.' };
  if (isUsernameTaken(input.username, existing, id)) return { success: false, error: 'Username is already in use.' };
  if (!/^\d{10}$/.test(input.phone.replace(/\D/g, ''))) return { success: false, error: 'Phone number must be 10 digits.' };
  if (isPhoneTaken(input.phone, existing, id)) return { success: false, error: 'Phone number is already in use.' };

  const next = existing.map((teacher) => teacher.id === id ? normalizeTeacher(input, branchId, existing, id) : teacher);
  teacherStore.setState(next);
  persistTeachers(next);
  return { success: true, teacher: next.find((teacher) => teacher.id === id) };
}

export function getTeachersForBranch(branchId?: string) {
  return getTeachers().filter((teacher) => !branchId || teacher.branchId === branchId);
}

export function getTeacherById(id: string) {
  return getTeachers().find((teacher) => teacher.id === id);
}
