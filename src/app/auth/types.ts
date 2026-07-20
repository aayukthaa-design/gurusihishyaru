// ─── Role & Permission Types ─────────────────────────────────────────────────

export type Role =
  | 'super_admin'
  | 'admin'
  | 'teacher'
  | 'parent'
  | 'accountant';

export type Permission =
  | 'create'
  | 'read'
  | 'update'
  | 'delete'
  | 'export'
  | 'manage_users'
  | 'manage_roles';

export type Module =
  | 'dashboard'
  | 'student_management'
  | 'teacher_management'
  | 'parent_management'
  | 'class_allocation'
  | 'fee_management'
  | 'attendance'
  | 'exam_marks'
  | 'inventory'
  | 'teacher_tasks'
  | 'timetable'
  | 'admission_crm'
  | 'expense_management'
  | 'event_management'
  | 'notification_center'
  | 'parent_portal'
  | 'teacher_portal'
  | 'my_classes'
  | 'daily_submission'
  | 'accountant_portal'
  | 'user_management'
  | 'role_management'
  | 'reports_analytics'
  | 'branch_management'
  | 'system_settings'
  | 'backup_restore'
  | 'theme_settings'
  | 'homework'
  | 'student_progress'
  | 'student_performance_analytics'
  | 'special_classes'
  | 'school_exam_schedules'
  | 'materials'
  | 'lesson_plan';

// ─── User Types ───────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  mobile?: string;
  name: string;
  /** Currently active role — determines which dashboard/sidebar is shown. Always one of `roles`. */
  role: Role;
  /** Full set of roles this account holds. Server-side authorization always checks the full set, never just `role`. */
  roles: Role[];
  avatar?: string;
  branchId?: string;
  linkedStudentIds?: string[]; // for parents
  assignedClassIds?: string[]; // for teachers
  mustChangePassword?: boolean;
  createdAt: string;
}

export interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

export interface LoginCredentials {
  /** Email or mobile number for staff/teacher/admin login. Parent login uses loginParent instead. */
  email: string;
  password?: string;
  rememberMe?: boolean;
}

export interface AuthContextType extends AuthState {
  login: (credentials: LoginCredentials) => Promise<{ success: boolean; role?: Role; roles?: Role[]; error?: string }>;
  logout: () => void;
  hasPermission: (module: Module, permission: Permission) => boolean;
  hasModuleAccess: (module: Module) => boolean;
  canAccess: (path: string) => boolean;
  /** Switches the active role for a multi-role user. UI/UX only — server-side authorization always uses the full token `roles`. */
  switchRole: (role: Role) => void;
  /** Parent login: logs in directly with a registered mobile number, no further verification. */
  loginParent: (mobile: string, rememberMe?: boolean) => Promise<{ success: boolean; error?: string }>;
  /** Patches the cached user object in both context state and storage (e.g. after clearing mustChangePassword). */
  updateUser: (patch: Partial<User>) => void;
}

// ─── JWT Payload (decoded client-side, never verified — the server is the source of truth) ──

export interface JWTPayload {
  sub: string;       // user id
  email: string;
  roles: Role[];
  name: string;
  branchId?: string;
  iat: number;
  exp: number;
}
