import { apiFetch } from './apiClient';

export type CasualLeaveStatus = 'Pending' | 'Approved' | 'Rejected';

export interface CasualLeaveRequest {
  id: number;
  teacherId: string;
  teacherName: string;
  branchId?: string;
  startDate: string;
  endDate: string;
  reason: string;
  status: CasualLeaveStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewRemarks?: string;
  createdAt: string;
  updatedAt: string;
}

export async function fetchCasualLeaves(params?: { teacherId?: string; status?: string; branchId?: string }): Promise<CasualLeaveRequest[]> {
  const qs = new URLSearchParams();
  if (params?.teacherId) qs.set('teacherId', params.teacherId);
  if (params?.status) qs.set('status', params.status);
  if (params?.branchId) qs.set('branchId', params.branchId);
  const query = qs.toString();
  const res = await apiFetch(`/api/casual-leaves${query ? `?${query}` : ''}`);
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export async function requestCasualLeave(params: { startDate: string; endDate: string; reason?: string }): Promise<CasualLeaveRequest> {
  const res = await apiFetch('/api/casual-leaves', { method: 'POST', body: params });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Failed to submit leave request');
  return res.json();
}

export async function reviewCasualLeave(id: number, status: 'Approved' | 'Rejected', reviewRemarks?: string): Promise<CasualLeaveRequest> {
  const res = await apiFetch(`/api/casual-leaves/${id}`, { method: 'PATCH', body: { status, reviewRemarks } });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Failed to update leave request');
  return res.json();
}

export async function cancelCasualLeave(id: number): Promise<void> {
  const res = await apiFetch(`/api/casual-leaves/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Failed to withdraw leave request');
}

export interface CasualLeaveBalance {
  userId: string;
  name: string;
  roles: string[];
  branchId?: string;
  leavesTaken: number;
  updatedAt?: string;
}

export async function fetchCasualLeaveBalances(params?: { branchId?: string }): Promise<CasualLeaveBalance[]> {
  const qs = new URLSearchParams();
  if (params?.branchId) qs.set('branchId', params.branchId);
  const query = qs.toString();
  const res = await apiFetch(`/api/casual-leave-balances${query ? `?${query}` : ''}`);
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export async function updateCasualLeaveBalance(userId: string, leavesTaken: number): Promise<CasualLeaveBalance> {
  const res = await apiFetch(`/api/casual-leave-balances/${userId}`, { method: 'PUT', body: { leavesTaken } });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Failed to update leave balance');
  return res.json();
}
