import { createStore, useStoreValue } from './store';
import { addNotification } from './notificationService';

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

const store = createStore<Exam[]>([
  { id: 'EX001', name: 'Mid-Term Mathematics', subject: 'Mathematics', className: '10th A', batch: 'Batch A', date: '2026-06-25', maxMarks: 100, passingMarks: 35, teacherId: 'TCH001', teacherName: 'Kavitha Rao', status: 'published', createdAt: new Date().toISOString() },
  { id: 'EX002', name: 'Unit Test — Physics',  subject: 'Physics',     className: '11th A', batch: 'Batch A', date: '2026-06-28', maxMarks: 50,  passingMarks: 20, teacherId: 'TCH002', teacherName: 'Ramesh Kumar', status: 'published', createdAt: new Date().toISOString() },
  { id: 'EX003', name: 'English Grammar Test', subject: 'English',     className: '9th A',  batch: 'Morning', date: '2026-06-30', maxMarks: 50,  passingMarks: 20, teacherId: 'TCH003', teacherName: 'Sunita Patil', status: 'draft',     createdAt: new Date().toISOString() },
]);

let counter = 10;

export function createExam(exam: Omit<Exam, 'id' | 'createdAt' | 'status'>): Exam {
  const newExam: Exam = {
    ...exam,
    id: `EX${String(++counter).padStart(3, '0')}`,
    status: 'draft',
    createdAt: new Date().toISOString(),
  };
  store.setState((prev) => [newExam, ...prev]);

  // Notify admin
  addNotification({
    title: `New Exam Created: ${newExam.name}`,
    message: `${newExam.teacherName} created a new exam for ${newExam.className} — ${newExam.subject} on ${newExam.date}`,
    type: 'info',
    roles: ['admin', 'super_admin'],
  });

  return newExam;
}

export function publishExam(id: string): void {
  store.setState((prev) =>
    prev.map((e) => (e.id === id ? { ...e, status: 'published' } : e))
  );
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

export function updateExamStatus(id: string, status: Exam['status']): void {
  store.setState((prev) => prev.map((exam) => (exam.id === id ? { ...exam, status } : exam)));
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

/** Alias for createExam — used by examApi fallback */
export const addExam = createExam;
