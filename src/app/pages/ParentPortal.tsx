import { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  CircleDollarSign,
  Clock,
  MapPin,
  User as UserIcon,
  Download,
  Info
} from 'lucide-react';
import { Link } from 'react-router';
import { Header } from '../components/Header';
import { GreetingBanner } from '../components/GreetingBanner';
import { useAuth } from '../auth/AuthContext';
import { useStudents } from '../lib/studentService';
import { useNotifications, getVisibleNotificationsForUser } from '../lib/notificationService';
import { refreshHomework } from '../lib/homeworkService';
import { subscribeMarks, MarkRecord } from '../lib/examMarksService';
import { subscribeExams, Exam } from '../lib/examService';
import { useSchoolExamSchedules, getAttachmentUrl } from '../lib/schoolExamScheduleService';
import { formatIndianCurrency } from '../lib/currency';
import { apiFetch } from '../lib/apiClient';
import { useFeeRecords, refreshFeeRecords } from '../lib/feeService';

export function ParentPortal() {
  const { user } = useAuth();
  const notifications = useNotifications();
  const visibleNotifications = getVisibleNotificationsForUser(notifications, user);

  const allStudents = useStudents();
  const students = useMemo(
    () => allStudents.filter((student) => user?.linkedStudentIds?.includes(student.id)),
    [allStudents, user?.linkedStudentIds]
  );
  const [selectedStudentId, setSelectedStudentId] = useState<string>('');

  useEffect(() => {
    if (students.length > 0 && (!selectedStudentId || !user?.linkedStudentIds?.includes(selectedStudentId))) {
      setSelectedStudentId(students[0].id);
    }
  }, [selectedStudentId, students, user]);

  const selectedStudent = useMemo(() => {
    const isAllowed = user?.linkedStudentIds?.includes(selectedStudentId);
    return (isAllowed ? students.find((student) => student.id === selectedStudentId) : null) ?? students[0];
  }, [selectedStudentId, students, user]);

  const [homeworkStats, setHomeworkStats] = useState({ total: 0, pending: 0 });
  const [exams, setExams] = useState<Exam[]>([]);
  const [allMarks, setAllMarks] = useState<MarkRecord[]>([]);
  const feeRecords = useFeeRecords();

  useEffect(() => {
    if (user) refreshFeeRecords(user);
  }, [user]);

  useEffect(() => {
    const unsubExams = subscribeExams(setExams);
    const unsubMarks = subscribeMarks(setAllMarks);
    return () => {
      unsubExams();
      unsubMarks();
    };
  }, []);

  useEffect(() => {
    if (user && selectedStudent?.id) {
      const student = selectedStudent;
      if (student) {
        refreshHomework(user).then(async (list) => {
          const studentHw = list.filter(h => h.className === student.className);
          let pendingCount = 0;
          
          for (const hw of studentHw) {
            try {
              const res = await apiFetch(`/api/homework/${hw.id}/submissions`);
              if (res.ok) {
                const subs = await res.json();
                const hasSub = Array.isArray(subs) && subs.some((s: any) => s.studentId === student.id);
                if (!hasSub) {
                  pendingCount++;
                }
              } else {
                pendingCount++;
              }
            } catch (e) {
              pendingCount++;
            }
          }
          setHomeworkStats({ total: studentHw.length, pending: pendingCount });
        }).catch(err => console.error('Failed to load homework stats', err));
      }
    }
  }, [user, selectedStudent]);

  const schoolExamSchedules = useSchoolExamSchedules();
  const [specialClasses, setSpecialClasses] = useState<any[]>([]);

  useEffect(() => {
    if (selectedStudent?.className) {
      apiFetch(`/api/special-classes?className=${selectedStudent.className}`)
        .then(res => res.json())
        .then(data => {
          const matched = Array.isArray(data) ? data.filter((c: any) => c.branchId === selectedStudent.branchId) : [];
          setSpecialClasses(matched);
        })
        .catch(err => console.error('Failed to fetch special classes for parent portal', err));
    }
  }, [selectedStudent]);

  const parentSchoolExams = useMemo(() => {
    return schoolExamSchedules.filter((schedule) => schedule.studentId === selectedStudent?.id);
  }, [schoolExamSchedules, selectedStudent?.id]);

  // A student can have several fee records (Tuition, Exam, Transport…) — aggregate
  // them into one summary tile rather than showing just one record like the old
  // hardcoded data did.
  const studentFeeRecords = useMemo(
    () => feeRecords.filter((record) => record.studentId === selectedStudent?.id),
    [feeRecords, selectedStudent?.id]
  );

  const selectedStudentFee = useMemo(() => {
    if (studentFeeRecords.length === 0) return null;
    const total = studentFeeRecords.reduce((sum, r) => sum + r.totalAmount, 0);
    const paid = studentFeeRecords.reduce((sum, r) => sum + r.paidAmount, 0);
    const hasOverdue = studentFeeRecords.some((r) => r.status === 'Overdue');
    const hasOutstanding = studentFeeRecords.some((r) => r.status !== 'Paid');
    const status = hasOverdue ? 'Overdue' : hasOutstanding ? 'Pending' : 'Paid';
    const upcoming = studentFeeRecords
      .filter((r) => r.status !== 'Paid' && r.dueDate)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
    return { total, paid, status, dueDate: upcoming?.dueDate || '' };
  }, [studentFeeRecords]);

  const feeDueAmount = selectedStudentFee ? selectedStudentFee.total - selectedStudentFee.paid : 0;
  const feeStatusLabel = selectedStudentFee?.status ?? 'Not available';
  const feeSummaryText = selectedStudentFee
    ? selectedStudentFee.status === 'Paid'
      ? 'All fees paid in full'
      : `Next due ${selectedStudentFee.dueDate || 'date not set'}`
    : 'No fee record available';

  const studentResults = useMemo(() => {
    if (!selectedStudent) return [];
    return allMarks
      .filter((m) => m.studentId === selectedStudent.id)
      .map((m) => {
        const exam = exams.find((e) => e.id === m.examId);
        return {
          examName: exam?.name ?? 'Exam',
          maxMarks: exam?.maxMarks ?? 100,
          passingMarks: exam?.passingMarks ?? 35,
          marksObtained: m.marksObtained,
          result: m.pass ? '✅ PASS' : '❌ FAIL',
        };
      });
  }, [selectedStudent, allMarks, exams]);

  if (!selectedStudent) {
    return (
      <div className="flex-1 bg-background">
        <Header title="Parent Dashboard" />
        <div className="max-w-3xl mx-auto p-6">
          <GreetingBanner
            name={user?.name ?? 'Parent'}
            subtitle="Student focused insights for your family"
          />
          <div className="rounded-3xl border border-border bg-card p-8 text-center shadow-sm">
            <p className="text-lg font-semibold text-foreground">No linked student account found</p>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Please contact the school office so your child can be connected to your parent account.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-background">
      <Header title="Parent Dashboard" />
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <GreetingBanner
          name={user?.name ?? 'Parent'}
          subtitle="A simple, student-centered overview of your child’s progress"
        />

        <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
          <div className="space-y-6">
            <div className="rounded-[28px] border border-border bg-card p-6 shadow-sm">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-primary/10 text-3xl font-bold text-primary">
                    {selectedStudent.fullName.charAt(0)}
                  </div>
                  <div>
                    <p className="text-xl font-semibold text-foreground">{selectedStudent.fullName}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{selectedStudent.admissionNumber} · {selectedStudent.className}</p>
                  </div>
                </div>

                {students.length > 1 && (
                  <label className="flex flex-col gap-2 text-sm">
                    <span className="font-medium text-foreground">Select child</span>
                    <select
                      value={selectedStudentId}
                      onChange={(event) => setSelectedStudentId(event.target.value)}
                      className="rounded-2xl border border-input bg-input-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/10"
                    >
                      {students.map((student) => (
                        <option key={student.id} value={student.id}>
                          {student.fullName} · {student.className}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>

              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <div className="rounded-3xl border border-border bg-background p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Student name</p>
                  <p className="mt-2 text-base font-semibold text-foreground">{selectedStudent.fullName}</p>
                </div>
                <div className="rounded-3xl border border-border bg-background p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Class & batch</p>
                  <p className="mt-2 text-base font-semibold text-foreground">{selectedStudent.className}</p>
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              {[
                { icon: CircleDollarSign, label: 'Fee status', value: feeStatusLabel, description: feeSummaryText },
                { icon: Bell, label: 'Unread alerts', value: `${visibleNotifications.filter((item) => item.status === 'unread').length}`, description: 'Notifications for your child' },
                { icon: ClipboardList, label: 'Pending homework', value: `${homeworkStats.pending}`, description: `Out of ${homeworkStats.total} total assignments` },
              ].map((card) => (
                <div key={card.label} className="rounded-3xl border border-border bg-card p-5 shadow-sm">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-muted-foreground">{card.label}</p>
                      <p className="mt-3 text-3xl font-semibold text-foreground">{card.value}</p>
                    </div>
                    <card.icon className="h-7 w-7 text-primary" />
                  </div>
                  <p className="mt-4 text-sm text-muted-foreground">{card.description}</p>
                </div>
              ))}
            </div>

            <div className="rounded-[28px] border border-border bg-card p-6 shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-base font-semibold text-foreground">Fees overview</p>
                  <p className="mt-1 text-sm text-muted-foreground">This section shows the selected student’s fee status.</p>
                </div>
                <Link to="/fees" className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline">
                  View full fees <ChevronRight className="h-4 w-4" />
                </Link>
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                <div className="rounded-3xl border border-border bg-background p-5">
                  <p className="text-sm font-semibold text-muted-foreground">Current fee status</p>
                  {selectedStudentFee ? (
                    <div className="mt-4 space-y-2">
                      <p className="text-sm text-foreground">{feeStatusLabel}</p>
                      <p className="text-3xl font-semibold text-foreground">{formatIndianCurrency(selectedStudentFee.paid)} / {formatIndianCurrency(selectedStudentFee.total)}</p>
                      <p className="text-sm text-muted-foreground">{feeSummaryText}</p>
                    </div>
                  ) : (
                    <p className="mt-4 text-sm text-muted-foreground">No fee information is available for this student.</p>
                  )}
                </div>

                <div className="rounded-3xl border border-border bg-background p-5">
                  <p className="text-sm font-semibold text-muted-foreground">Next due details</p>
                  {selectedStudentFee ? (
                    <div className="mt-4 space-y-2">
                      <p className="text-sm text-foreground">
                        {selectedStudentFee.status === 'Paid'
                          ? 'Nothing due'
                          : selectedStudentFee.status === 'Overdue'
                            ? 'Overdue now'
                            : selectedStudentFee.dueDate
                              ? `Due ${selectedStudentFee.dueDate}`
                              : 'Due date not set'}
                      </p>
                      <p className="text-lg font-semibold text-foreground">{formatIndianCurrency(feeDueAmount)}</p>
                      <p className="text-sm text-muted-foreground">Amount still owed on the current bill</p>
                    </div>
                  ) : (
                    <p className="mt-4 text-sm text-muted-foreground">No next due details available.</p>
                  )}
                </div>
              </div>
            </div>

            {/* Academic Exam Results */}
            <div className="rounded-[28px] border border-border bg-card p-6 shadow-sm">
              <div>
                <p className="text-base font-semibold text-foreground">Academic Exam Results</p>
                <p className="mt-1 text-sm text-muted-foreground">This section shows your child's published exam results and performance status.</p>
              </div>

              <div className="mt-5">
                {studentResults.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6 border border-dashed border-border rounded-3xl">No exam results have been published yet for this student.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left text-sm">
                      <thead>
                        <tr className="border-b border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          <th className="pb-3 pr-4">Exam Name</th>
                          <th className="pb-3 px-4 text-right">Max Marks</th>
                          <th className="pb-3 px-4 text-right">Passing Marks</th>
                          <th className="pb-3 px-4 text-right">Marks Obtained</th>
                          <th className="pb-3 pl-4 text-right">Result</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {studentResults.map((res, index) => (
                          <tr key={index} className="hover:bg-secondary/20">
                            <td className="py-3 pr-4 font-medium text-foreground">{res.examName}</td>
                            <td className="py-3 px-4 text-right text-muted-foreground">{res.maxMarks}</td>
                            <td className="py-3 px-4 text-right text-muted-foreground">{res.passingMarks}</td>
                            <td className="py-3 px-4 text-right font-semibold text-foreground">{res.marksObtained}</td>
                            <td className="py-3 pl-4 text-right font-medium">{res.result}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-[28px] border border-border bg-card p-6 shadow-sm">
              <div>
                <p className="text-base font-semibold text-foreground">School Examination Schedule</p>
                <p className="mt-1 text-sm text-muted-foreground">View-only access to your child’s school exam timetables and attachments.</p>
              </div>

              <div className="mt-5 space-y-4">
                {parentSchoolExams.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6 border border-dashed border-border rounded-3xl">No school examination schedule has been uploaded for this student yet.</p>
                ) : parentSchoolExams.map((exam) => (
                  <div key={exam.id} className="rounded-2xl border border-border bg-background p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">{exam.examName}</span>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${exam.status === 'Completed' ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' : exam.status === 'Ongoing' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400' : 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-400'}`}>{exam.status}</span>
                    </div>
                    <div className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                      <div><span className="font-medium text-foreground">School:</span> {exam.schoolName}</div>
                      <div><span className="font-medium text-foreground">Start:</span> {exam.startDate}</div>
                      <div><span className="font-medium text-foreground">End:</span> {exam.endDate}</div>
                      {exam.attachmentPath && (
                        <a href={getAttachmentUrl(exam.attachmentPath)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline">
                          <Download className="h-4 w-4" /> View / Download Timetable
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Special & Extra Classes */}
            <div className="rounded-[28px] border border-border bg-card p-6 shadow-sm">
              <div>
                <p className="text-base font-semibold text-foreground">Upcoming & Latest Special Classes</p>
                <p className="mt-1 text-sm text-muted-foreground">Bonus attendance-bearing extra classes scheduled for {selectedStudent.fullName}.</p>
              </div>

              <div className="mt-5 space-y-4">
                {specialClasses.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6 border border-dashed border-border rounded-3xl">No special classes scheduled for this student's section.</p>
                ) : (
                  specialClasses.map((c) => (
                    <div key={c.id} className="p-4 rounded-2xl border border-border bg-background flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 animate-fade-in">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 px-2.5 py-0.5 text-xs font-semibold">
                            {c.subject}
                          </span>
                          <span className="inline-flex rounded-full bg-secondary text-muted-foreground px-2.5 py-0.5 text-xs font-semibold">
                            {c.purpose}
                          </span>
                          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                            c.status === 'Cancelled' 
                              ? 'bg-red-100 text-red-700 dark:bg-red-950/20 dark:text-red-400'
                              : 'bg-green-100 text-green-700 dark:bg-green-950/20 dark:text-green-400'
                          }`}>
                            {c.status}
                          </span>
                        </div>
                        <h4 className="text-sm font-semibold text-foreground">{c.title}</h4>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <CalendarDays className="h-3 w-3 text-primary" />
                            <span>{c.date}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3 text-primary" />
                            <span>{c.startTime} - {c.endTime}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <MapPin className="h-3 w-3 text-primary" />
                            <span>{c.venue}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <UserIcon className="h-3 w-3 text-primary" />
                            <span>Teacher: {c.teacherName}</span>
                          </div>
                        </div>
                        {c.description && (
                          <p className="text-xs text-muted-foreground italic mt-1 bg-muted/20 p-2 rounded-lg">{c.description}</p>
                        )}
                      </div>

                      {c.attachmentPath && (
                        <a
                          href={c.attachmentPath}
                          download
                          className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-2 text-xs font-semibold text-foreground transition hover:bg-secondary/40 self-start sm:self-center"
                        >
                          <Download className="h-3.5 w-3.5" /> Download Attachment
                        </a>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-[28px] border border-border bg-card p-6 shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-base font-semibold text-foreground">Notifications</p>
                  <p className="mt-1 text-sm text-muted-foreground">Updates for your child and school announcements.</p>
                </div>
                <Link to="/notifications" className="text-sm font-semibold text-primary hover:underline">
                  See all
                </Link>
              </div>
              <div className="mt-6 grid gap-3">
                <div className="rounded-3xl border border-border bg-background p-4">
                  <p className="text-sm font-semibold text-foreground">{visibleNotifications.filter((item) => item.status === 'unread').length} unread alerts</p>
                  <p className="mt-2 text-sm text-muted-foreground">Stay updated on homework, fee reminders and meetings.</p>
                </div>
                <div className="rounded-3xl border border-border bg-background p-4">
                  <p className="text-sm font-semibold text-foreground">Recent message</p>
                  <p className="mt-2 text-sm text-muted-foreground">New announcements appear here and in the notifications panel.</p>
                </div>
              </div>
            </div>

            <div className="rounded-[28px] border border-border bg-card p-6 shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-base font-semibold text-foreground">Family quick actions</p>
                  <p className="mt-1 text-sm text-muted-foreground">One-tap access to the most important sections.</p>
                </div>
              </div>
              <div className="mt-6 grid gap-3">
                {[
                  { label: 'Events', icon: CalendarDays, href: '/events' },
                  { label: 'Notifications', icon: Bell, href: '/notifications' },
                  { label: 'Homework & Submissions', icon: ClipboardList, href: '/homework' },
                ].map((action) => (
                  <Link
                    key={action.label}
                    to={action.href}
                    className="flex items-center justify-between rounded-3xl border border-border bg-background px-5 py-4 transition-colors hover:bg-primary/5"
                  >
                    <div className="flex items-center gap-3">
                      <action.icon className="h-5 w-5 text-primary" />
                      <span className="text-sm font-semibold text-foreground">{action.label}</span>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </Link>
                ))}
              </div>
            </div>

            <div className="rounded-[28px] border border-border bg-card p-6 shadow-sm">
              <p className="text-base font-semibold text-foreground">Student profile</p>
              <div className="mt-5 space-y-4">
                {[
                  { label: 'Admission No.', value: selectedStudent.admissionNumber },
                  { label: 'Roll number', value: selectedStudent.rollNumber },
                  { label: 'Branch', value: selectedStudent.branchName },
                  { label: 'Class', value: selectedStudent.className },
                ].map((item) => (
                  <div key={item.label} className="rounded-3xl border border-border bg-background p-4">
                    <p className="text-sm text-muted-foreground">{item.label}</p>
                    <p className="mt-1 text-sm font-medium text-foreground">{item.value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
