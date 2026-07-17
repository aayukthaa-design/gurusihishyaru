import { useEffect, useMemo, useState } from 'react';
import { Header } from '../components/Header';
import { DataTable } from '../components/DataTable';
import { useAuth } from '../auth/AuthContext';
import { apiFetch } from '../lib/apiClient';
import {
  useMaterials,
  refreshMaterials,
  uploadMaterialAPI,
  deleteMaterialAPI,
  downloadMaterialFile,
  StudyMaterial,
} from '../lib/materialsService';
import { Library, Upload, Trash2, Download, Loader2, FileText } from 'lucide-react';

const BATCH_OPTIONS = ['Batch A', 'Batch B', 'Morning', 'Evening'];

export function Materials() {
  const { user } = useAuth();
  const materials = useMaterials();

  const isTeacher = user?.role === 'teacher';
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const isParent = user?.role === 'parent';

  const [teacherAllocations, setTeacherAllocations] = useState<{
    classes: string[];
    allocations: Record<string, { subjects: string[]; batches: string[] }>;
  } | null>(null);

  const [selectedClass, setSelectedClass] = useState('');
  const [subject, setSubject] = useState('');
  const [batch, setBatch] = useState(BATCH_OPTIONS[0]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setIsLoading(true);
    refreshMaterials(user).finally(() => setIsLoading(false));
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

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!file || !title.trim() || !selectedClass) {
      setError('Title, class and a file are required.');
      return;
    }
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('title', title.trim());
      formData.append('description', description);
      formData.append('subject', subject);
      formData.append('className', selectedClass);
      formData.append('batch', batch);
      formData.append('file', file);
      await uploadMaterialAPI(formData, user);
      setSuccess('Material uploaded successfully.');
      setTitle('');
      setDescription('');
      setFile(null);
      const fileInput = document.getElementById('material-file-input') as HTMLInputElement | null;
      if (fileInput) fileInput.value = '';
    } catch (err: any) {
      setError(err.message || 'Upload failed.');
    } finally {
      setIsUploading(false);
    }
  }

  async function handleDelete(id: number) {
    if (!window.confirm('Delete this material? This cannot be undone.')) return;
    try {
      await deleteMaterialAPI(id, user);
    } catch (err: any) {
      setError(err.message || 'Delete failed.');
    }
  }

  async function handleDownload(material: StudyMaterial) {
    try {
      await downloadMaterialFile(material);
    } catch (err: any) {
      setError(err.message || 'Download failed.');
    }
  }

  const myMaterials = useMemo(
    () => materials.filter((m) => m.teacherId === user?.id),
    [materials, user?.id]
  );

  return (
    <div className="flex-1 bg-background">
      <Header title="Study Materials" />
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
                <Upload className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-foreground">Upload Material</h2>
                <p className="text-xs text-muted-foreground">Only visible to you and students in the selected class — other teachers cannot see this.</p>
              </div>
            </div>
            <form onSubmit={handleUpload} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium text-foreground">Title</span>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Chapter 4 Notes — Motion"
                    className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary"
                    required
                  />
                </label>
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
                  <span className="font-medium text-foreground">Batch</span>
                  <select
                    value={batch}
                    onChange={(e) => setBatch(e.target.value)}
                    className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary"
                  >
                    {(teacherAllocations?.allocations[selectedClass]?.batches || BATCH_OPTIONS).map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium text-foreground">Description (optional)</span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary"
                />
              </label>
              <div className="border border-dashed border-border rounded-2xl p-4 bg-secondary/20">
                <input
                  type="file"
                  id="material-file-input"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  className="hidden"
                  required
                />
                <label
                  htmlFor="material-file-input"
                  className="inline-flex items-center gap-2 rounded-xl bg-secondary hover:bg-secondary/80 text-foreground px-4 py-2 text-xs font-bold cursor-pointer transition"
                >
                  <Upload className="h-4 w-4 text-muted-foreground" />
                  {file ? file.name : 'Select File'}
                </label>
                <p className="mt-2 text-xs text-muted-foreground">Max 25 MB per file.</p>
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={isUploading}
                  className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-all hover:opacity-90 disabled:opacity-50"
                >
                  {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  Upload
                </button>
              </div>
            </form>
          </div>
        )}

        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Library className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-base font-semibold text-foreground">
              {isTeacher ? 'My Materials' : isAdmin ? 'All Materials' : 'Materials for My Class'}
            </h2>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
            </div>
          ) : isAdmin ? (
            materials.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No materials uploaded yet.</p>
            ) : (
              <DataTable<StudyMaterial>
                columns={[
                  { header: 'Title', accessor: 'title' },
                  { header: 'Teacher', accessor: 'teacherName' },
                  { header: 'Class', accessor: 'className' },
                  { header: 'Subject', accessor: 'subject' },
                  { header: 'File', accessor: (m) => m.originalFileName },
                  {
                    header: 'Uploaded',
                    accessor: (m) => new Date(m.createdAt).toLocaleDateString('en-IN'),
                  },
                  {
                    header: '',
                    accessor: (m) => (
                      <button
                        onClick={() => handleDownload(m)}
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        <Download className="h-3.5 w-3.5" /> Download
                      </button>
                    ),
                  },
                ]}
                data={materials}
              />
            )
          ) : (
            <div className="space-y-2">
              {(isTeacher ? myMaterials : materials).length === 0 && (
                <p className="text-sm text-muted-foreground py-6 text-center">No materials available yet.</p>
              )}
              {(isTeacher ? myMaterials : materials).map((m) => (
                <div key={m.id} className="flex items-center justify-between rounded-xl border border-border bg-secondary/40 px-4 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <FileText className="h-5 w-5 shrink-0 text-primary" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{m.title}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {m.subject} · {m.className}{m.batch ? ` · ${m.batch}` : ''}
                        {isParent && ` · Shared by ${m.teacherName}`}
                      </p>
                      {m.description && <p className="text-xs text-muted-foreground mt-0.5">{m.description}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleDownload(m)}
                      className="p-2 rounded-lg hover:bg-secondary text-primary"
                      title="Download"
                    >
                      <Download className="h-4 w-4" />
                    </button>
                    {isTeacher && (
                      <button
                        onClick={() => handleDelete(m.id)}
                        className="p-2 rounded-lg hover:bg-secondary text-red-500"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
