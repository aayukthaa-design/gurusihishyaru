import { createStore, useStoreValue } from './store';
import { apiFetch } from './apiClient';

export interface TeacherRecord {
  id: string;
  employeeId: string;
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
  employmentType: string;
  status: 'Active' | 'Inactive';
  profilePhoto?: string;
  role: 'teacher';
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
    fullName: `${row.firstName || ''} ${row.lastName || ''}`.trim(),
    gender: row.gender || '',
    dob: row.dob || '',
    phone: row.mobile || row.phone || '',
    email: row.email || '',
    address: row.address || '',
    qualification: row.qualification || '',
    experience: row.experience || '',
    specialization: row.specialization || row.subjects || '',
    branchId: row.branchId || '',
    dateOfJoining: row.dateOfJoining || '',
    username: row.email || row.mobile || '',
    password: '',
    employmentType: row.employmentType || '',
    status: row.status === 'Inactive' ? 'Inactive' : 'Active',
    profilePhoto: row.profilePhoto || '',
    role: 'teacher',
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
