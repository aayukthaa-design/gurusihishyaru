import React from 'react';
import { Header } from '../components/Header';
import { useParams, useNavigate } from 'react-router';
import { subscribeExams } from '../lib/examService';
import { submitMarks, subscribeMarks, refreshMarks } from '../lib/examMarksService';
import { getExamAttendanceForExam } from '../lib/examAttendanceService';
import { getStudentsForClass as getRealStudentsForClass } from '../lib/studentService';

export function TeacherEnterMarks() {
  const params = useParams();
  const examId = params.examId || '';
  const navigate = useNavigate();
  const [exam, setExam] = React.useState<any | null>(null);
  const [students, setStudents] = React.useState<any[]>([]);
  const [records, setRecords] = React.useState<Record<string, number>>({});
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const unsub = subscribeExams((items) => {
      const found = items.find((e: any) => e.id === examId);
      setExam(found || null);
      if (found) {
        const roster = getRealStudentsForClass(found.className, found.branchId);
        setStudents(roster.map((s) => ({ id: s.id, name: s.fullName, roll: s.rollNumber })));
      }
    });
    return unsub;
  }, [examId]);

  React.useEffect(() => {
    if (!examId) return;
    void refreshMarks(examId);
    const unsub = subscribeMarks((all) => {
      const existing = all.filter((m) => m.examId === examId);
      const map: Record<string, number> = {};
      existing.forEach((m) => { map[m.studentId] = m.marksObtained; });
      setRecords(map);
    });
    return unsub;
  }, [examId]);

  if (!exam) return <div className="flex-1"><Header title="Enter Marks" /><div className="p-6">Exam not found.</div></div>;

  const attendanceRecords = getExamAttendanceForExam(exam.id);
  const canEnterMarks = (exam.status === 'attendance_completed' || exam.status === 'marks_entry_open' || exam.status === 'results_published') && attendanceRecords.length > 0;
  if (!canEnterMarks) {
    return (
      <div className="flex-1">
        <Header title={`Enter Marks — ${exam.name}`} />
        <div className="p-6">
          <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
            Complete Exam Attendance before entering marks.
          </div>
        </div>
      </div>
    );
  }

  function handleChange(studentId: string, value: number) {
    setRecords((r) => ({ ...r, [studentId]: value }));
  }

  async function handleSubmit() {
    if (!exam) return;
    setError(null);
    const max = exam.maxMarks ?? 100;
    const payload = students.map((s) => ({ studentId: s.id, studentName: s.name, rollNumber: s.roll, marksObtained: Number(records[s.id] || 0) }));
    for (const p of payload) {
      if (p.marksObtained < 0 || p.marksObtained > max) {
        setError('Marks must be between 0 and the exam maximum.');
        return;
      }
    }

    await submitMarks(examId, max, exam.passingMarks ?? Math.round(max * 0.35), payload);
    navigate('/exams');
  }

  return (
    <div className="flex-1">
      <Header title={`Enter Marks — ${exam.name}`} />
      <div className="p-6">
        <div className="mb-4 text-sm text-muted-foreground">Maximum Marks: <strong>{exam.maxMarks}</strong></div>
        <div className="space-y-3">
          {students.map((s) => (
            <div key={s.id} className="flex items-center justify-between rounded-md border p-3">
              <div>
                <p className="text-sm font-medium">{s.name}</p>
                <p className="text-xs text-muted-foreground">Roll: {s.roll}</p>
              </div>
              <div>
                <input
                  type="number"
                  value={records[s.id] ?? ''}
                  onChange={(e) => handleChange(s.id, Number(e.target.value))}
                  className="w-20 rounded-md border px-2 py-1"
                />
              </div>
            </div>
          ))}
        </div>
        {error && <div className="text-sm text-red-600 mt-3">{error}</div>}
        <div className="mt-4 flex gap-2">
          <button onClick={handleSubmit} className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground">Submit Marks</button>
          <button onClick={() => navigate(-1)} className="rounded-lg border px-4 py-2 text-sm">Cancel</button>
        </div>
      </div>
    </div>
  );
}
