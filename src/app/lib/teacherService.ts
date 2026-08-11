import { createStore, useStoreValue } from './store';
import { apiFetch } from './apiClient';

export interface TeacherRecord {
  id: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  gender: string;
  dob: string;
  phone: string;
  mobile: string;
  email: string;
  address: string;
  qualification: string;
  experience: string;
  specialization: string;
  subjects: string;
  department: string;
  salaryType: 'Monthly Fixed' | 'Per Class';
  salaryAmount: number;
  monthlySalary: number | null;
  salaryPerClass: number | null;
  branchId: string;
  dateOfJoining: string;
  username: string;
  password: string;
  employmentType: string;
  status: 'Active' | 'Inactive' | 'Pending Approval';
  profilePhoto?: string;
  role: 'teacher';
  roles: string[];
}

interface TeacherFormPayload {
  fullName: string;
  gender: string;
  dob: string;
  phone: string;
  email: string;
  address: string;
  qualification: string;
  experience: string;
  specialization: string;
  branchId: string;
  dateOfJoining: string;
  username: string;
  password: string;
  confirmPassword: string;
  employmentType: string;
  status: 'Active' | 'Inactive';
  profilePhoto?: string;
}

function mapApiTeacher(row: any): TeacherRecord {
  return {
    id: row.id,
    employeeId: row.id,
    firstName: row.firstName || '',
    lastName: row.lastName || '',
    fullName: `${row.firstName || ''} ${row.lastName || ''}`.trim(),
    gender: row.gender || '',
    dob: row.dob || '',
    phone: row.mobile || row.phone || '',
    mobile: row.mobile || row.phone || '',
    email: row.email || '',
    address: row.address || '',
    qualification: row.qualification || '',
    experience: row.experience || '',
    specialization: row.specialization || row.subjects || '',
    subjects: row.subjects || row.specialization || '',
    department: row.department || '',
    salaryType: row.salaryType === 'Per Class' ? 'Per Class' : 'Monthly Fixed',
    salaryAmount: Number(row.salaryAmount || 0),
    monthlySalary: row.monthlySalary ?? null,
    salaryPerClass: row.salaryPerClass ?? null,
    branchId: row.branchId || '',
    dateOfJoining: row.dateOfJoining || '',
    username: row.email || row.mobile || '',
    password: '',
    employmentType: row.employmentType || '',
    // 'Pending Approval' must survive the mapping — it drives the Approve
    // action in Teacher Management for teachers added by a branch Admin
    // (server.js: only super_admin-created teachers start Active).
    status: row.status === 'Inactive' || row.status === 'Pending Approval' ? row.status : 'Active',
    profilePhoto: row.profilePhoto || '',
    role: 'teacher',
    roles: Array.isArray(row.roles) ? row.roles : ['teacher'],
  };
}

const teacherStore = createStore<TeacherRecord[]>([]);

export async function refreshTeachers(branchId?: string): Promise<TeacherRecord[]> {
  try {
    const res = await apiFetch(`/api/teachers${branchId ? `?branchId=${encodeURIComponent(branchId)}` : ''}`);
    if (res.ok) {
      const data = await res.json();
      const mapped = Array.isArray(data) ? data.map(mapApiTeacher) : [];
      teacherStore.setState(mapped);
      return mapped;
    }
  } catch (err) {
    console.error('Failed to fetch teachers:', err);
  }
  return teacherStore.getState();
}

// Wipes the in-memory cache on logout — teacherStore is a module-level
// singleton, so without this a branch Admin who logs out and a different
// Admin/Super Admin who logs in on the same tab would briefly still see the
// previous account's (possibly other-branch) teacher list until some page
// happens to call refreshTeachers() again.
export function clearTeachers(): void {
  teacherStore.setState([]);
}

// Initial load
void refreshTeachers();

export function getTeachers(): TeacherRecord[] {
  return teacherStore.getState();
}

export function useTeachers() {
  return useStoreValue(teacherStore);
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') };
}

