import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Header } from '../components/Header';
import { GreetingBanner } from '../components/GreetingBanner';
import { useAuth } from '../auth/AuthContext';
import { getBranches } from '../lib/branchService';
import { useStudents } from '../lib/studentService';
import {
  createSchoolExamSchedule,
  deleteSchoolExamSchedule,
  formatScheduleDate,
  getAttachmentUrl,
  refreshSchoolExamSchedules,
  updateSchoolExamSchedule,
  useSchoolExamSchedules,
} from '../lib/schoolExamScheduleService';
import { CalendarDays, Download, Eye, RefreshCcw, Search, Trash2, Upload } from 'lucide-react';

const EXAM_OPTIONS = ['Mid-Term', 'Quarterly', 'Half-Yearly', 'Annual', 'Board Exam', 'Custom'];

export function SchoolExamSchedulesPage() {
  const { user } = useAuth();
  const students = useStudents();
  const branches = getBranches();
  const schedules = useSchoolExamSchedules();
  const [branchFilter, setBranchFilter] = useState(user?.role === 'super_admin' ? '' : user?.branchId ?? '');
  const [classFilter, setClassFilter] = useState('');
  const [studentFilter, setStudentFilter] = useState('');
  const [schoolFilter, setSchoolFilter] = useState('');
  const [examFilter, setExamFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    studentId: '',
    studentName: '',
    branchId: user?.branchId ?? '',
    schoolName: '',
    schoolClass: '',
    examName: '',
    startDate: '',
    endDate: '',
    subject: '',
    description: '',
    attachment: null as File | null,
  });
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);

  useEffect(() => {
    void refreshSchoolExamSchedules();
  }, []);

  useEffect(() => {
    if (user?.role !== 'teacher' && !selectedStudentId && students.length) {
      setSelectedStudentId(students[0].id);
    }
  }, [selectedStudentId, students, user]);

  const visibleStudents = useMemo(() => {
    const byBranch = branchFilter ? students.filter((student) => student.branchId === branchFilter) : students;
    return byBranch.filter((student) => {
      const matchesClass = !classFilter || student.className === classFilter;
      const matchesSearch = !search || `${student.fullName} ${student.id}`.toLowerCase().includes(search.toLowerCase());
      return matchesClass && matchesSearch;
    });
  }, [branchFilter, classFilter, search, students]);

  const filteredSchedules = useMemo(() => {
    const base = schedules.filter((schedule) => {
      const matchesBranch = !branchFilter || schedule.branchId === branchFilter;
      const matchesClass = !classFilter || schedule.schoolClass === classFilter;
      const matchesStudent = !studentFilter || schedule.studentId === studentFilter;
      const matchesSchool = !schoolFilter || schedule.schoolName.toLowerCase().includes(schoolFilter.toLowerCase());
      const matchesExam = !examFilter || schedule.examName === examFilter;
      const matchesStatus = !statusFilter || schedule.status === statusFilter;
      const matchesDateFrom = !dateFrom || !schedule.startDate || schedule.startDate >= dateFrom;
      const matchesDateTo = !dateTo || !schedule.endDate || schedule.endDate <= dateTo;
      const matchesSearch = !search || `${schedule.studentName} ${schedule.schoolName} ${schedule.examName}`.toLowerCase().includes(search.toLowerCase());
      return matchesBranch && matchesClass && matchesStudent && matchesSchool && matchesExam && matchesStatus && matchesDateFrom && matchesDateTo && matchesSearch;
    });

    if (user?.role === 'teacher') {
      return base.filter((schedule) => !schedule.teacherId || schedule.teacherId === user.id);
    }
    if (user?.role === 'parent') {
      return base.filter((schedule) => schedule.studentId && user.linkedStudentIds?.includes(schedule.studentId));
    }
    if (user?.role === 'admin' && user.branchId) {
      return base.filter((schedule) => schedule.branchId === user.branchId);
    }
    return base;
  }, [branchFilter, classFilter, dateFrom, dateTo, examFilter, schedules, schoolFilter, search, statusFilter, studentFilter, user]);

  const classOptions = useMemo(() => Array.from(new Set(students.map((student) => student.className).filter(Boolean))), [students]);
  const studentOptions = useMemo(() => {
    const scoped = branchFilter ? students.filter((student) => student.branchId === branchFilter) : students;
    return scoped.filter((student) => !classFilter || student.className === classFilter);
  }, [branchFilter, classFilter, students]);

  const resetForm = () => {
    setForm({
      studentId: '',
      studentName: '',
      branchId: user?.branchId ?? '',
      schoolName: '',
      schoolClass: '',
      examName: '',
      startDate: '',
      endDate: '',
      subject: '',
      description: '',
      attachment: null,
    });
    setEditingId(null);
  };

  const handleSelectStudent = (studentId: string) => {
    const student = students.find((entry) => entry.id === studentId);
    setSelectedStudentId(studentId);
    setForm((prev) => ({
      ...prev,
      studentId,
      studentName: student?.fullName || '',
      branchId: student?.branchId || prev.branchId,
      schoolClass: student?.className || '',
    }));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.studentId || !form.schoolName || !form.schoolClass || !form.examName || !form.startDate || !form.endDate) {
      setFeedback('Please complete the required student, school, class, exam, and date fields.');
      return;
    }
    if (form.startDate > form.endDate) {
      setFeedback('Start date cannot be later than end date.');
      return;
    }
    if (form.attachment && !/\.(pdf|png|jpg|jpeg)$/i.test(form.attachment.name)) {
      setFeedback('Only PDF, PNG, JPG, and JPEG files are allowed.');
      return;
    }
    if (form.attachment && form.attachment.size > 10 * 1024 * 1024) {
      setFeedback('Attachment size must be 10MB or less.');
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);

    const fd = new FormData();
    fd.append('studentId', form.studentId);
    fd.append('studentName', form.studentName);
    fd.append('branchId', form.branchId || user?.branchId || '');
    fd.append('schoolName', form.schoolName);
    fd.append('schoolClass', form.schoolClass);
    fd.append('examName', form.examName);
    fd.append('startDate', form.startDate);
    fd.append('endDate', form.endDate);
    fd.append('subject', form.subject);
    fd.append('description', form.description);
    fd.append('createdBy', user?.name || 'Teacher');
    fd.append('teacherId', user?.id || '');
    fd.append('teacherName', user?.name || '');
    if (form.attachment) {
      fd.append('attachment', form.attachment);
    }

    const result = editingId ? await updateSchoolExamSchedule(editingId, fd) : await createSchoolExamSchedule(fd);
    if (result) {
      setFeedback(editingId ? 'School exam schedule updated.' : 'School exam schedule created.');
      resetForm();
      setSelectedStudentId(form.studentId);
      await refreshSchoolExamSchedules();
    } else {
      setFeedback('Unable to save the schedule right now.');
    }
    setIsSubmitting(false);
  };

  const handleEdit = (schedule: (typeof schedules)[number]) => {
    setEditingId(schedule.id);
    setForm({
      studentId: schedule.studentId,
      studentName: schedule.studentName,
      branchId: schedule.branchId || user?.branchId || '',
      schoolName: schedule.schoolName,
      schoolClass: schedule.schoolClass,
      examName: schedule.examName,
      startDate: schedule.startDate,
      endDate: schedule.endDate,
      subject: schedule.subject || '',
      description: schedule.description || '',
      attachment: null,
    });
    setSelectedStudentId(schedule.studentId);
  };

  const handleDelete = async (id: string) => {
    setIsDeleting(id);
    const success = await deleteSchoolExamSchedule(id);
    if (success) {
      setFeedback('Schedule deleted.');
      if (editingId === id) resetForm();
    } else {
      setFeedback('Unable to delete the schedule.');
    }
    setIsDeleting(null);
  };

  const canManage = user?.role === 'teacher';
  const canView = user?.role !== 'accountant';

  return (
    <div className="flex-1 bg-background">
      <Header title="School Examination Schedule" />
      <div className="mx-auto max-w-7xl space-y-6 p-6">
        <GreetingBanner name={user?.name ?? 'User'} subtitle="Track school examinations for each student and keep parents and staff informed." />

        {feedback && <div className="rounded-2xl border border-primary/20 bg-primary/10 px-4 py-3 text-sm text-foreground">{feedback}</div>}

        {canManage && (
          <form onSubmit={handleSubmit} className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-foreground">{editingId ? 'Update School Exam Schedule' : 'Upload School Exam Schedule'}</h2>
                <p className="mt-1 text-sm text-muted-foreground">Select a student, fill the examination details, and upload the timetable file.</p>
              </div>
              <button type="button" onClick={resetForm} className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-secondary">Reset</button>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Branch</label>
                <select value={form.branchId} onChange={(event) => setForm((prev) => ({ ...prev, branchId: event.target.value }))} className="field">
                  <option value="">Select branch</option>
                  {branches.filter((branch) => branch.status === 'Active').map((branch) => (
                    <option key={branch.id} value={branch.id}>{branch.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Class</label>
                <select value={form.schoolClass} onChange={(event) => setForm((prev) => ({ ...prev, schoolClass: event.target.value }))} className="field">
                  <option value="">Select class</option>
                  {classOptions.map((className) => <option key={className} value={className}>{className}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Student</label>
                <select value={form.studentId} onChange={(event) => handleSelectStudent(event.target.value)} className="field">
                  <option value="">Select student</option>
                  {studentOptions.map((student) => (
                    <option key={student.id} value={student.id}>{student.fullName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Student Name</label>
                <input value={form.studentName} readOnly className="field" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">School Name</label>
                <input value={form.schoolName} onChange={(event) => setForm((prev) => ({ ...prev, schoolName: event.target.value }))} placeholder="e.g. ABC Public School" className="field" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Examination Name</label>
                <select value={form.examName} onChange={(event) => setForm((prev) => ({ ...prev, examName: event.target.value }))} className="field">
                  <option value="">Select exam</option>
                  {EXAM_OPTIONS.map((exam) => <option key={exam} value={exam}>{exam}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Start Date</label>
                <input type="date" value={form.startDate} onChange={(event) => setForm((prev) => ({ ...prev, startDate: event.target.value }))} className="field" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">End Date</label>
                <input type="date" value={form.endDate} onChange={(event) => setForm((prev) => ({ ...prev, endDate: event.target.value }))} className="field" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Subject (Optional)</label>
                <input value={form.subject} onChange={(event) => setForm((prev) => ({ ...prev, subject: event.target.value }))} placeholder="Maths / English" className="field" />
              </div>
              <div className="md:col-span-2 xl:col-span-3">
                <label className="mb-1.5 block text-sm font-medium text-foreground">Description / Notes</label>
                <textarea value={form.description} onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))} rows={3} className="field" placeholder="Any extra notes for parents and staff" />
              </div>
              <div className="md:col-span-2 xl:col-span-3">
                <label className="mb-1.5 block text-sm font-medium text-foreground">Upload Timetable</label>
                <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-secondary/30 px-4 py-6 text-center text-sm text-muted-foreground">
                  <Upload className="mb-2 h-5 w-5" />
                  <span>{form.attachment ? form.attachment.name : 'Choose PDF / PNG / JPG / JPEG file'}</span>
                  <input type="file" accept=".pdf,.png,.jpg,.jpeg" className="hidden" onChange={(event) => setForm((prev) => ({ ...prev, attachment: event.target.files?.[0] ?? null }))} />
                </label>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <button type="submit" disabled={isSubmitting} className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-70">
                {isSubmitting ? 'Saving...' : editingId ? 'Update Schedule' : 'Save Schedule'}
              </button>
              <button type="button" onClick={() => setForm((prev) => ({ ...prev, attachment: null }))} className="rounded-xl border border-border px-4 py-2.5 text-sm">Clear File</button>
            </div>
          </form>
        )}

        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Schedule Records</h2>
              <p className="mt-1 text-sm text-muted-foreground">Search and filter schedules by student, school, exam, or date range.</p>
            </div>
            <button type="button" onClick={() => void refreshSchoolExamSchedules()} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-secondary">
              <RefreshCcw className="h-4 w-4" /> Refresh
            </button>
          </div>

          <div className="mt-5 grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search student, school or exam" className="field pl-10" />
            </div>
            <select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)} className="field">
              <option value="">All branches</option>
              {branches.filter((branch) => branch.status === 'Active').map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
            <select value={classFilter} onChange={(event) => setClassFilter(event.target.value)} className="field">
              <option value="">All classes</option>
              {classOptions.map((className) => <option key={className} value={className}>{className}</option>)}
            </select>
            <select value={studentFilter} onChange={(event) => setStudentFilter(event.target.value)} className="field">
              <option value="">All students</option>
              {studentOptions.map((student) => <option key={student.id} value={student.id}>{student.fullName}</option>)}
            </select>
            <input value={schoolFilter} onChange={(event) => setSchoolFilter(event.target.value)} placeholder="School name" className="field" />
            <select value={examFilter} onChange={(event) => setExamFilter(event.target.value)} className="field">
              <option value="">All exam names</option>
              {EXAM_OPTIONS.map((exam) => <option key={exam} value={exam}>{exam}</option>)}
            </select>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="field">
              <option value="">All statuses</option>
              <option value="Upcoming">Upcoming</option>
              <option value="Ongoing">Ongoing</option>
              <option value="Completed">Completed</option>
            </select>
            <div className="flex gap-2">
              <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="field" />
              <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="field" />
            </div>
          </div>

          <div className="mt-6 space-y-4">
            {filteredSchedules.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No school exam schedules found for the selected criteria.</div>
            ) : filteredSchedules.map((schedule) => (
              <div key={schedule.id} className="rounded-2xl border border-border bg-background p-4 shadow-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">{schedule.examName}</span>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${schedule.status === 'Completed' ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' : schedule.status === 'Ongoing' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400' : 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-400'}`}>{schedule.status}</span>
                    </div>
                    <h3 className="text-base font-semibold text-foreground">{schedule.studentName}</h3>
                    <p className="text-sm text-muted-foreground">{schedule.schoolName} · {schedule.schoolClass}</p>
                    <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                      <span className="inline-flex items-center gap-1"><CalendarDays className="h-4 w-4" /> {formatScheduleDate(schedule.startDate)} to {formatScheduleDate(schedule.endDate)}</span>
                      {schedule.subject && <span>{schedule.subject}</span>}
                    </div>
                    {schedule.description && <p className="text-sm text-muted-foreground">{schedule.description}</p>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {schedule.attachmentPath && (
                      <>
                        <a href={getAttachmentUrl(schedule.attachmentPath)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm hover:bg-secondary">
                          <Eye className="h-4 w-4" /> Preview
                        </a>
                        <a href={getAttachmentUrl(schedule.attachmentPath)} download={schedule.attachmentName || 'timetable'} className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm hover:bg-secondary">
                          <Download className="h-4 w-4" /> Download
                        </a>
                      </>
                    )}
                    {canManage && (
                      <>
                        <button type="button" onClick={() => handleEdit(schedule)} className="rounded-xl border border-border px-3 py-2 text-sm hover:bg-secondary">Edit</button>
                        <button type="button" onClick={() => void handleDelete(schedule.id)} disabled={isDeleting === schedule.id} className="inline-flex items-center gap-2 rounded-xl border border-destructive/20 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-70">
                          <Trash2 className="h-4 w-4" /> {isDeleting === schedule.id ? 'Deleting...' : 'Delete'}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
