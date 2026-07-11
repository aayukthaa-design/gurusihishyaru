import { useMemo, useState, useEffect } from 'react';
import { useSchoolExamSchedules, getAttachmentUrl, formatScheduleDate } from '../lib/schoolExamScheduleService';
import { Header } from '../components/Header';
import { useAuth } from '../auth/AuthContext';
import { getBranches, getBranchName, filterByBranch } from '../lib/branchService';
import { enrollAdmissionByApplicantName } from '../lib/admissionService';
import { useStudents, addStudentAPI, updateStudentAPI, refreshStudents } from '../lib/studentService';
import {
  Users, Plus, Search, Eye, Edit2, ChevronRight,
  X, GraduationCap, Phone, MapPin, CalendarDays,
} from 'lucide-react';

interface Student {
  branchId?: string;
  id: string;
  firstName: string;
  lastName: string;
  gender: 'Male' | 'Female' | 'Other';
  dob: string;
  parentName: string;
  parentMobile: string;
  address: string;
  class: string;
  batch: string;
  admissionDate: string;
  status: 'Active' | 'Inactive';

  // Parent Information
  fatherName: string;
  motherName: string;
  primaryParentName: string;
  relationship: string;
  fatherMobile: string;
  motherMobile: string;
  primaryParentMobile: string;
  parentEmail: string;
  guardianName?: string;
  guardianMobile?: string;
}

const CLASSES = ['8th A', '8th B', '9th A', '9th B', '10th A', '10th B', '10th C', '11th A', '11th B', '12th A', '12th B'];
const BATCHES = ['Batch A', 'Batch B', 'Batch C', 'Morning', 'Evening'];

const EMPTY_FORM: Omit<Student, 'id'> = {
  branchId: '',
  firstName: '',
  lastName: '',
  gender: 'Male',
  dob: '',
  parentName: '',
  parentMobile: '',
  address: '',
  class: '',
  batch: '',
  admissionDate: '',
  status: 'Active',
  fatherName: '',
  motherName: '',
  primaryParentName: '',
  relationship: 'Father',
  fatherMobile: '',
  motherMobile: '',
  primaryParentMobile: '',
  parentEmail: '',
  guardianName: '',
  guardianMobile: '',
};

