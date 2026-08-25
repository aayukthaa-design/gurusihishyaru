import { createStore, useStoreValue } from './store';
import { apiFetch } from './apiClient';

export interface StudentRecord {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  dob?: string;
  rollNumber: string;
  admissionNumber: string;
  className: string;
  branchId: string;
  branchName: string;
  subject?: string;
  /** Academic board (CBSE/State/ICSE) — see classConstants.ts for the repurposing note. */
  batch?: string;
  fatherName?: string;
  motherName?: string;
  primaryParentName?: string;
  relationship?: string;
  fatherMobile?: string;
  motherMobile?: string;
  primaryParentMobile?: string;
  parentEmail?: string;
  guardianName?: string;
  guardianMobile?: string;
  address?: string;
  status?: string;
  /** Extra batches this student also belongs to, beyond className/batch/branchId above (their primary batch). Same student, one profile, multiple batches. */
  batches?: Array<{ classId: string; className: string; batch?: string; branchId: string }>;
}

const API_BASE = '';

const today = new Date();

// No demo seed students - start with an empty list to prepare for real data import
const SEED_STUDENTS: StudentRecord[] = [];

const studentStore = createStore<StudentRecord[]>(SEED_STUDENTS);

export async function refreshStudents(): Promise<StudentRecord[]> {
  try {
    const res = await apiFetch(`${API_BASE}/api/students`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const mapped: StudentRecord[] = data.map((student: any) => ({
          ...student,
          branchName: student.branchId === 'branch_rajajinagar' ? 'Rajajinagar Branch' :
                      student.branchId === 'branch_jayanagar' ? 'Jayanagar Branch' :
                      student.branchId === 'branch_vijayanagar' ? 'Vijayanagar Branch' :
                      student.branchId === 'branch_hsr' ? 'HSR Layout Branch' : 'Main Branch'
        }));
        studentStore.setState(mapped);
        return mapped;
      }
    }
  } catch (e) {
    console.error('Failed to fetch students, using memory cache:', e);
  }
  return studentStore.getState();
}

// Initial load
void refreshStudents();

export function getStudentsForClass(className?: string, branchId?: string, batch?: string): StudentRecord[] {
  const list = studentStore.getState();
  const normalize = (v?: string) => (v ? v.replace('Grade ', '') : '');
  const filterClass = normalize(className);
  return list.filter((student) => {
    const matchesPrimary =
      (!className || normalize(student.className) === filterClass) &&
      (!branchId || student.branchId === branchId) &&
      (!batch || student.batch === batch);
    // Multi-batch: also match if this student was additionally assigned to a
    // batch (student_batches, server-attached as `batches`) matching the
    // requested className/branch/board — so a student in a second batch shows
    // up for that batch's roster too, not just their primary one.
    const matchesSecondary =
      !!className &&
      (student.batches || []).some(
        (b) => normalize(b.className) === filterClass && (!branchId || b.branchId === branchId) && (!batch || b.batch === batch)
      );
    // Soft-deleted/re-admitted students keep an Inactive duplicate row; exclude
    // it here so every roster built off this class list (attendance, exams,
    // homework) doesn't show the same student twice.
    return (matchesPrimary || matchesSecondary) && student.status !== 'Inactive';
  });
}

export function getStudentsByIds(studentIds: string[]): StudentRecord[] {
  if (!studentIds?.length) return [];
  const list = studentStore.getState();
  return list.filter((student) => studentIds.includes(student.id));
}

export function getStudentById(studentId?: string): StudentRecord | undefined {
  if (!studentId) return undefined;
  const list = studentStore.getState();
  return list.find((student) => student.id === studentId);
}

export function getAllStudents(): StudentRecord[] {
  return studentStore.getState();
}

export async function addStudentAPI(student: Omit<StudentRecord, 'id'>): Promise<StudentRecord | null> {
  try {
    const res = await apiFetch(`${API_BASE}/api/students`, {
      method: 'POST',
      body: student
    });
    if (res.ok) {
      const saved = await res.json();
      await refreshStudents();
      return saved;
    }
  } catch (err) {
    console.error('addStudentAPI error:', err);
  }
  return null;
}

export async function updateStudentAPI(id: string, student: Partial<StudentRecord>): Promise<StudentRecord | null> {
  try {
    const res = await apiFetch(`${API_BASE}/api/students/${id}`, {
      method: 'PUT',
      body: student
    });
    if (res.ok) {
      const saved = await res.json();
      await refreshStudents();
      return saved;
    }
  } catch (err) {
    console.error('updateStudentAPI error:', err);
  }
  return null;
}

export async function deleteStudentAPI(id: string): Promise<boolean> {
  try {
    const res = await apiFetch(`${API_BASE}/api/students/${id}`, { method: 'DELETE' });
    if (res.ok) {
      await refreshStudents();
      return true;
    }
  } catch (err) {
    console.error('deleteStudentAPI error:', err);
  }
  return false;
}

export function useStudents() {
  return useStoreValue(studentStore);
}

/** Adds the student to another batch (classId) alongside every batch they're already in — never moves/overwrites their primary. */
export async function addStudentToBatchAPI(studentId: string, classId: string): Promise<StudentRecord | null> {
  try {
    const res = await apiFetch(`${API_BASE}/api/students/${studentId}/batches`, { method: 'POST', body: { classId } });
    if (res.ok) {
      const saved = await res.json();
      await refreshStudents();
      return saved;
    }
  } catch (err) {
    console.error('addStudentToBatchAPI error:', err);
  }
  return null;
}

/** Removes the student from one batch (classId). If it was their primary, the server reassigns their primary to a remaining batch (or clears it if none are left). */
export async function removeStudentFromBatchAPI(studentId: string, classId: string): Promise<StudentRecord | null> {
  try {
    const res = await apiFetch(`${API_BASE}/api/students/${studentId}/batches/${classId}`, { method: 'DELETE' });
    if (res.ok) {
      const saved = await res.json();
      await refreshStudents();
      return saved;
    }
  } catch (err) {
    console.error('removeStudentFromBatchAPI error:', err);
  }
  return null;
}
