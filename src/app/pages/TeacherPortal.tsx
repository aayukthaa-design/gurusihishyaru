import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Header } from '../components/Header';
import { GreetingBanner } from '../components/GreetingBanner';
import { useAuth } from '../auth/AuthContext';
import { subscribeExams } from '../lib/examService';
import { getTeacherExamAttendanceDashboard, subscribeExamAttendance } from '../lib/examAttendanceService';
import { ChevronRight, CheckCircle2, Circle } from 'lucide-react';

const SCHEDULE = [
  { time: '08:00–09:00', class: 'Mathematics · 10th A', room: 'Room 201', done: true },
  { time: '09:00–10:00', class: 'Mathematics · 11th B', room: 'Room 201', done: true },
  { time: '11:30–12:30', class: 'Mathematics · 10th C', room: 'Room 201', done: false },
  { time: '02:00–03:00', class: 'Mathematics · 11th A', room: 'Room 201', done: false },
];

const TASKS = [
  { text: 'Grade mid-term papers — 10th A', due: 'Jun 20', urgent: true },
  { text: 'Submit attendance sheet', due: 'Today', urgent: true },
  { text: 'Prepare quiz questions', due: 'Jun 22', urgent: false },
  { text: 'Update course material', due: 'Jun 25', urgent: false },
];

export function TeacherPortal() {
  const { user } = useAuth();
  const [exams, setExams] = useState<any[]>([]);
  const [attendanceVersion, setAttendanceVersion] = useState(0);
  const [specialClasses, setSpecialClasses] = useState<any[]>([]);

  useEffect(() => {
    const unsubscribeExams = subscribeExams((items) => setExams(items));
    const unsubscribeAttendance = subscribeExamAttendance(() => setAttendanceVersion((value) => value + 1));
    
    if (user) {
      fetch(`/api/special-classes?teacherId=${user.id}`)
        .then(res => res.json())
        .then(data => setSpecialClasses(data))
        .catch(e => console.error(e));
    }

    return () => {
      unsubscribeExams();
      unsubscribeAttendance();
    };
  }, [user]);

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

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-foreground">Today's Schedule</h2>
              <button className="flex items-center gap-1 text-xs text-primary hover:underline">
                Full timetable <ChevronRight className="h-3 w-3" />
              </button>
            </div>
            <div className="space-y-3">
              {SCHEDULE.map((item, index) => (
                <div key={index} className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${item.done ? 'border-border bg-muted/60 opacity-80' : 'border-primary/30 bg-primary/5'}`}>
                  {item.done ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
                  ) : (
                    <Circle className="h-4 w-4 shrink-0 text-primary" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{item.class}</p>
                    <p className="text-xs text-muted-foreground">{item.room}</p>
                  </div>
                  <span className="text-xs font-medium text-muted-foreground shrink-0">{item.time}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <h2 className="mb-4 text-base font-semibold text-foreground">Pending Tasks</h2>
            <div className="space-y-3">
              {TASKS.map((task, index) => (
                <div key={index} className="flex items-center gap-3 rounded-xl border border-border bg-secondary/50 px-4 py-3">
                  <Circle className="h-4 w-4 shrink-0 text-muted-foreground/40" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground">{task.text}</p>
                    <p className={`text-xs font-medium ${task.urgent ? 'text-red-500' : 'text-muted-foreground'}`}>Due: {task.due}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
