import { createStore, useStoreValue } from './store';
import { apiFetch } from './apiClient';

export type FeeStatus = 'Pending' | 'Partially Paid' | 'Paid' | 'Overdue';

/** Discount + category + duration fields shared by fee structures, records, and approval requests. */
export interface FeeDiscountFields {
  /** Total fee before discount, as entered by staff. */
  originalAmount: number;
  discountPercent: number;
  /** originalAmount * discountPercent / 100 — always server-computed, never trust a client-sent value. */
  discountAmount: number;
  /** Free-text, e.g. "Tuition", "CBSE Batch", "Crash Course". */
  category: string;
  /** Fee period this charge covers, e.g. '2026-06-01' to '2026-08-31'. */
  startDate: string;
  endDate: string;
}

export interface FeeStructure extends FeeDiscountFields {
  id: number;
  className: string;
  branchId: string;
  academicYear: string;
  feeType: string;
  /** Final Amount (originalAmount - discountAmount) — unchanged meaning, existing readers keep working. */
  amount: number;
  dueDate: string;
  createdAt: string;
  updatedAt: string;
}

export interface FeeRecord extends FeeDiscountFields {
  id: number;
  studentId: string;
  studentName: string;
  className: string;
  branchId: string;
  feeType: string;
  academicYear: string;
  /** Final Amount (originalAmount - discountAmount) — unchanged meaning, existing readers keep working. */
  totalAmount: number;
  paidAmount: number;
  dueDate: string;
  status: FeeStatus;
  /** Set only for recurring monthly fee records, e.g. '2026-07'. */
  month?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FeePayment {
  id: number;
  feeRecordId: number;
  studentId: string;
  amount: number;
  paymentMode: string;
  referenceNumber: string;
  receivedBy: string;
  paymentDate: string;
  receiptNumber: string;
  branchId: string;
  createdAt: string;
}

export interface FeeStats {
  totalCollected: number;
  totalPending: number;
  overdueCount: number;
  paidCount: number;
  totalRecords: number;
}

const feeRecordsStore = createStore<FeeRecord[]>([]);
const feeStructuresStore = createStore<FeeStructure[]>([]);

export function useFeeRecords() {
  return useStoreValue(feeRecordsStore);
}

export function useFeeStructures() {
  return useStoreValue(feeStructuresStore);
}

export async function refreshFeeRecords(user?: any): Promise<FeeRecord[]> {
  if (!user) return [];
  try {
    const params = new URLSearchParams();
    if (user.branchId) params.set('branchId', user.branchId);
    const res = await apiFetch(`/api/fees/records?${params.toString()}`);
    if (!res.ok) throw new Error('Backend failed');
    const data = await res.json();
    if (Array.isArray(data)) {
      feeRecordsStore.setState(data);
      return data;
    }
    return [];
  } catch (e) {
    console.error('Fee records refresh failed', e);
    return feeRecordsStore.getState();
  }
}

export async function refreshFeeStructures(user?: any): Promise<FeeStructure[]> {
  if (!user) return [];
  try {
    const params = new URLSearchParams();
    if (user.branchId) params.set('branchId', user.branchId);
    const res = await apiFetch(`/api/fees/structures?${params.toString()}`);
    if (!res.ok) throw new Error('Backend failed');
    const data = await res.json();
    if (Array.isArray(data)) {
      feeStructuresStore.setState(data);
      return data;
    }
    return [];
  } catch (e) {
    console.error('Fee structures refresh failed', e);
    return feeStructuresStore.getState();
  }
}

export async function fetchFeeStats(user?: any): Promise<FeeStats> {
  const empty: FeeStats = { totalCollected: 0, totalPending: 0, overdueCount: 0, paidCount: 0, totalRecords: 0 };
  if (!user) return empty;
  try {
    const params = new URLSearchParams();
    if (user.branchId) params.set('branchId', user.branchId);
    const res = await apiFetch(`/api/fees/stats?${params.toString()}`);
    if (!res.ok) return empty;
    return await res.json();
  } catch (e) {
    console.error('Fee stats fetch failed', e);
    return empty;
  }
}

export async function createFeeStructureAPI(body: Partial<FeeStructure>, user: any): Promise<FeeStructure> {
  const res = await apiFetch('/api/fees/structures', { method: 'POST', body });
  if (!res.ok) throw new Error('Failed to create fee structure');
  const created = await res.json();
  await refreshFeeStructures(user);
  return created;
}

export async function generateFeeRecordsAPI(structureId: number, user: any): Promise<{ createdCount: number; skippedCount: number }> {
  const res = await apiFetch('/api/fees/records/generate', { method: 'POST', body: { structureId } });
  if (!res.ok) throw new Error('Failed to generate fee records');
  const result = await res.json();
  await refreshFeeRecords(user);
  return result;
}

export interface MonthlyFeeGenerationInput {
  className: string;
  feeType: string;
  /** Original Amount before discount — the server computes discountAmount/Final Amount from this + discountPercent. */
  originalAmount: number;
  discountPercent?: number;
  category?: string;
  startDate?: string;
  endDate?: string;
  academicYear: string;
  startMonth: string; // 'YYYY-MM'
  months: number;
  dueDay: number;
  branchId?: string;
}

export async function generateMonthlyFeeRecordsAPI(
  input: MonthlyFeeGenerationInput,
  user: any
): Promise<{ createdCount: number; skippedCount: number; studentCount: number }> {
  const res = await apiFetch('/api/fees/records/generate-monthly', { method: 'POST', body: input });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to generate monthly fee records');
  }
  const result = await res.json();
  await refreshFeeRecords(user);
  return result;
}

