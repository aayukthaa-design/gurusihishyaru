import { useEffect, useState } from 'react';
import { Header } from '../components/Header';
import { DataTable } from '../components/DataTable';
import { useAuth } from '../auth/AuthContext';
import { apiFetch } from '../lib/apiClient';
import {
  useLessonPlans,
  refreshLessonPlans,
  createLessonPlanAPI,
  updateLessonPlanAPI,
  deleteLessonPlanAPI,
  LessonPlan as LessonPlanRecord,
  LessonPlanStatus,
} from '../lib/lessonPlanService';
import { NotebookPen, Plus, Trash2, Loader2, BookOpen, CheckCircle2, Circle, Clock } from 'lucide-react';

const STATUS_OPTIONS: LessonPlanStatus[] = ['Planned', 'In Progress', 'Completed'];

const STATUS_STYLES: Record<LessonPlanStatus, string> = {
  Planned: 'bg-secondary text-muted-foreground',
  'In Progress': 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
  Completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
};

const STATUS_ICONS: Record<LessonPlanStatus, typeof Circle> = {
  Planned: Circle,
  'In Progress': Clock,
  Completed: CheckCircle2,
};

export function LessonPlan() {
  const { user } = useAuth();
  const plans = useLessonPlans();

  const isTeacher = user?.role === 'teacher';
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  const [teacherAllocations, setTeacherAllocations] = useState<{
    classes: string[];
    allocations: Record<string, { subjects: string[]; batches: string[] }>;
  } | null>(null);

  const [selectedClass, setSelectedClass] = useState('');
  const [subject, setSubject] = useState('');
  const [batch, setBatch] = useState('');
  const [chapterTitle, setChapterTitle] = useState('');
  const [topic, setTopic] = useState('');
  const [textbookReference, setTextbookReference] = useState('');
  const [plannedDate, setPlannedDate] = useState('');
  const [objectives, setObjectives] = useState('');
  const [notes, setNotes] = useState('');

  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setIsLoading(true);
    refreshLessonPlans(user).finally(() => setIsLoading(false));
  }, [user]);

  useEffect(() => {
    if (isTeacher && user) {
      apiFetch(`/api/allocations?teacherId=${user.id}`)
        .then((res) => res.json())
        .then((data) => {
          if (data?.classes?.length > 0) {
            setTeacherAllocations(data);
            const defaultClass = data.classes[0];
            setSelectedClass(defaultClass);
            const alloc = data.allocations[defaultClass];
            if (alloc?.subjects?.length > 0) setSubject(alloc.subjects[0]);
            if (alloc?.batches?.length > 0) setBatch(alloc.batches[0]);
          }
        })
        .catch((err) => console.error('Failed to fetch allocations', err));
    }
  }, [isTeacher, user]);

  function handleClassChange(className: string) {
    setSelectedClass(className);
    const alloc = teacherAllocations?.allocations[className];
    if (alloc?.subjects?.length > 0) setSubject(alloc.subjects[0]);
    if (alloc?.batches?.length > 0) setBatch(alloc.batches[0]);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!chapterTitle.trim() || !selectedClass || !plannedDate) {
      setError('Chapter/topic title, class and a planned date are required.');
      return;
    }
    setIsSaving(true);
    try {
      await createLessonPlanAPI({
        className: selectedClass,
        subject,
        batch,
        chapterTitle: chapterTitle.trim(),
        topic,
        textbookReference,
        plannedDate,
        objectives,
        notes,
        status: 'Planned',
      }, user);
      setSuccess('Lesson plan added.');
      setChapterTitle('');
      setTopic('');
      setTextbookReference('');
      setPlannedDate('');
      setObjectives('');
      setNotes('');
    } catch (err: any) {
      setError(err.message || 'Failed to add lesson plan.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleStatusChange(plan: LessonPlanRecord, status: LessonPlanStatus) {
    try {
      await updateLessonPlanAPI(plan.id, { status }, user);
    } catch (err: any) {
      setError(err.message || 'Failed to update status.');
    }
  }

  async function handleDelete(id: number) {
    if (!window.confirm('Delete this lesson plan entry?')) return;
    try {
      await deleteLessonPlanAPI(id, user);
    } catch (err: any) {
      setError(err.message || 'Delete failed.');
    }
  }

  return (
    <div className="flex-1 bg-background">
      <Header title="Lesson Plans" />
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
            {error}
          </div>
        )}
        {success && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-400">
            {success}
          </div>
        )}

        {isTeacher && (
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <NotebookPen className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-foreground">Plan a Lesson</h2>
                <p className="text-xs text-muted-foreground">Chapter/topic from the textbook, per class and subject.</p>
              </div>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium text-foreground">Class</span>
                  <select
                    value={selectedClass}
                    onChange={(e) => handleClassChange(e.target.value)}
                    className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary"
                    required
                  >
                    {(teacherAllocations?.classes || []).map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium text-foreground">Subject</span>
                  <select
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary"
                  >
                    {(teacherAllocations?.allocations[selectedClass]?.subjects || []).map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium text-foreground">Chapter / Topic Title</span>
                  <input
                    type="text"
                    value={chapterTitle}
                    onChange={(e) => setChapterTitle(e.target.value)}
                    placeholder="e.g. Chapter 4 — Laws of Motion"
                    className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary"
                    required
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium text-foreground">Textbook Reference</span>
                  <input
                    type="text"
                    value={textbookReference}
                    onChange={(e) => setTextbookReference(e.target.value)}
                    placeholder="e.g. NCERT Class 10 Physics, Ch. 4"
                    className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary"
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium text-foreground">Sub-topic (optional)</span>
                  <input
                    type="text"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary"
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium text-foreground">Planned Date</span>
                  <input
                    type="date"
                    value={plannedDate}
                    onChange={(e) => setPlannedDate(e.target.value)}
                    className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary"
                    required
                  />
                </label>
              </div>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium text-foreground">Objectives (optional)</span>
                <textarea
                  value={objectives}
                  onChange={(e) => setObjectives(e.target.value)}
                  rows={2}
                  className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium text-foreground">Notes (optional)</span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary"
                />
              </label>
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-all hover:opacity-90 disabled:opacity-50"
                >
                  {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Add Lesson Plan
                </button>
              </div>
            </form>
          </div>
        )}

        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <BookOpen className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-base font-semibold text-foreground">
              {isAdmin ? 'All Teachers’ Lesson Plans' : 'My Lesson Plans'}
            </h2>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
            </div>
          ) : isAdmin ? (
            plans.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No lesson plans yet.</p>
            ) : (
              <DataTable<LessonPlanRecord>
                columns={[
                  { header: 'Teacher', accessor: 'teacherName' },
                  { header: 'Class', accessor: 'className' },
                  { header: 'Subject', accessor: 'subject' },
                  { header: 'Chapter/Topic', accessor: 'chapterTitle' },
                  { header: 'Planned Date', accessor: (p) => p.plannedDate ? new Date(p.plannedDate).toLocaleDateString('en-IN') : '—' },
                  {
                    header: 'Status',
                    accessor: (p) => (
                      <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[p.status]}`}>
                        {p.status}
                      </span>
                    ),
                  },
                ]}
                data={plans}
              />
            )
          ) : (
            <div className="space-y-2">
              {plans.length === 0 && (
                <p className="text-sm text-muted-foreground py-6 text-center">No lesson plans yet — add one above.</p>
              )}
              {plans.map((p) => {
                const StatusIcon = STATUS_ICONS[p.status];
                return (
                  <div key={p.id} className="rounded-xl border border-border bg-secondary/40 px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <StatusIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <p className="text-sm font-medium text-foreground truncate">{p.chapterTitle}</p>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {p.subject} · {p.className}{p.batch ? ` · ${p.batch}` : ''} · Planned: {p.plannedDate ? new Date(p.plannedDate).toLocaleDateString('en-IN') : '—'}
                        </p>
                        {p.textbookReference && <p className="text-xs text-muted-foreground mt-0.5">📖 {p.textbookReference}</p>}
                        {p.objectives && <p className="text-xs text-foreground mt-1">{p.objectives}</p>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <select
                          value={p.status}
                          onChange={(e) => handleStatusChange(p, e.target.value as LessonPlanStatus)}
                          className={`rounded-full px-2.5 py-1 text-xs font-medium border-0 focus:outline-none ${STATUS_STYLES[p.status]}`}
                        >
                          {STATUS_OPTIONS.map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => handleDelete(p.id)}
                          className="p-2 rounded-lg hover:bg-secondary text-red-500"
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
