import {
  LayoutDashboard,
  Users,
  CreditCard,
  ClipboardCheck,
  ClipboardList,
  GraduationCap,
  Package,
  Calendar,
  UserPlus,
  Receipt,
  Bell,
  BarChart3,
  Settings,
  Wallet,
  Shield,
  UserCog,
  HardDrive,
  Building2,
  Palette,
  ListTodo,
  BookOpen,
  UserCheck,
  Link2,
  FileText,
  Library,
  NotebookPen,
  type LucideIcon,
} from 'lucide-react';
import type { Role, Module } from './types';
import { hasModuleAccess } from './rbac';

export interface SidebarItem {
  name: string;
  href: string;
  icon: LucideIcon;
  module: Module;
}

export interface SidebarGroup {
  label: string;
  items: SidebarItem[];
}

// ─── Master nav list ──────────────────────────────────────────────────────────

const ALL_SIDEBAR_ITEMS: SidebarItem[] = [
  // Core
  { name: 'Dashboard',        href: '/',                 icon: LayoutDashboard, module: 'dashboard' },

  // Admin — People
  { name: 'Students',         href: '/students',         icon: Users,           module: 'student_management' },
  { name: 'Teachers',         href: '/teachers',         icon: BookOpen,        module: 'teacher_management' },
  { name: 'Parents',          href: '/parents',          icon: UserCheck,       module: 'parent_management' },
  { name: 'Class Allocation', href: '/allocations',      icon: Link2,           module: 'class_allocation' },

  // Admin — Academic
  { name: 'Attendance',       href: '/attendance',       icon: ClipboardCheck,  module: 'attendance' },
  { name: 'Teacher Attendance', href: '/teacher-attendance', icon: Users, module: 'attendance' },
  { name: 'Exams',            href: '/exams',            icon: GraduationCap,   module: 'exam_marks' },
  { name: 'Homework',         href: '/homework',         icon: ClipboardList,  module: 'homework' },
  { name: 'Study Materials',  href: '/materials',        icon: Library,         module: 'materials' },
  { name: 'Lesson Plans',     href: '/lesson-plan',      icon: NotebookPen,     module: 'lesson_plan' },
  { name: 'Timetable',        href: '/timetable',        icon: Calendar,        module: 'timetable' },
  { name: 'Admissions',       href: '/admissions',       icon: UserPlus,        module: 'admission_crm' },
  { name: 'Teacher Tasks',    href: '/tasks',            icon: ListTodo,        module: 'teacher_tasks' },

  // Finance
  { name: 'Fees',             href: '/fees',             icon: CreditCard,      module: 'fee_management' },
  { name: 'Expenses',         href: '/expenses',         icon: Receipt,         module: 'expense_management' },
  { name: 'Inventory',        href: '/inventory',        icon: Package,         module: 'inventory' },

  // Communication
  { name: 'Events',           href: '/events',           icon: Calendar,        module: 'event_management' },
  { name: 'Notifications',    href: '/notifications',    icon: Bell,            module: 'notification_center' },
  { name: 'Reports',          href: '/reports',          icon: BarChart3,       module: 'reports_analytics' },
  { name: 'Student Performance Analytics', href: '/performance-analytics', icon: BarChart3, module: 'student_performance_analytics' },

  // Super Admin — System
  { name: 'Users',            href: '/users',            icon: UserCog,         module: 'user_management' },
  { name: 'Branches',         href: '/branches',         icon: Building2,       module: 'branch_management' },
  { name: 'Roles',            href: '/roles',            icon: Shield,          module: 'role_management' },
  { name: 'System Settings',  href: '/settings',         icon: Settings,        module: 'system_settings' },
  { name: 'Backup',           href: '/backup',           icon: HardDrive,       module: 'backup_restore' },
  { name: 'Theme',            href: '/theme-settings',   icon: Palette,         module: 'theme_settings' },

  // Portals
  { name: 'Finance',          href: '/accountant',       icon: Wallet,          module: 'accountant_portal' },
  { name: 'My Dashboard',     href: '/parent',           icon: LayoutDashboard, module: 'parent_portal' },

  // Teacher-specific
  { name: 'My Dashboard',     href: '/teacher',          icon: LayoutDashboard, module: 'teacher_portal' },
  { name: 'Scoreboard',       href: '/teacher/scoreboard', icon: BarChart3,    module: 'teacher_portal' },
  { name: 'Salary Slips',     href: '/teacher/salary-slips', icon: FileText,    module: 'teacher_portal' },
  { name: 'My Classes',       href: '/my-classes',       icon: BookOpen,        module: 'my_classes' },
  { name: 'Special Classes',  href: '/special-classes',  icon: BookOpen,        module: 'special_classes' },
  { name: 'School Exam Schedule', href: '/school-exam-schedules', icon: FileText, module: 'school_exam_schedules' },
];

// ─── Role-specific sidebar groups ────────────────────────────────────────────

export function getSidebarGroups(role: Role): SidebarGroup[] {
  const allowed = ALL_SIDEBAR_ITEMS.filter((i) => hasModuleAccess(role, i.module));

  if (role === 'super_admin') {
    return [
      { label: 'Overview',          items: allowed.filter((i) => i.module === 'dashboard') },
      { label: 'Management',        items: allowed.filter((i) => (['user_management', 'branch_management', 'role_management', 'special_classes', 'materials', 'lesson_plan'] as Module[]).includes(i.module)) },
      { label: 'Finance & Reports', items: allowed.filter((i) => (['expense_management', 'accountant_portal', 'reports_analytics', 'student_performance_analytics'] as Module[]).includes(i.module)) },
      { label: 'System',            items: allowed.filter((i) => (['notification_center', 'system_settings', 'backup_restore', 'theme_settings'] as Module[]).includes(i.module)) },
    ].filter((g) => g.items.length > 0);
  }

  if (role === 'admin') {
    return [
      { label: 'Overview',  items: allowed.filter((i) => i.module === 'dashboard') },
      { label: 'People',    items: allowed.filter((i) => (['student_management', 'teacher_management', 'parent_management', 'class_allocation'] as Module[]).includes(i.module)) },
      { label: 'Academic',  items: allowed.filter((i) => (['attendance', 'exam_marks', 'timetable', 'admission_crm', 'teacher_tasks', 'special_classes', 'materials', 'lesson_plan'] as Module[]).includes(i.module)) },
      { label: 'Finance',   items: allowed.filter((i) => (['fee_management', 'expense_management', 'inventory'] as Module[]).includes(i.module)) },
      { label: 'More',      items: allowed.filter((i) => (['event_management', 'notification_center', 'reports_analytics'] as Module[]).includes(i.module)) },
    ].filter((g) => g.items.length > 0);
  }

  if (role === 'teacher') {
    return [
      { label: 'Overview',  items: allowed.filter((i) => (['dashboard', 'teacher_portal'] as Module[]).includes(i.module)) },
      { label: 'Teaching',  items: allowed.filter((i) => (['my_classes', 'attendance', 'exam_marks', 'homework', 'materials', 'lesson_plan', 'timetable', 'special_classes', 'school_exam_schedules'] as Module[]).includes(i.module)) },
      { label: 'Students',  items: allowed.filter((i) => (['student_progress'] as Module[]).includes(i.module)) },
      { label: 'Reports',   items: allowed.filter((i) => (['daily_submission', 'notification_center'] as Module[]).includes(i.module)) },
    ].filter((g) => g.items.length > 0);
  }

  // Parent, Accountant — single flat list
  return [{ label: 'Menu', items: allowed }];
}

export { ALL_SIDEBAR_ITEMS };
