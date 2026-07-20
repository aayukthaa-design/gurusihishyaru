import type { Role, Permission, Module } from './types';

export interface RoleConfig {
  label: string;
  modules: Module[];
  permissions: Permission[];
}

export const ROLE_CONFIG: Record<Role, RoleConfig> = {

  // ── Super Admin: strategic + system control only ─────────────────────────
  // NOT responsible for day-to-day student/fee/attendance operations.
  // Manages users, roles, system settings, analytics, institute configuration.
  super_admin: {
    label: 'Super Admin',
    modules: [
      'dashboard',
      'user_management',        // create/manage admins & accountants
      'role_management',        // assign roles
      'reports_analytics',      // institute-wide analytics
      'branch_management',      // institute-wide branch administration
      'system_settings',        // institute configuration
      'backup_restore',         // data safety
      'theme_settings',         // UI customisation
      'notification_center',    // system-wide notification monitoring
      'expense_management',     // financial oversight
      'accountant_portal',      // financial overview
      'student_performance_analytics',
      'special_classes',
      'materials',
      'lesson_plan',
    ],
    permissions: [
      'create',
      'read',
      'update',
      'delete',
      'export',
      'manage_users',
      'manage_roles',
    ],
  },

  // ── Admin: operational manager ───────────────────────────────────────────
  // Handles all day-to-day institute operations.
  // Cannot touch system settings, roles, or super admin accounts.
  admin: {
    label: 'Admin',
    modules: [
      'dashboard',
      'student_management',     // manage student records
      'teacher_management',     // manage teacher profiles & assignments
      'parent_management',      // manage parent records
      'class_allocation',       // assign teachers to classes/subjects/batches
      'fee_management',         // collect and track fees
      'attendance',             // daily attendance
      'exam_marks',             // exams and results
      'teacher_tasks',          // assign teacher work
      'timetable',              // schedule management
      'admission_crm',          // new admissions
      'event_management',       // events and meetings
      'notification_center',    // send notifications
      'reports_analytics',      // operational reports
      'expense_management',     // day-to-day expenses
      'inventory',              // inventory management
      'special_classes',
      'materials',               // oversight of all teachers' uploaded materials
      'lesson_plan',              // oversight of all teachers' lesson plans
    ],
    permissions: ['create', 'read', 'update', 'delete', 'export'],
  },

  // ── Teacher ───────────────────────────────────────────────────────────────
  teacher: {
    label: 'Teacher',
    modules: [
      'dashboard',
      'teacher_portal',   // Teacher Dashboard
      'my_classes',       // My Classes (allocated by admin)
      'attendance',       // Mark attendance for assigned classes
      'exam_marks',       // Create & enter marks for assigned classes
      'homework',         // Assign homework
      'student_management', // Manage student records from teacher portal
      'student_progress', // View student progress
      'timetable',        // View own timetable
      'notification_center', // Teacher-specific notifications
      'daily_submission', // Daily work report submission
      'special_classes',
      'school_exam_schedules',
      'materials',         // Upload/manage own study materials (never visible to other teachers)
      'lesson_plan',        // Plan lessons per class/subject from the textbook
    ],
    permissions: ['create', 'read', 'update'],
  },

  // ── Parent ────────────────────────────────────────────────────────────────
  parent: {
    label: 'Parent',
    modules: [
      'parent_portal',
      'fee_management',
      'student_progress',
      'homework',
      'notification_center',
      'event_management',
      'special_classes',
      'materials',   // View/download materials shared for their child's class
    ],
    permissions: ['read'],
  },

  // ── Accountant ────────────────────────────────────────────────────────────
  accountant: {
    label: 'Accountant',
    modules: [
      'dashboard',
      'accountant_portal',
      'fee_management',
      'expense_management',
      'inventory',
      'reports_analytics',
    ],
    permissions: ['create', 'read', 'update', 'delete', 'export'],
  },
};

// ─── Module → Route mapping ───────────────────────────────────────────────────

