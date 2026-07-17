import { createStore, useStoreValue } from './store';
import { apiFetch } from './apiClient';

export type EventStatus = 'Scheduled' | 'Cancelled' | 'Completed';

export interface EventRecord {
  id: number;
  title: string;
  description: string;
  eventType: string;
  date: string;
  time: string;
  venue: string;
  expectedAttendees: number;
  branchId: string;
  createdBy: string;
  createdByName: string;
  status: EventStatus;
  createdAt: string;
  updatedAt: string;
}

const eventsStore = createStore<EventRecord[]>([]);

export function useEvents() {
  return useStoreValue(eventsStore);
}

export async function refreshEvents(user?: any): Promise<EventRecord[]> {
  if (!user) return [];
  try {
    const params = new URLSearchParams();
    if (user.branchId) params.set('branchId', user.branchId);
    const res = await apiFetch(`/api/events?${params.toString()}`);
    if (!res.ok) throw new Error('Backend failed');
    const data = await res.json();
    if (Array.isArray(data)) {
      eventsStore.setState(data);
      return data;
    }
    return [];
  } catch (e) {
    console.error('Events refresh failed', e);
    return eventsStore.getState();
  }
}

export async function createEventAPI(body: Partial<EventRecord>, user: any): Promise<EventRecord> {
  const res = await apiFetch('/api/events', { method: 'POST', body });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to create event');
  }
  const created = await res.json();
  await refreshEvents(user);
  return created;
}

export async function updateEventAPI(id: number, body: Partial<EventRecord>, user: any): Promise<EventRecord> {
  const res = await apiFetch(`/api/events/${id}`, { method: 'PUT', body });
  if (!res.ok) throw new Error('Failed to update event');
  const updated = await res.json();
  await refreshEvents(user);
  return updated;
}

export async function deleteEventAPI(id: number, user: any): Promise<void> {
  const res = await apiFetch(`/api/events/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete event');
  await refreshEvents(user);
}