function StudentForm({
  initial,
  onSave,
  onClose,
  isEdit,
  branchOptions,
  defaultBranchId,
}: {
  initial: Omit<Student, 'id'>;
  onSave: (data: Omit<Student, 'id'>) => void;
  onClose: () => void;
  isEdit: boolean;
  branchOptions: Array<{ id: string; name: string }>;
  defaultBranchId?: string;
}) {
  const [form, setForm] = useState(initial);
  const set = (k: keyof typeof form, v: string) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">{isEdit ? 'Edit Student' : 'Add New Student'}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Fill all required fields marked with *</p>
        </div>
        <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-foreground">First Name <span className="text-destructive">*</span></label>
          <input value={form.firstName} onChange={(e) => set('firstName', e.target.value)} placeholder="e.g. Arjun" className="field" />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-foreground">Last Name <span className="text-destructive">*</span></label>
          <input value={form.lastName} onChange={(e) => set('lastName', e.target.value)} placeholder="e.g. Sharma" className="field" />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-foreground">Gender <span className="text-destructive">*</span></label>
          <select value={form.gender} onChange={(e) => set('gender', e.target.value)} className="field">
            <option>Male</option><option>Female</option><option>Other</option>
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-foreground">Date of Birth <span className="text-destructive">*</span></label>
          <input type="date" value={form.dob} onChange={(e) => set('dob', e.target.value)} className="field" />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-foreground">Class <span className="text-destructive">*</span></label>
          <select value={form.class} onChange={(e) => set('class', e.target.value)} className="field">
            <option value="">Select class…</option>
            {CLASSES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-foreground">Batch <span className="text-destructive">*</span></label>
          <select value={form.batch} onChange={(e) => set('batch', e.target.value)} className="field">
            <option value="">Select batch…</option>
            {BATCHES.map((b) => <option key={b}>{b}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-foreground">Admission Date <span className="text-destructive">*</span></label>
          <input type="date" value={form.admissionDate} onChange={(e) => set('admissionDate', e.target.value)} className="field" />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-foreground">Assigned Branch</label>
          <select value={form.branchId || defaultBranchId || ''} onChange={(e) => set('branchId', e.target.value)} className="field">
            <option value="">All branches</option>
            {branchOptions.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-foreground">Status</label>
          <select value={form.status} onChange={(e) => set('status', e.target.value as 'Active' | 'Inactive')} className="field">
            <option>Active</option><option>Inactive</option>
          </select>
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <label className="mb-1.5 block text-sm font-medium text-foreground">Address</label>
          <input value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="e.g. 123, MG Road, Bangalore" className="field" />
        </div>

        {/* Parent Information Section */}
        <div className="sm:col-span-2 lg:col-span-3 mt-4 border-t border-border pt-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">Parent Information</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Father Name</label>
              <input value={form.fatherName || ''} onChange={(e) => {
                set('fatherName', e.target.value);
                if (form.relationship === 'Father') {
                  setForm(prev => ({ ...prev, fatherName: e.target.value, parentName: e.target.value, primaryParentName: e.target.value }));
                }
              }} placeholder="Father Name" className="field" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Mother Name</label>
              <input value={form.motherName || ''} onChange={(e) => {
                set('motherName', e.target.value);
                if (form.relationship === 'Mother') {
                  setForm(prev => ({ ...prev, motherName: e.target.value, parentName: e.target.value, primaryParentName: e.target.value }));
                }
              }} placeholder="Mother Name" className="field" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Primary Parent / Guardian Name <span className="text-destructive">*</span></label>
              <input value={form.primaryParentName || ''} onChange={(e) => {
                setForm(prev => ({ ...prev, primaryParentName: e.target.value, parentName: e.target.value }));
              }} placeholder="e.g. Robert Johnson" className="field" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Relationship <span className="text-destructive">*</span></label>
              <select value={form.relationship || 'Father'} onChange={(e) => {
                set('relationship', e.target.value);
                let pName = form.primaryParentName;
                if (e.target.value === 'Father' && form.fatherName) pName = form.fatherName;
                if (e.target.value === 'Mother' && form.motherName) pName = form.motherName;
                if (e.target.value === 'Guardian' && form.guardianName) pName = form.guardianName;
                
                let pMobile = form.primaryParentMobile;
                if (e.target.value === 'Father' && form.fatherMobile) pMobile = form.fatherMobile;
                if (e.target.value === 'Mother' && form.motherMobile) pMobile = form.motherMobile;
                if (e.target.value === 'Guardian' && form.guardianMobile) pMobile = form.guardianMobile;

                setForm(prev => ({ 
                  ...prev, 
                  relationship: e.target.value, 
                  primaryParentName: pName,
                  parentName: pName,
                  primaryParentMobile: pMobile,
                  parentMobile: pMobile
                }));
              }} className="field">
                <option>Father</option>
                <option>Mother</option>
                <option>Guardian</option>
                <option>Other</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Father Mobile Number</label>
              <input type="tel" value={form.fatherMobile || ''} onChange={(e) => {
                set('fatherMobile', e.target.value);
                if (form.relationship === 'Father') {
                  setForm(prev => ({ ...prev, fatherMobile: e.target.value, parentMobile: e.target.value, primaryParentMobile: e.target.value }));
                }
              }} placeholder="e.g. 9876543210" className="field" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Mother Mobile Number</label>
              <input type="tel" value={form.motherMobile || ''} onChange={(e) => {
                set('motherMobile', e.target.value);
                if (form.relationship === 'Mother') {
                  setForm(prev => ({ ...prev, motherMobile: e.target.value, parentMobile: e.target.value, primaryParentMobile: e.target.value }));
                }
              }} placeholder="e.g. 9876543210" className="field" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Primary Parent Login Mobile <span className="text-destructive">*</span></label>
              <input type="tel" value={form.primaryParentMobile || ''} onChange={(e) => {
                setForm(prev => ({ ...prev, primaryParentMobile: e.target.value, parentMobile: e.target.value }));
              }} placeholder="Mobile for Parent Login" className="field" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Parent Email</label>
              <input type="email" value={form.parentEmail || ''} onChange={(e) => set('parentEmail', e.target.value)} placeholder="parent@email.com" className="field" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Guardian Name (Optional)</label>
              <input value={form.guardianName || ''} onChange={(e) => {
                set('guardianName', e.target.value);
                if (form.relationship === 'Guardian') {
                  setForm(prev => ({ ...prev, guardianName: e.target.value, parentName: e.target.value, primaryParentName: e.target.value }));
                }
              }} placeholder="Guardian Name" className="field" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Guardian Mobile (Optional)</label>
              <input type="tel" value={form.guardianMobile || ''} onChange={(e) => {
                set('guardianMobile', e.target.value);
                if (form.relationship === 'Guardian') {
                  setForm(prev => ({ ...prev, guardianMobile: e.target.value, parentMobile: e.target.value, primaryParentMobile: e.target.value }));
                }
              }} placeholder="Guardian Mobile" className="field" />
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 flex gap-3">
        <button onClick={() => onSave(form)} className="rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:opacity-90 active:scale-95">
          {isEdit ? 'Save Changes' : 'Add Student'}
        </button>
        <button onClick={onClose} className="rounded-xl border border-border px-6 py-2.5 text-sm font-medium transition-colors hover:bg-secondary">
          Cancel
        </button>
      </div>

      <style>{`.field { width:100%; border-radius:0.75rem; border:1px solid var(--input); background:var(--input-background); padding:0.625rem 1rem; font-size:0.875rem; color:var(--foreground); outline:none; } .field:focus { border-color:var(--primary); box-shadow:0 0 0 2px color-mix(in srgb,var(--primary) 20%,transparent); }`}</style>
    </div>
  );
}

function StudentProfile({ student, onClose }: { student: Student; onClose: () => void }) {
  const schoolExams = useSchoolExamSchedules().filter((schedule) => schedule.studentId === student.id);

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="mb-5 flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-xl font-bold text-primary">
            {student.firstName.charAt(0)}{student.lastName.charAt(0)}
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground">{student.firstName} {student.lastName}</h2>
            <p className="text-sm text-muted-foreground">{student.id} · {student.class} · {student.batch}</p>
          </div>
        </div>
        <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[
          { icon: CalendarDays, label: 'Date of Birth', value: student.dob },
          { icon: Users, label: 'Gender', value: student.gender },
          { icon: GraduationCap, label: 'Class & Batch', value: `${student.class} — ${student.batch}` },
          { icon: CalendarDays, label: 'Admission Date', value: student.admissionDate },
          { icon: Phone, label: 'Primary Parent Name', value: student.primaryParentName || student.parentName },
          { icon: Phone, label: 'Primary Parent Mobile', value: student.primaryParentMobile || student.parentMobile },
          { icon: Mail, label: 'Parent Email', value: student.parentEmail || '—' },
          { icon: Phone, label: 'Father Name & Mobile', value: student.fatherName ? `${student.fatherName} (${student.fatherMobile || '—'})` : '—' },
          { icon: Phone, label: 'Mother Name & Mobile', value: student.motherName ? `${student.motherName} (${student.motherMobile || '—'})` : '—' },
          { icon: MapPin, label: 'Address', value: student.address },
        ].map(({ icon: Icon, label, value }) => (
          <div key={label} className="rounded-xl border border-border bg-secondary/50 p-4">
            <div className="mb-1 flex items-center gap-2">
              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">{label}</p>
            </div>
            <p className="text-sm font-semibold text-foreground">{value || '—'}</p>
          </div>
        ))}
        <div className="rounded-xl border border-border bg-secondary/50 p-4">
          <p className="mb-1 text-xs text-muted-foreground">Branch</p>
          <p className="text-sm font-semibold text-foreground">{getBranchName(student.branchId)}</p>
        </div>
        <div className="rounded-xl border border-border bg-secondary/50 p-4">
          <p className="mb-1 text-xs text-muted-foreground">Status</p>
          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${student.status === 'Active' ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' : 'bg-secondary text-muted-foreground'}`}>
            {student.status}
          </span>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-border bg-secondary/30 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">School Examination Schedule</h3>
          <span className="text-xs text-muted-foreground">{schoolExams.length} records</span>
        </div>
        {schoolExams.length === 0 ? (
          <p className="text-sm text-muted-foreground">No school examination schedule has been uploaded for this student yet.</p>
        ) : (
          <div className="space-y-3">
            {schoolExams.map((exam) => (
              <div key={exam.id} className="rounded-xl border border-border bg-card p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">{exam.examName}</span>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${exam.status === 'Completed' ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' : exam.status === 'Ongoing' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400' : 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-400'}`}>{exam.status}</span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{exam.schoolName} · {exam.schoolClass}</p>
                <p className="mt-1 text-sm text-foreground">{formatScheduleDate(exam.startDate)} to {formatScheduleDate(exam.endDate)}</p>
                {exam.attachmentPath && (
                  <a href={getAttachmentUrl(exam.attachmentPath)} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-sm font-semibold text-primary hover:underline">View / Download Timetable</a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function StudentManagement() {
  const { user } = useAuth();
  const branches = getBranches();
  const rawStudents = useStudents();
  
  useEffect(() => {
    void refreshStudents();
  }, []);

  const students = useMemo(() => {
    return rawStudents.map((s) => ({
      ...s,
      class: s.className || '',
      parentName: s.primaryParentName || s.fatherName || '',
      parentMobile: s.primaryParentMobile || s.fatherMobile || '',
      admissionDate: s.admissionDate || '',
      status: (s.status || 'Active') as 'Active' | 'Inactive',
      gender: (s.gender || 'Male') as 'Male' | 'Female' | 'Other',
      fatherName: s.fatherName || '',
      motherName: s.motherName || '',
      primaryParentName: s.primaryParentName || '',
      relationship: s.relationship || 'Father',
      fatherMobile: s.fatherMobile || '',
      motherMobile: s.motherMobile || '',
      primaryParentMobile: s.primaryParentMobile || '',
      parentEmail: s.parentEmail || '',
      guardianName: s.guardianName || '',
      guardianMobile: s.guardianMobile || '',
    }));
  }, [rawStudents]);

  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState(user?.role === 'super_admin' ? '' : user?.branchId ?? '');
  const [panel, setPanel] = useState<'none' | 'add' | { type: 'edit' | 'view'; id: string }>('none');

  const filtered = useMemo(() => {
    const scopedStudents = filterByBranch(students, user, branchFilter);
    return scopedStudents.filter((student) => {
      const matchesSearch = [student.firstName, student.lastName, student.id, student.parentName, student.parentMobile]
        .join(' ')
        .toLowerCase()
        .includes(search.toLowerCase());
      const matchesClass = !classFilter || student.class === classFilter;
      return matchesSearch && matchesClass;
    });
  }, [branchFilter, classFilter, search, students, user]);

  const visible = filtered.slice(0, 10); // Show more students in page

  const handleAdd = async (data: Omit<Student, 'id'>) => {
    const resolvedBranchId = data.branchId || user?.branchId || branchFilter || undefined;
    const apiPayload = {
      ...data,
      className: data.class,
      primaryParentName: data.primaryParentName || data.parentName,
      primaryParentMobile: data.primaryParentMobile || data.parentMobile,
      branchId: resolvedBranchId
    };
    await addStudentAPI(apiPayload);
    enrollAdmissionByApplicantName(`${data.firstName} ${data.lastName}`);
    setPanel('none');
  };

  const handleEdit = async (id: string, data: Omit<Student, 'id'>) => {
    const apiPayload = {
      ...data,
      className: data.class,
      primaryParentName: data.primaryParentName || data.parentName,
      primaryParentMobile: data.primaryParentMobile || data.parentMobile
    };
    await updateStudentAPI(id, apiPayload);
    enrollAdmissionByApplicantName(`${data.firstName} ${data.lastName}`);
    setPanel('none');
  };

  const editStudent = panel !== 'none' && typeof panel === 'object' && panel.type === 'edit' ? students.find((student) => student.id === panel.id) : null;
  const viewStudent = panel !== 'none' && typeof panel === 'object' && panel.type === 'view' ? students.find((student) => student.id === panel.id) : null;

  return (
    <div className="flex-1 bg-background">
      <Header title="Student Management" />

      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: 'Total', value: students.length, color: 'text-foreground' },
            { label: 'Active', value: students.filter((student) => student.status === 'Active').length, color: 'text-green-600 dark:text-green-400' },
            { label: 'Inactive', value: students.filter((student) => student.status === 'Inactive').length, color: 'text-muted-foreground' },
            { label: 'New (Jun)', value: 4, color: 'text-sky-600 dark:text-sky-400' },
          ].map((stat) => (
            <div key={stat.label} className="rounded-2xl border border-border bg-card px-5 py-4">
              <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{stat.label}</p>
            </div>
          ))}
        </div>

        {panel === 'add' && (
          <StudentForm
            initial={EMPTY_FORM}
            isEdit={false}
            onSave={handleAdd}
            onClose={() => setPanel('none')}
            branchOptions={branches.filter((branch) => branch.status === 'Active').map(({ id, name }) => ({ id, name }))}
            defaultBranchId={user?.role === 'super_admin' ? branchFilter || user?.branchId : user?.branchId}
          />
        )}
        {editStudent && (
          <StudentForm
            initial={{ ...editStudent, branchId: editStudent.branchId || '' }}
            isEdit
            onSave={(data) => handleEdit(editStudent.id, data)}
            onClose={() => setPanel('none')}
            branchOptions={branches.filter((branch) => branch.status === 'Active').map(({ id, name }) => ({ id, name }))}
            defaultBranchId={editStudent.branchId || (user?.role === 'super_admin' ? branchFilter || user?.branchId : user?.branchId)}
          />
        )}
        {viewStudent && <StudentProfile student={viewStudent} onClose={() => setPanel('none')} />}

        <div className="flex flex-wrap gap-3">
          <div className="relative min-w-[180px] flex-1">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              placeholder="Search by name, ID, parent or mobile…"
              value={search}
              onChange={(event) => { setSearch(event.target.value); setPanel('none'); }}
              className="w-full rounded-xl border border-input bg-input-background py-2.5 pl-10 pr-4 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <select
            value={classFilter}
            onChange={(event) => setClassFilter(event.target.value)}
            className="rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none"
          >
            <option value="">All Classes</option>
            {CLASSES.map((className) => <option key={className}>{className}</option>)}
          </select>
          {user?.role === 'super_admin' && (
            <select
              value={branchFilter}
              onChange={(event) => setBranchFilter(event.target.value)}
              className="rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none"
            >
              <option value="">All Branches</option>
              {branches.filter((branch) => branch.status === 'Active').map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          )}
          <button onClick={() => setPanel('add')} className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:opacity-90 active:scale-95">
            <Plus className="h-4 w-4" />
            Add Student
          </button>
        </div>

        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <h2 className="font-semibold text-foreground">
              Student List
              <span className="ml-2 text-sm font-normal text-muted-foreground">({filtered.length} found)</span>
            </h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-secondary/40">
                  {['Student', 'Class', 'Batch', 'Primary Parent', 'Parent Login Mobile', 'Status', ''].map((heading) => (
                    <th key={heading} className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.map((student) => (
                  <tr key={student.id} className="transition-colors hover:bg-secondary/30">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                          {student.firstName.charAt(0)}{student.lastName.charAt(0)}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-foreground">{student.firstName} {student.lastName}</p>
                          <p className="text-xs text-muted-foreground">{student.id}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-sm text-foreground">{student.class}</td>
                    <td className="px-5 py-4 text-sm text-muted-foreground">{student.batch}</td>
                    <td className="px-5 py-4 text-sm text-foreground">{student.parentName}</td>
                    <td className="px-5 py-4 text-sm text-muted-foreground">{student.parentMobile}</td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${student.status === 'Active' ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' : 'bg-secondary text-muted-foreground'}`}>
                        {student.status}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-1">
                        <button onClick={() => setPanel({ type: 'view', id: student.id })} className="rounded-lg p-1.5 transition-colors hover:bg-secondary" title="View Profile">
                          <Eye className="h-4 w-4 text-primary" />
                        </button>
                        <button onClick={() => setPanel({ type: 'edit', id: student.id })} className="rounded-lg p-1.5 transition-colors hover:bg-secondary" title="Edit">
                          <Edit2 className="h-4 w-4 text-muted-foreground" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filtered.length > visible.length && (
            <div className="border-t border-border px-6 py-4">
              <span className="text-xs text-muted-foreground">Showing top {visible.length} of {filtered.length} students</span>
            </div>
          )}
          {filtered.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Users className="h-10 w-10 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No students found</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
