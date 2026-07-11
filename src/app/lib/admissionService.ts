import type { User } from '../auth/types';
import { addNotification } from './notificationService';
import { apiFetch } from './apiClient';

export type AdmissionStatus =
  | 'Enquiry'
  | 'Application Submitted'
  | 'Document Verification'
  | 'Interview Scheduled'
  | 'Interview Completed'
  | 'Approved'
  | 'Enrolled'
  | 'Rejected';

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

async function updateStatus(admissionId: string, action: 'submit' | 'verify' | 'schedule' | 'complete' | 'approve' | 'enroll' | 'reject') {
  try {
    const res = await apiFetch(`/api/admissions/${admissionId}/action`, { method: 'PATCH', body: { action } });
    if (res.ok) {
      await refreshAdmissions();
    }
  } catch (err) {
    console.error('updateStatus error:', err);
  }
}

export function submitAdmissionApplication(admissionId: string) {
  void updateStatus(admissionId, 'submit');
}

export function verifyAdmissionDocuments(admissionId: string) {
  void updateStatus(admissionId, 'verify');
}

export function scheduleAdmissionInterview(admissionId: string) {
  void updateStatus(admissionId, 'schedule');
}

export function completeAdmissionInterview(admissionId: string) {
  void updateStatus(admissionId, 'complete');
}

export function approveAdmission(admissionId: string) {
  void updateStatus(admissionId, 'approve');
}

export function rejectAdmission(admissionId: string) {
  void updateStatus(admissionId, 'reject');
}

export function enrollAdmission(admissionId: string) {
  void updateStatus(admissionId, 'enroll');
}

export function enrollAdmissionByApplicantName(applicantName: string) {
  const target = admissionState.find((record) => record.applicantName.toLowerCase() === applicantName.toLowerCase());
  if (!target) {
    return undefined;
  }

  void updateStatus(target.id, 'enroll');
  return target.id;
}

export function getAdmissionWorkflowActions(status: AdmissionStatus) {
  switch (status) {
    case 'Enquiry':
      return [{ label: 'Submit Application', action: 'submit' as const }];
    case 'Application Submitted':
      return [{ label: 'Verify Documents', action: 'verify' as const }];
    case 'Document Verification':
      return [{ label: 'Schedule Interview', action: 'schedule' as const }];
    case 'Interview Scheduled':
      return [{ label: 'Complete Interview', action: 'complete' as const }];
    case 'Interview Completed':
      return [{ label: 'Approve', action: 'approve' as const }];
    case 'Approved':
      return [{ label: 'Enroll Student', action: 'enroll' as const }];
    default:
      return [];
  }
}

export function applyAdmissionWorkflowAction(admissionId: string, action: 'submit' | 'verify' | 'schedule' | 'complete' | 'approve' | 'enroll' | 'reject') {
  switch (action) {
    case 'submit':
      submitAdmissionApplication(admissionId);
      break;
    case 'verify':
      verifyAdmissionDocuments(admissionId);
      break;
    case 'schedule':
      scheduleAdmissionInterview(admissionId);
      break;
    case 'complete':
      completeAdmissionInterview(admissionId);
      break;
    case 'approve':
      approveAdmission(admissionId);
      break;
    case 'enroll':
      enrollAdmission(admissionId);
      const target = admissionState.find((record) => record.id === admissionId);
      if (target) {
        addNotification({
          title: 'New Student Admission',
          message: `${target.applicantName} • Class ${target.grade.replace('Grade ', '')} • Inventory Allocation Pending`,
          description: `Inventory Allocation Pending for newly enrolled student: ${target.applicantName} (${target.id}). Click details to allocate uniforms, notebooks, bags etc.`,
          type: 'info',
          roles: ['accountant', 'admin', 'super_admin'],
          recipient: 'Accountant',
          branchId: target.branchId,
          notificationType: 'Admission'
        });
      }
      break;
    case 'reject':
      rejectAdmission(admissionId);
      break;
  }
}

export function getAdmissionStats(records: AdmissionRecord[]) {
  return {
    total: records.length,
    inProgress: records.filter((record) => !['Rejected', 'Enrolled'].includes(record.status)).length,
    approved: records.filter((record) => record.status === 'Approved').length,
    enrolled: records.filter((record) => record.status === 'Enrolled').length,
    rejected: records.filter((record) => record.status === 'Rejected').length,
  };
}

export function getAdmissionStatusColor(status: AdmissionStatus) {
  switch (status) {
    case 'Enquiry':
      return 'bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300';
    case 'Application Submitted':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';
    case 'Document Verification':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300';
    case 'Interview Scheduled':
      return 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300';
    case 'Interview Completed':
      return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300';
    case 'Approved':
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300';
    case 'Enrolled':
      return 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400';
    case 'Rejected':
      return 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300';
    default:
      return 'bg-secondary text-muted-foreground';
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
