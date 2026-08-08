import { apiFetch } from './apiClient';
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
  status: 'Active' | 'Inactive' | 'Archived';
  createdAt: string;
  board: string;
  description: string;
  updatedAt?: string;
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
  board: string;
  description: string;
}

const classStore = createStore<ClassRecord[]>([]);

export async function refreshClasses(): Promise<ClassRecord[]> {
  try {
    const res = await apiFetch('/api/classes');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        classStore.setState(data);
        return data;
      }
    }
  } catch (e) {
    console.error('Failed to fetch classes:', e);
  }
  return classStore.getState();
}

// Initial load
void refreshClasses();

export function getClasses(): ClassRecord[] {
  return classStore.getState();
}

export function useClasses() {
  return useStoreValue(classStore);
}

export async function addClass(input: ClassFormPayload): Promise<{ success: boolean; error?: string; class?: ClassRecord }> {
  if (!input.className.trim()) return { success: false, error: 'Class name is required.' };
  if (!input.assignedTeacherId) return { success: false, error: 'Assigned teacher is required.' };
  try {
    const res = await apiFetch('/api/classes', { method: 'POST', body: input });
    if (res.ok) {
      const classRecord: ClassRecord = await res.json();
      await refreshClasses();
      return { success: true, class: classRecord };
    }
    const data = await res.json().catch(() => ({}));
    return { success: false, error: data.error || 'Unable to create class.' };
  } catch (err) {
    console.error('addClass error:', err);
    return { success: false, error: 'Connection to server failed. Please try again.' };
  }
}

export async function updateClass(id: string, input: Partial<ClassFormPayload>): Promise<{ success: boolean; error?: string; class?: ClassRecord }> {
  try {
    const res = await apiFetch(`/api/classes/${id}`, { method: 'PUT', body: input });
    if (res.ok) {
      const classRecord: ClassRecord = await res.json();
      await refreshClasses();
      return { success: true, class: classRecord };
    }
    const data = await res.json().catch(() => ({}));
    return { success: false, error: data.error || 'Unable to update batch.' };
  } catch (err) {
    console.error('updateClass error:', err);
    return { success: false, error: 'Connection to server failed. Please try again.' };
  }
}

export async function deleteClass(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await apiFetch(`/api/classes/${id}`, { method: 'DELETE' });
    if (res.ok) {
      await refreshClasses();
      return { success: true };
    }
    const data = await res.json().catch(() => ({}));
    return { success: false, error: data.error || 'Unable to delete batch.' };
  } catch (err) {
    console.error('deleteClass error:', err);
    return { success: false, error: 'Connection to server failed. Please try again.' };
  }
}

export function getClassesForBranch(branchId?: string) {
  return getClasses().filter((entry) => entry.status !== 'Archived' && (!branchId || entry.branchId === branchId));
}

export function getClassesForTeacher(teacherId?: string, branchId?: string) {
  return getClasses().filter((entry) => entry.status !== 'Archived' && (!teacherId || entry.assignedTeacherId === teacherId) && (!branchId || entry.branchId === branchId));
}

// Same shape /api/allocations?teacherId= used to return, so Homework.tsx and
// TeacherCreateExam.tsx can switch data source without changing their own
// logic. A teacher now has exactly one subject/board per batch (classes row),
// so `batches` is always a single-element array holding that batch's board.
export function getTeacherAllocationsShape(teacherId?: string, branchId?: string): {
  classes: string[];
  allocations: Record<string, { subjects: string[]; batches: string[] }>;
} {
  const rows = getClassesForTeacher(teacherId, branchId);
  const classes = rows.map((r) => r.className);
  const allocations: Record<string, { subjects: string[]; batches: string[] }> = {};
  for (const row of rows) {
    allocations[row.className] = {
      subjects: row.subject ? [row.subject] : [],
      batches: row.board ? [row.board] : [],
    };
  }
  return { classes, allocations };
}
