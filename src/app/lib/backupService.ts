import { apiFetch } from './apiClient';

export interface BackupRecord {
  id: number;
  filename: string;
  sizeBytes: number;
  createdAt: string;
  createdBy: string;
  type: 'manual' | 'pre_restore_auto';
  status: 'success' | 'failed';
}

export async function fetchBackupHistory(): Promise<BackupRecord[]> {
  const res = await apiFetch('/api/backup/history');
  if (!res.ok) throw new Error('Failed to load backup history');
  return res.json();
}

export async function createBackup(): Promise<BackupRecord> {
  const res = await apiFetch('/api/backup/create', { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Backup creation failed');
  }
  return res.json();
}

// Requires an auth header, so this fetches as a blob rather than using a plain <a href>.
export async function downloadBackup(record: BackupRecord): Promise<void> {
  const res = await apiFetch(`/api/backup/${record.id}/download`);
  if (!res.ok) throw new Error('Download failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = record.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function deleteBackup(id: number): Promise<void> {
  const res = await apiFetch(`/api/backup/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Delete failed');
}

// The most destructive operation in the app — the caller must have already
// confirmed with the user (typed confirmation phrase) before calling this.
export async function restoreBackup(file: File): Promise<{ success: boolean; message: string }> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('confirm', 'true');
  const res = await apiFetch('/api/backup/restore', { method: 'POST', body: formData });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Restore failed');
  return data;
}

export function formatBackupSize(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}
