import { apiFetch } from './apiClient';
import { createStore, useStoreValue } from './store';

export interface TimetableEntry {
  id: number;
  className: string;
  dayOfWeek: string;
  period: string;
  subject: string;
  teacherId: string | null;
  teacherName: string | null;
  room: string;
  branchId?: string | null;
  startTime?: string;
  endTime?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface TimetableFilter {
  className?: string;
  branchId?: string;
}

export interface TimetableEntryInput {
  className: string;
  dayOfWeek: string;
  startTime?: string;
  endTime?: string;
  /** Legacy fixed-slot label — kept for entries that predate free start/end times. */
  period?: string;
  subject?: string;
  teacherId?: string;
  teacherName?: string;
  room?: string;
  notes?: string;
  branchId?: string;
}

// Shared reactive store (see store.ts) so Timetable.tsx and TeacherPortal.tsx
// both see live updates without a manual refresh. Only one filtered view is
// visible at a time in this app (different routes), so a single shared
// current-filter store is sufficient rather than per-component caches.
const timetableStore = createStore<TimetableEntry[]>([]);
let currentFilter: TimetableFilter = {};

export async function refreshTimetable(filter: TimetableFilter = currentFilter): Promise<TimetableEntry[]> {
  currentFilter = filter;
  try {
    const params = new URLSearchParams();
    if (filter.className) params.set('className', filter.className);
    if (filter.branchId) params.set('branchId', filter.branchId);
    const qs = params.toString();
    const res = await apiFetch(`/api/timetable${qs ? `?${qs}` : ''}`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        timetableStore.setState(data);
        return data;
      }
    }
  } catch (e) {
    console.error('Failed to fetch timetable:', e);
  }
  return timetableStore.getState();
}

export function getTimetable(): TimetableEntry[] {
  return timetableStore.getState();
}

export function useTimetable(): TimetableEntry[] {
  return useStoreValue(timetableStore);
}

export async function saveTimetableEntry(input: TimetableEntryInput): Promise<{ success: boolean; error?: string; entry?: TimetableEntry }> {
  try {
    const res = await apiFetch('/api/timetable', { method: 'POST', body: input });
    if (res.ok) {
      const entry: TimetableEntry = await res.json();
      await refreshTimetable();
      return { success: true, entry };
    }
    const data = await res.json().catch(() => ({}));
    return { success: false, error: data.error || 'Unable to save timetable entry.' };
  } catch (err) {
    console.error('saveTimetableEntry error:', err);
    return { success: false, error: 'Connection to server failed. Please try again.' };
  }
}

export async function deleteTimetableEntry(id: number): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await apiFetch(`/api/timetable/${id}`, { method: 'DELETE' });
    if (res.ok) {
      await refreshTimetable();
      return { success: true };
    }
    const data = await res.json().catch(() => ({}));
    return { success: false, error: data.error || 'Unable to delete timetable entry.' };
  } catch (err) {
    console.error('deleteTimetableEntry error:', err);
    return { success: false, error: 'Connection to server failed. Please try again.' };
  }
}

/** "HH:MM-HH:MM" if both times are set, else falls back to the legacy period label. */
export function displayTimeRange(entry: TimetableEntry): string {
  if (entry.startTime && entry.endTime) return `${entry.startTime}-${entry.endTime}`;
  return entry.period || '';
}

/** Sorts by start time (falling back to the legacy period label) for a stable, chronological list. */
export function sortByTime(entries: TimetableEntry[]): TimetableEntry[] {
  return [...entries].sort((a, b) => displayTimeRange(a).localeCompare(displayTimeRange(b)));
}