export interface SingleFeeRecordInput {
  studentId: string;
  feeType: string;
  /** Original Amount before discount — the server computes discountAmount/Final Amount from this + discountPercent. */
  originalAmount: number;
  discountPercent?: number;
  category?: string;
  startDate?: string;
  endDate?: string;
  dueDate: string;
  academicYear?: string;
  month?: string;
}

/** A pending/approved/rejected Super Admin sign-off on a fee amount — see fee_approval_requests. */
export interface FeeApprovalRequest extends FeeDiscountFields {
  id: string;
  studentId: string;
  studentName: string;
  className: string;
  branchId: string;
  /** Null when this request is for a brand-new fee assignment (nothing to update yet); set when editing an existing record. */
  feeRecordId: number | null;
  feeType: string;
  academicYear: string;
  month?: string | null;
  /** Null when there's no existing fee for this student yet. */
  oldAmount: number | null;
  /** Final Amount being requested (originalAmount - discountAmount). */
  newAmount: number;
  dueDate: string;
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

/** For admin/accountant, creating or editing a fee amount opens a pending request instead of writing fee_records directly — Super Admin only. */
export type FeeRecordWriteResult =
  | { pendingApproval: true; request: FeeApprovalRequest }
  | { pendingApproval: false; record: FeeRecord };

export async function createSingleFeeRecordAPI(input: SingleFeeRecordInput, user: any): Promise<FeeRecordWriteResult> {
  const res = await apiFetch('/api/fees/records', { method: 'POST', body: input });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to create fee record');
  }
  const result = await res.json();
  await refreshFeeRecords(user);
  return result;
}

export async function updateFeeRecordAPI(
  recordId: number,
  updates: { originalAmount?: number; discountPercent?: number; category?: string; startDate?: string; endDate?: string; dueDate?: string },
  user: any
): Promise<FeeRecordWriteResult> {
  const res = await apiFetch(`/api/fees/records/${recordId}`, { method: 'PUT', body: updates });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to update fee record');
  }
  const result = await res.json();
  await refreshFeeRecords(user);
  return result;
}

/** Branch-scoped for admin/accountant; every branch for Super Admin — same as every other list endpoint in this app. */
export async function fetchFeeApprovalRequestsAPI(status?: 'Pending' | 'Approved' | 'Rejected'): Promise<FeeApprovalRequest[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  const res = await apiFetch(`/api/fee-approval-requests${query}`);
  if (!res.ok) return [];
  return res.json();
}

export async function approveFeeApprovalRequestAPI(requestId: string): Promise<FeeApprovalRequest> {
  const res = await apiFetch(`/api/fee-approval-requests/${requestId}/approve`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to approve fee request');
  }
  return res.json();
}

export async function rejectFeeApprovalRequestAPI(requestId: string, reason?: string): Promise<FeeApprovalRequest> {
  const res = await apiFetch(`/api/fee-approval-requests/${requestId}/reject`, { method: 'POST', body: { reason } });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to reject fee request');
  }
  return res.json();
}

export async function recordFeePaymentAPI(
  recordId: number,
  amount: number,
  paymentMode: string,
  referenceNumber: string,
  user: any
): Promise<{ record: FeeRecord; receiptNumber: string }> {
  const res = await apiFetch(`/api/fees/records/${recordId}/payments`, {
    method: 'POST',
    body: { amount, paymentMode, referenceNumber },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Payment failed');
  }
  const result = await res.json();
  await refreshFeeRecords(user);
  return result;
}

export async function fetchFeePayments(recordId: number): Promise<FeePayment[]> {
  try {
    const res = await apiFetch(`/api/fees/records/${recordId}/payments`);
    if (!res.ok) return [];
    return await res.json();
  } catch (e) {
    console.error('Fee payments fetch failed', e);
    return [];
  }
}
