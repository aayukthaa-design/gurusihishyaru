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

export function getClassesForBranch(branchId?: string) {
  return getClasses().filter((entry) => !branchId || entry.branchId === branchId);
}

export function getClassesForTeacher(teacherId?: string, branchId?: string) {
  return getClasses().filter((entry) => (!teacherId || entry.assignedTeacherId === teacherId) && (!branchId || entry.branchId === branchId));
}
