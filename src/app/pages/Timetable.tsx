import { useEffect, useState, useMemo } from 'react';
import { Header } from '../components/Header';
import { apiFetch } from '../lib/apiClient';

const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const periods = ['08:00-09:00', '09:00-10:00', '10:00-11:00', '11:30-12:30', '12:30-01:30', '02:00-03:00'];

const schedule = [
  ['Mathematics', 'Physics', 'Chemistry', 'English', 'Biology', 'History'],
  ['English', 'Mathematics', 'Biology', 'Physics', 'Chemistry', 'P.E.'],
  ['Chemistry', 'Biology', 'Mathematics', 'History', 'English', 'Physics'],
  ['Physics', 'English', 'P.E.', 'Mathematics', 'History', 'Chemistry'],
  ['Biology', 'Chemistry', 'History', 'English', 'Mathematics', 'P.E.'],
];

const colors: { [key: string]: string } = {
  Mathematics: 'bg-primary/10 text-primary border-primary',
  Physics: 'bg-accent/10 text-accent border-accent',
  Chemistry: 'bg-chart-3/10 text-chart-3 border-chart-3',
  English: 'bg-chart-4/10 text-chart-4 border-chart-4',
  Biology: 'bg-chart-2/10 text-chart-2 border-chart-2',
  History: 'bg-chart-5/10 text-chart-5 border-chart-5',
  'P.E.': 'bg-muted text-muted-foreground border-border',
};

export function Timetable() {
  const [selectedClass, setSelectedClass] = useState('10th A');
  const [specialClasses, setSpecialClasses] = useState<any[]>([]);

  useEffect(() => {
    apiFetch(`/api/special-classes?className=${selectedClass}`)
      .then((res) => res.json())
      .then((data) => setSpecialClasses(Array.isArray(data) ? data : []))
      .catch((err) => console.error('Failed to load special classes for timetable', err));
  }, [selectedClass]);

  const getSpecialClassesForDayAndPeriod = (dayName: string, periodString: string) => {
    const [pStart, pEnd] = periodString.split('-');
    return specialClasses.filter((c) => {
      if (c.status === 'Cancelled') return false;
      const dateObj = new Date(c.date);
      const classDayName = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
      if (classDayName !== dayName) return false;
      return c.startTime >= pStart && c.startTime < pEnd;
    });
  };

  return (
    <div className="flex-1">
      <Header title="Timetable Management" />
      
      <div className="p-6 space-y-6">
        <div className="mb-6 flex items-center gap-4">
          <select 
            value={selectedClass} 
            onChange={(e) => setSelectedClass(e.target.value)}
            className="rounded-lg border border-input bg-input-background px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="10th A">Grade 10 - Section A</option>
            <option value="10th B">Grade 10 - Section B</option>
            <option value="11th A">Grade 11 - Section A</option>
          </select>
        </div>

        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full">
            <thead className="border-b border-border bg-muted">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Time</th>
                {days.map((day) => (
                  <th key={day} className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">
                    {day}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {periods.map((period, periodIndex) => (
                <tr key={period} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-4 text-sm font-medium text-card-foreground">{period}</td>
                  {schedule.map((daySchedule, dayIndex) => (
                    <td key={dayIndex} className="px-4 py-4 space-y-2">
                      <div className={`rounded-lg border-l-4 p-3 ${colors[daySchedule[periodIndex]]}`}>
                        <p className="text-sm font-medium">{daySchedule[periodIndex]}</p>
                      </div>

                      {/* Special Class Badge Overlays */}
                      {getSpecialClassesForDayAndPeriod(days[dayIndex], period).map((sc) => (
                        <div key={sc.id} className="rounded-lg border-l-4 border-purple-500 bg-purple-50 dark:bg-purple-950/20 p-2.5 text-xs font-semibold text-purple-700 dark:text-purple-300">
                          <span className="inline-flex rounded-full bg-purple-200 dark:bg-purple-900 px-1.5 py-0.5 text-[9px] uppercase font-extrabold mr-1">Special Class</span>
                          <p className="font-bold line-clamp-1">{sc.title}</p>
                          <p className="text-[10px] text-muted-foreground">{sc.startTime} - {sc.endTime} ({sc.venue})</p>
                        </div>
                      ))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Weekend or Extra Hours Special Classes List */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-4">
          <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full bg-purple-500"></span>
            Special & Weekend Classes Scheduled ({selectedClass})
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {specialClasses.filter(c => c.status !== 'Cancelled').map((c) => (
              <div key={c.id} className="p-4 rounded-xl border border-purple-100 dark:border-purple-900/60 bg-purple-50/20 dark:bg-purple-950/5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="inline-flex rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 px-2 py-0.5 text-xs font-semibold">
                    {c.subject} · {c.purpose}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{c.status}</span>
                </div>
                <h4 className="text-sm font-bold text-foreground line-clamp-1">{c.title}</h4>
                <p className="text-xs text-muted-foreground">{c.date} · {c.startTime} - {c.endTime} · {c.venue}</p>
                <p className="text-xs text-muted-foreground font-semibold">Teacher: {c.teacherName}</p>
              </div>
            ))}
            {specialClasses.filter(c => c.status !== 'Cancelled').length === 0 && (
              <p className="text-xs text-muted-foreground italic py-2">No special classes scheduled for this section.</p>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
