import { addNotification } from './notificationService';
import { getBranchName } from './branchService';

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

const STORAGE_KEY = 'guru_teacher_tasks';

let taskState: TaskRecord[] = [];
const listeners = new Set<() => void>();

function loadTasks(): TaskRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as TaskRecord[];
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    // ignore
  }
  return [];
}

function persist() {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(taskState));
}

function emit() {
  listeners.forEach((l) => l());
}

taskState = loadTasks();

export function getTasks(): TaskRecord[] {
  return taskState;
}

export function subscribeTasks(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function createTask(payload: Omit<TaskRecord, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'progress'>) {
  const task: TaskRecord = {
    ...payload,
    id: `T${String(Date.now())}`,
    status: 'pending',
    progress: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as TaskRecord;
  taskState = [task, ...taskState];
  persist();
  emit();

  // Notify assigned teacher
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
}

export function updateTask(taskId: string, updates: Partial<TaskRecord>) {
  taskState = taskState.map((t) => (t.id === taskId ? { ...t, ...updates, updatedAt: new Date().toISOString() } : t));
  persist();
  emit();
}

export function deleteTask(taskId: string) {
  taskState = taskState.filter((t) => t.id !== taskId);
  persist();
  emit();
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
  updateTask(taskId, { teacherId, teacherName });
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
}

export function setTaskProgress(taskId: string, progress: number, remarks?: string) {
  const status = progress >= 100 ? 'completed' : progress > 0 ? 'in-progress' : 'pending';
  updateTask(taskId, { progress, status, completionRemarks: remarks });
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
