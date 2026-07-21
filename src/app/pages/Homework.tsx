import React, { useMemo, useState, useEffect } from 'react';
import { Header } from '../components/Header';
import { 
  ClipboardList, Plus, BookOpen, CheckCircle2, Clock, AlertCircle, 
  FileText, Trash2, Eye, Download, Upload, ArrowLeft, RefreshCw,
  FileSpreadsheet, Edit3
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { getStudentsForClass, useStudents } from '../lib/studentService';
import { getBranchName } from '../lib/branchService';
import {
  useHomework,
  refreshHomework,
  createHomeworkAPI,
  updateHomeworkAPI,
  deleteHomeworkAPI,
  fetchSubmissionsAPI,
  submitHomeworkAPI,
  removeSubmissionAPI,
  reviewSubmissionAPI,
  exportHomeworkReport,
  HomeworkAssignment,
  HomeworkSubmission,
  HomeworkAttachment
} from '../lib/homeworkService';
import { apiFetch } from '../lib/apiClient';

const CLASS_OPTIONS = ['8th A', '8th B', '9th A', '9th B', '10th A', '10th B'];
const BATCH_OPTIONS = ['Batch A', 'Batch B', 'Morning', 'Evening'];
const SUBJECT_OPTIONS = ['Mathematics', 'Physics', 'Chemistry', 'Biology', 'English', 'Computer Science'];

const API_BASE = '';

export function Homework() {
  const { user } = useAuth();
  const homeworkList = useHomework();

  // Selected state
  const [selectedClass, setSelectedClass] = useState(CLASS_OPTIONS[0]);
  const [subject, setSubject] = useState(SUBJECT_OPTIONS[0]);
  const [batch, setBatch] = useState(BATCH_OPTIONS[0]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('23:59');
  
  // Attachments upload state
  const [attachments, setAttachments] = useState<File[]>([]);
  const [existingAttachments, setExistingAttachments] = useState<HomeworkAttachment[]>([]);
  const [editingHomeworkId, setEditingHomeworkId] = useState<string | null>(null);

  // Parent student selection
  const allStudents = useStudents();
  const parentStudents = useMemo(() => {
    if (user?.role !== 'parent' || !user.linkedStudentIds) return [];
    return allStudents.filter(s => user.linkedStudentIds?.includes(s.id));
  }, [user, allStudents]);

  const [selectedStudentId, setSelectedStudentId] = useState(parentStudents[0]?.id || '');
  const selectedStudent = useMemo(() => {
    return parentStudents.find(s => s.id === selectedStudentId) || parentStudents[0];
  }, [parentStudents, selectedStudentId]);

  // Loading/feedback states
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Submissions view state (Teacher only)
  const [activeSubmissionsHomeworkId, setActiveSubmissionsHomeworkId] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<HomeworkSubmission[]>([]);
  const [reviewingStudentId, setReviewingStudentId] = useState<string | null>(null);
  const [remarks, setRemarks] = useState('');

  // Parent submission uploads
  const [submissionFile, setSubmissionFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Load allocations dynamically for teacher
  const [teacherAllocations, setTeacherAllocations] = useState<{
    classes: string[];
    allocations: Record<string, { subjects: string[]; batches: string[] }>;
  } | null>(null);

  useEffect(() => {
    if (user) {
      refreshHomework(user);
    }
  }, [user]);

  useEffect(() => {
    if (user?.role === 'teacher') {
      apiFetch(`${API_BASE}/api/allocations?teacherId=${user.id}`)
        .then(res => res.json())
        .then(data => {
          if (data && data.classes && data.classes.length > 0) {
            setTeacherAllocations(data);
            const defaultClass = data.classes[0];
            setSelectedClass(defaultClass);
            
            const classAlloc = data.allocations[defaultClass];
            if (classAlloc) {
              if (classAlloc.subjects?.length > 0) setSubject(classAlloc.subjects[0]);
              if (classAlloc.batches?.length > 0) setBatch(classAlloc.batches[0]);
            }
          }
        })
        .catch(err => console.error('Failed to fetch allocations', err));
    }
  }, [user]);

  // Handle class select for teachers to update subjects and batches
  function handleClassChange(className: string) {
    setSelectedClass(className);
    if (teacherAllocations) {
      const classAlloc = teacherAllocations.allocations[className];
      if (classAlloc) {
        if (classAlloc.subjects?.length > 0) setSubject(classAlloc.subjects[0]);
        if (classAlloc.batches?.length > 0) setBatch(classAlloc.batches[0]);
      }
    }
  }

  // Active student list for selected class (Teacher only)
  const studentsInClass = useMemo(() => getStudentsForClass(selectedClass, user?.branchId), [selectedClass, user?.branchId]);

  // Load submissions when active homework changes
  useEffect(() => {
    if (activeSubmissionsHomeworkId) {
      setIsLoading(true);
      fetchSubmissionsAPI(activeSubmissionsHomeworkId)
        .then(data => {
          setSubmissions(data);
          setIsLoading(false);
        })
        .catch(() => setIsLoading(false));
    } else {
      setSubmissions([]);
    }
  }, [activeSubmissionsHomeworkId]);

  // Parent homework list with submissions
  const [parentSubmissions, setParentSubmissions] = useState<Record<string, HomeworkSubmission>>({});
  
  // Dynamic fetch submissions for parent's child
  useEffect(() => {
    if (user?.role === 'parent' && selectedStudent) {
      // Fetch submissions for all visible homework assignments
      const visibleHw = homeworkList.filter(hw => hw.className === selectedStudent.className);
      const subPromises = visibleHw.map(hw => 
        fetchSubmissionsAPI(hw.id).then(subs => ({
          hwId: hw.id,
          sub: subs.find(s => s.studentId === selectedStudent.id) || null
        }))
      );
      
      Promise.all(subPromises).then(results => {
        const mapped: Record<string, HomeworkSubmission> = {};
        results.forEach(res => {
          if (res.sub) mapped[res.hwId] = res.sub;
        });
        setParentSubmissions(mapped);
      });
    }
  }, [homeworkList, user?.role, selectedStudent]);

  // Calculate status for parent homework
  function getHomeworkStatus(hw: HomeworkAssignment, studentId: string) {
    const sub = parentSubmissions[hw.id];
    if (sub) {
      return sub.submissionStatus === 'Reviewed' ? 'Reviewed' : 'Submitted';
    }
    
    // Check if overdue
    const now = new Date();
    const dateStr = `${hw.dueDate}T${hw.dueTime || '23:59'}:00`;
    const dueDateTime = new Date(dateStr);
    if (isNaN(dueDateTime.getTime())) {
      const justDueDate = new Date(hw.dueDate);
      justDueDate.setHours(23, 59, 59, 999);
      return now > justDueDate ? 'Overdue' : 'Pending Submission';
    }
    return now > dueDateTime ? 'Overdue' : 'Pending Submission';
  }

  // Calculate submission lists for reports
  const reportData = useMemo(() => {
    if (!activeSubmissionsHomeworkId) return null;
    const hw = homeworkList.find(h => h.id === activeSubmissionsHomeworkId);
    if (!hw) return null;

    const classStudents = getStudentsForClass(hw.className, hw.branchId);
    
    let submitted = 0;
    let reviewed = 0;
    let pending = 0;
    let overdue = 0;

    const studentStatusRows = classStudents.map(stu => {
      const sub = submissions.find(s => s.studentId === stu.id);
      let status = 'Pending Submission';
      
      if (sub) {
        if (sub.submissionStatus === 'Reviewed') {
          status = 'Reviewed';
          reviewed++;
        } else {
          status = 'Submitted';
          submitted++;
        }
      } else {
        const now = new Date();
        const dateStr = `${hw.dueDate}T${hw.dueTime || '23:59'}:00`;
        const dueDateTime = new Date(dateStr);
        const isOverdue = isNaN(dueDateTime.getTime()) 
          ? now > new Date(hw.dueDate + 'T23:59:59')
          : now > dueDateTime;

        if (isOverdue) {
          status = 'Overdue';
          overdue++;
        } else {
          status = 'Pending Submission';
          pending++;
        }
      }

      return {
        name: stu.fullName,
        rollNumber: stu.rollNumber,
        status,
        time: sub ? sub.submissionTime : '',
        remarks: sub ? sub.remarks || '' : '',
      };
    });

    return {
      title: hw.title,
      className: hw.className,
      subject: hw.subject,
      dueDate: `${hw.dueDate} ${hw.dueTime}`,
      total: classStudents.length,
      submitted,
      pending,
      overdue,
      reviewed,
      students: studentStatusRows
    };
  }, [activeSubmissionsHomeworkId, homeworkList, submissions]);

  // Export report trigger
  function handleExport(format: 'pdf' | 'excel') {
    if (!reportData) return;
    exportHomeworkReport(format, reportData);
    setSuccess(`Successfully exported Homework Report as ${format.toUpperCase()}`);
  }

  // Create or Update homework assignment
  async function handleAssignHomework(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setIsLoading(true);

    if (!title.trim() || !subject || !dueDate || !selectedClass) {
      setError('Please fill in all required fields.');
      setIsLoading(false);
      return;
    }

    try {
      const fd = new FormData();
      fd.append('className', selectedClass);
      fd.append('subject', subject);
      fd.append('batch', batch);
      fd.append('title', title);
      fd.append('description', description);
      fd.append('dueDate', dueDate);
      fd.append('dueTime', dueTime);
      fd.append('teacherId', user?.id || '');
      fd.append('assignedBy', user?.name || 'Teacher');
      fd.append('branchId', user?.branchId || '');

      attachments.forEach((file) => {
        fd.append('attachments', file);
      });

      if (editingHomeworkId) {
        fd.append('existingAttachments', JSON.stringify(existingAttachments));
        await updateHomeworkAPI(editingHomeworkId, fd, user);
        setSuccess('Homework updated successfully.');
      } else {
        await createHomeworkAPI(fd, user);
        setSuccess('Homework assigned successfully.');
      }

      // Reset form
      setTitle('');
      setDescription('');
      setDueDate('');
      setDueTime('23:59');
      setAttachments([]);
      setExistingAttachments([]);
      setEditingHomeworkId(null);
    } catch (err: any) {
      setError(err.message || 'Failed to save homework assignment.');
    } finally {
      setIsLoading(false);
    }
  }

  // Edit homework trigger
  function handleEditHomework(hw: HomeworkAssignment) {
    setEditingHomeworkId(hw.id);
    setSelectedClass(hw.className);
    setSubject(hw.subject);
    setBatch(hw.batch);
    setTitle(hw.title);
    setDescription(hw.description);
    setDueDate(hw.dueDate);
    setDueTime(hw.dueTime || '23:59');
    setExistingAttachments(hw.attachments || []);
    setAttachments([]);
    setError(null);
    setSuccess(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Cancel edit
  function handleCancelEdit() {
    setEditingHomeworkId(null);
    setTitle('');
    setDescription('');
    setDueDate('');
    setDueTime('23:59');
    setAttachments([]);
    setExistingAttachments([]);
    setError(null);
  }

  // Delete homework
  async function handleDeleteHomework(id: string) {
    if (!confirm('Are you sure you want to delete this homework? This will also delete all submissions.')) return;
    setError(null);
    setSuccess(null);
    try {
      await deleteHomeworkAPI(id, user);
      setSuccess('Homework deleted successfully.');
      if (activeSubmissionsHomeworkId === id) {
        setActiveSubmissionsHomeworkId(null);
      }
    } catch (err) {
      setError('Failed to delete homework assignment.');
    }
  }

  // Submit student homework
  async function handleSubmitHomework(hwId: string) {
    if (!submissionFile || !selectedStudent) return;
    setError(null);
    setSuccess(null);
    setIsSubmitting(true);

    try {
      const fd = new FormData();
      fd.append('studentId', selectedStudent.id);
      fd.append('studentName', selectedStudent.fullName);
      fd.append('rollNumber', selectedStudent.rollNumber);
      fd.append('submissionFile', submissionFile);

      const hasPrev = !!parentSubmissions[hwId];
      await submitHomeworkAPI(hwId, fd, user, hasPrev);
      setSuccess('Homework submitted successfully.');
      setSubmissionFile(null);
    } catch (err) {
      setError('Failed to upload submission.');
    } finally {
      setIsSubmitting(false);
    }
  }

  // Remove parent submission
  async function handleRemoveSubmission(hwId: string) {
    if (!selectedStudent || !confirm('Are you sure you want to remove your submission?')) return;
    setError(null);
    setSuccess(null);
    try {
      await removeSubmissionAPI(hwId, selectedStudent.id, user);
      setSuccess('Submission removed successfully. You can upload a new file.');
    } catch (err) {
      setError('Failed to remove submission.');
    }
  }

  // Submit teacher review
  async function handleReviewSubmit(hwId: string, studentId: string) {
    if (!user) return;
    setError(null);
    setSuccess(null);
    setIsLoading(true);
    try {
      await reviewSubmissionAPI(hwId, studentId, remarks, user.name, user);
      setSuccess('Submission marked as Reviewed.');
      setRemarks('');
      setReviewingStudentId(null);
      
      // Refresh submissions
      const data = await fetchSubmissionsAPI(hwId);
      setSubmissions(data);
    } catch (err) {
      setError('Failed to submit review.');
    } finally {
      setIsLoading(false);
    }
  }

  const showTeacherView = user?.role === 'teacher';
  const showParentView = user?.role === 'parent';

  // Security filters for list of assignments
  const visibleHomework = useMemo(() => {
    if (showTeacherView) {
      // Only homework created by this teacher
      return homeworkList.filter(hw => hw.teacherId === user?.id);
    }
    if (showParentView && selectedStudent) {
      // Only homework for student's class
      return homeworkList.filter(hw => hw.className === selectedStudent.className);
    }
    return [];
  }, [homeworkList, user, showTeacherView, showParentView, selectedStudent]);

  return (
    <div className="flex-1 bg-background">
      <Header title={showParentView ? 'Child Homework & Submissions' : 'Homework Center'} />
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        
        {/* Global Feedback message */}
        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40 p-4 text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-red-500 shrink-0" />
            {error}
          </div>
        )}
        {success && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40 p-4 text-sm text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
            {success}
          </div>
        )}

        {/* --- TEACHER PORTAL LAYOUT --- */}
        {showTeacherView && !activeSubmissionsHomeworkId && (
          <div className="grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
            
            {/* Homework Assignment Form */}
            <div className="rounded-3xl border border-border bg-card p-6 shadow-sm">
              <div className="flex items-center justify-between border-b border-border pb-4 mb-6">
                <div>
                  <h2 className="text-lg font-bold text-foreground">
                    {editingHomeworkId ? '✏️ Edit Homework Assignment' : '📝 Assign Homework'}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Assign question papers and details to classes of your branch.
                  </p>
                </div>
                <div className="text-xs text-muted-foreground bg-secondary/80 px-3 py-1.5 rounded-xl font-semibold">
                  Branch: {getBranchName(user?.branchId)}
                </div>
              </div>

              <form onSubmit={handleAssignHomework} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <label className="grid gap-2 text-sm font-semibold">
                    <span>Class *</span>
                    <select
                      value={selectedClass}
                      onChange={(e) => handleClassChange(e.target.value)}
                      className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary"
                    >
                      {teacherAllocations?.classes?.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      )) || CLASS_OPTIONS.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </label>

                  <label className="grid gap-2 text-sm font-semibold">
                    <span>Batch *</span>
                    <select
                      value={batch}
                      onChange={(e) => setBatch(e.target.value)}
                      className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary"
                    >
                      {teacherAllocations?.allocations[selectedClass]?.batches?.map((b) => (
                        <option key={b} value={b}>{b}</option>
                      )) || BATCH_OPTIONS.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </label>

                  <label className="grid gap-2 text-sm font-semibold">
                    <span>Subject *</span>
                    <select
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary"
                    >
                      {teacherAllocations?.allocations[selectedClass]?.subjects?.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      )) || SUBJECT_OPTIONS.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="grid gap-2 text-sm font-semibold">
                  <span>Homework Title *</span>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Example: Quadratic Formulas & Exercises"
                    className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary"
                    required
                  />
                </label>

                <label className="grid gap-2 text-sm font-semibold">
                  <span>Instructions / Description</span>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="List problem numbers, page numbers, or general instructions..."
                    rows={4}
                    className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary"
                  />
                </label>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="grid gap-2 text-sm font-semibold">
                    <span>Due Date *</span>
                    <input
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary"
                      required
                    />
                  </label>

                  <label className="grid gap-2 text-sm font-semibold">
                    <span>Due Time</span>
                    <input
                      type="time"
                      value={dueTime}
                      onChange={(e) => setDueTime(e.target.value)}
                      className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary"
                    />
                  </label>
                </div>

                {/* Upload Section */}
                <div className="border border-dashed border-border rounded-2xl p-4 bg-secondary/20">
                  <p className="text-sm font-semibold text-foreground mb-2">📄 Attach Question Papers or Guides</p>
                  <p className="text-xs text-muted-foreground mb-3">
                    Supported formats: PDF, DOC, DOCX, PPT, PPTX, XLS, XLSX, Images (JPG, PNG)
                  </p>
                  
                  {/* File input */}
                  <input
                    type="file"
                    multiple
                    id="teacher-homework-attachment"
                    onChange={(e) => {
                      if (e.target.files) {
                        setAttachments(prev => [...prev, ...Array.from(e.target.files!)]);
                      }
                    }}
                    className="hidden"
                  />
                  <label
                    htmlFor="teacher-homework-attachment"
                    className="inline-flex items-center gap-2 rounded-xl bg-secondary hover:bg-secondary/80 text-foreground px-4 py-2 text-xs font-bold cursor-pointer transition"
                  >
                    <Upload className="h-4.5 w-4.5 text-muted-foreground" />
                    Select Files
                  </label>

                  {/* List of currently selected files to upload */}
                  {attachments.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground">New uploads to attach:</p>
                      {attachments.map((file, i) => (
                        <div key={i} className="flex items-center justify-between bg-card p-2 rounded-xl border text-xs">
                          <span className="truncate font-medium">{file.name}</span>
                          <button
                            type="button"
                            onClick={() => setAttachments(prev => prev.filter((_, idx) => idx !== i))}
                            className="p-1 hover:bg-secondary text-red-500 rounded-lg"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Existing attachments when editing */}
                  {editingHomeworkId && existingAttachments.length > 0 && (
                    <div className="mt-4 border-t border-border pt-3 space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground">Attached Question Papers:</p>
                      {existingAttachments.map((file, i) => (
                        <div key={i} className="flex items-center justify-between bg-card p-2 rounded-xl border text-xs">
                          <span className="truncate font-medium text-foreground">{file.originalname}</span>
                          <div className="flex gap-2">
                            <a
                              href={`${API_BASE}${file.path}`}
                              target="_blank"
                              rel="noreferrer"
                              className="p-1 hover:bg-secondary text-primary rounded-lg"
                              title="Download / View"
                            >
                              <Download className="h-4 w-4" />
                            </a>
                            <button
                              type="button"
                              onClick={() => setExistingAttachments(prev => prev.filter((_, idx) => idx !== i))}
                              className="p-1 hover:bg-secondary text-red-500 rounded-lg"
                              title="Remove"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex gap-3 justify-end pt-2">
                  {editingHomeworkId && (
                    <button
                      type="button"
                      onClick={handleCancelEdit}
                      className="px-4 py-2.5 rounded-xl border text-sm font-semibold hover:bg-secondary"
                    >
                      Cancel Edit
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                  >
                    {isLoading ? 'Saving...' : editingHomeworkId ? 'Save Changes' : 'Assign Homework'}
                  </button>
                </div>
              </form>
            </div>

            {/* Teacher Sidebar Details */}
            <div className="rounded-3xl border border-border bg-card p-6 shadow-sm space-y-4 h-fit">
              <h3 className="text-base font-bold text-foreground">Selected Allocation Summary</h3>
              <div className="space-y-3">
                <div className="rounded-2xl border bg-background p-3.5 text-sm">
                  <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Class Selected</p>
                  <p className="mt-1 font-bold text-foreground">{selectedClass}</p>
                </div>
                <div className="rounded-2xl border bg-background p-3.5 text-sm">
                  <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Subject & Batch</p>
                  <p className="mt-1 font-bold text-foreground">{subject} · {batch}</p>
                </div>
                <div className="rounded-2xl border bg-background p-3.5 text-sm">
                  <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Students Enrolled</p>
                  <p className="mt-1 font-bold text-foreground">{studentsInClass.length} students</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Teacher View - List of assigned homeworks */}
        {showTeacherView && !activeSubmissionsHomeworkId && (
          <div className="rounded-3xl border border-border bg-card p-6 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-base font-bold text-foreground">Assigned Homework List</h3>
                <p className="text-xs text-muted-foreground">List of homework assignments created by you.</p>
              </div>
              <button 
                onClick={() => refreshHomework(user)} 
                className="p-2 hover:bg-secondary rounded-full text-muted-foreground"
                title="Refresh Homework"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>

            {visibleHomework.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-border bg-background p-8 text-center text-sm text-muted-foreground">
                No homework assigned yet. Fill in the form above to assign homework to a class.
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {visibleHomework.map((hw) => (
                  <div key={hw.id} className="rounded-3xl border border-border bg-background p-5 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                          {hw.subject} · {hw.className}
                        </span>
                        <span className="text-xs text-muted-foreground font-medium">
                          Due: {hw.dueDate} {hw.dueTime}
                        </span>
                      </div>
                      
                      <h4 className="mt-3 font-bold text-foreground text-base leading-snug">{hw.title}</h4>
                      <p className="mt-2 text-sm text-muted-foreground line-clamp-3">{hw.description}</p>
                      
                      {hw.attachments && hw.attachments.length > 0 && (
                        <div className="mt-4">
                          <p className="text-xs font-semibold text-foreground">📄 Question Papers:</p>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {hw.attachments.map((file, idx) => (
                              <a
                                key={idx}
                                href={`${API_BASE}${file.path}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 bg-secondary hover:bg-secondary/80 text-[11px] font-medium text-foreground rounded-lg px-2.5 py-1 border transition"
                              >
                                <Download className="h-3 w-3" />
                                {file.originalname}
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="mt-6 border-t border-border/60 pt-4 flex items-center justify-between gap-2">
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => handleEditHomework(hw)}
                          className="p-2 hover:bg-secondary text-primary rounded-xl"
                          title="Edit Assignment"
                        >
                          <Edit3 className="h-4.5 w-4.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteHomework(hw.id)}
                          className="p-2 hover:bg-secondary text-red-500 rounded-xl"
                          title="Delete Homework"
                        >
                          <Trash2 className="h-4.5 w-4.5" />
                        </button>
                      </div>

                      <button
                        onClick={() => setActiveSubmissionsHomeworkId(hw.id)}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-xs font-bold text-primary-foreground hover:opacity-90 transition"
                      >
                        Submissions & Reports
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* --- TEACHER SUBMISSIONS VIEW & GRADING & REPORTING --- */}
        {showTeacherView && activeSubmissionsHomeworkId && (
          <div className="space-y-6">
            
            {/* Submissions header */}
            <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
              <button
                onClick={() => {
                  setActiveSubmissionsHomeworkId(null);
                  setReviewingStudentId(null);
                }}
                className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Homework List
              </button>

              <div className="flex gap-2">
                <button
                  onClick={() => handleExport('pdf')}
                  className="inline-flex items-center gap-2 rounded-xl border bg-card px-4 py-2 text-xs font-bold text-foreground hover:bg-secondary transition"
                >
                  <FileText className="h-4 w-4 text-red-500" />
                  Export PDF Report
                </button>
                <button
                  onClick={() => handleExport('excel')}
                  className="inline-flex items-center gap-2 rounded-xl border bg-card px-4 py-2 text-xs font-bold text-foreground hover:bg-secondary transition"
                >
                  <FileSpreadsheet className="h-4 w-4 text-emerald-500" />
                  Export Excel Report
                </button>
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
              
              {/* List of submissions */}
              <div className="rounded-3xl border border-border bg-card p-6 shadow-sm">
                <div className="mb-4">
                  <h3 className="text-lg font-bold text-foreground">Class Student Submissions</h3>
                  <p className="text-xs text-muted-foreground">
                    Showing submissions status for all students enrolled in class {reportData?.className}
                  </p>
                </div>

                {isLoading ? (
                  <div className="py-12 text-center text-sm text-muted-foreground">Loading submissions...</div>
                ) : (
                  <div className="divide-y divide-border">
                    {studentsInClass.map((stu) => {
                      const sub = submissions.find(s => s.studentId === stu.id);
                      
                      // Calculate status badge
                      const hw = homeworkList.find(h => h.id === activeSubmissionsHomeworkId);
                      let status = 'Pending Submission';
                      let statusColor = 'bg-yellow-100 text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-400';
                      let statusLabel = '🟡 Pending Submission';

                      if (sub) {
                        if (sub.submissionStatus === 'Reviewed') {
                          statusColor = 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400';
                          statusLabel = '🔵 Reviewed';
                          status = 'Reviewed';
                        } else {
                          statusColor = 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400';
                          statusLabel = '🟢 Submitted';
                          status = 'Submitted';
                        }
                      } else if (hw) {
                        const now = new Date();
                        const dateStr = `${hw.dueDate}T${hw.dueTime || '23:59'}:00`;
                        const dueDateTime = new Date(dateStr);
                        const isOverdue = isNaN(dueDateTime.getTime()) 
                          ? now > new Date(hw.dueDate + 'T23:59:59')
                          : now > dueDateTime;

                        if (isOverdue) {
                          statusColor = 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400';
                          statusLabel = '🔴 Overdue';
                          status = 'Overdue';
                        }
                      }

                      return (
                        <div key={stu.id} className="py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-foreground text-sm">{stu.fullName}</span>
                              <span className="text-xs text-muted-foreground">Roll: {stu.rollNumber}</span>
                            </div>
                            {sub && (
                              <p className="text-xs text-muted-foreground mt-1">
                                Submitted: {new Date(sub.submissionTime).toLocaleString('en-IN')}
                              </p>
                            )}
                          </div>

                          <div className="flex items-center gap-3">
                            <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusColor}`}>
                              {statusLabel}
                            </span>
                            
                            {sub ? (
                              <div className="flex gap-1.5">
                                <a
                                  href={`${API_BASE}${sub.filePath}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="p-2 hover:bg-secondary text-primary rounded-lg border"
                                  title="View / Download Submission"
                                >
                                  <Eye className="h-4 w-4" />
                                </a>
                                <button
                                  onClick={() => {
                                    setReviewingStudentId(stu.id);
                                    setRemarks(sub.remarks || '');
                                  }}
                                  className="px-3 py-1.5 bg-primary/10 text-primary hover:bg-primary/20 text-xs font-bold rounded-lg border transition"
                                >
                                  Review
                                </button>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground italic">No submission</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Grading Review Sidebar */}
              <div className="space-y-6">
                
                {/* Statistics Box */}
                <div className="rounded-3xl border border-border bg-card p-6 shadow-sm">
                  <h4 className="text-base font-bold text-foreground mb-4">Submission Metrics</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="rounded-2xl border p-3.5 bg-background text-center">
                      <p className="text-2xl font-bold text-primary">{reportData?.total}</p>
                      <p className="text-xs text-muted-foreground mt-1">Total Enrolled</p>
                    </div>
                    <div className="rounded-2xl border p-3.5 bg-background text-center">
                      <p className="text-2xl font-bold text-green-500">{reportData?.submitted}</p>
                      <p className="text-xs text-muted-foreground mt-1">Submitted</p>
                    </div>
                    <div className="rounded-2xl border p-3.5 bg-background text-center">
                      <p className="text-2xl font-bold text-blue-500">{reportData?.reviewed}</p>
                      <p className="text-xs text-muted-foreground mt-1">Reviewed</p>
                    </div>
                    <div className="rounded-2xl border p-3.5 bg-background text-center">
                      <p className="text-2xl font-bold text-red-500">{reportData?.overdue}</p>
                      <p className="text-xs text-muted-foreground mt-1">Overdue</p>
                    </div>
                  </div>
                </div>

                {/* Review Form */}
                {reviewingStudentId && (
                  <div className="rounded-3xl border border-border bg-card p-6 shadow-sm">
                    <h4 className="text-base font-bold text-foreground mb-4">
                      Review Submission from {
                        studentsInClass.find(s => s.id === reviewingStudentId)?.fullName
                      }
                    </h4>

                    {(() => {
                      const sub = submissions.find(s => s.studentId === reviewingStudentId);
                      if (!sub) return null;
                      return (
                        <div className="mb-4 text-xs bg-secondary/50 rounded-2xl p-4 border space-y-2">
                          <p>
                            <span className="font-semibold text-muted-foreground">Filename: </span>
                            <span className="font-medium text-foreground">{sub.fileName}</span>
                          </p>
                          <p>
                            <span className="font-semibold text-muted-foreground">Upload Size: </span>
                            <span className="font-medium text-foreground">
                              {(sub.fileSize / 1024).toFixed(1)} KB
                            </span>
                          </p>
                          <a
                            href={`${API_BASE}${sub.filePath}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-primary hover:underline font-bold"
                          >
                            <Download className="h-3 w-3" />
                            Download & Preview Submitted Homework
                          </a>
                        </div>
                      );
                    })()}

                    <label className="grid gap-2 text-sm font-semibold">
                      <span>Remarks / Feedback (Optional)</span>
                      <textarea
                        value={remarks}
                        onChange={(e) => setRemarks(e.target.value)}
                        placeholder="Add private remarks for the parent/student..."
                        rows={3}
                        className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary"
                      />
                    </label>

                    <div className="flex gap-2 justify-end pt-3">
                      <button
                        type="button"
                        onClick={() => setReviewingStudentId(null)}
                        className="px-3.5 py-2 rounded-xl border text-xs font-bold hover:bg-secondary"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={isLoading}
                        onClick={() => handleReviewSubmit(activeSubmissionsHomeworkId, reviewingStudentId)}
                        className="px-4 py-2 bg-primary text-primary-foreground hover:opacity-90 text-xs font-bold rounded-xl transition"
                      >
                        {isLoading ? 'Saving...' : 'Mark as Reviewed'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* --- PARENT PORTAL LAYOUT --- */}
        {showParentView && (
          <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
            
            {/* Parent Homework cards */}
            <div className="space-y-6">
              
              <div className="rounded-3xl border border-border bg-card p-6 shadow-sm">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b pb-4 mb-4">
                  <div>
                    <h3 className="text-lg font-bold text-foreground">Assigned Homework Tasks</h3>
                    <p className="text-xs text-muted-foreground">
                      Assigned lessons and questionnaires for your child.
                    </p>
                  </div>

                  {parentStudents.length > 1 && (
                    <label className="flex flex-col gap-1 text-xs">
                      <span className="font-semibold text-muted-foreground">Select child</span>
                      <select
                        value={selectedStudentId}
                        onChange={(e) => setSelectedStudentId(e.target.value)}
                        className="rounded-xl border border-input bg-input-background px-3 py-2 text-xs font-bold focus:outline-none"
                      >
                        {parentStudents.map((stu) => (
                          <option key={stu.id} value={stu.id}>
                            {stu.fullName} · {stu.className}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>

                {visibleHomework.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-border bg-background p-8 text-center text-sm text-muted-foreground">
                    No homework assignments have been posted for your student's class yet.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {visibleHomework.map((hw) => {
                      const status = getHomeworkStatus(hw, selectedStudent.id);
                      const submission = parentSubmissions[hw.id];
                      
                      let badgeColor = 'bg-yellow-100 text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-400';
                      let statusLabel = '🟡 Pending Submission';

                      if (status === 'Reviewed') {
                        badgeColor = 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400';
                        statusLabel = '🔵 Reviewed';
                      } else if (status === 'Submitted') {
                        badgeColor = 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400';
                        statusLabel = '🟢 Submitted';
                      } else if (status === 'Overdue') {
                        badgeColor = 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400';
                        statusLabel = '🔴 Overdue';
                      }

                      return (
                        <div key={hw.id} className="rounded-3xl border border-border bg-background p-5 space-y-4">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <h4 className="font-bold text-foreground text-base leading-snug">{hw.title}</h4>
                                <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-bold ${badgeColor}`}>
                                  {statusLabel}
                                </span>
                              </div>
                              <p className="text-xs text-muted-foreground mt-1">
                                Subject: <span className="font-semibold">{hw.subject}</span> | Assigned by: {hw.assignedBy}
                              </p>
                            </div>
                            <div className="text-xs text-muted-foreground text-left sm:text-right font-medium shrink-0">
                              <span className="text-red-500 font-semibold">Due: {hw.dueDate} {hw.dueTime}</span>
                            </div>
                          </div>

                          <p className="text-sm text-muted-foreground whitespace-pre-line">{hw.description}</p>
                          
                          {/* Teacher's question paper / guides */}
                          {hw.attachments && hw.attachments.length > 0 && (
                            <div className="bg-secondary/40 border rounded-2xl p-3.5">
                              <p className="text-xs font-semibold text-foreground mb-2">📄 Question Paper & Material:</p>
                              <div className="flex flex-wrap gap-2">
                                {hw.attachments.map((file, idx) => (
                                  <a
                                    key={idx}
                                    href={`${API_BASE}${file.path}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1.5 bg-card hover:bg-secondary text-xs font-semibold text-foreground rounded-lg px-3 py-1.5 border transition"
                                  >
                                    <Download className="h-3.5 w-3.5 text-primary" />
                                    {file.originalname}
                                  </a>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Submission Details block */}
                          {submission && (
                            <div className="border-t border-border/80 pt-4 space-y-3">
                              <div className="flex flex-wrap items-center justify-between gap-3 bg-emerald-50 dark:bg-emerald-950/20 p-3 rounded-2xl border border-emerald-100 dark:border-emerald-900/40 text-xs">
                                <div>
                                  <p className="font-bold text-emerald-800 dark:text-emerald-400">✅ Submitted File: {submission.fileName}</p>
                                  <p className="text-muted-foreground text-[10px] mt-0.5">
                                    Uploaded: {new Date(submission.submissionTime).toLocaleString('en-IN')}
                                  </p>
                                </div>
                                <div className="flex gap-2">
                                  <a
                                    href={`${API_BASE}${submission.filePath}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="p-1.5 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 rounded-lg"
                                    title="View Submitted File"
                                  >
                                    <Eye className="h-4.5 w-4.5" />
                                  </a>
                                  <button
                                    onClick={() => handleRemoveSubmission(hw.id)}
                                    className="p-1.5 hover:bg-red-50 text-red-500 rounded-lg"
                                    title="Remove Submission"
                                  >
                                    <Trash2 className="h-4.5 w-4.5" />
                                  </button>
                                </div>
                              </div>

                              {submission.remarks && (
                                <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/40 p-4 rounded-2xl text-xs">
                                  <p className="font-bold text-blue-800 dark:text-blue-400 mb-1">📝 Teacher Feedback & Remarks:</p>
                                  <p className="text-foreground leading-relaxed italic">"{submission.remarks}"</p>
                                  <p className="text-[10px] text-muted-foreground mt-2 text-right">
                                    Reviewed by {submission.reviewedBy} on {submission.reviewedAt ? new Date(submission.reviewedAt).toLocaleDateString('en-IN') : ''}
                                  </p>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Upload submission form (if not reviewed yet) */}
                          {(!submission || submission.submissionStatus !== 'Reviewed') && (
                            <div className="border-t border-border/80 pt-4 flex flex-col gap-3">
                              <p className="text-xs font-semibold text-foreground">
                                {submission ? '🔄 Replace Submission File' : '📤 Upload Child\'s Finished Homework:'}
                              </p>
                              
                              <div className="flex flex-wrap items-center gap-3">
                                <input
                                  type="file"
                                  id={`parent-homework-submit-${hw.id}`}
                                  onChange={(e) => {
                                    if (e.target.files && e.target.files[0]) {
                                      setSubmissionFile(e.target.files[0]);
                                    }
                                  }}
                                  className="hidden"
                                />
                                <label
                                  htmlFor={`parent-homework-submit-${hw.id}`}
                                  className="inline-flex items-center gap-2 rounded-xl bg-secondary hover:bg-secondary/80 text-foreground px-4 py-2 text-xs font-bold cursor-pointer transition border"
                                >
                                  <Upload className="h-4 w-4 text-muted-foreground" />
                                  {submissionFile ? 'Change Selected File' : 'Select Homework File'}
                                </label>
                                
                                {submissionFile && (
                                  <span className="text-xs font-medium text-foreground truncate max-w-[200px]">
                                    Selected: {submissionFile.name}
                                  </span>
                                )}

                                {submissionFile && (
                                  <button
                                    onClick={() => handleSubmitHomework(hw.id)}
                                    disabled={isSubmitting}
                                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 text-xs font-bold transition disabled:opacity-50"
                                  >
                                    {isSubmitting ? 'Uploading...' : submission ? 'Replace Submission' : 'Submit Homework'}
                                  </button>
                                )}
                              </div>
                              <p className="text-[10px] text-muted-foreground">
                                Supported files: PDF, DOC, DOCX, Images (PNG, JPG)
                              </p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Parent student profile summary card */}
            <div className="space-y-6 h-fit">
              <div className="rounded-3xl border border-border bg-card p-6 shadow-sm">
                <h4 className="text-base font-bold text-foreground mb-4">Child Student Profile</h4>
                <div className="space-y-4">
                  <div className="flex items-center gap-3 bg-secondary/30 p-3 rounded-2xl">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-xl font-bold text-primary">
                      {selectedStudent?.fullName.charAt(0)}
                    </div>
                    <div>
                      <p className="font-bold text-foreground text-sm">{selectedStudent?.fullName}</p>
                      <p className="text-xs text-muted-foreground">{selectedStudent?.admissionNumber}</p>
                    </div>
                  </div>

                  <div className="rounded-2xl border bg-background p-3.5 text-xs space-y-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground font-medium">Class:</span>
                      <span className="font-bold text-foreground">{selectedStudent?.className}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground font-medium">Roll Number:</span>
                      <span className="font-bold text-foreground">{selectedStudent?.rollNumber}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground font-medium">Branch:</span>
                      <span className="font-bold text-foreground">{selectedStudent?.branchName}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