export const MODULE_ROUTES: Record<Module, string[]> = {
  dashboard:           ['/'],
  student_management:  ['/students'],
  teacher_management:  ['/teachers'],
  parent_management:   ['/parents'],
  class_allocation:    ['/allocations'],
  fee_management:      ['/fees'],
  attendance:          ['/attendance', '/teacher-attendance'],
  exam_marks:          ['/exams'],
  inventory:           ['/inventory'],
  teacher_tasks:       ['/tasks'],
  timetable:           ['/timetable'],
  admission_crm:       ['/admissions'],
  expense_management:  ['/expenses'],
  event_management:    ['/events'],
  notification_center: ['/notifications'],
  parent_portal:       ['/parent'],
  teacher_portal:      ['/teacher', '/teacher/scoreboard', '/teacher/salary-slips'],
  my_classes:          ['/my-classes'],
  daily_submission:    ['/daily-submission'],
  accountant_portal:   ['/accountant'],
  user_management:     ['/users'],
  role_management:     ['/roles'],
  reports_analytics:   ['/reports'],
  branch_management:   ['/branches'],
  system_settings:     ['/settings'],
  backup_restore:      ['/backup'],
  theme_settings:      ['/theme-settings'],
  homework:            ['/homework'],
  student_progress:    ['/progress'],
  student_performance_analytics: ['/performance-analytics'],
  special_classes:     ['/special-classes'],
  school_exam_schedules: ['/school-exam-schedules'],
  materials:           ['/materials'],
  lesson_plan:         ['/lesson-plan'],
};

// ─── RBAC helpers ─────────────────────────────────────────────────────────────

export function getRoleLabel(role: Role | undefined): string {
  if (!role || !(role in ROLE_CONFIG)) return 'Dashboard';
  return ROLE_CONFIG[role].label;
}

export function hasModuleAccess(role: Role, module: Module): boolean {
  const config = ROLE_CONFIG[role];
  if (!config) return false;
  return config.modules.includes(module);
}

export function hasPermission(role: Role, module: Module, permission: Permission): boolean {
  const config = ROLE_CONFIG[role];
  if (!config) return false;
  return (
    hasModuleAccess(role, module) &&
    config.permissions.includes(permission)
  );
}

export function canAccessRoute(role: Role, path: string): boolean {
  // Marking Teacher Attendance is restricted to Admin/Super Admin — accountants
  // and teachers still get in via the 'attendance' module below, but the page
  // itself (TeacherAttendance.tsx) renders everything read-only for them.
  if (path === '/teacher-attendance' || path.startsWith('/teacher-attendance')) {
    return role === 'admin' || role === 'super_admin' || role === 'teacher' || role === 'accountant';
  }

  for (const [module, routes] of Object.entries(MODULE_ROUTES)) {
    if (routes.some((r) => path === r || path.startsWith(r + '/'))) {
      return hasModuleAccess(role, module as Module);
    }
  }
  return false;
}

// ─── Default post-login route ─────────────────────────────────────────────────

export function defaultRouteForRole(role: Role): string {
  switch (role) {
    case 'super_admin':
    case 'admin':
      return '/';
    case 'teacher':
      return '/teacher';
    case 'parent':
      return '/parent';
    case 'accountant':
      return '/accountant';
    default:
      return '/';
  }
}

/** Priority order used to pick the default active role for a freshly-logged-in multi-role user. */
export const ROLE_PRIORITY: Role[] = ['super_admin', 'admin', 'accountant', 'teacher', 'parent'];

export function hasAnyRole(roles: Role[], targets: Role[]): boolean {
  return roles.some((r) => targets.includes(r));
}

/** Highest-priority role in a user's held roles, per ROLE_PRIORITY. */
export function getPrimaryRole(roles: Role[]): Role {
  for (const candidate of ROLE_PRIORITY) {
    if (roles.includes(candidate)) return candidate;
  }
  return roles[0] ?? 'teacher';
}

/**
 * Route to land on right after login. A user holding more than one role lands
 * on /select-role first (rather than guessing) since the UI/UX consequences
 * of e.g. Super Admin mode vs Teacher mode differ enough (branch scoping in
 * particular) that a conscious choice is safer than silently combining them.
 */
export function getDefaultRoute(roles: Role[]): string {
  if (roles.length > 1) return '/select-role';
  return defaultRouteForRole(roles[0] ?? 'teacher');
}
