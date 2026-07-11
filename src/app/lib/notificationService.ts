import { PDFTemplateService } from './pdfTemplateService';
import { utils, writeFile } from 'xlsx';
import { createStore, useStoreValue } from './store';

const API_BASE = '';
const STORAGE_KEY = 'guru-shishyaru-notifications';

export type NotificationStatus = 'unread' | 'read' | 'deleted' | 'scheduled' | 'expired';
export type NotificationPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  description?: string;
  type: 'success' | 'info' | 'warning' | 'error';
  priority?: NotificationPriority;
  /** Which roles receive this notification */
  roles?: string[];
  /** Which teacher IDs receive this notification */
  teacherIds?: string[];
  /** Which class names this notification is about */
  classNames?: string[];
  /** Specific user IDs */
  userIds?: string[];
  /** Specific student IDs for parent-related notifications */
  studentIds?: string[];
  sender?: string;
  notificationType?: string;
  recipient?: string;
  recipientRole?: string;
  branchId?: string;
  status: NotificationStatus;
  read: boolean;
  createdAt: string;
  readAt?: string | null;
  readBy?: string | null;
  readByRole?: string | null;
  readByBranch?: string | null;
  deletedAt?: string | null;
  deletedBy?: string | null;
  deletedByBranch?: string | null;
  scheduledFor?: string | null;
  expiresAt?: string | null;
}

interface NotificationUserLike {
  id?: string;
  role?: string;
  branchId?: string;
  assignedClassIds?: string[];
  linkedStudentIds?: string[];
}

interface NotificationActor {
  name?: string;
  role?: string;
  branchId?: string;
}

function getStoredNotifications(): AppNotification[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppNotification[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function persistNotifications(notifications: AppNotification[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications));
  } catch {
    // Ignore storage errors (private mode, quota, etc.)
  }
}

function broadcastNotifications(notifications: AppNotification[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications));
  } catch {
    // ignore
  }

  try {
    if ('BroadcastChannel' in window) {
      const channel = new BroadcastChannel('guru-shishyaru-notifications');
      channel.postMessage({ type: 'notifications-sync', notifications });
      channel.close();
    }
  } catch {
    // ignore
  }
}

function getDefaultNotifications(): AppNotification[] {
  return [
  {
    id: 'N001',
    title: 'Welcome to Guru Shishyaru Tutorials',
    message: 'Your account has been set up successfully.',
    description: 'Account setup completed successfully for your institution profile.',
    type: 'success',
    roles: ['teacher', 'admin', 'super_admin', 'accountant', 'parent'],
    status: 'unread',
    priority: 'medium',
    sender: 'System',
    notificationType: 'Account',
    recipient: 'All Users',
    read: false,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'N002',
    title: 'You have been assigned to Class 10A — Mathematics',
    message: 'Admin has allocated you to Class 10A for Mathematics, Batch A. 35 students enrolled.',
    description: 'New class allocation for the current batch.',
    type: 'info',
    roles: ['teacher'],
    teacherIds: ['TCH001'],
    classNames: ['10th A'],
    status: 'unread',
    priority: 'high',
    sender: 'Admin',
    notificationType: 'Allocation',
    recipient: 'Teacher',
    branchId: 'BR001',
    read: false,
    createdAt: new Date(Date.now() - 3_600_000).toISOString(),
  },
  {
    id: 'N003',
    title: 'Timetable updated for Class 9B',
    message: 'Your timetable for Class 9B has been updated by Admin.',
    description: 'Timetable changes were published for the assigned batch.',
    type: 'info',
    roles: ['teacher'],
    teacherIds: ['TCH003'],
    classNames: ['9th A'],
    status: 'read',
    priority: 'medium',
    sender: 'Admin',
    notificationType: 'Timetable',
    recipient: 'Teacher',
    branchId: 'BR001',
    read: true,
    readAt: new Date(Date.now() - 14_400_000).toISOString(),
    readBy: 'Admin User',
    readByRole: 'admin',
    readByBranch: 'BR001',
    createdAt: new Date(Date.now() - 7_200_000).toISOString(),
  },
  {
    id: 'N004',
    title: 'Attendance reminder',
    message: 'Please submit attendance for today\'s classes.',
    description: 'Daily attendance submission reminder for faculty.',
    type: 'warning',
    roles: ['teacher'],
    status: 'scheduled',
    priority: 'high',
    sender: 'System',
    notificationType: 'Reminder',
    recipient: 'Teacher',
    branchId: 'BR001',
    read: false,
    scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
    createdAt: new Date(Date.now() - 1_800_000).toISOString(),
  },
  {
    id: 'N005',
    title: 'Parent meeting scheduled',
    message: 'A parent-teacher meeting has been arranged for tomorrow.',
    description: 'Faculty and parents are invited to the meeting.',
    type: 'info',
    roles: ['parent'],
    status: 'deleted',
    priority: 'medium',
    sender: 'Admin',
    notificationType: 'Meeting',
    recipient: 'Parent',
    branchId: 'BR001',
    read: false,
    deletedAt: new Date(Date.now() - 900_000).toISOString(),
    deletedBy: 'Admin User',
    deletedByBranch: 'BR001',
    createdAt: new Date(Date.now() - 2_400_000).toISOString(),
  },
  ];
}

