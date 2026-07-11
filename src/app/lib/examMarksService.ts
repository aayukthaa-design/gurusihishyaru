import { createStore } from './store';

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

const seedMarksList: MarkRecord[] = [];

const marksStore = createStore<MarkRecord[]>(seedMarksList);

function normalizeExamId(examId: string | number) {
  return typeof examId === 'number' ? String(examId) : examId;
}

export function subscribeMarks(listener: (marks: MarkRecord[]) => void) {
  return marksStore.subscribe(listener);
}

export function getMarksForExam(examId: string | number) {
  const id = normalizeExamId(examId);
  return marksStore.getState().filter((m) => m.examId === id);
}

function gradeFromPercentage(p: number) {
  if (p >= 90) return 'A+';
  if (p >= 75) return 'A';
  if (p >= 60) return 'B';
  if (p >= 50) return 'C';
  if (p >= 40) return 'D';
  return 'F';
}

export function submitMarks(
  examId: string | number,
  maxMarks: number,
  passingMarks: number,
  records: { studentId: string; studentName: string; rollNumber: string; marksObtained: number }[]
) {
  const id = normalizeExamId(examId);
  const processed = records.map((r) => {
    const percentage = (r.marksObtained / maxMarks) * 100;
    const grade = gradeFromPercentage(percentage);
    const pass = r.marksObtained >= passingMarks;
    return { examId: id, ...r, percentage, grade, pass } as MarkRecord;
  });

  marksStore.setState((current) => [
    ...current.filter(
      (m) => m.examId !== id || !processed.some((p) => p.studentId === m.studentId)
    ),
    ...processed,
  ]);

  return processed;
}

export type { MarkRecord };
