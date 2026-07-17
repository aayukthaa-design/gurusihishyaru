import { createStore, useStoreValue } from './store';
import { addNotification } from './notificationService';
import { apiFetch } from './apiClient';
import { getStudentsByIds } from './studentService';

export interface StudyMaterial {
  id: number;
  title: string;
  description: string;
  subject: string;
  className: string;
  batch: string;
  branchId: string;
  teacherId: string;
  teacherName: string;
  originalFileName: string;
  fileSize: number;
  mimeType: string;
  createdAt: string;
  updatedAt: string;
}

const materialsStore = createStore<StudyMaterial[]>([]);

export function useMaterials() {
  return useStoreValue(materialsStore);
}

export function getMaterials(): StudyMaterial[] {
  return materialsStore.getState();
}

// Sync from backend — access is scoped server-side from the verified JWT, so this
// only ever returns what the current user is actually allowed to see.
export async function refreshMaterials(user?: any): Promise<StudyMaterial[]> {
  if (!user) return [];
  try {
    const params = new URLSearchParams();
    if (user.branchId) params.set('branchId', user.branchId);
    if (user.role === 'parent' && user.linkedStudentIds?.length) {
      const students = getStudentsByIds(user.linkedStudentIds);
      const classes = Array.from(new Set(students.map((s: any) => s.className)));
      params.set('classNames', classes.join(','));
    }

    const res = await apiFetch(`/api/materials?${params.toString()}`);
    if (!res.ok) throw new Error('Backend failed');
    const data = await res.json();
    if (Array.isArray(data)) {
      materialsStore.setState(data);
      return data;
    }
    return [];
  } catch (e) {
    console.error('Materials refresh failed', e);
    return materialsStore.getState();
  }
}

export async function uploadMaterialAPI(formData: FormData, user: any): Promise<StudyMaterial> {
  const res = await apiFetch('/api/materials', { method: 'POST', body: formData });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Upload failed');
  }
  const created = await res.json();

  addNotification({
    title: 'New Study Material',
    message: `${created.teacherName} shared "${created.title}" for ${created.className}`,
    description: `Subject: ${created.subject}`,
    type: 'info',
    roles: ['parent'],
    classNames: [created.className],
    sender: created.teacherName || 'Teacher',
    notificationType: 'Materials',
    branchId: created.branchId,
  });

  await refreshMaterials(user);
  return created;
}

export async function updateMaterialAPI(id: number, body: Partial<StudyMaterial>, user: any): Promise<StudyMaterial> {
  const res = await apiFetch(`/api/materials/${id}`, { method: 'PUT', body });
  if (!res.ok) throw new Error('Update failed');
  const updated = await res.json();
  await refreshMaterials(user);
  return updated;
}

export async function deleteMaterialAPI(id: number, user: any): Promise<void> {
  const res = await apiFetch(`/api/materials/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Delete failed');
  await refreshMaterials(user);
}

// Material files require an authenticated, ownership-checked download — a plain
// <a href> can't carry the Authorization header, so this fetches as a blob and
// triggers the browser's save dialog via a temporary object URL.
export async function downloadMaterialFile(material: StudyMaterial): Promise<void> {
  const res = await apiFetch(`/api/materials/${material.id}/file`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Download failed');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = material.originalFileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
