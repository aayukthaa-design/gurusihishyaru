import React, { useState } from 'react';
import { Header } from '../components/Header';
import { useAuth } from '../auth/AuthContext';
import { addSubmission } from '../lib/dailySubmissionService';
import { addNotification } from '../lib/notificationService';
import { useNavigate } from 'react-router';

export function DailySubmission() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0,10));
  const [className, setClassName] = useState('');
  const [subject, setSubject] = useState('');
  const [topic, setTopic] = useState('');
  const [homework, setHomework] = useState('');
  const [attendanceStatus, setAttendanceStatus] = useState<'All Present' | 'Some Absent' | 'Many Absent' | 'Not Taken'>('All Present');
  const [notes, setNotes] = useState('');

  const teacherId = user?.id || 'unknown_teacher';
  const teacherName = user?.name || 'Unknown';

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!className || !subject) {
      alert('Please provide Class and Subject');
      return;
    }

    const saved = addSubmission({
      date,
      className,
      subject,
      topic,
      homework,
      attendanceStatus,
      notes,
      teacherId,
      teacherName,
    });

    // Notify admins and superadmins
    addNotification({ title: 'Daily Submission', message: `${teacherName} submitted report for ${className} (${subject})`, type: 'info', roles: ['admin','super_admin'], classNames: [className] });

    // Notify teacher (confirmation)
    addNotification({ title: 'Submission Received', message: `Your daily submission for ${date} was saved.`, type: 'success', userIds: [teacherId] });

    // Optionally navigate to teacher portal
    navigate('/');
  }

  return (
    <div className="flex-1 bg-background">
      <Header title="Daily Teacher Submission" />
      <div className="max-w-3xl mx-auto p-6">
        <form onSubmit={handleSubmit} className="rounded-2xl border border-border bg-card p-6 space-y-4">
          <div>
            <label className="field-label">Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="field" />
          </div>

          <div>
            <label className="field-label">Class</label>
            <input value={className} onChange={(e) => setClassName(e.target.value)} placeholder="e.g. 10th A" className="field" />
          </div>

          <div>
            <label className="field-label">Subject</label>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Mathematics" className="field" />
          </div>

          <div>
            <label className="field-label">Topic Covered</label>
            <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Topic" className="field" />
          </div>

          <div>
            <label className="field-label">Homework Given</label>
            <input value={homework} onChange={(e) => setHomework(e.target.value)} placeholder="Homework details" className="field" />
          </div>

          <div>
            <label className="field-label">Attendance Status</label>
            <select value={attendanceStatus} onChange={(e) => setAttendanceStatus(e.target.value as any)} className="field">
              <option>All Present</option>
              <option>Some Absent</option>
              <option>Many Absent</option>
              <option>Not Taken</option>
            </select>
          </div>

          <div>
            <label className="field-label">Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="field" rows={3} />
          </div>

          <div className="flex gap-3">
            <button type="submit" className="rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground">Submit Daily Report</button>
            <button type="button" onClick={() => navigate('/')} className="rounded-xl border border-border px-6 py-2.5 text-sm">Cancel</button>
          </div>
        </form>
      </div>
      <style>{`
        .field-label { display:block; font-size:0.875rem; font-weight:500; color:var(--foreground); margin-bottom:0.375rem; }
        .field { width:100%; border-radius:0.75rem; border:1px solid var(--input); background:var(--input-background); padding:0.625rem 1rem; font-size:0.875rem; color:var(--foreground); outline:none; }
        .field:focus { border-color:var(--primary); box-shadow:0 0 0 2px color-mix(in srgb,var(--primary) 20%,transparent); }
      `}</style>
    </div>
  );
}
