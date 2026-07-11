import type { User, Role } from './types';

// ─── Seed Users ───────────────────────────────────────────────────────────────
// In a real app these would live in a database with bcrypt-hashed passwords.
// Here we simulate password hashing by storing a hashed constant.
// Default password for all users: Password@123

// Simulated bcrypt hash of "Password@123"
// (In production, use actual bcrypt. Here we verify against the plain password.)
export const DEFAULT_PASSWORD = 'Password@123';

const CLASS_NAMES = ['8th A','8th B','9th A','9th B','10th A','10th B','10th C','11th A','11th B','12th A','12th B'];

const BRANCH_IDS = ['branch_rajajinagar', 'branch_jayanagar', 'branch_vijayanagar', 'branch_hsr'];

const PARENT_LINKED_STUDENT_IDS = [
  ['STU001', 'STU002'],
  ['STU003'],
  ['STU004'],
  ['STU005'],
  ['STU006'],
];

const makeUsers = (
  role: Role,
  prefix: string,
  count = 5
): Array<User & { password: string }> =>
  Array.from({ length: count }, (_, i) => {
    const offset =
      role === 'super_admin' ? 0
      : role === 'admin' ? 5
      : role === 'teacher' ? 10
      : role === 'parent' ? 15
      : 20;

    const mobile = `98765${String(100001 + offset + i).slice(1)}`;

    return {
      id: `${role}_${i + 1}`,
      email: `${prefix}${i + 1}@tutorials.com`,
      mobile,
      password: DEFAULT_PASSWORD,
      name: `${prefix.charAt(0).toUpperCase() + prefix.slice(1)} User ${i + 1}`,
      role,
      branchId: role === 'admin' || role === 'accountant' || role === 'teacher' || role === 'parent'
        ? BRANCH_IDS[i % BRANCH_IDS.length]
        : undefined,
      createdAt: new Date().toISOString(),
      ...(role === 'parent'
        ? { linkedStudentIds: PARENT_LINKED_STUDENT_IDS[i] ?? [] }
        : {}),
      ...(role === 'teacher' ? { assignedClassIds: [CLASS_NAMES[i % CLASS_NAMES.length]] } : {}),
    };
  });

export const SEED_USERS: Array<User & { password: string }> = [
  ...makeUsers('super_admin', 'superadmin'),
  ...makeUsers('admin', 'admin'),
  ...makeUsers('teacher', 'teacher'),
  ...makeUsers('parent', 'parent'),
  ...makeUsers('accountant', 'accountant'),
];

// Quick lookup by email
export const findUserByEmail = (
  email: string
): (User & { password: string }) | undefined =>
  SEED_USERS.find((u) => u.email.toLowerCase() === email.toLowerCase());

// Quick lookup by email or mobile number
export const findUserByEmailOrMobile = (
  identifier: string
): (User & { password: string }) | undefined =>
  SEED_USERS.find(
    (u) => u.email.toLowerCase() === identifier.toLowerCase() || u.mobile === identifier
  );
