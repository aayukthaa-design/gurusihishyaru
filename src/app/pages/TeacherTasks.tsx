import React from 'react';
import { Header } from '../components/Header';
import { StatsCard } from '../components/StatsCard';
import { ListTodo, CheckCircle2, Clock, AlertCircle, Plus, Paperclip } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { getBranches } from '../lib/branchService';
import { useAuth } from '../auth/AuthContext';
import { getTeachersForBranch } from '../lib/teacherService';
import taskService, { getTaskStats, subscribeTasks, createTask, setTaskProgress, refreshTasks, TaskRecord } from '../lib/taskService';

export function TeacherTasks() {
  const { user } = useAuth();
  const branches = getBranches();
  const [tasks, setTasks] = React.useState<TaskRecord[]>(taskService.getTasks());
  const [createOpen, setCreateOpen] = React.useState(false);
  const [form, setForm] = React.useState({
    title: '',
    description: '',
    teacherId: '',
    branchId: user?.branchId ?? '',
    priority: 'medium',
    dueDate: '',
    dueTime: '',
    relatedClass: '',
    relatedSubject: '',
    attachmentUrl: '',
  });
  const teacherOptions = React.useMemo(() => getTeachersForBranch(user?.branchId), [user?.branchId]);

  React.useEffect(() => {
    const unsubscribe = subscribeTasks(() => setTasks(taskService.getTasks()));
    return unsubscribe;
  }, []);

  React.useEffect(() => {
    void refreshTasks(user?.role === 'super_admin' ? {} : { branchId: user?.branchId, teacherId: user?.role === 'teacher' ? user.id : undefined });
  }, [user?.role, user?.branchId, user?.id]);

  const stats = getTaskStats(tasks);

  const saveTask = () => {
    const teacher = teacherOptions.find((t) => t.id === form.teacherId);
    if (!form.title.trim() || !form.teacherId) {
      return;
    }

    createTask({
      title: form.title,
      description: form.description,
      teacherId: form.teacherId,
      teacherName: teacher?.fullName,
      branchId: form.branchId || undefined,
      priority: form.priority as any,
      dueDate: form.dueDate || undefined,
      dueTime: form.dueTime || undefined,
      relatedClass: form.relatedClass || undefined,
      relatedSubject: form.relatedSubject || undefined,
      attachmentUrl: form.attachmentUrl || undefined,
    });

    setCreateOpen(false);
    setForm({ title: '', description: '', teacherId: '', branchId: user?.branchId ?? '', priority: 'medium', dueDate: '', dueTime: '', relatedClass: '', relatedSubject: '', attachmentUrl: '' });
  };

  const updateProgress = (taskId: string, progress: number, remarks?: string) => {
    setTaskProgress(taskId, progress, remarks);
  };

  const scopedTasks = user?.role === 'teacher'
    ? taskService.getTasks().filter((task) => task.teacherId === user.id)
    : taskService.getTasks().filter((task) => task.branchId === user?.branchId);
  const visibleTasks = user?.role === 'super_admin' ? taskService.getTasks() : scopedTasks;
  const visibleStats = getTaskStats(visibleTasks);

  return (
    <div className="flex-1">
      <Header title="Teacher Task Management" />
      
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4 w-full">
            <StatsCard title="Total Tasks" value={String(visibleStats.total)} icon={ListTodo} iconColor="bg-primary" />
            <StatsCard title="Completed" value={String(visibleStats.completed)} change="Live" changeType="positive" icon={CheckCircle2} iconColor="bg-chart-3" />
            <StatsCard title="In Progress" value={String(visibleStats.inProgress)} icon={Clock} iconColor="bg-chart-4" />
            <StatsCard title="Pending" value={String(visibleStats.pending)} change="Live" changeType="negative" icon={AlertCircle} iconColor="bg-destructive" />
          </div>
          <div className="ml-4">
            <Button onClick={() => setCreateOpen(true)}><Plus className="mr-2 h-4 w-4" />Create Task</Button>
          </div>
        </div>

        <div className="space-y-4">
          {visibleTasks.map((task) => (
            <div key={task.id} className="rounded-xl border border-border bg-card p-6 transition-all duration-200 hover:shadow-lg">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg font-semibold text-card-foreground">{task.title}</h3>
                    <span className={`rounded-full px-2 py-1 text-xs font-medium ${
                      task.priority === 'critical' ? 'bg-destructive/10 text-destructive' :
                      task.priority === 'high' ? 'bg-destructive/10 text-destructive' :
                      task.priority === 'medium' ? 'bg-chart-4/10 text-chart-4' :
                      'bg-muted text-muted-foreground'
                    }`}>
                      {task.priority}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">Assigned to: {task.teacherName ?? 'Unassigned'}</p>
                  <p className="mt-1 text-sm text-muted-foreground">Due: {task.dueDate} {task.dueTime}</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${
                  task.status === 'completed' ? 'bg-chart-3/10 text-chart-3' :
                  task.status === 'in-progress' ? 'bg-primary/10 text-primary' :
                  'bg-muted text-muted-foreground'
                }`}>
                  {task.status}
                </span>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <input type="range" min={0} max={100} value={task.progress ?? 0} onChange={(e) => updateProgress(task.id, Number(e.target.value))} />
                <span className="text-xs text-muted-foreground">{task.progress ?? 0}%</span>
                {task.attachmentUrl && <a href={task.attachmentUrl} className="ml-auto inline-flex items-center text-sm text-primary"><Paperclip className="mr-2 h-4 w-4"/>Attachment</a>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Create Task</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-2 mt-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Task Title</label>
              <Input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Assign Teacher</label>
              <select
                className="field"
                value={form.teacherId}
                onChange={(e) => setForm((p) => ({ ...p, teacherId: e.target.value }))}
              >
                <option value="">Select a teacher</option>
                {teacherOptions.map((teacher) => (
                  <option key={teacher.id} value={teacher.id}>
                    {teacher.fullName} ({teacher.employeeId})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Branch</label>
              <Input value={branches.find((branch) => branch.id === form.branchId)?.name ?? 'Branch scope'} readOnly />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Priority</label>
              <select className="field" value={form.priority} onChange={(e) => setForm((p) => ({ ...p, priority: e.target.value }))}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Due Date</label>
              <Input type="date" value={form.dueDate} onChange={(e) => setForm((p) => ({ ...p, dueDate: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Due Time</label>
              <Input type="time" value={form.dueTime} onChange={(e) => setForm((p) => ({ ...p, dueTime: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Related Class (optional)</label>
              <Input value={form.relatedClass} onChange={(e) => setForm((p) => ({ ...p, relatedClass: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Related Subject (optional)</label>
              <Input value={form.relatedSubject} onChange={(e) => setForm((p) => ({ ...p, relatedSubject: e.target.value }))} />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-sm font-medium">Description</label>
              <Textarea value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Attachment (URL)</label>
              <Input value={form.attachmentUrl} onChange={(e) => setForm((p) => ({ ...p, attachmentUrl: e.target.value }))} placeholder="https://..." />
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={saveTask}>Save Task</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
