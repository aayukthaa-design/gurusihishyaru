import React from 'react';
import { useAuth } from '../auth/AuthContext';
import { useStudents, getAllStudents } from '../lib/studentService';
import { useTeachers, getTeachers } from '../lib/teacherService';
import { findTodaysBirthdays, findUpcomingBirthdays, notifyBirthday } from '../lib/birthdayService';

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export function BirthdayChecker() {
  const students = useStudents();
  const teachers = useTeachers();
  const { user } = useAuth();
  const [lastDate, setLastDate] = React.useState<string>(todayKey());

  React.useEffect(() => {
    // Run on mount and whenever students/teachers/user change
    const runCheck = () => {
      const branchId = user?.role === 'admin' ? user.branchId : undefined;
      const { students: sToday, teachers: tToday } = findTodaysBirthdays(getAllStudents(), getTeachers(), branchId);
      sToday.forEach((s) => notifyBirthday(s));
      tToday.forEach((t) => notifyBirthday(t));
    };

    runCheck();

    const timer = setInterval(() => {
      const key = todayKey();
      if (key !== lastDate) {
        setLastDate(key);
        runCheck();
      }
    }, 60_000); // check every minute for date change

    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students.length, teachers.length, user?.id, user?.branchId]);

  return null;
}

export default BirthdayChecker;
