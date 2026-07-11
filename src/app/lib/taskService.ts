import { addNotification } from './notificationService';
import { getBranchName } from './branchService';
import { apiFetch } from './apiClient';

export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

export interface TaskRecord {
  id: string;
  title: string;
  description?: string;
  teacherId?: string; // assigned teacher id
  teacherName?: string;
  branchId?: string;
  priority?: TaskPriority;
  dueDate?: string; // yyyy-mm-dd
  dueTime?: string; // HH:MM
  relatedClass?: string;
  relatedSubject?: string;
  attachmentUrl?: string;
  status: 'pending' | 'in-progress' | 'completed';
  progress?: number; // 0-100
  completionRemarks?: string;
  createdAt: string;
  updatedAt: string;
}

let taskState: TaskRecord[] = [];
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export async function refreshTasks(params: { branchId?: string; teacherId?: string } = {}): Promise<TaskRecord[]> {
  try {
    const query = new URLSearchParams();
    if (params.branchId) query.set('branchId', params.branchId);
    if (params.teacherId) query.set('teacherId', params.teacherId);
    const res = await apiFetch(`/api/teacher-tasks?${query.toString()}`);
    if (res.ok) {
      const data = await res.json();
      taskState = Array.isArray(data) ? data : [];
      emit();
      return taskState;
    }
  } catch (err) {
    console.error('Failed to fetch teacher tasks:', err);
  }
  return taskState;
}

// Initial load
void refreshTasks();

export function getTasks(): TaskRecord[] {
  return taskState;
}

export function subscribeTasks(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function createTask(payload: Omit<TaskRecord, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'progress'>): Promise<TaskRecord | null> {
  try {
    const res = await apiFetch('/api/teacher-tasks', { method: 'POST', body: payload });
    if (!res.ok) return null;
    const task = await res.json();
    await refreshTasks();

    if (task.teacherId) {
      addNotification({
        title: 'New Task Assigned',
        message: `${task.title} has been assigned to you${task.branchId ? ` (${getBranchName(task.branchId)})` : ''}`,
        type: 'info',
        teacherIds: [task.teacherId],
        roles: ['teacher'],
        branchId: task.branchId ?? null,
      });
    }

    return task;
  } catch (err) {
    console.error('createTask error:', err);
    return null;
  }
}

export async function updateTask(taskId: string, updates: Partial<TaskRecord>): Promise<void> {
  try {
    const res = await apiFetch(`/api/teacher-tasks/${taskId}`, { method: 'PUT', body: updates });
    if (res.ok) {
      await refreshTasks();
    }
  } catch (err) {
    console.error('updateTask error:', err);
  }
}

export async function deleteTask(taskId: string): Promise<void> {
  try {
    const res = await apiFetch(`/api/teacher-tasks/${taskId}`, { method: 'DELETE' });
    if (res.ok) {
      await refreshTasks();
    }
  } catch (err) {
    console.error('deleteTask error:', err);
  }
}

export function getTasksForTeacher(teacherId?: string, branchId?: string) {
  return taskState.filter((t) => (teacherId ? t.teacherId === teacherId : true) && (branchId ? t.branchId === branchId : true));
}

export function getTaskStats(tasks?: TaskRecord[]) {
  const list = tasks ?? taskState;
  return {
    total: list.length,
    pending: list.filter((t) => t.status === 'pending').length,
    inProgress: list.filter((t) => t.status === 'in-progress').length,
    completed: list.filter((t) => t.status === 'completed').length,
  };
}

export function assignTask(taskId: string, teacherId?: string, teacherName?: string) {
  void updateTask(taskId, { teacherId, teacherName }).then(() => {
    const task = taskState.find((t) => t.id === taskId);
    if (task && teacherId) {
      addNotification({
        title: 'Task Assigned',
        message: `${task.title} was assigned to you`,
        type: 'info',
        teacherIds: [teacherId],
        roles: ['teacher'],
        branchId: task.branchId ?? null,
      });
    }
  });
}

export function setTaskProgress(taskId: string, progress: number, remarks?: string) {
  const status = progress >= 100 ? 'completed' : progress > 0 ? 'in-progress' : 'pending';
  void updateTask(taskId, { progress, status, completionRemarks: remarks }).then(() => {
    const task = taskState.find((t) => t.id === taskId);
    if (task && status === 'completed') {
      addNotification({
        title: 'Task Completed',
        message: `${task.title} marked completed by ${task.teacherName ?? 'teacher'}`,
        type: 'success',
        roles: ['admin', 'super_admin'],
        branchId: task.branchId ?? null,
      });
    }
  });
}

export function exportTasksCSV(tasks?: TaskRecord[]) {
  const list = tasks ?? taskState;
  const header = ['ID','Title','Teacher','Branch','Priority','Due Date','Due Time','Class','Subject','Status','Progress','Created At'];
  const rows = list.map((t) => [t.id, t.title, t.teacherName ?? '', t.branchId ?? '', t.priority ?? '', t.dueDate ?? '', t.dueTime ?? '', t.relatedClass ?? '', t.relatedSubject ?? '', t.status, String(t.progress ?? 0), t.createdAt]);
  const csv = [header, ...rows].map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tasks-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default {
  getTasks,
  subscribeTasks,
  createTask,
  updateTask,
  deleteTask,
  getTasksForTeacher,
  getTaskStats,
  assignTask,
  setTaskProgress,
  exportTasksCSV,
};