const store = createStore<AppNotification[]>(getStoredNotifications() ?? getDefaultNotifications());

let counter = 10;
const storedNotifications = getStoredNotifications();
if (storedNotifications?.length) {
  counter = storedNotifications.reduce((highest, notification) => {
    const match = notification.id.match(/N(\d+)/);
    if (!match) return highest;
    const numericValue = Number(match[1]);
    return Math.max(highest, numericValue + 1);
  }, 10);
}

function applyNotificationUpdate(updater: (prev: AppNotification[]) => AppNotification[]): void {
  store.setState((prev) => {
    const next = updater(prev);
    persistNotifications(next);
    broadcastNotifications(next);
    return next;
  });
}

async function fetchNotificationsFromBackend(user?: NotificationUserLike | null): Promise<AppNotification[] | null> {
  if (typeof window === 'undefined') return null;
  try {
    const params = new URLSearchParams();
    if (user?.id) params.set('userId', user.id);
    if (user?.role) params.set('role', user.role);
    if (user?.branchId) params.set('branchId', user.branchId);
    if (user?.assignedClassIds?.length) params.set('classNames', user.assignedClassIds.join(','));
    if (user?.linkedStudentIds?.length) params.set('studentIds', user.linkedStudentIds.join(','));
    const response = await fetch(`${API_BASE}/api/notifications?${params.toString()}`);
    if (!response.ok) throw new Error('backend unavailable');
    const data = await response.json();
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

async function syncFromBackend(user?: NotificationUserLike | null): Promise<void> {
  const backendNotifications = await fetchNotificationsFromBackend(user);
  if (backendNotifications) {
    const unique = backendNotifications.filter((notification, index, list) => list.findIndex((entry) => entry.id === notification.id) === index);
    store.setState(unique);
    persistNotifications(unique);
    broadcastNotifications(unique);
  }
}

async function pushNotificationToBackend(notification: AppNotification): Promise<void> {
  try {
    const response = await fetch(`${API_BASE}/api/notifications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...notification,
        id: notification.id,
        sender: notification.sender ?? 'System',
        notificationType: notification.notificationType ?? notification.type,
        recipient: notification.recipient ?? 'All',
        recipientRole: notification.readByRole ?? '',
        branchId: notification.branchId ?? null,
      }),
    });
    if (!response.ok) throw new Error('backend unavailable');
  } catch {
    persistNotifications(getNotifications());
  }
}

async function applyMutationToBackend(id: string, action: 'read' | 'delete' | 'restore', payload?: Record<string, string | null>): Promise<void> {
  try {
    let response: Response;
    if (action === 'read') {
      response = await fetch(`${API_BASE}/api/notifications/${id}/read`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {}),
      });
    } else if (action === 'delete') {
      response = await fetch(`${API_BASE}/api/notifications/${id}/delete`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {}),
      });
    } else {
      response = await fetch(`${API_BASE}/api/notifications/${id}/restore`, { method: 'PATCH' });
    }
    if (!response.ok) throw new Error('backend unavailable');
  } catch {
    persistNotifications(getNotifications());
  }
}

async function applyBulkMutationToBackend(ids: string[], action: 'read' | 'delete', payload?: Record<string, string | null>): Promise<void> {
  try {
    const response = await fetch(`${API_BASE}/api/notifications/bulk/${action}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, ...payload }),
    });
    if (!response.ok) throw new Error('backend unavailable');
  } catch {
    persistNotifications(getNotifications());
  }
}

