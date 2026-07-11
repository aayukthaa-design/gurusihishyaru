import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { useAuth } from '../auth/AuthContext';
import { useStudents, getAllStudents } from '../lib/studentService';
import { useTeachers, getTeachers } from '../lib/teacherService';
import { findTodaysBirthdays, findUpcomingBirthdays } from '../lib/birthdayService';

export function BirthdayWidget() {
  const students = useStudents();
  const teachers = useTeachers();
  const { user } = useAuth();
  const branchId = user?.role === 'admin' ? user.branchId : undefined;

  const todays = React.useMemo(() => findTodaysBirthdays(getAllStudents(), getTeachers(), branchId), [students.length, teachers.length, user?.branchId]);
  const upcoming = React.useMemo(() => findUpcomingBirthdays(getAllStudents(), getTeachers(), 7, branchId), [students.length, teachers.length, user?.branchId]);

  const items = [...todays.students.map(s => ({ ...s })), ...todays.teachers.map(t => ({ ...t }))];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Today's Birthdays</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className="text-sm text-muted-foreground">No Birthdays Today</div>
        ) : (
          <ul className="space-y-2">
            {items.map((it) => (
              <li key={`${it.role}-${it.id}`} className="flex items-center justify-between">
                <div>
                  <div className="font-medium">{it.role === 'student' ? '🎂' : '🎉'} {it.name}</div>
                  <div className="text-xs text-muted-foreground">{it.branchId ?? ''} {it.className ? `• ${it.className}` : ''}</div>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4">
          <h4 className="text-sm font-semibold">Upcoming (7 days)</h4>
          {upcoming.length === 0 ? (
            <div className="text-sm text-muted-foreground">No upcoming birthdays</div>
          ) : (
            <ul className="text-sm space-y-1 mt-2">
              {upcoming.map((u) => (
                <li key={`${u.role}-${u.id}`}>{u.role === 'student' ? '🎂' : '🎉'} {u.name} • {u.dob?.slice(5)} • {u.branchId}</li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default BirthdayWidget;
