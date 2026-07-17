import { createStore, useStoreValue } from './store';
import { apiFetch } from './apiClient';

export type FeeStatus = 'Pending' | 'Partially Paid' | 'Paid' | 'Overdue';

export interface FeeStructure {
  id: number;
  className: string;
  branchId: string;
  academicYear: string;
  feeType: string;
  amount: number;
  dueDate: string;
  createdAt: string;
  updatedAt: string;
}

export interface FeeRecord {
  id: number;
  studentId: string;
  studentName: string;
  className: string;
  branchId: string;
  feeType: string;
  academicYear: string;
  totalAmount: number;
  paidAmount: number;
  dueDate: string;
  status: FeeStatus;
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
