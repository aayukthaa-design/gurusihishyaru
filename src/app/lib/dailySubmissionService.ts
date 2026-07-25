import { apiFetch } from './apiClient';
import { createStore, useStoreValue } from './store';

type Submission = {
  id: string;
  date: string; // ISO date
  className: string;
  subject: string;
  topic: string;
  homework: string;
  attendanceStatus: 'All Present' | 'Some Absent' | 'Many Absent' | 'Not Taken' | string;
  notes?: string;
  teacherId: string;
  teacherName: string;
  branchId?: string;
  createdAt: string; // timestamp
};

const store = createStore<Submission[]>([]);

export async function refreshSubmissions(): Promise<Submission[]> {
  try {
    const res = await apiFetch('/api/daily-submissions');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        store.setState(data);
        return data;
      }
    }
  } catch (e) {
    console.error('Failed to fetch daily submissions:', e);
  }
  return store.getState();
}

// Initial load
void refreshSubmissions();

export function subscribeSubmissions(cb: (items: Submission[]) => void) {
  return store.subscribe(cb);
}

export function useSubmissions(): Submission[] {
  return useStoreValue(store);
}

export function getSubmissions() {
  return store.getState();
}

export async function addSubmission(payload: Omit<Submission, 'id' | 'createdAt' | 'teacherId' | 'teacherName'>): Promise<Submission | null> {
  try {
    const res = await apiFetch('/api/daily-submissions', { method: 'POST', body: payload });
    if (res.ok) {
      const submission = await res.json();
      await refreshSubmissions();
      return submission;
    }
  } catch (err) {
    console.error('addSubmission error:', err);
  }
  return null;
}

export type { Submission };
