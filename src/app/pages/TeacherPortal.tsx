import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Header } from '../components/Header';
import { GreetingBanner } from '../components/GreetingBanner';
import { useAuth } from '../auth/AuthContext';
import { subscribeExams } from '../lib/examService';
import { getTeacherExamAttendanceDashboard, subscribeExamAttendance } from '../lib/examAttendanceService';
import { refreshTasks, getTasksForTeacher, subscribeTasks, TaskRecord } from '../lib/taskService';
import { Circle, Link2 } from 'lucide-react';
import { apiFetch } from '../lib/apiClient';
import { useClasses, getClassesForTeacher } from '../lib/classService';

function formatDueDate(dueDate?: string): string {
  if (!dueDate) return '—';
  const todayStr = new Date().toISOString().split('T')[0];
  if (dueDate === todayStr) return 'Today';
  return new Date(dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function TeacherPortal() {
  const { user } = useAuth();
  const [exams, setExams] = useState<any[]>([]);
  const [attendanceVersion, setAttendanceVersion] = useState(0);
  const [specialClasses, setSpecialClasses] = useState<any[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);

  // "My Batches" — reactive via the classes store, so a batch (re)assignment
  // shows up here immediately without a fresh login (requirement: teacher
  // portal auto-shows assigned branch/batches on creation/approval/reassignment).
  useClasses();
  const myBatches = getClassesForTeacher(user?.id, user?.branchId);

  useEffect(() => {
    const unsubscribeExams = subscribeExams((items) => setExams(items));
    const unsubscribeAttendance = subscribeExamAttendance(() => setAttendanceVersion((value) => value + 1));
    const unsubscribeTasks = subscribeTasks(() => setTasks(getTasksForTeacher(user?.id, user?.branchId)));

    if (user) {
      apiFetch(`/api/special-classes?teacherId=${user.id}`)
        .then(res => res.json())
        .then(data => setSpecialClasses(Array.isArray(data) ? data : []))
        .catch(e => console.error(e));

      refreshTasks({ branchId: user.branchId, teacherId: user.id }).then(() => setTasks(getTasksForTeacher(user.id, user.branchId)));
    }

    return () => {
      unsubscribeExams();
      unsubscribeAttendance();
      unsubscribeTasks();
    };
  }, [user]);

  const pendingTasks = useMemo(
    () => tasks.filter((t) => t.status !== 'completed').slice(0, 6),
    [tasks]
  );

  const dashboard = getTeacherExamAttendanceDashboard(user, exams, []);
  void attendanceVersion;

  const teacherExamCount = useMemo(() => {
    if (!user) return 0;
    return exams.filter((exam) => exam.teacherId === user.id).length;
  }, [exams, user]);

  const todayStr = new Date().toISOString().split('T')[0];
  const todayClasses = specialClasses.filter(c => c.date === todayStr && c.status !== 'Cancelled');
  const upcomingClasses = specialClasses.filter(c => c.status !== 'Cancelled' && new Date(c.date + 'T' + c.startTime) > new Date());
  const completedClasses = specialClasses.filter(c => c.status !== 'Cancelled' && new Date(c.date + 'T' + c.startTime) <= new Date());

  return (
    <div className="flex-1 bg-background">
      <Header title="Teacher Dashboard" />
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <GreetingBanner name={user?.name ?? 'Teacher'} subtitle="Teacher portal with live class scoreboards and attendance summary." />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Today's Exams", value: dashboard.todaysExams },
            { label: 'Pending Attendance', value: dashboard.pendingExamAttendance },
            { label: 'Completed Attendance', value: dashboard.completedExamAttendance },
            { label: 'My Exams', value: teacherExamCount },
          ].map((stat) => (
            <div key={stat.label} className="rounded-2xl border border-border bg-card p-5 text-center">
              <p className="text-3xl font-bold text-foreground">{stat.value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{stat.label}</p>
            </div>
          ))}
        </div>

        {/* Special Classes Dashboard Widget */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Today's Special Classes", value: todayClasses.length },
            { label: "Upcoming Special Classes", value: upcomingClasses.length },
            { label: "Completed Special Classes", value: completedClasses.length },
            { label: "Total Special Classes", value: specialClasses.length },
          ].map((stat) => (
            <div key={stat.label} className="rounded-2xl border border-border bg-purple-50/50 dark:bg-purple-950/10 p-5 text-center">
              <p className="text-3xl font-bold text-purple-600 dark:text-purple-400">{stat.value}</p>
              <p className="mt-1 text-xs text-purple-700 dark:text-purple-300 font-semibold">{stat.label}</p>
            </div>
          ))}
        </div>

        {/* My Batches */}
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <Link2 className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-base font-semibold text-foreground">My Batches</h2>
          </div>
          {myBatches.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No batch has been assigned yet.</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {myBatches.map((b) => (
                <div key={b.id} className="rounded-xl border border-border bg-secondary/30 p-4">
                  <p className="text-sm font-semibold text-foreground">{b.className}</p>
                  <p className="text-xs text-muted-foreground">{[b.board, b.subject].filter(Boolean).join(' · ') || '—'}</p>
                  {b.classTiming && <p className="mt-1 text-xs text-muted-foreground">{b.classTiming}</p>}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Scoreboard Center</h2>
              <p className="mt-1 text-sm text-muted-foreground">Open the dedicated class-wise scoreboard page to view rankings, analytics, and export results for your assigned classes.</p>
            </div>
            <Link
              to="/teacher/scoreboard"
              className="inline-flex items-center justify-center rounded-lg border border-border bg-card px-4 py-2 text-sm text-primary transition hover:bg-secondary"
            >
              View Scoreboard
            </Link>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-foreground">Pending Tasks</h2>
          <div className="space-y-3">
            {pendingTasks.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">No pending tasks.</p>
            )}
            {pendingTasks.map((task) => {
              const urgent = task.dueDate ? task.dueDate <= new Date().toISOString().split('T')[0] : false;
              return (
                <div key={task.id} className="flex items-center gap-3 rounded-xl border border-border bg-secondary/50 px-4 py-3">
                  <Circle className="h-4 w-4 shrink-0 text-muted-foreground/40" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground">{task.title}</p>
                    <p className={`text-xs font-medium ${urgent ? 'text-red-500' : 'text-muted-foreground'}`}>Due: {formatDueDate(task.dueDate)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
