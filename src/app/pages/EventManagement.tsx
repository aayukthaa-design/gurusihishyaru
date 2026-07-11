import { Header } from '../components/Header';
import { CalendarDays, Users, MapPin } from 'lucide-react';
import { subscribeExams } from '../lib/examService';
import React from 'react';

const events = [
  { id: 1, title: 'Annual Sports Day', date: '2026-06-25', time: '09:00 AM', venue: 'School Ground', attendees: 450, type: 'Sports' },
  { id: 2, title: 'Science Exhibition', date: '2026-07-05', time: '10:00 AM', venue: 'Science Lab', attendees: 200, type: 'Academic' },
  { id: 3, title: 'Parent-Teacher Meeting', date: '2026-06-22', time: '02:00 PM', venue: 'Main Hall', attendees: 120, type: 'Meeting' },
  { id: 4, title: 'Cultural Fest', date: '2026-07-15', time: '11:00 AM', venue: 'Auditorium', attendees: 500, type: 'Cultural' },
];

const colors: { [key: string]: string } = {
  Sports: 'bg-chart-3 text-white',
  Academic: 'bg-primary text-white',
  Meeting: 'bg-chart-4 text-white',
  Cultural: 'bg-accent text-white',
};

export function EventManagement() {
  const [examEvents, setExamEvents] = React.useState<any[]>([]);

  React.useEffect(() => {
    const unsub = subscribeExams((items) => {
      const mapped = items.map((ex: any) => ({ id: ex.id + 1000000, title: `${ex.name} (${ex.subject})`, date: ex.date, time: '', venue: ex.className, attendees: 0, type: 'Academic' }));
      setExamEvents(mapped);
    });
    return unsub;
  }, []);
  const combined = [...events, ...examEvents].sort((a,b)=> a.date.localeCompare(b.date));

  return (
    <div className="flex-1">
      <Header title="Event Management" />
      
      <div className="p-6 space-y-6">
        <div className="mb-6">
          <button className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground transition-all hover:opacity-90">
            Create New Event
          </button>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {combined.map((event) => (
            <div key={event.id} className="rounded-xl border border-border bg-card p-6 transition-all duration-200 hover:shadow-lg">
              <div className="mb-4 flex items-start justify-between">
                <h3 className="text-xl font-semibold text-card-foreground">{event.title}</h3>
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${colors[event.type]}`}>
                  {event.type}
                </span>
              </div>
              <div className="space-y-2 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <CalendarDays className="h-4 w-4" />
                  <span>{event.date} {event.time ? `at ${event.time}` : ''}</span>
                </div>
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  <span>{event.venue}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  <span>{event.attendees} expected attendees</span>
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <button className="rounded-lg border border-border bg-secondary px-3 py-1.5 text-xs transition-colors hover:bg-muted">
                  View Details
                </button>
                <button className="rounded-lg border border-border bg-secondary px-3 py-1.5 text-xs transition-colors hover:bg-muted">
                  Edit Event
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
