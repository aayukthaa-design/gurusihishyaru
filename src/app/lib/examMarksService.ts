import { createStore } from './store';
import { apiFetch } from './apiClient';

type MarkRecord = {
  examId: string;
  studentId: string;
  studentName: string;
  rollNumber: string;
  marksObtained: number;
  percentage: number;
  grade: string;
  pass: boolean;
};

const marksStore = createStore<MarkRecord[]>([]);

function normalizeExamId(examId: string | number) {
  return typeof examId === 'number' ? String(examId) : examId;
}

function mapApiMark(row: any): MarkRecord {
  return {
    examId: String(row.examId),
    studentId: row.studentId,
    studentName: row.studentName || '',
    rollNumber: row.rollNumber || '',
    marksObtained: row.marksObtained,
    percentage: row.percentage,
    grade: row.grade,
    pass: Boolean(row.pass),
  };
}

export async function refreshMarks(examId?: string | number): Promise<MarkRecord[]> {
  try {
    const query = examId !== undefined ? `?examId=${encodeURIComponent(normalizeExamId(examId))}` : '';
    const res = await apiFetch(`/api/exam-marks${query}`);
    if (res.ok) {
      const data = await res.json();
      const mapped = Array.isArray(data) ? data.map(mapApiMark) : [];
      if (examId !== undefined) {
        // Merge in place so marks for other exams already loaded aren't discarded
        const id = normalizeExamId(examId);
        marksStore.setState((current) => [...current.filter((m) => m.examId !== id), ...mapped]);
      } else {
        marksStore.setState(mapped);
      }
      return mapped;
    }
  } catch (err) {
    console.error('Failed to fetch exam marks:', err);
  }
  return marksStore.getState();
}

// Initial load of all marks (needed for cross-exam analytics views)
void refreshMarks();

export function subscribeMarks(listener: (marks: MarkRecord[]) => void) {
  return marksStore.subscribe(listener);
}

export function getMarksForExam(examId: string | number) {
  const id = normalizeExamId(examId);
  return marksStore.getState().filter((m) => m.examId === id);
}

export async function submitMarks(
  examId: string | number,
  maxMarks: number,
  passingMarks: number,
  records: { studentId: string; studentName: string; rollNumber: string; marksObtained: number }[]
): Promise<MarkRecord[]> {
  const id = normalizeExamId(examId);
  try {
    const res = await apiFetch('/api/exam-marks/submit', {
      method: 'POST',
      body: { examId: id, maxMarks, passingMarks, records },
    });
    if (res.ok) {
      const data = await res.json();
      const mapped = Array.isArray(data) ? data.map(mapApiMark) : [];
      marksStore.setState((current) => [...current.filter((m) => m.examId !== id), ...mapped]);
      return mapped;
    }
  } catch (err) {
    console.error('submitMarks error:', err);
  }
  return [];
}

export type { MarkRecord };
