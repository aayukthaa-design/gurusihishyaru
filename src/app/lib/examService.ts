import { createStore, useStoreValue } from './store';
import { addNotification } from './notificationService';
import { apiFetch } from './apiClient';

export interface Exam {
  id: string;
  name: string;
  subject: string;
  className: string;
  batch: string;
  date: string;
  maxMarks: number;
  passingMarks: number;
  teacherId: string;
  teacherName: string;
  status: 'draft' | 'published' | 'attendance_completed' | 'marks_entry_open' | 'results_published' | 'completed';
  createdAt: string;
}

function mapApiExam(row: any): Exam {
  return {
    id: String(row.id),
    name: row.name,
    subject: row.subject,
    className: row.className,
    batch: row.batch || '',
    date: row.date,
    maxMarks: row.maxMarks,
    passingMarks: row.passingMarks,
    teacherId: row.createdBy || '',
    teacherName: row.teacherName || '',
    status: row.status || 'draft',
    createdAt: row.createdAt,
  };
}

const store = createStore<Exam[]>([]);

export async function refreshExams(): Promise<Exam[]> {
  try {
    const res = await apiFetch('/api/exams');
    if (res.ok) {
      const data = await res.json();
      const mapped = Array.isArray(data) ? data.map(mapApiExam) : [];
      store.setState(mapped);
      return mapped;
    }
  } catch (err) {
    console.error('Failed to fetch exams:', err);
  }
  return store.getState();
}

// Initial load
void refreshExams();

/** Kept for the examApi.ts network-failure fallback path only. */
export function createExam(exam: Omit<Exam, 'id' | 'createdAt' | 'status'>): Exam {
  let counter = store.getState().length + 1;
  const newExam: Exam = {
    ...exam,
    id: `EX${String(counter).padStart(3, '0')}`,
    status: 'draft',
    createdAt: new Date().toISOString(),
  };
  store.setState((prev) => [newExam, ...prev]);

  addNotification({
    title: `New Exam Created: ${newExam.name}`,
    message: `${newExam.teacherName} created a new exam for ${newExam.className} — ${newExam.subject} on ${newExam.date}`,
    type: 'info',
    roles: ['admin', 'super_admin'],
  });

  return newExam;
}

/** Alias for createExam — used by examApi fallback */
export const addExam = createExam;

export async function publishExam(id: string): Promise<void> {
  await updateExamStatus(id, 'published');
  const exam = store.getState().find((e) => e.id === id);
  if (exam) {
    addNotification({
      title: `Exam Published: ${exam.name}`,
      message: `${exam.name} for ${exam.className} has been published and added to the student portal.`,
      type: 'success',
      roles: ['admin', 'parent'],
      classNames: [exam.className],
    });
  }
}

export async function updateExamStatus(id: string, status: Exam['status']): Promise<void> {
  try {
    const res = await apiFetch(`/api/exams/${id}`, { method: 'PUT', body: { status } });
    if (res.ok) {
      await refreshExams();
    }
  } catch (err) {
    console.error('updateExamStatus error:', err);
  }
}

export function subscribeExams(listener: (exams: Exam[]) => void): () => void {
  return store.subscribe(listener);
}

export function useExams(): Exam[] {
  return useStoreValue(store);
}

export function getExams(): Exam[] {
  return store.getState();
}
