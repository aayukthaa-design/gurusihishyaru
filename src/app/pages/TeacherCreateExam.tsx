import React from 'react';
import { Header } from '../components/Header';
import { useAuth } from '../auth/AuthContext';
import { saveExamAPI } from '../lib/examApi';
import { addNotification } from '../lib/notificationService';
import { getStudentsForClass } from '../lib/studentService';
import { submitExamAttendanceRecords } from '../lib/examAttendanceService';
import { updateExamStatus } from '../lib/examService';
import { useNavigate } from 'react-router';
import { apiFetch } from '../lib/apiClient';

export function TeacherCreateExam() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [classesState, setClassesState] = React.useState<string[]>(user?.assignedClassIds ?? []);
  const [allocMap, setAllocMap] = React.useState<Record<string, { subjects: string[]; batches: string[] }>>({});

  const [name, setName] = React.useState('');
  const [subject, setSubject] = React.useState('');
  const [className, setClassName] = React.useState(classesState[0] ?? '');
  const [batch, setBatch] = React.useState('');
  const [date, setDate] = React.useState('');
  const [maxMarks, setMaxMarks] = React.useState<number>(100);
  const [passingMarks, setPassingMarks] = React.useState<number>(35);
  const [description, setDescription] = React.useState('');
  const [attachment, setAttachment] = React.useState<{ name: string; size: number; url: string; file?: File | null } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [showAttendanceModal, setShowAttendanceModal] = React.useState(false);
  const [pendingExam, setPendingExam] = React.useState<any | null>(null);
  const [attendanceStudents, setAttendanceStudents] = React.useState<Array<{ id: string; name: string; roll: string; admissionNumber: string; className: string; branchId: string; branchName: string }>>([]);
  const [attendanceStatuses, setAttendanceStatuses] = React.useState<Record<string, 'present' | 'absent'>>({});
  const [attendanceMessage, setAttendanceMessage] = React.useState<string | null>(null);
  const [attendanceSuccess, setAttendanceSuccess] = React.useState(false);

  // Subjects by class (fallback mapping) — teachers can pick subjects relevant to the selected class
  const SUBJECTS_BY_CLASS: Record<string, string[]> = {
    '8th A': ['Math', 'Science', 'English'],
    '8th B': ['Math', 'Science', 'English'],
    '9th A': ['Math', 'Physics', 'English'],
    '9th B': ['Math', 'Physics', 'English'],
    '10th A': ['Mathematics', 'Chemistry', 'Biology'],
    '10th B': ['Mathematics', 'Chemistry', 'Biology'],
  };

  const BATCHES_BY_CLASS: Record<string, string[]> = {
    '8th A': ['2026-Morning','2026-Evening'],
    '8th B': ['2026-Morning','2026-Evening'],
    '9th A': ['2026-Morning'],
    '9th B': ['2026-Morning'],
    '10th A': ['2026-Day'],
    '10th B': ['2026-Day'],
  };

  const batchesForClass = allocMap[className]?.batches || BATCHES_BY_CLASS[className] || [];

  const subjectsForClass = allocMap[className]?.subjects || SUBJECTS_BY_CLASS[className] || [];
  
  React.useEffect(() => {
    if (!classesState.includes(className) && classesState.length > 0) setClassName(classesState[0]);
  }, [classesState, className]);

  React.useEffect(() => {
    if (subjectsForClass.length > 0 && !subjectsForClass.includes(subject)) setSubject(subjectsForClass[0]);
    if (batchesForClass.length > 0 && !batchesForClass.includes(batch)) setBatch(batchesForClass[0]);
  }, [className, subjectsForClass, batchesForClass, subject, batch]);

  // load allocations from API
  React.useEffect(() => {
    async function loadAlloc() {
      try {
        const base = '';
        const resp = await apiFetch(`${base}/api/allocations?teacherId=${user?.id}`);
        if (!resp.ok) throw new Error('no');
        const data = await resp.json();
        if (data.classes && data.classes.length) setClassesState(data.classes);
        if (data.allocations) setAllocMap(data.allocations);
      } catch (err) {
        // fallback to assignedClassIds already present
      }
    }
    loadAlloc();
  }, [user?.id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name || !subject || !className || !date || !maxMarks) {
      setError('Please fill all required fields');
      return;
    }
    if (passingMarks === undefined || passingMarks === null) {
      setError('Please specify passing marks');
      return;
    }
    if (passingMarks < 0) {
      setError('Passing marks cannot be negative');
      return;
    }
    if (passingMarks > maxMarks) {
      setError('Passing marks cannot exceed maximum marks');
      return;
    }

    // Validate attachment if present
    if (attachment) {
      if (attachment.size > 10 * 1024 * 1024) {
        setError('Attachment must be <= 10 MB');
        return;
      }
    }

    // Enforce teacher can only create for assigned classes
    if (!classesState.includes(className)) {
      setError('You are not assigned to the selected class');
      return;
    }

    const payload = { name, subject, className, batch, date, maxMarks, passingMarks, status: 'published', createdBy: user?.id, description, attachment };

    let saved: Awaited<ReturnType<typeof saveExamAPI>>;
    try {
      saved = await saveExamAPI(payload);
    } catch {
      setError('Failed to save exam. Please try again.');
      return;
    }

    if (!saved?.name || !saved?.className || !saved?.date) {
      setError('Failed to save exam. Please try again.');
      return;
    }

    const exam = saved;
    setPendingExam(exam);
    const students = getStudentsForClass(exam.className, user?.branchId).map((student) => ({
      id: student.id,
      name: student.fullName,
      roll: student.rollNumber,
      admissionNumber: student.admissionNumber,
      className: student.className,
      branchId: student.branchId,
      branchName: student.branchName,
    }));
    setAttendanceStudents(students);
    setAttendanceStatuses({});
    setShowAttendanceModal(true);
    setAttendanceMessage(null);
    setAttendanceSuccess(false);

    // Notify admins
    addNotification({
      title: 'New Exam Created',
      message: `${user?.name} created exam '${exam.name}' for ${exam.className} on ${exam.date}`,
      type: 'info',
      roles: ['admin','super_admin'],
      classNames: [exam.className],
    });

    // Also add a calendar-like notification for students/parents
    addNotification({
      title: `Exam Scheduled: ${exam.name}`,
      message: `${exam.subject} exam for ${exam.className} on ${exam.date}. Maximum marks: ${exam.maxMarks}`,
      type: 'info',
      roles: ['parent'],
      classNames: [exam.className],
    });

    // Success notification for teacher
    addNotification({ title: 'Exam Published', message: `Exam '${exam.name}' published.`, type: 'success', userIds: [user?.id || ''] });

    navigate('/exams');
  }

  function handleAttendanceSubmit() {
    if (!pendingExam || !user) return;
    const submissions = attendanceStudents.map((student) => ({
      examId: String(pendingExam.id),
      studentId: student.id,
      studentName: student.name,
      rollNumber: student.roll,
      admissionNumber: student.admissionNumber,
      className: student.className,
      branchId: student.branchId,
      branchName: student.branchName,
      status: attendanceStatuses[student.id] ?? 'present',
      date: pendingExam.date,
      time: new Date().toLocaleTimeString(),
      teacherId: user.id,
      teacherName: user.name,
      subjectId: pendingExam.subject || 'SUB001',
      subjectName: pendingExam.subject,
      classId: `${student.className}-class`,
      recordedBy: user.name,
    }));

    submitExamAttendanceRecords(submissions, user);
    updateExamStatus(String(pendingExam.id), 'attendance_completed');
    addNotification({
      title: 'Exam Attendance Submitted',
      message: `Attendance recorded for ${pendingExam.name}.`,
      type: 'success',
      roles: ['admin', 'super_admin'],
    });
    setAttendanceSuccess(true);
    setAttendanceMessage('Exam Published Successfully. Exam Attendance Submitted Successfully.');
  }

  function handleFileChange(file?: File | null) {
    if (!file) return;
    if (file.type !== 'application/pdf') {
      setError('Only PDF files are allowed');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('File must be 10 MB or smaller');
      return;
    }
    if (attachment?.url) {
      URL.revokeObjectURL(attachment.url);
    }
    const url = URL.createObjectURL(file);
    setAttachment({ name: file.name, size: file.size, url, file });
    setError(null);
  }

  function handleRemoveAttachment() {
    if (attachment?.url) {
      URL.revokeObjectURL(attachment.url);
    }
    setAttachment(null);
    setError(null);
  }

  return (
    <div className="flex-1">
      <Header title="Create Exam" />
      <div className="p-6">
        <form onSubmit={handleSubmit} className="max-w-xl space-y-4">
          <div>
            <label className="block text-sm font-medium text-muted-foreground">Exam Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2" />
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground">Exam Description</label>
            <textarea value={description} onChange={(e)=>setDescription(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2" rows={4} />
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground">Subject</label>
            {subjectsForClass.length > 0 ? (
              <select value={subject} onChange={(e)=>setSubject(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2">
                {subjectsForClass.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            ) : (
              <input value={subject} onChange={(e) => setSubject(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2" />
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground">Class</label>
            <select value={className} onChange={(e) => setClassName(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2">
              {classesState.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground">Batch</label>
            {batchesForClass.length > 0 ? (
              <select value={batch} onChange={(e)=>setBatch(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2">
                {batchesForClass.map((b)=> <option key={b} value={b}>{b}</option>)}
              </select>
            ) : (
              <input value={batch} onChange={(e) => setBatch(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2" />
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground">Exam Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2" />
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground">Maximum Marks</label>
            <input type="number" value={maxMarks} onChange={(e) => setMaxMarks(Number(e.target.value))} className="mt-1 w-full rounded-md border px-3 py-2" />
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground">Passing Marks</label>
            <input type="number" value={passingMarks} onChange={(e) => setPassingMarks(Number(e.target.value))} className="mt-1 w-full rounded-md border px-3 py-2" />
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground">Question Paper (PDF, ≤10MB)</label>
            <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center">
              <label htmlFor="exam-attachment" className="inline-flex cursor-pointer items-center justify-center rounded-xl border border-border bg-white px-4 py-2 text-sm font-medium text-foreground transition hover:bg-primary/5">
                Choose PDF
              </label>
              <span className="text-sm text-muted-foreground">{attachment ? attachment.name : 'No file chosen'}</span>
            </div>
            <input
              id="exam-attachment"
              type="file"
              accept="application/pdf"
              onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
              className="sr-only"
            />

            {attachment ? (
              <div className="mt-3 rounded-2xl border border-border bg-background p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{attachment.name}</p>
                    <p className="text-xs text-muted-foreground">{Math.round(attachment.size / 1024)} KB · PDF file</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <a href={attachment.url} target="_blank" rel="noreferrer" className="rounded-full border border-border bg-white px-3 py-1 text-xs text-primary hover:bg-primary/5">Preview</a>
                    <a href={attachment.url} download={attachment.name} className="rounded-full border border-border bg-white px-3 py-1 text-xs text-primary hover:bg-primary/5">Download</a>
                    <button type="button" onClick={handleRemoveAttachment} className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs text-red-600 hover:bg-red-100">Remove</button>
                  </div>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">Choose another PDF to replace this one anytime before publishing.</p>
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">Attach the question paper as a PDF file so it can be reviewed later.</p>
            )}
          </div>

          {error && <div className="text-sm text-red-600">{error}</div>}
          {attendanceMessage && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{attendanceMessage}</div>}

          <div className="flex gap-2">
            <button type="submit" className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground">Publish Exam</button>
            <button type="button" onClick={async () => {
              // Save as draft
              setError(null);
              if (!name || !subject || !className || !date || !maxMarks) { setError('Please fill required fields before saving draft'); return; }
              if (passingMarks < 0 || passingMarks > maxMarks) { setError('Passing marks must be between 0 and maximum marks'); return; }
              try {
                const draft = await saveExamAPI({ name, subject, className, batch, date, maxMarks, passingMarks, description, attachment, status: 'draft', createdBy: user?.id });
                if (!draft?.name) {
                  setError('Failed to save draft. Please try again.');
                  return;
                }
                addNotification({ title: 'Draft Saved', message: `Draft '${draft.name}' saved.`, type: 'info', userIds: [user?.id || ''] });
                navigate('/exams');
              } catch {
                setError('Failed to save draft. Please try again.');
              }
            }} className="rounded-lg border px-4 py-2 text-sm">Save Draft</button>
            <button type="button" onClick={() => navigate(-1)} className="rounded-lg border px-4 py-2 text-sm">Cancel</button>
          </div>
        </form>
      </div>

      {showAttendanceModal && pendingExam && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Exam Attendance — {pendingExam.name}</h2>
                <p className="text-sm text-muted-foreground">{pendingExam.subject} · {pendingExam.className} · {pendingExam.date}</p>
              </div>
              <button type="button" onClick={() => setShowAttendanceModal(false)} className="rounded-lg border border-border px-3 py-2 text-sm">Close</button>
            </div>
            <div className="mb-4 grid gap-3 rounded-xl border border-border bg-secondary/20 p-4 md:grid-cols-4">
              <div>
                <p className="text-xs uppercase text-muted-foreground">Total Students</p>
                <p className="text-lg font-semibold text-foreground">{attendanceSummary.total}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-muted-foreground">Present</p>
                <p className="text-lg font-semibold text-foreground">{attendanceSummary.present}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-muted-foreground">Absent</p>
                <p className="text-lg font-semibold text-foreground">{attendanceSummary.absent}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-muted-foreground">Remaining</p>
                <p className="text-lg font-semibold text-foreground">{attendanceSummary.remaining}</p>
              </div>
            </div>
            <div className="mb-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => setAttendanceStatuses(Object.fromEntries(attendanceStudents.map((student) => [student.id, 'present']))) } className="rounded-lg border border-border px-3 py-2 text-sm">Mark All Present</button>
              <button type="button" onClick={() => setAttendanceStatuses(Object.fromEntries(attendanceStudents.map((student) => [student.id, 'absent']))) } className="rounded-lg border border-border px-3 py-2 text-sm">Mark All Absent</button>
              <button type="button" onClick={() => setAttendanceStatuses({})} className="rounded-lg border border-border px-3 py-2 text-sm">Reset Attendance</button>
            </div>
            {!attendanceSuccess ? (
              <>
                <div className="space-y-3">
                  {attendanceStudents.map((student) => (
                    <div key={student.id} className="flex flex-col gap-3 rounded-lg border border-border bg-background p-3 md:flex-row md:items-center md:justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                          {student.name.split(' ').slice(0,2).map((word) => word[0]).join('')}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-foreground">{student.name}</p>
                          <p className="text-xs text-muted-foreground">Roll {student.roll} · Adm {student.admissionNumber} · {student.className}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {(['present','absent'] as const).map((status) => {
                          const selected = attendanceStatuses[student.id] === status;
                          return (
                            <button key={status} type="button" onClick={() => setAttendanceStatuses((prev) => ({ ...prev, [student.id]: status }))} className={`rounded-lg border px-3 py-2 text-sm ${selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-secondary hover:bg-secondary/80'}`}>
                              {status === 'present' ? 'Present' : 'Absent'}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" onClick={handleAttendanceSubmit} disabled={!canSubmitAttendance} className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60">Submit Attendance</button>
                  <button type="button" onClick={() => setShowAttendanceModal(false)} className="rounded-lg border border-border px-4 py-2 text-sm">Cancel</button>
                </div>
              </>
            ) : (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                <div className="mb-4 flex items-center gap-2 text-lg font-semibold">
                  <span>✅</span>
                  <span>Exam Attendance Submitted Successfully</span>
                </div>
                <div className="mb-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-emerald-200 bg-background/60 p-3">
                    <p className="text-xs uppercase">Exam Name</p>
                    <p className="font-semibold">{pendingExam.name}</p>
                  </div>
                  <div className="rounded-xl border border-emerald-200 bg-background/60 p-3">
                    <p className="text-xs uppercase">Class</p>
                    <p className="font-semibold">{pendingExam.className}</p>
                  </div>
                  <div className="rounded-xl border border-emerald-200 bg-background/60 p-3">
                    <p className="text-xs uppercase">Subject</p>
                    <p className="font-semibold">{pendingExam.subject}</p>
                  </div>
                  <div className="rounded-xl border border-emerald-200 bg-background/60 p-3">
                    <p className="text-xs uppercase">Teacher</p>
                    <p className="font-semibold">{user?.name}</p>
                  </div>
                </div>
                <div className="mb-4 rounded-xl border border-emerald-200 bg-background/60 p-3">
                  <p className="text-xs uppercase">Attendance Summary</p>
                  <p className="mt-1 text-sm">Total Strength: {attendanceSummary.total}</p>
                  <p className="text-sm">Present: {attendanceSummary.present}</p>
                  <p className="text-sm">Absent: {attendanceSummary.absent}</p>
                  <p className="text-sm">Attendance Percentage: {attendanceSummary.percentage}%</p>
                  <p className="text-sm">Status: Completed</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => navigate('/reports')} className="rounded-lg border border-emerald-300 px-3 py-2 text-sm">Open Reports & Analytics</button>
                  <button type="button" onClick={() => navigate(`/exams/${pendingExam.id}/marks`)} className="rounded-lg border border-emerald-300 px-3 py-2 text-sm">Go to Marks Entry</button>
                  <button type="button" onClick={() => navigate('/exams')} className="rounded-lg border border-emerald-300 px-3 py-2 text-sm">Back to Dashboard</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
