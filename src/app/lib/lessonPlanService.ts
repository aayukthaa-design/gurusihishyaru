import { createStore, useStoreValue } from './store';
import { apiFetch } from './apiClient';

export type LessonPlanStatus = 'Planned' | 'In Progress' | 'Completed';

export interface LessonPlan {
  id: number;
  teacherId: string;
  teacherName: string;
  branchId: string;
  className: string;
  batch: string;
  subject: string;
  chapterTitle: string;
  topic: string;
  textbookReference: string;
  plannedDate: string;
  objectives: string;
  notes: string;
  status: LessonPlanStatus;
  createdAt: string;
  updatedAt: string;
}

const lessonPlanStore = createStore<LessonPlan[]>([]);

export function useLessonPlans() {
  return useStoreValue(lessonPlanStore);
}

export function getLessonPlans(): LessonPlan[] {
  return lessonPlanStore.getState();
}

export async function refreshLessonPlans(user?: any): Promise<LessonPlan[]> {
  if (!user) return [];
  try {
    const params = new URLSearchParams();
    if (user.branchId) params.set('branchId', user.branchId);

    const res = await apiFetch(`/api/lesson-plans?${params.toString()}`);
    if (!res.ok) throw new Error('Backend failed');
    const data = await res.json();
    if (Array.isArray(data)) {
      lessonPlanStore.setState(data);
      return data;
    }
    return [];
  } catch (e) {
    console.error('Lesson plans refresh failed', e);
    return lessonPlanStore.getState();
  }
}

export async function createLessonPlanAPI(body: Partial<LessonPlan>, user: any): Promise<LessonPlan> {
  const res = await apiFetch('/api/lesson-plans', { method: 'POST', body });
  if (!res.ok) throw new Error('Create failed');
  const created = await res.json();
  await refreshLessonPlans(user);
  return created;
}

export async function updateLessonPlanAPI(id: number, body: Partial<LessonPlan>, user: any): Promise<LessonPlan> {
  const res = await apiFetch(`/api/lesson-plans/${id}`, { method: 'PUT', body });
  if (!res.ok) throw new Error('Update failed');
  const updated = await res.json();
  await refreshLessonPlans(user);
  return updated;
}

export async function deleteLessonPlanAPI(id: number, user: any): Promise<void> {
  const res = await apiFetch(`/api/lesson-plans/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Delete failed');
  await refreshLessonPlans(user);
}
