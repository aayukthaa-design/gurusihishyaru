import { createStore, useStoreValue } from './store';
import { apiFetch } from './apiClient';

export interface SchoolExamSchedule {
  id: string;
  studentId: string;
  studentName: string;
  branchId?: string;
  schoolName: string;
  schoolClass: string;
  examName: string;
  startDate: string;
  endDate: string;
  subject?: string;
  description?: string;
  attachmentPath?: string | null;
  attachmentName?: string | null;
  attachmentSize?: number | null;
  status: 'Upcoming' | 'Ongoing' | 'Completed';
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
  teacherId?: string;
  teacherName?: string;
}

const API_BASE = '';
const schoolExamStore = createStore<SchoolExamSchedule[]>([]);

export function getSchoolExamStatus(startDate?: string, endDate?: string): SchoolExamSchedule['status'] {
  if (!startDate || !endDate) return 'Upcoming';
  const today = new Date().toISOString().slice(0, 10);
  if (today < startDate) return 'Upcoming';
  if (today > endDate) return 'Completed';
  return 'Ongoing';
}

export async function refreshSchoolExamSchedules(params: Record<string, string> = {}): Promise<SchoolExamSchedule[]> {
  try {
    const query = new URLSearchParams(params);
    const res = await apiFetch(`${API_BASE}/api/school-exam-schedules?${query.toString()}`);
    if (!res.ok) throw new Error('failed');
    const data = await res.json();
    if (Array.isArray(data)) {
      const normalized = data.map((entry: any) => ({
        ...entry,
        status: getSchoolExamStatus(entry.startDate, entry.endDate),
      }));
      schoolExamStore.setState(normalized);
      return normalized;
    }
  } catch (error) {
    console.error('Failed to fetch school exam schedules', error);
  }
  return schoolExamStore.getState();
}

export function subscribeSchoolExamSchedules(listener: (items: SchoolExamSchedule[]) => void) {
  return schoolExamStore.subscribe(listener);
}

export function useSchoolExamSchedules() {
  return useStoreValue(schoolExamStore);
}

export async function createSchoolExamSchedule(formData: FormData): Promise<SchoolExamSchedule | null> {
  try {
    const res = await apiFetch(`${API_BASE}/api/school-exam-schedules`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) throw new Error('failed');
    const created = await res.json();
    await refreshSchoolExamSchedules();
    return created;
  } catch (error) {
    console.error('Failed to create school exam schedule', error);
    return null;
  }
}

export async function updateSchoolExamSchedule(id: string, formData: FormData): Promise<SchoolExamSchedule | null> {
  try {
    const res = await apiFetch(`${API_BASE}/api/school-exam-schedules/${id}`, {
      method: 'PUT',
      body: formData,
    });
    if (!res.ok) throw new Error('failed');
    const updated = await res.json();
    await refreshSchoolExamSchedules();
    return updated;
  } catch (error) {
    console.error('Failed to update school exam schedule', error);
    return null;
  }
}

export async function deleteSchoolExamSchedule(id: string): Promise<boolean> {
  try {
    const res = await apiFetch(`${API_BASE}/api/school-exam-schedules/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('failed');
    await refreshSchoolExamSchedules();
    return true;
  } catch (error) {
    console.error('Failed to delete school exam schedule', error);
    return false;
  }
}

export function getAttachmentUrl(path?: string | null) {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE}${path}`;
}

export function formatScheduleDate(value?: string) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