function normalizeNotificationStatus(status?: AppNotification['status']): AppNotification['status'] {
  return status ?? 'unread';
}

export function addNotification(
  notif: Omit<AppNotification, 'id' | 'read' | 'createdAt' | 'status'> & {
    status?: AppNotification['status'];
  }
): void {
  const now = new Date().toISOString();
  const newNotif: AppNotification = {
    ...notif,
    id: `N${String(++counter).padStart(3, '0')}`,
    status: normalizeNotificationStatus(notif.status),
    read: notif.status === 'read',
    createdAt: now,
  };
  applyNotificationUpdate((prev) => [newNotif, ...prev]);
  void pushNotificationToBackend(newNotif);
}

export function markNotificationAsRead(id: string, actor?: NotificationActor): void {
  const timestamp = new Date().toISOString();
  applyNotificationUpdate((prev) =>
    prev.map((notification) => {
      if (notification.id !== id || notification.status === 'deleted') return notification;
      return {
        ...notification,
        status: 'read',
        read: true,
        readAt: timestamp,
        readBy: actor?.name ?? 'System',
        readByRole: actor?.role ?? 'system',
        readByBranch: actor?.branchId ?? notification.branchId ?? null,
      };
    })
  );
  void applyMutationToBackend(id, 'read', {
    readAt: timestamp,
    readBy: actor?.name ?? 'System',
    readByRole: actor?.role ?? 'system',
    readByBranch: actor?.branchId ?? null,
  });
}

export function markAllRead(actor?: NotificationActor): void {
  const timestamp = new Date().toISOString();
  const current = getNotifications();
  const ids = current.filter((notification) => notification.status !== 'deleted' && notification.status !== 'read').map((notification) => notification.id);
  applyNotificationUpdate((prev) => prev.map((notification) => {
    if (notification.status === 'deleted' || notification.status === 'read') return notification;
    return {
      ...notification,
      status: 'read',
      read: true,
      readAt: timestamp,
      readBy: actor?.name ?? 'System',
      readByRole: actor?.role ?? 'system',
      readByBranch: actor?.branchId ?? notification.branchId ?? null,
    };
  }));
  if (ids.length) {
    void applyBulkMutationToBackend(ids, 'read', {
      readAt: timestamp,
      readBy: actor?.name ?? 'System',
      readByRole: actor?.role ?? 'system',
      readByBranch: actor?.branchId ?? null,
    });
  }
}

export function deleteNotification(id: string, actor?: NotificationActor): void {
  const timestamp = new Date().toISOString();
  applyNotificationUpdate((prev) => prev.map((notification) => {
    if (notification.id !== id) return notification;
    return {
      ...notification,
      status: 'deleted',
      read: false,
      deletedAt: timestamp,
      deletedBy: actor?.name ?? 'System',
      deletedByBranch: actor?.branchId ?? notification.branchId ?? null,
    };
  }));
  void applyMutationToBackend(id, 'delete', {
    deletedAt: timestamp,
    deletedBy: actor?.name ?? 'System',
    deletedByBranch: actor?.branchId ?? null,
  });
}

export function restoreNotification(id: string): void {
  applyNotificationUpdate((prev) => prev.map((notification) => {
    if (notification.id !== id) return notification;
    return {
      ...notification,
      status: 'unread',
      read: false,
      deletedAt: null,
      deletedBy: null,
      deletedByBranch: null,
    };
  }));
  void applyMutationToBackend(id, 'restore');
}

export function subscribeNotifications(
  listener: (notifications: AppNotification[]) => void
): () => void {
  return store.subscribe(listener);
}

export function useNotifications(): AppNotification[] {
  return useStoreValue(store);
}

export function getNotifications(): AppNotification[] {
  return store.getState();
}

export function getVisibleNotificationsForUser(
  notifications: AppNotification[],
  user?: NotificationUserLike | null
): AppNotification[] {
  if (!user) return notifications;

  return notifications.filter((notification) => {
    if (user.role === 'super_admin') return true;

    const explicitRoles = notification.roles ?? [];
    if (explicitRoles.length > 0 && !explicitRoles.includes(user.role ?? '') && !explicitRoles.includes('all') && !explicitRoles.includes('everyone')) {
      return false;
    }

    if (notification.userIds?.includes(user.id ?? '')) return true;
    if (notification.teacherIds?.includes(user.id ?? '')) return true;
    if (notification.studentIds?.some((studentId) => user.linkedStudentIds?.includes(studentId))) return true;

    if (user.role === 'teacher') {
      const assignedClasses = user.assignedClassIds ?? [];
      if (notification.classNames?.some((className) => assignedClasses.includes(className))) return true;
      if (explicitRoles.includes('teacher')) return true;
      return false;
    }

    if (user.role === 'parent') {
      if (notification.classNames?.length && (user.linkedStudentIds?.length ?? 0) > 0) return true;
      if (explicitRoles.includes('parent')) return true;
      return false;
    }

    if (user.role === 'admin' || user.role === 'accountant') {
      return !notification.branchId || notification.branchId === user.branchId;
    }

    return true;
  });
}

