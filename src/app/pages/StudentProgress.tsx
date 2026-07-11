import { Header } from '../components/Header';
import { TrendingUp, Award, BookOpen } from 'lucide-react';
import { RadarChart, PolarGrid, PolarAngleAxis, Radar, ResponsiveContainer, Tooltip } from 'recharts';
import { subscribeExams } from '../lib/examService';
import React from 'react';

const PROGRESS_DATA = [
  { subject: 'Math', score: 88 },
  { subject: 'Science', score: 74 },
  { subject: 'English', score: 91 },
  { subject: 'History', score: 67 },
  { subject: 'Art', score: 95 },
  { subject: 'PE', score: 82 },
];

const TOP_STUDENTS = [
  { name: 'Arjun Sharma', class: 'Grade 10A', avg: 94.5, rank: 1 },
  { name: 'Priya Nair', class: 'Grade 10A', avg: 92.1, rank: 2 },
  { name: 'Rohit Verma', class: 'Grade 9B', avg: 90.8, rank: 3 },
  { name: 'Sneha Patel', class: 'Grade 10B', avg: 89.3, rank: 4 },
];

export function StudentProgress() {
  const [exams, setExams] = React.useState<any[]>([]);

  React.useEffect(() => {
    const unsub = subscribeExams((items) => setExams(items));
    return unsub;
  }, []);

  return (
    <div className="flex-1">
      <Header title="Student Progress Reports" />
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-border bg-card p-6">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="h-5 w-5 text-primary" />
              <h3 className="font-semibold text-foreground">Average Score by Subject</h3>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <RadarChart data={PROGRESS_DATA}>
                <PolarGrid stroke="var(--border)" />
                <PolarAngleAxis dataKey="subject" tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }} />
                <Radar name="Score" dataKey="score" stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={0.25} />
                <Tooltip contentStyle={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', borderRadius: '0.5rem', color: 'var(--card-foreground)' }} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
          
          <div className="rounded-xl border border-border bg-card p-6">
            <div className="flex items-center gap-2 mb-4">
              <Award className="h-5 w-5 text-amber-500" />
              <h3 className="font-semibold text-foreground">Top Performing Students</h3>
            </div>
            <div className="space-y-3">
              {TOP_STUDENTS.map((s) => (
                <div key={s.rank} className="flex items-center gap-3 rounded-lg border border-border bg-secondary px-4 py-3">
                  <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                    s.rank === 1 ? 'bg-amber-500 text-white' :
                    s.rank === 2 ? 'bg-slate-400 text-white' :
                    s.rank === 3 ? 'bg-amber-700 text-white' :
                    'bg-muted text-muted-foreground'
                  }`}>
                    {s.rank}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground">{s.name}</p>
                    <p className="text-xs text-muted-foreground">{s.class}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-sm font-semibold text-foreground">{s.avg}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="mb-4 text-lg font-semibold text-card-foreground">Upcoming Exams</h3>
          <div className="space-y-3">
            {exams.filter((e:any)=>e.status==='published').slice(0,5).map((exam) => (
              <div key={exam.id} className="flex items-center justify-between rounded-lg border border-border bg-secondary p-4">
                <div>
                  <p className="font-medium text-card-foreground">{exam.name} — {exam.subject}</p>
                  <p className="text-xs text-muted-foreground">{exam.className} — {exam.date}</p>
                </div>
                <span className="text-xs text-primary">Details</span>
              </div>
            ))}
            {exams.length === 0 && <p className="text-sm text-muted-foreground">No upcoming exams</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
