import { useEffect, useState, useMemo } from 'react';
import { Header } from '../components/Header';
import { useAuth } from '../auth/AuthContext';
import { PDFTemplateService } from '../lib/pdfTemplateService';
import { apiFetch } from '../lib/apiClient';
import { 
  Calendar, Clock, MapPin, FileText, User, Plus, Edit2, 
  Trash2, XCircle, CheckCircle2, Download, AlertCircle, RefreshCw, BarChart2 
} from 'lucide-react';

interface SpecialClass {
  id: number;
  title: string;
  subject: string;
  branchId: string;
  className: string;
  batch: string;
  date: string;
  startTime: string;
  endTime: string;
  venue: string;
  purpose: string;
  description: string;
  attachmentPath: string;
  status: 'Published' | 'Edited' | 'Cancelled' | 'Rescheduled';
  teacherId: string;
  teacherName: string;
  createdAt: string;
}

interface Student {
  id: string;
  fullName: string;
  rollNumber: string;
  className: string;
  branchId: string;
}

interface BonusAttendanceRecord {
  id: number;
  studentId: string;
  studentName: string;
  specialClassId: number;
  date: string;
  attendanceStatus: 'present' | 'absent';
  teacherName: string;
  branchId: string;
}

export function SpecialClasses() {
  const { user } = useAuth();
  const [classes, setClasses] = useState<SpecialClass[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>('All');
  const [loading, setLoading] = useState(true);
  const [branches, setBranches] = useState<any[]>([]);

  // Modals state
  const [isScheduleOpen, setIsScheduleOpen] = useState(false);
  const [isAttendanceOpen, setIsAttendanceOpen] = useState(false);
  const [selectedClass, setSelectedClass] = useState<SpecialClass | null>(null);
  const [attendanceRecords, setAttendanceRecords] = useState<Record<string, 'present' | 'absent'>>({});
  const [existingAttendance, setExistingAttendance] = useState<BonusAttendanceRecord[]>([]);

  // Form fields
  const [editId, setEditId] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('Mathematics');
  const [branchId, setBranchId] = useState('');
  const [className, setClassName] = useState('10th A');
  const [batch, setBatch] = useState('Batch A');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [venue, setVenue] = useState('');
  const [purpose, setPurpose] = useState('Revision');
  const [description, setDescription] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);

  // Load data
  const loadClasses = async () => {
    try {
      setLoading(true);
      const url = `/api/special-classes`;
      const res = await apiFetch(url);
      const data = await res.json();
      setClasses(Array.isArray(data) ? data : []);

      const branchRes = await apiFetch('/api/branches');
      const branchData = await branchRes.json();
      setBranches(Array.isArray(branchData) ? branchData : []);

      const studRes = await apiFetch('/api/students');
      const studData = await studRes.json();
      setStudents(Array.isArray(studData) ? studData : []);
    } catch (e) {
      console.error('Error fetching data:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadClasses();
  }, []);

  useEffect(() => {
    if (user) {
      setBranchId(user.branchId || 'branch_rajajinagar');
    }
  }, [user]);

  // Filter classes based on role and branch selection
  const filteredClasses = useMemo(() => {
    if (!user) return [];
    let items = classes;

    // Super Admin filter
    if (user.role === 'super_admin') {
      if (selectedBranch !== 'All') {
        items = items.filter(c => c.branchId === selectedBranch);
      }
    } 
    // Admin filter
    else if (user.role === 'admin') {
      items = items.filter(c => c.branchId === user.branchId);
    } 
    // Teacher filter
    else if (user.role === 'teacher') {
      items = items.filter(c => c.teacherId === user.id);
    } 
    // Parent filter
    else if (user.role === 'parent') {
      // Find classes matching the parent's children's classes
      const parentStudents = students.filter(s => user.linkedStudentIds?.includes(s.id));
      const childClasses = parentStudents.map(s => s.className);
      items = items.filter(c => childClasses.includes(c.className) && c.branchId === user.branchId);
    }

    return items;
  }, [classes, user, selectedBranch, students]);

  // Stats summaries
  const stats = useMemo(() => {
    const total = filteredClasses.length;
    const upcoming = filteredClasses.filter(c => c.status !== 'Cancelled' && new Date(c.date + 'T' + c.startTime) > new Date()).length;
    const completed = filteredClasses.filter(c => c.status !== 'Cancelled' && new Date(c.date + 'T' + c.startTime) <= new Date()).length;
    const cancelled = filteredClasses.filter(c => c.status === 'Cancelled').length;
    return { total, upcoming, completed, cancelled };
  }, [filteredClasses]);

  // Schedule class
  const handleScheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !date || !startTime || !endTime || !venue) {
      alert('Please fill out all required fields');
      return;
    }

    const formData = new FormData();
    formData.append('title', title);
    formData.append('subject', subject);
    formData.append('branchId', user?.role === 'super_admin' ? branchId : (user?.branchId || 'branch_rajajinagar'));
    formData.append('className', className);
    formData.append('batch', batch);
    formData.append('date', date);
    formData.append('startTime', startTime);
    formData.append('endTime', endTime);
    formData.append('venue', venue);
    formData.append('purpose', purpose);
    formData.append('description', description);
    formData.append('teacherId', user?.id || 'teacher_kumar');
    formData.append('teacherName', user?.name || 'Mr. Kumar');
    if (attachment) {
      formData.append('attachment', attachment);
    }

    try {
      const url = editId ? `/api/special-classes/${editId}` : `/api/special-classes`;
      const method = editId ? 'PUT' : 'POST';
      
      if (editId) {
        formData.append('status', 'Edited');
      }

      const res = await apiFetch(url, {
        method,
        body: formData
      });

      if (res.ok) {
        setIsScheduleOpen(false);
        resetForm();
        loadClasses();
      } else {
        alert('Failed to save special class');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const resetForm = () => {
    setEditId(null);
    setTitle('');
    setSubject('Mathematics');
    setClassName('10th A');
    setBatch('Batch A');
    setDate('');
    setStartTime('');
    setEndTime('');
    setVenue('');
    setPurpose('Revision');
    setDescription('');
    setAttachment(null);
  };

  const handleEditClick = (c: SpecialClass) => {
    setEditId(c.id);
    setTitle(c.title);
    setSubject(c.subject);
    setBranchId(c.branchId);
    setClassName(c.className);
    setBatch(c.batch);
    setDate(c.date);
    setStartTime(c.startTime);
    setEndTime(c.endTime);
    setVenue(c.venue);
    setPurpose(c.purpose);
    setDescription(c.description);
    setIsScheduleOpen(true);
  };

  const handleCancelClick = async (id: number) => {
    if (!confirm('Are you sure you want to cancel this Special Class?')) return;
    try {
      const res = await apiFetch(`/api/special-classes/${id}`, { method: 'DELETE' });
      if (res.ok) {
        loadClasses();
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Open Attendance modal
  const openAttendanceModal = async (c: SpecialClass) => {
    setSelectedClass(c);
    setIsAttendanceOpen(true);
    
    // Fetch students of this class
    const classStudents = students.filter(s => s.className === c.className && s.branchId === c.branchId);
    
    // Fetch existing attendance
    try {
      const res = await apiFetch(`/api/special-classes/${c.id}/attendance`);
      const data: BonusAttendanceRecord[] = await res.json();
      const attendanceData = Array.isArray(data) ? data : [];
      setExistingAttendance(attendanceData);

      const records: Record<string, 'present' | 'absent'> = {};
      classStudents.forEach(s => {
        const found = attendanceData.find(r => r.studentId === s.id);
        records[s.id] = found ? found.attendanceStatus : 'absent';
      });
      setAttendanceRecords(records);
    } catch (e) {
      console.error(e);
    }
  };

  // Submit Attendance
  const handleAttendanceSubmit = async () => {
    if (!selectedClass) return;
    try {
      const res = await apiFetch(`/api/special-classes/${selectedClass.id}/attendance`, {
        method: 'POST',
        body: {
          attendanceRecords,
          markedBy: user?.name || 'Teacher',
          date: selectedClass.date,
          branchId: selectedClass.branchId
        }
      });
      if (res.ok) {
        setIsAttendanceOpen(false);
        loadClasses();
        alert('Bonus attendance recorded successfully!');
      } else {
        alert('Failed to save attendance');
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Export PDF Report for a specific class
  const exportClassPDF = async (c: SpecialClass) => {
    const classStudents = students.filter(s => s.className === c.className && s.branchId === c.branchId);
    
    // Calculate attendance summary
    let presentCount = 0;
    let absentCount = 0;
    const rows = classStudents.map(s => {
      const record = existingAttendance.find(r => r.studentId === s.id);
      const status = record ? record.attendanceStatus : 'absent';
      if (status === 'present') presentCount++;
      else absentCount++;
      return [s.fullName, s.id, s.rollNumber, status.toUpperCase()];
    });

    const pdfService = new PDFTemplateService();
    pdfService.addTitle('Special Class Attendance & Bonus Summary Report');
    
    const detailsBody = [
      ['Class Title', c.title],
      ['Subject / Purpose', `${c.subject} (${c.purpose})`],
      ['Teacher', c.teacherName],
      ['Date & Time', `${c.date} (${c.startTime} - ${c.endTime})`],
      ['Venue', c.venue]
    ];
    pdfService.addTable([['Detail', 'Value']], detailsBody);
    
    pdfService.addSectionHeading('Attendance Summary Metrics');
    const summaryBody = [
      ['Total Class Strength', String(classStudents.length)],
      ['Present', String(presentCount)],
      ['Absent', String(absentCount)],
      ['Attendance Rate', `${classStudents.length > 0 ? Math.round((presentCount / classStudents.length) * 100) : 0}%`]
    ];
    pdfService.addTable([['Metric', 'Value']], summaryBody);

    pdfService.addSectionHeading('Student Attendance Details');
    const headers = ['Student Name', 'ID', 'Roll No', 'Status (Bonus)'];
    pdfService.addTable([headers], rows);

    await pdfService.exportWithLetterhead(`Special_Class_${c.id}_Attendance_Report.pdf`);
  };

  const getBranchName = (id: string) => {
    const b = branches.find(x => x.id === id);
    return b ? b.name : id;
  };

  return (
    <div className="flex-1 bg-background text-foreground animate-fade-in">
      <Header title="Special Classes & Bonus Attendance" />

      <div className="max-w-7xl mx-auto p-6 space-y-6">
        
        {/* Top filter / control panel */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between bg-card p-4 rounded-2xl border border-border shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
              <Calendar className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold">Extra Class Schedule</h2>
              <p className="text-xs text-muted-foreground">Manage extra sessions and award bonus attendance markers.</p>
            </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-3">
            {user?.role === 'super_admin' && (
              <select 
                value={selectedBranch} 
                onChange={(e) => setSelectedBranch(e.target.value)}
                className="rounded-xl border border-input bg-input-background px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="All">All Branches</option>
                {branches.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            )}

            {(user?.role === 'teacher' || user?.role === 'admin') && (
              <button 
                onClick={() => { resetForm(); setIsScheduleOpen(true); }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 shadow-sm"
              >
                <Plus className="h-4 w-4" /> Schedule Extra Class
              </button>
            )}
          </div>
        </div>

        {/* Dashboard summary stats */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {[
            { label: 'Total Scheduled', value: stats.total, color: 'text-primary' },
            { label: 'Upcoming', value: stats.upcoming, color: 'text-amber-500' },
            { label: 'Completed', value: stats.completed, color: 'text-green-500' },
            { label: 'Cancelled', value: stats.cancelled, color: 'text-red-500' }
          ].map((stat, idx) => (
            <div key={idx} className="bg-card p-5 rounded-2xl border border-border shadow-sm flex flex-col justify-between hover:border-primary/20 transition-all">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{stat.label}</p>
              <p className={`text-3xl font-extrabold mt-2 ${stat.color}`}>{stat.value}</p>
            </div>
          ))}
        </div>

        {/* Special Classes listing */}
        {loading ? (
          <div className="flex justify-center items-center py-12">
            <RefreshCw className="h-6 w-6 animate-spin text-primary" />
            <span className="ml-2.5 text-sm text-muted-foreground">Loading scheduled extra classes...</span>
          </div>
        ) : filteredClasses.length === 0 ? (
          <div className="bg-card p-12 text-center rounded-2xl border border-border">
            <AlertCircle className="h-10 w-10 mx-auto text-muted-foreground" />
            <h3 className="text-base font-bold mt-4">No Special Classes Found</h3>
            <p className="text-sm text-muted-foreground mt-1">There are no special or extra revision classes scheduled currently.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {filteredClasses.map(c => {
              const isPast = new Date(c.date + 'T' + c.startTime) <= new Date();
              return (
                <div key={c.id} className="relative bg-card rounded-2xl border border-border shadow-sm overflow-hidden flex flex-col justify-between group hover:border-primary/40 transition-colors">
                  <div className={`h-1.5 w-full ${
                    c.status === 'Cancelled' ? 'bg-red-500' : isPast ? 'bg-green-500' : 'bg-primary'
                  }`} />
                  
                  <div className="p-5 flex-1 space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                        {c.subject}
                      </span>
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        c.status === 'Cancelled' 
                          ? 'bg-red-100 text-red-700 dark:bg-red-950/20 dark:text-red-400'
                          : c.status === 'Rescheduled'
                          ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400'
                          : 'bg-green-100 text-green-700 dark:bg-green-950/20 dark:text-green-400'
                      }`}>
                        {c.status}
                      </span>
                    </div>

                    <div>
                      <h3 className="text-base font-bold text-foreground line-clamp-1">{c.title}</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">Purpose: {c.purpose}</p>
                    </div>

                    <div className="space-y-2 text-xs text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-3.5 w-3.5 text-primary shrink-0" />
                        <span>{c.date}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Clock className="h-3.5 w-3.5 text-primary shrink-0" />
                        <span>{c.startTime} - {c.endTime}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <MapPin className="h-3.5 w-3.5 text-primary shrink-0" />
                        <span>{c.venue}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <User className="h-3.5 w-3.5 text-primary shrink-0" />
                        <span>Teacher: {c.teacherName}</span>
                      </div>
                    </div>

                    {c.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2 italic bg-muted/30 p-2.5 rounded-lg border border-border/50">
                        {c.description}
                      </p>
                    )}

                    {c.attachmentPath && (
                      <a 
                        href={c.attachmentPath} 
                        download
                        className="inline-flex items-center gap-1.5 text-xs text-primary font-medium hover:underline"
                      >
                        <Download className="h-3.5 w-3.5" /> Download Attachment
                      </a>
                    )}
                  </div>

                  <div className="px-5 py-4 border-t border-border bg-muted/20 flex flex-wrap items-center justify-between gap-3">
                    {user?.role === 'teacher' && c.status !== 'Cancelled' && (
                      <div className="flex items-center gap-2 w-full justify-between">
                        <button
                          onClick={() => openAttendanceModal(c)}
                          className="inline-flex items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-green-700"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" /> Mark Attendance
                        </button>

                        <div className="flex items-center gap-1.5">
                          <button onClick={() => handleEditClick(c)} className="p-1.5 rounded-lg border border-border bg-card hover:bg-secondary/40 text-muted-foreground">
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => handleCancelClick(c.id)} className="p-1.5 rounded-lg border border-border bg-card hover:bg-red-50 text-red-500">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    )}

                    {user?.role === 'admin' && (
                      <div className="flex items-center gap-2 w-full justify-between">
                        <button
                          onClick={() => { openAttendanceModal(c).then(() => exportClassPDF(c)); }}
                          className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-secondary"
                        >
                          <Download className="h-3.5 w-3.5" /> Export PDF
                        </button>
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => handleEditClick(c)} className="p-1.5 rounded-lg border border-border bg-card hover:bg-secondary/40 text-muted-foreground">
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => handleCancelClick(c.id)} className="p-1.5 rounded-lg border border-border bg-card hover:bg-red-50 text-red-500">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    )}

                    {user?.role === 'super_admin' && (
                      <button
                        onClick={() => { openAttendanceModal(c).then(() => exportClassPDF(c)); }}
                        className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition hover:opacity-90"
                      >
                        <Download className="h-3.5 w-3.5" /> Export PDF
                      </button>
                    )}

                    {user?.role === 'parent' && (
                      <span className="text-xs text-muted-foreground">
                        Class: {c.className} ({c.batch})
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

      </div>

      {/* Schedule / Edit Modal */}
      {isScheduleOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-lg font-bold text-foreground">{editId ? 'Reschedule Special Class' : 'Schedule Special Class'}</h3>
              <button onClick={() => setIsScheduleOpen(false)} className="rounded-lg p-1.5 hover:bg-secondary/40 text-muted-foreground">
                <XCircle className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleScheduleSubmit} className="space-y-4 text-sm">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="font-semibold text-muted-foreground">Title *</label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="E.g. Algebra Revision Class"
                    className="w-full rounded-xl border border-input bg-input-background px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="font-semibold text-muted-foreground">Subject *</label>
                  <select
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="w-full rounded-xl border border-input bg-input-background px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option>Mathematics</option>
                    <option>Physics</option>
                    <option>Chemistry</option>
                    <option>Biology</option>
                    <option>English</option>
                    <option>History</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {user?.role === 'super_admin' && (
                  <div className="space-y-1.5">
                    <label className="font-semibold text-muted-foreground">Branch *</label>
                    <select
                      value={branchId}
                      onChange={(e) => setBranchId(e.target.value)}
                      className="w-full rounded-xl border border-input bg-input-background px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      {branches.map(b => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="font-semibold text-muted-foreground">Class *</label>
                  <select
                    value={className}
                    onChange={(e) => setClassName(e.target.value)}
                    className="w-full rounded-xl border border-input bg-input-background px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option>10th A</option>
                    <option>10th B</option>
                    <option>10th C</option>
                    <option>9th A</option>
                    <option>9th B</option>
                    <option>11th A</option>
                    <option>11th B</option>
                    <option>12th A</option>
                    <option>12th B</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="font-semibold text-muted-foreground">Batch *</label>
                  <select
                    value={batch}
                    onChange={(e) => setBatch(e.target.value)}
                    className="w-full rounded-xl border border-input bg-input-background px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option>Batch A</option>
                    <option>Batch B</option>
                    <option>Batch C</option>
                    <option>Morning</option>
                    <option>Evening</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <label className="font-semibold text-muted-foreground">Date *</label>
                  <input
                    type="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full rounded-xl border border-input bg-input-background px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="font-semibold text-muted-foreground">Start Time *</label>
                  <input
                    type="time"
                    required
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full rounded-xl border border-input bg-input-background px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="font-semibold text-muted-foreground">End Time *</label>
                  <input
                    type="time"
                    required
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="w-full rounded-xl border border-input bg-input-background px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="font-semibold text-muted-foreground">Venue *</label>
                  <input
                    type="text"
                    required
                    value={venue}
                    onChange={(e) => setVenue(e.target.value)}
                    placeholder="E.g. Room 204"
                    className="w-full rounded-xl border border-input bg-input-background px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="font-semibold text-muted-foreground">Purpose *</label>
                  <select
                    value={purpose}
                    onChange={(e) => setPurpose(e.target.value)}
                    className="w-full rounded-xl border border-input bg-input-background px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option>Revision</option>
                    <option>Doubt Clearing</option>
                    <option>Extra Coaching</option>
                    <option>Practical</option>
                    <option>Exam Preparation</option>
                    <option>Seminar</option>
                    <option>Workshop</option>
                    <option>Other</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-muted-foreground">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Additional class details or instructions..."
                  rows={2}
                  className="w-full rounded-xl border border-input bg-input-background px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-muted-foreground">Attachment (PDF, Images, DOC, PPT)</label>
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.ppt,.pptx"
                  onChange={(e) => setAttachment(e.target.files?.[0] || null)}
                  className="w-full rounded-xl border border-input bg-input-background px-3.5 py-1 text-sm focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-3 border-t border-border pt-4">
                <button
                  type="button"
                  onClick={() => setIsScheduleOpen(false)}
                  className="rounded-xl border border-border px-4 py-2 hover:bg-secondary/40 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-primary px-4 py-2 text-primary-foreground hover:opacity-90 font-semibold"
                >
                  {editId ? 'Update & Publish' : 'Publish Announcement'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Mark Attendance Modal */}
      {isAttendanceOpen && selectedClass && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="w-full max-w-2xl rounded-2xl border border-border bg-card p-6 shadow-xl space-y-4 animate-zoom-in">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="text-lg font-bold text-foreground">Mark Bonus Attendance</h3>
                <p className="text-xs text-muted-foreground">{selectedClass.title} ({selectedClass.className})</p>
              </div>
              <button onClick={() => setIsAttendanceOpen(false)} className="rounded-lg p-1.5 hover:bg-secondary/40 text-muted-foreground">
                <XCircle className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-96 overflow-y-auto border border-border rounded-xl">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted text-muted-foreground font-semibold">
                  <tr>
                    <th className="p-3">Student Name</th>
                    <th className="p-3">ID</th>
                    <th className="p-3">Roll No</th>
                    <th className="p-3 text-center">Bonus Attendance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {students.filter(s => s.className === selectedClass.className && s.branchId === selectedClass.branchId).map(student => (
                    <tr key={student.id} className="hover:bg-secondary/10">
                      <td className="p-3 font-semibold text-foreground">{student.fullName}</td>
                      <td className="p-3 text-muted-foreground">{student.id}</td>
                      <td className="p-3 text-muted-foreground">{student.rollNumber}</td>
                      <td className="p-3">
                        <div className="flex justify-center gap-3">
                          <button
                            onClick={() => setAttendanceRecords(prev => ({ ...prev, [student.id]: 'present' }))}
                            className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${
                              attendanceRecords[student.id] === 'present'
                                ? 'bg-green-600 text-white shadow-sm'
                                : 'bg-secondary/40 text-muted-foreground hover:bg-secondary'
                            }`}
                          >
                            Present
                          </button>
                          <button
                            onClick={() => setAttendanceRecords(prev => ({ ...prev, [student.id]: 'absent' }))}
                            className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${
                              attendanceRecords[student.id] === 'absent'
                                ? 'bg-red-500 text-white shadow-sm'
                                : 'bg-secondary/40 text-muted-foreground hover:bg-secondary'
                            }`}
                          >
                            Absent
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between items-center border-t border-border pt-4">
              <button
                onClick={() => exportClassPDF(selectedClass)}
                className="inline-flex items-center gap-1 rounded-xl border border-border px-4 py-2 hover:bg-secondary/40 font-semibold"
              >
                <Download className="h-4 w-4" /> Export Report (PDF)
              </button>
              
              <div className="flex gap-3">
                <button
                  onClick={() => setIsAttendanceOpen(false)}
                  className="rounded-xl border border-border px-4 py-2 hover:bg-secondary/40 font-semibold"
                >
                  Close
                </button>
                <button
                  onClick={handleAttendanceSubmit}
                  className="rounded-xl bg-primary px-5 py-2 text-primary-foreground hover:opacity-90 font-semibold"
                >
                  Save Attendance
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
