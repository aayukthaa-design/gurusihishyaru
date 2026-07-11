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
  | 'school_exam_schedules';

// ─── User Types ───────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  mobile?: string;
  name: string;
  role: Role;
  avatar?: string;
  branchId?: string;
  linkedStudentIds?: string[]; // for parents
  assignedClassIds?: string[]; // for teachers
  createdAt: string;
}

export interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

export interface LoginCredentials {
  email: string;
  password?: string;
  rememberMe?: boolean;
  isParent?: boolean;
}

export interface AuthContextType extends AuthState {
  login: (credentials: LoginCredentials) => Promise<{ success: boolean; role?: Role; error?: string }>;
  logout: () => void;
  hasPermission: (module: Module, permission: Permission) => boolean;
  hasModuleAccess: (module: Module) => boolean;
  canAccess: (path: string) => boolean;
}

// ─── JWT Payload ──────────────────────────────────────────────────────────────

export interface JWTPayload {
  sub: string;       // user id
  email: string;
  role: Role;
  name: string;
  branchId?: string;
  iat: number;
  exp: number;
}
