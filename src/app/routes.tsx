import { createBrowserRouter, Navigate } from 'react-router';
import React from 'react';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { SelectRole } from './pages/SelectRole';
import { Unauthorized } from './pages/Unauthorized';
import { Dashboard } from './pages/Dashboard';
import { StudentManagement } from './pages/StudentManagement';
import { TeacherManagement } from './pages/TeacherManagement';
import { ParentManagement } from './pages/ParentManagement';
import { ClassAllocation } from './pages/ClassAllocation';
import { FeeManagement } from './pages/FeeManagement';
import { Attendance } from './pages/Attendance';
import { TeacherAttendance } from './pages/TeacherAttendance';
import { ExamsManagement } from './pages/ExamsManagement';
import { TeacherCreateExam } from './pages/TeacherCreateExam';
import { TeacherScoreboard } from './pages/TeacherScoreboard';
import { Inventory } from './pages/Inventory';
import { TeacherTasks } from './pages/TeacherTasks';
import { Timetable } from './pages/Timetable';
import { AdmissionCRM } from './pages/AdmissionCRM';
import { TeacherEnterMarks } from './pages/TeacherEnterMarks';
import { ExpenseManagement } from './pages/ExpenseManagement';
import { EventManagement } from './pages/EventManagement';
import { NotificationsPage as Notifications } from './pages/notifications';
import { DailySubmission } from './pages/DailySubmission';
import { ParentPortal } from './pages/ParentPortal';
import { TeacherPortal } from './pages/TeacherPortal';
import { TeacherSalarySlips } from './pages/TeacherSalarySlips';
import { AccountantPortal } from './pages/AccountantPortal';
import { UserManagement } from './pages/UserManagement';
import { BranchManagement } from './pages/BranchManagement';
import { RoleManagement } from './pages/RoleManagement';
import { ReportsAnalytics } from './pages/ReportsAnalytics';
import { SystemSettings } from './pages/SystemSettings';
import { BackupRestore } from './pages/BackupRestore';
import { ThemeSettings } from './pages/ThemeSettings';
import { Homework } from './pages/Homework';
import { StudentProgress } from './pages/StudentProgress';
import { StudentPerformanceAnalytics } from './pages/StudentPerformanceAnalytics';
import { ThemeShowcase } from './pages/ThemeShowcase';
import { SpecialClasses } from './pages/SpecialClasses';
import { SchoolExamSchedulesPage } from './pages/SchoolExamSchedules';
import { ProtectedRoute, GuestRoute } from './auth/ProtectedRoute';
import type { Module } from './auth/types';

// ─── Helper: wraps a page in ProtectedRoute ───────────────────────────────────

