import type { User } from '../auth/types';
import { apiFetch } from './apiClient';

// Simplified to 3 working statuses (+ terminal Rejected). Existing admission
// rows created before this simplification may still literally hold one of
// the old intermediate values ('Application Submitted', 'Document
// Verification', 'Interview Scheduled', 'Interview Completed', 'Approved')
// — that text is never rewritten (preserves history), so this type stays
// widened to `string` for the raw value while every helper below treats
// anything that isn't 'Enquiry'/'Admitted'/'Rejected' as being at the
// "Updated" stage.
export type AdmissionStatus = 'Enquiry' | 'Updated' | 'Admitted' | 'Rejected' | (string & {});

export interface AdmissionRecord {
  id: string;
  applicantName: string;
  grade: string;
  appliedDate: string;
  contactNumber: string;
  email: string;
  branchId?: string;
  status: AdmissionStatus;
  createdAt: string;
  updatedAt: string;
}

let admissionState: AdmissionRecord[] = [];
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export async function refreshAdmissions(branchId?: string): Promise<AdmissionRecord[]> {
  try {
    const res = await apiFetch(`/api/admissions${branchId ? `?branchId=${encodeURIComponent(branchId)}` : ''}`);
    if (res.ok) {
      const data = await res.json();
      admissionState = Array.isArray(data) ? data : [];
      emit();
      return admissionState;
    }
  } catch (err) {
    console.error('Failed to fetch admissions:', err);
  }
  return admissionState;
}

// Initial load
void refreshAdmissions();

export function getAdmissions(): AdmissionRecord[] {
  return admissionState;
}

export function subscribeAdmissions(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function createAdmission(data: Omit<AdmissionRecord, 'id' | 'status' | 'createdAt' | 'updatedAt'>): Promise<AdmissionRecord | null> {
  try {
    const res = await apiFetch('/api/admissions', { method: 'POST', body: data });
    if (!res.ok) return null;
    const record = await res.json();
    await refreshAdmissions();
    return record;
  } catch (err) {
    console.error('createAdmission error:', err);
    return null;
  }
}

export async function updateAdmission(
  admissionId: string,
  data: Pick<AdmissionRecord, 'applicantName' | 'grade' | 'contactNumber' | 'email' | 'appliedDate'>
): Promise<AdmissionRecord | null> {
  try {
    const res = await apiFetch(`/api/admissions/${admissionId}`, { method: 'PUT', body: data });
    if (!res.ok) return null;
    const record = await res.json();
    await refreshAdmissions();
    return record;
  } catch (err) {
    console.error('updateAdmission error:', err);
    return null;
  }
}

async function updateStatus(admissionId: string, action: 'update' | 'admit' | 'reject') {
  try {
    const res = await apiFetch(`/api/admissions/${admissionId}/action`, { method: 'PATCH', body: { action } });
    if (res.ok) {
      await refreshAdmissions();
      return true;
    }
    const err = await res.json().catch(() => ({}));
    if (err.error) alert(err.error);
  } catch (err) {
    console.error('updateStatus error:', err);
  }
  return false;
}

/** Enquiry -> Updated: replaces the old submit/verify/schedule/complete/approve chain. */
export function markAdmissionUpdated(admissionId: string) {
  void updateStatus(admissionId, 'update');
}

export function rejectAdmission(admissionId: string) {
  void updateStatus(admissionId, 'reject');
}

// Marks Admitted. This is now the entry point into the Fees module — the
// server reuses (or creates, dedup-checked) the linked student record and
// sends the branch-Accountant/Super-Admin notification, so nothing further
// needs to happen client-side beyond refreshing the admissions list.
export function markAdmissionAdmitted(admissionId: string) {
  void updateStatus(admissionId, 'admit');
}

// Kept for the reverse direction: StudentManagement.tsx calls this after an
// admin manually adds/edits a student, to flip a name-matched admission to
// Admitted too. The server-side Admitted handler's own dedup check (match by
// admissionId, then by name+branch) means this never creates a duplicate
// student even though the student here was already created independently.
export function enrollAdmissionByApplicantName(applicantName: string) {
  const target = admissionState.find((record) => record.applicantName.toLowerCase() === applicantName.toLowerCase());
  if (!target) {
    return undefined;
  }

  void updateStatus(target.id, 'admit');
  return target.id;
}

export function getAdmissionWorkflowActions(status: AdmissionStatus) {
  switch (status) {
    case 'Enquiry':
      return [{ label: 'Mark Updated', action: 'update' as const }, { label: 'Mark Admitted', action: 'admit' as const }];
    case 'Admitted':
    case 'Rejected':
      return [];
    default:
      // Anything else (an "Updated" row, or a legacy in-progress status from
      // before this simplification) can go straight to Admitted.
      return [{ label: 'Mark Admitted', action: 'admit' as const }];
  }
}

export function applyAdmissionWorkflowAction(admissionId: string, action: 'update' | 'admit' | 'reject') {
  switch (action) {
    case 'update':
      markAdmissionUpdated(admissionId);
      break;
    case 'admit':
      markAdmissionAdmitted(admissionId);
      break;
    case 'reject':
      rejectAdmission(admissionId);
      break;
  }
}

export function getAdmissionStats(records: AdmissionRecord[]) {
  return {
    total: records.length,
    // Anything that isn't Admitted/Rejected — covers 'Enquiry', 'Updated',
    // and any legacy in-progress status from before the simplification.
    inProgress: records.filter((record) => !['Rejected', 'Admitted'].includes(record.status)).length,
    admitted: records.filter((record) => record.status === 'Admitted').length,
    rejected: records.filter((record) => record.status === 'Rejected').length,
  };
}

export function getAdmissionStatusColor(status: AdmissionStatus) {
  switch (status) {
    case 'Enquiry':
      return 'bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300';
    case 'Admitted':
      return 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400';
    case 'Rejected':
      return 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300';
    case 'Updated':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';
    default:
      // Legacy in-progress status text (e.g. 'Interview Scheduled') from
      // before the simplification — shown with the same styling as 'Updated'.
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';
  }
}

export function getWorkflowLabel(status: AdmissionStatus) {
  return status;
}

export function getFilteredAdmissions(records: AdmissionRecord[], user: User | null, branchSelection?: string) {
  if (!user) {
    return records;
  }

  if (user.role === 'super_admin') {
    return branchSelection ? records.filter((record) => record.branchId === branchSelection) : records;
  }

  return records.filter((record) => !record.branchId || record.branchId === user.branchId);
}