export function getNotificationStats(
  notifications: AppNotification[],
  user?: NotificationUserLike | null
) {
  const scoped = getVisibleNotificationsForUser(notifications, user);

  return {
    total: scoped.length,
    unread: scoped.filter((notification) => notification.status === 'unread').length,
    read: scoped.filter((notification) => notification.status === 'read').length,
    deleted: scoped.filter((notification) => notification.status === 'deleted').length,
    scheduled: scoped.filter((notification) => notification.status === 'scheduled').length,
  };
}

export function clearNotifications(actor?: NotificationActor): void {
  const timestamp = new Date().toISOString();
  const current = getNotifications();
  const ids = current.filter((notification) => notification.status !== 'deleted').map((notification) => notification.id);
  applyNotificationUpdate((prev) => prev.map((notification) => {
    if (notification.status === 'deleted') return notification;
    return {
      ...notification,
      status: 'deleted',
      read: false,
      deletedAt: timestamp,
      deletedBy: actor?.name ?? 'System',
      deletedByBranch: actor?.branchId ?? notification.branchId ?? null,
    };
  }));
  if (ids.length) {
    void applyBulkMutationToBackend(ids, 'delete', {
      deletedAt: timestamp,
      deletedBy: actor?.name ?? 'System',
      deletedByBranch: actor?.branchId ?? null,
    });
  }
}

export async function refreshNotifications(user?: NotificationUserLike | null): Promise<AppNotification[]> {
  const backendNotifications = await fetchNotificationsFromBackend(user);
  if (backendNotifications) {
    const unique = backendNotifications.filter((notification, index, list) => list.findIndex((entry) => entry.id === notification.id) === index);
    store.setState(unique);
    persistNotifications(unique);
    broadcastNotifications(unique);
    return unique;
  }
  return getNotifications();
}

export async function exportNotificationsReport(
  format: 'pdf' | 'excel',
  notifications: AppNotification[],
  user?: NotificationUserLike | null
): Promise<void> {
  const scoped = getVisibleNotificationsForUser(notifications, user);
  const rows = scoped.map((notification) => ({
    title: notification.title,
    description: notification.message,
    notificationType: notification.notificationType ?? notification.type,
    priority: notification.priority ?? 'medium',
    sentBy: notification.sender ?? 'System',
    sentTo: notification.recipient ?? notification.roles?.join(', ') ?? 'All',
    branch: notification.branchId ?? 'All Branches',
    dateSent: notification.createdAt,
    dateRead: notification.readAt ?? '',
    readBy: notification.readBy ?? '',
    status: notification.status,
    deletedDate: notification.deletedAt ?? '',
    deletedBy: notification.deletedBy ?? '',
  }));

  if (format === 'excel') {
    const workbook = utils.book_new();
    const worksheet = utils.json_to_sheet(rows);
    utils.book_append_sheet(workbook, worksheet, 'Notifications');
    writeFile(workbook, `notifications-report-${new Date().toISOString().slice(0, 10)}.xlsx`);
    return;
  }

  const pdfService = new PDFTemplateService('p');
  pdfService.addTitle('Notification Audit Report');
  
  const headers = ['Title', 'Status', 'Type', 'Priority', 'Sent To', 'Branch', 'Sent Date'];
  const body = rows.map(row => [
    row.title,
    row.status,
    row.notificationType,
    row.priority,
    row.sentTo,
    row.branch,
    new Date(row.dateSent).toLocaleString('en-IN')
  ]);
  
  pdfService.addTable([headers], body);
  await pdfService.exportWithLetterhead(`notifications-report-${new Date().toISOString().slice(0, 10)}.pdf`);
}

export function markRead(id: string): void {
  markNotificationAsRead(id);
}
