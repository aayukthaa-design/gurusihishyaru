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
  createdAt: string; // timestamp
};

const store = createStore<Submission[]>([]);

function nowISO() {
  return new Date().toISOString();
}

export function subscribeSubmissions(cb: (items: Submission[]) => void) {
  return store.subscribe((state) => cb(state.slice().reverse()));
}

export function useSubmissions(): Submission[] {
  return useStoreValue(store);
}

export function getSubmissions() {
  return store.getState().slice().reverse();
}

export function addSubmission(payload: Omit<Submission, 'id' | 'createdAt'>) {
  const id = `SUB${Date.now()}`;
  const item: Submission = { id, createdAt: nowISO(), ...payload } as Submission;
  store.setState((prev) => [item, ...prev]);
  return item;
}

export type { Submission };