function Protected({ module, children }: { module: Module; children: React.ReactNode }) {
  return <ProtectedRoute requiredModule={module}>{children}</ProtectedRoute>;
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const router = createBrowserRouter([
  // Public routes
  {
    path: '/login',
    element: (
      <GuestRoute>
        <Login />
      </GuestRoute>
    ),
  },
  {
    path: '/unauthorized',
    element: <Unauthorized />,
  },
  {
    path: '/select-role',
    element: (
      <ProtectedRoute>
        <SelectRole />
      </ProtectedRoute>
    ),
  },

  // Protected application routes
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <Layout />
      </ProtectedRoute>
    ),
    children: [
      // Dashboard
      {
        index: true,
        element: (
          <Protected module="dashboard">
            <Dashboard />
          </Protected>
        ),
      },

      // Academic
      {
        path: 'students',
        element: (
          <Protected module="student_management">
            <StudentManagement />
          </Protected>
        ),
      },
      {
        path: 'teachers',
        element: (
          <Protected module="teacher_management">
            <TeacherManagement />
          </Protected>
        ),
      },
      {
        path: 'parents',
        element: (
          <Protected module="parent_management">
            <ParentManagement />
          </Protected>
        ),
      },
      {
        path: 'allocations',
        element: (
          <Protected module="class_allocation">
            <ClassAllocation />
          </Protected>
        ),
      },
      {
        path: 'attendance',
        element: (
          <Protected module="attendance">
            <Attendance />
          </Protected>
        ),
      },
      {
        path: 'teacher-attendance',
        element: (
          <Protected module="attendance">
            <TeacherAttendance />
          </Protected>
        ),
      },
      {
        path: 'exams',
        element: (
          <Protected module="exam_marks">
            <ExamsManagement />
          </Protected>
        ),
      },
      {
        path: 'teacher/exams/create',
        element: (
          <Protected module="exam_marks">
            <TeacherCreateExam />
          </Protected>
        ),
      },
      {
        path: 'exams/:examId/marks',
        element: (
          <Protected module="exam_marks">
            <TeacherEnterMarks />
          </Protected>
        ),
      },
      {
        path: 'timetable',
        element: (
          <Protected module="timetable">
            <Timetable />
          </Protected>
        ),
      },
      {
        path: 'special-classes',
        element: (
          <Protected module="special_classes">
            <SpecialClasses />
          </Protected>
        ),
      },
      {
        path: 'school-exam-schedules',
        element: (
          <Protected module="school_exam_schedules">
            <SchoolExamSchedulesPage />
          </Protected>
        ),
      },
      {
        path: 'homework',
        element: (
          <Protected module="homework">
            <Homework />
          </Protected>
        ),
      },
      {
        path: 'progress',
        element: (
          <Protected module="student_progress">
            <StudentProgress />
          </Protected>
        ),
      },

      // Finance
      {
        path: 'fees',
        element: (
          <Protected module="fee_management">
            <FeeManagement />
          </Protected>
        ),
      },
      {
        path: 'expenses',
        element: (
          <Protected module="expense_management">
            <ExpenseManagement />
          </Protected>
        ),
      },
      {
        path: 'inventory',
        element: (
          <Protected module="inventory">
            <Inventory />
          </Protected>
        ),
      },

      // Operations
      {
        path: 'tasks',
        element: (
          <Protected module="teacher_tasks">
            <TeacherTasks />
          </Protected>
        ),
      },
      {
        path: 'admissions',
        element: (
          <Protected module="admission_crm">
            <AdmissionCRM />
          </Protected>
        ),
      },

      // Communication
      {
        path: 'events',
        element: (
          <Protected module="event_management">
            <EventManagement />
          </Protected>
        ),
      },
      {
        path: 'notifications',
        element: (
          <Protected module="notification_center">
            <Notifications />
          </Protected>
        ),
      },
      {
        path: 'daily-submission',
        element: (
          <Protected module="teacher_portal">
            <DailySubmission />
          </Protected>
        ),
      },

      // Portals
      {
        path: 'parent',
        element: (
          <Protected module="parent_portal">
            <ParentPortal />
          </Protected>
        ),
      },
      {
        path: 'teacher',
        element: (
          <Protected module="teacher_portal">
            <TeacherPortal />
          </Protected>
        ),
      },
      {
        path: 'teacher/scoreboard',
        element: (
          <Protected module="teacher_portal">
            <TeacherScoreboard />
          </Protected>
        ),
      },
      {
        path: 'teacher/salary-slips',
        element: (
          <Protected module="teacher_portal">
            <TeacherSalarySlips />
          </Protected>
        ),
      },
      {
        path: 'accountant',
        element: (
          <Protected module="accountant_portal">
            <AccountantPortal />
          </Protected>
        ),
      },

      // Analytics
      {
        path: 'reports',
        element: (
          <Protected module="reports_analytics">
            <ReportsAnalytics />
          </Protected>
        ),
      },
      {
        path: 'performance-analytics',
        element: (
          <Protected module="student_performance_analytics">
            <StudentPerformanceAnalytics />
          </Protected>
        ),
      },

      // Administration
      {
        path: 'users',
        element: (
          <Protected module="user_management">
            <UserManagement />
          </Protected>
        ),
      },
      {
        path: 'branches',
        element: (
          <Protected module="branch_management">
            <BranchManagement />
          </Protected>
        ),
      },
      {
        path: 'roles',
        element: (
          <Protected module="role_management">
            <RoleManagement />
          </Protected>
        ),
      },

      // System
      {
        path: 'settings',
        element: (
          <Protected module="system_settings">
            <SystemSettings />
          </Protected>
        ),
      },
      {
        path: 'backup',
        element: (
          <Protected module="backup_restore">
            <BackupRestore />
          </Protected>
        ),
      },
      {
        path: 'theme-settings',
        element: (
          <Protected module="theme_settings">
            <ThemeSettings />
          </Protected>
        ),
      },

      // Dev/showcase
      { path: 'showcase', element: <ThemeShowcase /> },
    ],
  },

  // Fallback
  { path: '*', element: <Navigate to="/" replace /> },
]);
