import { Bell, Check, Clock3, FileDown, Info, MailOpen, MessageCircle, Search, Trash2, Plus, Send } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import React from 'react';
import {
  clearNotifications,
  deleteNotification,
  exportNotificationsReport,
  fetchNotificationReads,
  getNotificationStats,
  getVisibleNotificationsForUser,
  isUnreadForMe,
  markAllRead,
  markNotificationAsRead,
  refreshNotifications,
  refreshSentNotifications,
  restoreNotification,
  sendComposedNotification,
  useNotifications,
  useSentNotifications,
  type NotificationAudience,
  type NotificationReadEntry,
} from '../lib/notificationService';
import { useAuth } from '../auth/AuthContext';
import { sendBirthdayWhatsAppWish } from '../lib/birthdayService';
import type { Role } from '../auth/types';

function formatDateTime(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

// ─── Role-aware compose audiences ──────────────────────────────────────────
// Matches exactly what each role is allowed to send to (server-enforced —
// see AUDIENCE_ALLOWED_ROLES in server.js). No branch/class/teacher picker
// is shown anywhere here: branch, assigned batches, and assigned teacher are
// always resolved server-side from the sender's own account, never chosen
// by hand.
const AUDIENCE_OPTIONS_BY_ROLE: Partial<Record<Role, { value: NotificationAudience; label: string }[]>> = {
  super_admin: [
    { value: 'all_users', label: 'All Users' },
    { value: 'all_admins', label: 'All Admins' },
    { value: 'all_teachers', label: 'All Teachers' },
    { value: 'all_parents', label: 'All Parents' },
    { value: 'all_accountants', label: 'All Accountants' },
  ],
  admin: [
    { value: 'branch_teachers', label: 'All Teachers in My Branch' },
    { value: 'branch_parents', label: 'All Parents in My Branch' },
    { value: 'branch_accountants', label: 'All Accountants in My Branch' },
    { value: 'to_super_admin', label: 'Super Admin' },
  ],
  teacher: [
    { value: 'my_batch_parents', label: 'All Parents of My Assigned Batches' },
    { value: 'branch_admin', label: 'Admin of My Branch' },
    { value: 'to_super_admin', label: 'Super Admin' },
  ],
  parent: [
    { value: 'my_assigned_teacher', label: 'Assigned Teacher' },
    { value: 'branch_admin', label: 'Admin of My Branch' },
    { value: 'to_super_admin', label: 'Super Admin' },
  ],
  accountant: [
    { value: 'branch_admin', label: 'Admin of My Branch' },
    { value: 'to_super_admin', label: 'Super Admin' },
  ],
};

const AUDIENCE_LABELS: Record<string, string> = Object.fromEntries(
  Object.values(AUDIENCE_OPTIONS_BY_ROLE).flat().filter(Boolean).map((opt) => [opt!.value, opt!.label])
);

export function NotificationsPage() {
  const notifications = useNotifications();
  const sentNotifications = useSentNotifications();
  const auth = useAuth();
  const [search, setSearch] = React.useState('');
  const [filter, setFilter] = React.useState<'all' | 'unread' | 'deleted'>('all');
  const [mailbox, setMailbox] = React.useState<'inbox' | 'sent'>('inbox');
  const [composerOpen, setComposerOpen] = React.useState(false);
  const audienceOptions = (auth.user?.role && AUDIENCE_OPTIONS_BY_ROLE[auth.user.role]) || [];
  const [composeForm, setComposeForm] = React.useState({
    title: '',
    message: '',
    description: '',
    audience: (audienceOptions[0]?.value ?? '') as NotificationAudience | '',
    notificationType: 'General Announcement',
    priority: 'medium',
    schedule: '',
  });
  const [sendError, setSendError] = React.useState<string | null>(null);
  const [sending, setSending] = React.useState(false);

  const scopedNotifications = React.useMemo(
    () => getVisibleNotificationsForUser(notifications, auth.user),
    [notifications, auth.user]
  );

  const stats = React.useMemo(() => getNotificationStats(scopedNotifications, auth.user), [scopedNotifications, auth.user]);

  const visibleNotifications = React.useMemo(() => {
    const query = search.trim().toLowerCase();
    return scopedNotifications.filter((notification) => {
      if (filter === 'unread' && !isUnreadForMe(notification)) return false;
      if (filter === 'deleted' && notification.status !== 'deleted') return false;
      if (!query) return true;

      const haystack = [
        notification.title,
        notification.message,
        notification.description,
        notification.recipient,
        notification.branchId,
        notification.notificationType,
        notification.sender,
        notification.createdAt,
        notification.readAt,
        notification.deletedAt,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [filter, scopedNotifications, search]);

  React.useEffect(() => {
    void refreshNotifications(auth.user);
    void refreshSentNotifications();
  }, [auth.user]);

  const isStaff = auth.user?.role === 'admin' || auth.user?.role === 'super_admin' || auth.user?.role === 'accountant';
  const isTeacher = auth.user?.role === 'teacher';
  // Teachers can see read-receipts for Materials notifications specifically
  // (did parents see the study material I posted) — matches the backend's
  // narrower allowance at GET /api/notifications/:id/reads.
  const canSeeReadsFor = (notification: { notificationType?: string }) => isStaff || (isTeacher && notification.notificationType === 'Materials');
  const [expandedReadsId, setExpandedReadsId] = React.useState<string | null>(null);
  const [readsDetail, setReadsDetail] = React.useState<{ readCount: number; totalRecipients: number; reads: NotificationReadEntry[] } | null>(null);
  const [loadingReads, setLoadingReads] = React.useState(false);

  const toggleReadsDetail = async (id: string) => {
    if (expandedReadsId === id) {
      setExpandedReadsId(null);
      setReadsDetail(null);
      return;
    }
    setExpandedReadsId(id);
    setReadsDetail(null);
    setLoadingReads(true);
    const detail = await fetchNotificationReads(id);
    setReadsDetail(detail);
    setLoadingReads(false);
  };

  const handleSendBirthdayWish = (notification: { studentIds?: string[]; teacherIds?: string[] }) => {
    const studentId = notification.studentIds?.[0];
    const teacherId = notification.teacherIds?.[0];
    const result = studentId
      ? sendBirthdayWhatsAppWish('student', studentId)
      : teacherId
        ? sendBirthdayWhatsAppWish('teacher', teacherId)
        : { success: false, error: 'No student or teacher linked to this notification.' };
    if (!result.success) alert(result.error);
  };

  const activeNotifications = visibleNotifications.filter((notification) => isUnreadForMe(notification) || notification.status === 'scheduled');
  const historyNotifications = visibleNotifications.filter((notification) => (!isUnreadForMe(notification) && notification.status !== 'scheduled') || notification.status === 'deleted' || notification.status === 'expired');

  const resetComposeForm = () => setComposeForm({
    title: '', message: '', description: '',
    audience: (audienceOptions[0]?.value ?? '') as NotificationAudience | '',
    notificationType: 'General Announcement', priority: 'medium', schedule: '',
  });

  const handleSendNotification = async () => {
    if (!auth.user || !composeForm.title.trim() || !composeForm.message.trim() || !composeForm.audience) return;
    setSending(true);
    setSendError(null);
    const result = await sendComposedNotification({
      title: composeForm.title,
      message: composeForm.message,
      description: composeForm.description,
      priority: composeForm.priority as 'high' | 'medium' | 'low',
      notificationType: composeForm.notificationType,
      audience: composeForm.audience,
      scheduledFor: composeForm.schedule || null,
    });
    setSending(false);
    if (!result.success) {
      setSendError(result.error || 'Failed to send notification.');
      return;
    }
    void refreshSentNotifications();
    setComposerOpen(false);
    resetComposeForm();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Notification Center</h1>
        <p className="text-muted-foreground">Manage lifecycle events, history, and audit-ready reports.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-5">
        <Card className="transition-all duration-300 hover:shadow-lg">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total</CardTitle>
            <Bell className="h-5 w-5 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        <Card className="transition-all duration-300 hover:shadow-lg">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Unread</CardTitle>
            <MailOpen className="h-5 w-5 text-chart-4" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.unread}</div>
          </CardContent>
        </Card>
        <Card className="transition-all duration-300 hover:shadow-lg">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Read</CardTitle>
            <Check className="h-5 w-5 text-chart-3" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.read}</div>
          </CardContent>
        </Card>
        <Card className="transition-all duration-300 hover:shadow-lg">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Deleted</CardTitle>
            <Trash2 className="h-5 w-5 text-rose-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.deleted}</div>
          </CardContent>
        </Card>
        <Card className="transition-all duration-300 hover:shadow-lg">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Scheduled</CardTitle>
            <Clock3 className="h-5 w-5 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.scheduled}</div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <Button onClick={() => setComposerOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Compose Notification
          </Button>
          <div className="flex rounded-xl border border-border overflow-hidden">
            {(['inbox', 'sent'] as const).map((value) => (
              <button
                key={value}
                onClick={() => setMailbox(value)}
                className={`px-3 py-2 text-sm font-medium capitalize transition-colors ${mailbox === value ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-secondary'}`}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
        {mailbox === 'inbox' && (
          <div className="flex flex-wrap gap-2">
            {(['all', 'unread', 'deleted'] as const).map((value) => (
              <Button
                key={value}
                size="sm"
                variant={filter === value ? 'default' : 'outline'}
                onClick={() => setFilter(value)}
                className="capitalize"
              >
                {value}
              </Button>
            ))}
          </div>
        )}
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          {mailbox === 'inbox' && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search title, recipient, branch, sender..."
                className="w-full min-w-[260px] pl-9"
              />
            </div>
          )}
          {mailbox === 'inbox' && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => markAllRead(auth.user ?? undefined)}>
                <Check className="mr-2 h-4 w-4" />
                Mark All as Read
              </Button>
              <Button variant="outline" size="sm" onClick={() => clearNotifications(auth.user ?? undefined)}>
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Visible
              </Button>
              <Button variant="outline" size="sm" onClick={() => exportNotificationsReport('pdf', visibleNotifications, auth.user)}>
                <FileDown className="mr-2 h-4 w-4" />
                PDF
              </Button>
            </div>
          )}
        </div>
      </div>

      {mailbox === 'sent' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Sent Notifications</h3>
            <p className="text-sm text-muted-foreground">Everything you've sent, with delivery and read counts.</p>
          </div>
          <div className="space-y-3">
            {sentNotifications.length === 0 && (
              <Card>
                <CardContent className="py-8 text-center text-sm text-muted-foreground">You haven't sent any notifications yet.</CardContent>
              </Card>
            )}
            {sentNotifications.map((notification) => (
              <Card key={notification.id} className="transition-all duration-300 hover:shadow-lg">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 space-y-1">
                      <CardTitle className="text-base">{notification.title}</CardTitle>
                      <CardDescription>{notification.message}</CardDescription>
                    </div>
                    <Badge variant="outline" className="h-5 px-1.5 text-[10px] uppercase">{notification.status}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-2 pb-4 text-xs text-muted-foreground md:flex-row md:items-center md:justify-between">
                  <div className="space-y-1">
                    <p>Sent: {formatDateTime(notification.createdAt)}</p>
                    <p>To: {AUDIENCE_LABELS[notification.audience ?? ''] ?? notification.recipient ?? 'Custom'}</p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => toggleReadsDetail(notification.id)}>
                    <MailOpen className="mr-1 h-3 w-3" />
                    {notification.readCount ?? 0} of {notification.totalRecipients ?? '?'} read
                  </Button>
                </CardContent>
                {expandedReadsId === notification.id && (
                  <CardContent className="border-t border-border pt-4">
                    {loadingReads ? (
                      <p className="text-sm text-muted-foreground">Loading…</p>
                    ) : readsDetail ? (
                      readsDetail.reads.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No one has read this yet.</p>
                      ) : (
                        <ul className="space-y-1">
                          {readsDetail.reads.map((r) => (
                            <li key={r.userId} className="flex items-center justify-between text-xs text-muted-foreground">
                              <span>{r.userName} <span className="text-muted-foreground/70">({r.userRole})</span></span>
                              <span>{formatDateTime(r.readAt)}</span>
                            </li>
                          ))}
                        </ul>
                      )
                    ) : (
                      <p className="text-sm text-muted-foreground">Failed to load read receipts.</p>
                    )}
                  </CardContent>
                )}
              </Card>
            ))}
          </div>
        </div>
      )}

      {mailbox === 'inbox' && (
      <>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Active Notifications</h3>
          <p className="text-sm text-muted-foreground">Unread and scheduled items are shown here until they are archived.</p>
        </div>
        <div className="space-y-3">
          {activeNotifications.length === 0 && (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">No active notifications match your current scope.</CardContent>
            </Card>
          )}
          {activeNotifications.map((notification) => (
            <Card key={notification.id} className={`transition-all duration-300 hover:shadow-lg ${isUnreadForMe(notification) ? 'border-l-4 border-l-primary bg-primary/5' : ''}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-base">{notification.title}</CardTitle>
                      <Badge variant={notification.status === 'scheduled' ? 'secondary' : 'default'} className="h-5 px-1.5 text-[10px] uppercase">
                        {notification.status === 'scheduled' ? 'scheduled' : isUnreadForMe(notification) ? 'unread' : 'read'}
                      </Badge>
                    </div>
                    <CardDescription>{notification.message}</CardDescription>
                    <p className="whitespace-pre-line text-xs text-muted-foreground">{notification.description}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {notification.type === 'info' && <Info className="h-5 w-5 text-primary" />}
                    {notification.type === 'warning' && <Bell className="h-5 w-5 text-chart-4" />}
                    {notification.type === 'success' && <Check className="h-5 w-5 text-chart-3" />}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 pb-4 md:flex-row md:items-center md:justify-between">
                <div className="space-y-1 text-xs text-muted-foreground">
                  <p>Sent: {formatDateTime(notification.createdAt)}</p>
                  <p>Branch: {notification.branchId ?? 'All Branches'} • Recipient: {notification.recipient ?? 'All'} • Type: {notification.notificationType ?? notification.type}</p>
                </div>
                <div className="flex gap-2">
                  {canSeeReadsFor(notification) && (
                    <Button size="sm" variant="ghost" onClick={() => toggleReadsDetail(notification.id)}>
                      <MailOpen className="mr-1 h-3 w-3" />
                      {notification.readCount ?? 0} read
                    </Button>
                  )}
                  {notification.description?.includes('Inventory Allocation Pending') && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-emerald-500 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/20"
                      onClick={() => {
                        markNotificationAsRead(notification.id, auth.user ?? undefined);
                        window.location.href = '/accountant?tab=allocations';
                      }}
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      Allocate Inventory
                    </Button>
                  )}
                  {notification.notificationType === 'Birthday' && (notification.studentIds?.length || notification.teacherIds?.length) && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-[#25D366] text-[#128C4A] hover:bg-[#25D366]/10 dark:text-[#25D366]"
                      onClick={() => handleSendBirthdayWish(notification)}
                    >
                      <MessageCircle className="mr-1 h-3.5 w-3.5" />
                      Send Wishes
                    </Button>
                  )}
                  {isUnreadForMe(notification) && notification.status !== 'scheduled' && (
                    <Button size="sm" variant="ghost" onClick={() => markNotificationAsRead(notification.id, auth.user ?? undefined)}>
                      <Check className="mr-1 h-3 w-3" />
                      Mark as Read
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => deleteNotification(notification.id, auth.user ?? undefined)}>
                    <Trash2 className="mr-1 h-3 w-3" />
                    Delete
                  </Button>
                </div>
              </CardContent>
              {canSeeReadsFor(notification) && expandedReadsId === notification.id && (
                <CardContent className="border-t border-border pt-4">
                  {loadingReads ? (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                  ) : readsDetail ? (
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-foreground">
                        {readsDetail.readCount} of {readsDetail.totalRecipients || '?'} recipients have read this
                      </p>
                      {readsDetail.reads.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No one has read this yet.</p>
                      ) : (
                        <ul className="space-y-1">
                          {readsDetail.reads.map((r) => (
                            <li key={r.userId} className="flex items-center justify-between text-xs text-muted-foreground">
                              <span>{r.userName} <span className="text-muted-foreground/70">({r.userRole})</span></span>
                              <span>{formatDateTime(r.readAt)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Failed to load read receipts.</p>
                  )}
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Notification History</h3>
          <p className="text-sm text-muted-foreground">Audit trail for read, deleted, and completed lifecycle events.</p>
        </div>
        <div className="space-y-3">
          {historyNotifications.length === 0 && (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">No history entries are available for the current selection.</CardContent>
            </Card>
          )}
          {historyNotifications.map((notification) => (
            <Card key={notification.id} className="transition-all duration-300 hover:shadow-lg">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-base">{notification.title}</CardTitle>
                      <Badge variant="outline" className="h-5 px-1.5 text-[10px] uppercase">
                        {notification.status}
                      </Badge>
                    </div>
                    <CardDescription>{notification.message}</CardDescription>
                    <p className="whitespace-pre-line text-xs text-muted-foreground">{notification.description}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {notification.type === 'info' && <Info className="h-5 w-5 text-primary" />}
                    {notification.type === 'warning' && <Bell className="h-5 w-5 text-chart-4" />}
                    {notification.type === 'success' && <Check className="h-5 w-5 text-chart-3" />}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 pb-4 text-xs text-muted-foreground md:flex-row md:items-center md:justify-between">
                <div className="space-y-1">
                  <p>Sent: {formatDateTime(notification.createdAt)}</p>
                  <p>Read: {formatDateTime(notification.readAt)} • Deleted: {formatDateTime(notification.deletedAt)}</p>
                </div>
                <div className="flex gap-2">
                  {canSeeReadsFor(notification) && (
                    <Button size="sm" variant="ghost" onClick={() => toggleReadsDetail(notification.id)}>
                      <MailOpen className="mr-1 h-3 w-3" />
                      {notification.readCount ?? 0} read
                    </Button>
                  )}
                  {notification.status === 'deleted' && (
                    <Button size="sm" variant="ghost" onClick={() => restoreNotification(notification.id)}>
                      <Check className="mr-1 h-3 w-3" />
                      Restore
                    </Button>
                  )}
                </div>
                <div className="space-y-1 text-right">
                  <p>Read by: {notification.readBy ?? '—'}</p>
                  <p>Deleted by: {notification.deletedBy ?? '—'}</p>
                </div>
              </CardContent>
              {canSeeReadsFor(notification) && expandedReadsId === notification.id && (
                <CardContent className="border-t border-border pt-4">
                  {loadingReads ? (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                  ) : readsDetail ? (
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-foreground">
                        {readsDetail.readCount} of {readsDetail.totalRecipients || '?'} recipients have read this
                      </p>
                      {readsDetail.reads.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No one has read this yet.</p>
                      ) : (
                        <ul className="space-y-1">
                          {readsDetail.reads.map((r) => (
                            <li key={r.userId} className="flex items-center justify-between text-xs text-muted-foreground">
                              <span>{r.userName} <span className="text-muted-foreground/70">({r.userRole})</span></span>
                              <span>{formatDateTime(r.readAt)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Failed to load read receipts.</p>
                  )}
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      </div>
      </>
      )}

      <Dialog open={composerOpen} onOpenChange={setComposerOpen}>
        <DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto p-6">
          <DialogHeader>
            <DialogTitle>Compose Notification</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Title *</label>
              <input
                value={composeForm.title}
                onChange={(e) => setComposeForm((prev) => ({ ...prev, title: e.target.value }))}
                placeholder="e.g. Fee Payment Reminder"
                className="w-full rounded-xl border border-input bg-input-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Message *</label>
              <textarea
                value={composeForm.message}
                onChange={(e) => setComposeForm((prev) => ({ ...prev, message: e.target.value }))}
                placeholder="Short message shown in the notification"
                rows={3}
                className="w-full rounded-xl border border-input bg-input-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Description</label>
              <input
                value={composeForm.description}
                onChange={(e) => setComposeForm((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="Optional additional detail"
                className="w-full rounded-xl border border-input bg-input-background px-3 py-2 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium">Send To *</label>
                <select
                  value={composeForm.audience}
                  onChange={(e) => setComposeForm((prev) => ({ ...prev, audience: e.target.value as NotificationAudience }))}
                  className="w-full rounded-xl border border-input bg-input-background px-3 py-2 text-sm"
                >
                  {audienceOptions.length === 0 && <option value="">No recipients available for your role</option>}
                  {audienceOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-muted-foreground">
                  {composeForm.audience === 'my_batch_parents' && 'Automatically resolved from your assigned batches.'}
                  {composeForm.audience === 'my_assigned_teacher' && "Automatically resolved from your child's batch."}
                  {(composeForm.audience === 'branch_teachers' || composeForm.audience === 'branch_parents' || composeForm.audience === 'branch_accountants' || composeForm.audience === 'branch_admin') && 'Automatically limited to your own branch.'}
                </p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Priority</label>
                <select
                  value={composeForm.priority}
                  onChange={(e) => setComposeForm((prev) => ({ ...prev, priority: e.target.value }))}
                  className="w-full rounded-xl border border-input bg-input-background px-3 py-2 text-sm"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Schedule for later (optional)</label>
              <input
                type="datetime-local"
                value={composeForm.schedule}
                onChange={(e) => setComposeForm((prev) => ({ ...prev, schedule: e.target.value }))}
                className="w-full rounded-xl border border-input bg-input-background px-3 py-2 text-sm"
              />
            </div>
            {sendError && <p className="text-sm text-destructive">{sendError}</p>}
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setComposerOpen(false)}>Cancel</Button>
            <Button
              disabled={!composeForm.title.trim() || !composeForm.message.trim() || !composeForm.audience || sending}
              onClick={handleSendNotification}
            >
              <Send className="mr-2 h-4 w-4" />
              {sending ? 'Sending…' : composeForm.schedule ? 'Schedule' : 'Send'} Notification
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
