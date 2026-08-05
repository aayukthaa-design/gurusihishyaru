import { createStore, useStoreValue } from './store';
import { apiFetch } from './apiClient';

export interface Holiday {
  id: number;
  date: string;
  title: string;
  branchId: string | null;
  createdBy?: string;
  createdAt?: string;
}

export interface StudentLeave {
  id: number;
  studentId: string;
  studentName?: string;
  startDate: string;
  endDate: string;
  reason?: string;
  branchId?: string | null;
  createdBy?: string;
  createdAt?: string;
}

const holidayStore = createStore<Holiday[]>([]);
const leaveStore = createStore<StudentLeave[]>([]);

export function useHolidays(): Holiday[] {
  return useStoreValue(holidayStore);
}

export function useStudentLeaves(): StudentLeave[] {
  return useStoreValue(leaveStore);
}

export async function refreshHolidays(params: { branchId?: string; from?: string; to?: string } = {}): Promise<Holiday[]> {
  try {
    const query = new URLSearchParams();
    if (params.branchId) query.set('branchId', params.branchId);
    if (params.from) query.set('from', params.from);
    if (params.to) query.set('to', params.to);
    const res = await apiFetch(`/api/holidays?${query.toString()}`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        holidayStore.setState(data);
        return data;
      }
    }
  } catch (err) {
    console.error('refreshHolidays error:', err);
  }
  return holidayStore.getState();
}

export async function createHoliday(holiday: { date: string; title: string; branchId?: string | null }): Promise<Holiday | null> {
  try {
    const res = await apiFetch('/api/holidays', { method: 'POST', body: holiday });
    if (!res.ok) return null;
    const created = await res.json();
    await refreshHolidays();
    return created;
  } catch (err) {
    console.error('createHoliday error:', err);
    return null;
  }
}

export async function deleteHoliday(id: number): Promise<boolean> {
  try {
    const res = await apiFetch(`/api/holidays/${id}`, { method: 'DELETE' });
    if (!res.ok) return false;
    await refreshHolidays();
    return true;
  } catch (err) {
    console.error('deleteHoliday error:', err);
    return false;
  }
}

export function isHoliday(holidays: Holiday[], date: string, branchId?: string): Holiday | undefined {
  return holidays.find((h) => h.date === date && (!h.branchId || h.branchId === branchId));
}

export async function refreshStudentLeaves(params: { branchId?: string; studentId?: string; date?: string } = {}): Promise<StudentLeave[]> {
  try {
    const query = new URLSearchParams();
    if (params.branchId) query.set('branchId', params.branchId);
    if (params.studentId) query.set('studentId', params.studentId);
    if (params.date) query.set('date', params.date);
    const res = await apiFetch(`/api/student-leaves?${query.toString()}`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        leaveStore.setState(data);
        return data;
      }
    }
  } catch (err) {
    console.error('refreshStudentLeaves error:', err);
  }
  return leaveStore.getState();
}

export async function createStudentLeave(leave: { studentId: string; studentName?: string; startDate: string; endDate: string; reason?: string; branchId?: string }): Promise<StudentLeave | null> {
  try {
    const res = await apiFetch('/api/student-leaves', { method: 'POST', body: leave });
    if (!res.ok) return null;
    const created = await res.json();
    await refreshStudentLeaves();
    return created;
  } catch (err) {
    console.error('createStudentLeave error:', err);
    return null;
  }
}

export async function deleteStudentLeave(id: number): Promise<boolean> {
  try {
    const res = await apiFetch(`/api/student-leaves/${id}`, { method: 'DELETE' });
    if (!res.ok) return false;
    await refreshStudentLeaves();
    return true;
  } catch (err) {
    console.error('deleteStudentLeave error:', err);
    return false;
  }
}

export function isOnLeave(leaves: StudentLeave[], studentId: string, date: string): StudentLeave | undefined {
  return leaves.find((l) => l.studentId === studentId && l.startDate <= date && l.endDate >= date);
}
