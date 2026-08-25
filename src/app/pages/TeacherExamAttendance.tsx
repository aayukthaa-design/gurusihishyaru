import React from 'react';
import { Header } from '../components/Header';
import { useParams, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { subscribeExams, updateExamStatus } from '../lib/examService';
import { getStudentsForClass, getStudentsByIds } from '../lib/studentService';
import { submitExamAttendanceRecords } from '../lib/examAttendanceService';

// Standalone entry point for marking exam attendance on an exam that's
// already been created — the only other place this could happen was the
// one-shot modal shown right after creating an exam (TeacherCreateExam.tsx).
// If a teacher closed that modal, or the tab crashed, there was no way back:
// the exam's status could never reach 'attendance_completed', which
// permanently blocked Enter Marks. This route reopens the same step for
// any exam still stuck before that status.
export function TeacherExamAttendance() {
  const { examId = '' } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [exam, setExam] = React.useState<any | null>(null);
  const [students, setStudents] = React.useState<Array<{ id: string; name: string; roll: string; admissionNumber: string; className: string; branchId: string; branchName: string }>>([]);
  const [statuses, setStatuses] = React.useState<Record<string, 'present' | 'absent'>>({});
  const [message, setMessage] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    const unsub = subscribeExams((items) => {
      const found = items.find((e) => String(e.id) === examId) || null;
      setExam(found);
      if (found) {
        // Exams are scoped to one batch (className + board/batch), not the whole
        // class — omitting found.batch here pulled in every batch sharing the
        // same className, which is exactly the "wrong students showing up for
        // exam attendance" bug. A Primary Exam has no batch at all — it carries
        // its own explicit studentIds instead.
        const roster = (found.studentIds?.length ? getStudentsByIds(found.studentIds) : getStudentsForClass(found.className, user?.branchId, found.batch)).map((student) => ({
          id: student.id,
          name: student.fullName,
          roll: student.rollNumber,
          admissionNumber: student.admissionNumber,
          className: student.className,
          branchId: student.branchId,
          branchName: student.branchName,
        }));
        setStudents(roster);
      }
    });
    return unsub;
  }, [examId, user?.branchId]);

  const summary = React.useMemo(() => {
    const total = students.length;
    const present = students.filter((s) => statuses[s.id] === 'present').length;
    const absent = students.filter((s) => statuses[s.id] === 'absent').length;
    return { total, present, absent, remaining: total - present - absent };
  }, [students, statuses]);
  const canSubmit = summary.total > 0 && summary.remaining === 0;

  if (!exam) {
    return (
      <div className="flex-1">
        <Header title="Exam Attendance" />
        <div className="p-6 text-sm text-muted-foreground">Exam not found.</div>
      </div>
    );
  }

  if (exam.status !== 'draft' && exam.status !== 'published') {
    return (
      <div className="flex-1">
        <Header title={`Exam Attendance — ${exam.name}`} />
        <div className="p-6">
          <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
            Attendance for this exam is already complete.
          </div>
          <button type="button" onClick={() => navigate(`/exams/${exam.id}/marks`)} className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground">Go to Enter Marks</button>
        </div>
      </div>
    );
  }

  async function handleSubmit() {
    if (!user) return;
    setSubmitting(true);
    setMessage(null);
    const submissions = students.map((student) => ({
      examId: String(exam.id),
      studentId: student.id,
      studentName: student.name,
      rollNumber: student.roll,
      admissionNumber: student.admissionNumber,
      className: student.className,
      branchId: student.branchId,
      branchName: student.branchName,
      status: statuses[student.id] ?? 'present',
      date: exam.date,
      time: new Date().toLocaleTimeString(),
      teacherId: user.id,
      teacherName: user.name,
      subjectId: exam.subject || 'SUB001',
      subjectName: exam.subject,
      classId: `${student.className}-class`,
      recordedBy: user.name,
    }));

    try {
      await submitExamAttendanceRecords(submissions, user);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to submit exam attendance.');
      setSubmitting(false);
      return;
    }
    await updateExamStatus(String(exam.id), 'attendance_completed');
    setSubmitting(false);
    navigate(`/exams/${exam.id}/marks`);
  }

  return (
    <div className="flex-1">
      <Header title={`Exam Attendance — ${exam.name}`} />
      <div className="p-6">
        <div className="mb-4 grid gap-3 rounded-xl border border-border bg-secondary/20 p-4 md:grid-cols-4">
          <div>
            <p className="text-xs uppercase text-muted-foreground">Total Students</p>
            <p className="text-lg font-semibold text-foreground">{summary.total}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-muted-foreground">Present</p>
            <p className="text-lg font-semibold text-foreground">{summary.present}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-muted-foreground">Absent</p>
            <p className="text-lg font-semibold text-foreground">{summary.absent}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-muted-foreground">Remaining</p>
            <p className="text-lg font-semibold text-foreground">{summary.remaining}</p>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => setStatuses(Object.fromEntries(students.map((s) => [s.id, 'present'])))} className="rounded-lg border border-border px-3 py-2 text-sm">Mark All Present</button>
          <button type="button" onClick={() => setStatuses(Object.fromEntries(students.map((s) => [s.id, 'absent'])))} className="rounded-lg border border-border px-3 py-2 text-sm">Mark All Absent</button>
          <button type="button" onClick={() => setStatuses({})} className="rounded-lg border border-border px-3 py-2 text-sm">Reset</button>
        </div>

        {students.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center rounded-xl border border-border bg-card">No students found for {exam.className}.</p>
        ) : (
          <div className="space-y-3">
            {students.map((student) => (
              <div key={student.id} className="flex flex-col gap-3 rounded-lg border border-border bg-background p-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm font-semibold text-foreground">{student.name}</p>
                  <p className="text-xs text-muted-foreground">Roll {student.roll} · Adm {student.admissionNumber}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(['present', 'absent'] as const).map((status) => {
                    const selected = statuses[student.id] === status;
                    return (
                      <button key={status} type="button" onClick={() => setStatuses((prev) => ({ ...prev, [student.id]: status }))} className={`rounded-lg border px-3 py-2 text-sm ${selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-secondary hover:bg-secondary/80'}`}>
                        {status === 'present' ? 'Present' : 'Absent'}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {message && <div className="text-sm text-red-600 mt-3">{message}</div>}

        <div className="mt-4 flex gap-2">
          <button type="button" onClick={handleSubmit} disabled={!canSubmit || submitting} className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60">
            {submitting ? 'Submitting...' : 'Submit Attendance'}
          </button>
          <button type="button" onClick={() => navigate('/exams')} className="rounded-lg border px-4 py-2 text-sm">Cancel</button>
        </div>
      </div>
    </div>
  );
}