export async function addTeacher(input: TeacherFormPayload, branchId: string): Promise<{ success: boolean; error?: string; teacher?: TeacherRecord }> {
  if (!input.fullName.trim()) return { success: false, error: 'Full name is required.' };
  if (!input.phone.trim()) return { success: false, error: 'Phone number is required.' };
  if (!/^\d{10}$/.test(input.phone.replace(/\D/g, ''))) return { success: false, error: 'Phone number must be 10 digits.' };
  if (input.password && input.password !== input.confirmPassword) return { success: false, error: 'Passwords do not match.' };

  const { firstName, lastName } = splitName(input.fullName);
  try {
    const res = await apiFetch('/api/teachers', {
      method: 'POST',
      body: {
        firstName, lastName, fullName: input.fullName.trim(),
        gender: input.gender, dob: input.dob, phone: input.phone, mobile: input.phone,
        email: input.email.trim(), address: input.address.trim(),
        qualification: input.qualification.trim(), experience: input.experience.trim(),
        specialization: input.specialization.trim(), branchId,
        dateOfJoining: input.dateOfJoining, password: input.password || undefined,
        employmentType: input.employmentType, status: input.status, profilePhoto: input.profilePhoto,
      },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { success: false, error: data.error || 'Unable to create teacher.' };
    }
    const created = mapApiTeacher(await res.json());
    await refreshTeachers();
    return { success: true, teacher: created };
  } catch (err) {
    console.error('addTeacher error:', err);
    return { success: false, error: 'Connection to server failed.' };
  }
}

export async function updateTeacher(id: string, input: TeacherFormPayload, branchId: string): Promise<{ success: boolean; error?: string; teacher?: TeacherRecord }> {
  if (!input.fullName.trim()) return { success: false, error: 'Full name is required.' };
  if (!input.phone.trim()) return { success: false, error: 'Phone number is required.' };
  if (!/^\d{10}$/.test(input.phone.replace(/\D/g, ''))) return { success: false, error: 'Phone number must be 10 digits.' };
  if (input.password && input.password !== input.confirmPassword) return { success: false, error: 'Passwords do not match.' };

  const { firstName, lastName } = splitName(input.fullName);
  try {
    const res = await apiFetch(`/api/teachers/${id}`, {
      method: 'PUT',
      body: {
        firstName, lastName, fullName: input.fullName.trim(),
        gender: input.gender, dob: input.dob, phone: input.phone, mobile: input.phone,
        email: input.email.trim(), address: input.address.trim(),
        qualification: input.qualification.trim(), experience: input.experience.trim(),
        specialization: input.specialization.trim(), branchId,
        dateOfJoining: input.dateOfJoining, password: input.password || undefined,
        employmentType: input.employmentType, status: input.status, profilePhoto: input.profilePhoto,
      },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { success: false, error: data.error || 'Unable to update teacher.' };
    }
    const updated = mapApiTeacher(await res.json());
    await refreshTeachers();
    return { success: true, teacher: updated };
  } catch (err) {
    console.error('updateTeacher error:', err);
    return { success: false, error: 'Connection to server failed.' };
  }
}

export function getTeachersForBranch(branchId?: string) {
  return getTeachers().filter((teacher) => !branchId || teacher.branchId === branchId);
}

export function getTeacherById(id: string) {
  return getTeachers().find((teacher) => teacher.id === id);
}

// ─── Teacher → Admin role-change requests ──────────────────────────────────
// Admins have no direct way to change a user's roles — this opens a request
// that Super Admin approves/rejects from the Notification Center, mirroring
// feeService.ts's fee-approval-request wrappers.

export interface RoleChangeRequest {
  id: string;
  userId: string;
  userName: string;
  branchId: string | null;
  addRole: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  requestedBy: string;
  requestedByName: string;
  requestedAt: string;
  approvedBy?: string | null;
  approvedByName?: string | null;
  approvedAt?: string | null;
  rejectedBy?: string | null;
  rejectedByName?: string | null;
  rejectedAt?: string | null;
  rejectionReason?: string | null;
}

export async function requestRoleChangeAPI(userId: string): Promise<RoleChangeRequest> {
  const res = await apiFetch('/api/role-change-requests', { method: 'POST', body: { userId } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to request Admin access');
  return data.request;
}

export async function fetchRoleChangeRequestsAPI(status?: 'Pending' | 'Approved' | 'Rejected'): Promise<RoleChangeRequest[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  const res = await apiFetch(`/api/role-change-requests${query}`);
  if (!res.ok) return [];
  return res.json();
}

export async function approveRoleChangeRequestAPI(requestId: string): Promise<RoleChangeRequest> {
  const res = await apiFetch(`/api/role-change-requests/${requestId}/approve`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to approve role change request');
  }
  return res.json();
}

export async function rejectRoleChangeRequestAPI(requestId: string, reason?: string): Promise<RoleChangeRequest> {
  const res = await apiFetch(`/api/role-change-requests/${requestId}/reject`, { method: 'POST', body: { reason } });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to reject role change request');
  }
  return res.json();
}
