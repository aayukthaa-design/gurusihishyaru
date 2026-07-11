import { PDFTemplateService } from './pdfTemplateService';
import { utils, writeFile } from 'xlsx';
import { createStore, useStoreValue } from './store';
import { getStudentById, getStudentsByIds } from './studentService';
import { addNotification } from './notificationService';

const API_BASE = '';

export interface HomeworkAttachment {
  filename: string;
  originalname: string;
  path: string;
  size: number;
}

export interface HomeworkAssignment {
  id: string; // sqlite integer ID stringified
  className: string;
  batch: string;
  subject: string;
  title: string;
  description: string;
  dueDate: string;
  dueTime: string;
  teacherId: string;
  assignedBy: string;
  branchId: string;
  createdAt: string;
  attachments?: HomeworkAttachment[];
}

export interface HomeworkSubmission {
  id: number;
  homeworkId: number;
  studentId: string;
  studentName: string;
  rollNumber: string;
  submissionTime: string;
  submissionStatus: 'Submitted' | 'Reviewed';
  filePath: string;
  fileName: string;
  fileSize: number;
  remarks?: string | null;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
}

const homeworkStore = createStore<HomeworkAssignment[]>([]);

export function useHomework() {
  return useStoreValue(homeworkStore);
}

export function getHomework(): HomeworkAssignment[] {
  return homeworkStore.getState();
}

// Sync from backend
export async function refreshHomework(user?: any): Promise<HomeworkAssignment[]> {
  if (!user) return [];
  try {
    const params = new URLSearchParams();
    params.set('role', user.role);
    params.set('userId', user.id);
    if (user.branchId) params.set('branchId', user.branchId);
    
    // For parent portal homework, fetch children class names
    if (user.role === 'parent' && user.linkedStudentIds?.length) {
      const students = getStudentsByIds(user.linkedStudentIds);
      const classes = Array.from(new Set(students.map(s => s.className)));
      params.set('classNames', classes.join(','));
    }
    
    const res = await fetch(`${API_BASE}/api/homework?${params.toString()}`);
    if (!res.ok) throw new Error('Backend failed');
    const data = await res.json();
    if (Array.isArray(data)) {
      // Map IDs to strings
      const mapped = data.map(item => ({ ...item, id: String(item.id) }));
      homeworkStore.setState(mapped);
      return mapped;
    }
    return [];
  } catch (e) {
    console.error('Homework refresh failed', e);
    return homeworkStore.getState(); // return local cached
  }
}

// Create homework assignment (Multipart Form Data for attachments)
export async function createHomeworkAPI(formData: FormData, user: any) {
  try {
    const res = await fetch(`${API_BASE}/api/homework`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) throw new Error('Create failed');
    const created = await res.json();
    
    // Notify parents of the assigned class
    addNotification({
      title: 'Homework Assigned',
      message: `New Homework assigned for ${created.className}: "${created.title}"`,
      description: `Subject: ${created.subject} | Due: ${created.dueDate} ${created.dueTime || ''}`,
      type: 'info',
      roles: ['parent'],
      classNames: [created.className],
      sender: created.assignedBy || 'Teacher',
      notificationType: 'Homework',
      branchId: created.branchId,
    });
    
    await refreshHomework(user);
    return created;
  } catch (e) {
    console.error(e);
    throw e;
  }
}

// Update homework assignment
export async function updateHomeworkAPI(id: string, formData: FormData, user: any) {
  try {
    const res = await fetch(`${API_BASE}/api/homework/${id}`, {
      method: 'PUT',
      body: formData,
    });
    if (!res.ok) throw new Error('Update failed');
    const updated = await res.json();
    
    // Notify parents of updated homework
    addNotification({
      title: 'Homework Updated',
      message: `Homework updated for ${updated.className}: "${updated.title}"`,
      description: `Subject: ${updated.subject} | Due: ${updated.dueDate} ${updated.dueTime || ''}`,
      type: 'warning',
      roles: ['parent'],
      classNames: [updated.className],
      sender: updated.assignedBy || 'Teacher',
      notificationType: 'Homework',
      branchId: updated.branchId,
    });
    
    await refreshHomework(user);
    return updated;
  } catch (e) {
    console.error(e);
    throw e;
  }
}

// Delete homework assignment
export async function deleteHomeworkAPI(id: string, user: any) {
  try {
    const res = await fetch(`${API_BASE}/api/homework/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('Delete failed');
    await refreshHomework(user);
    return true;
  } catch (e) {
    console.error(e);
    throw e;
  }
}

// Retrieve submissions list for homework ID
export async function fetchSubmissionsAPI(homeworkId: string): Promise<HomeworkSubmission[]> {
  try {
    const res = await fetch(`${API_BASE}/api/homework/${homeworkId}/submissions`);
    if (!res.ok) throw new Error('Submissions fetch failed');
    return await res.json();
  } catch (e) {
    console.error(e);
    return [];
  }
}

// Submit homework (Multipart form data for single submissionFile)
export async function submitHomeworkAPI(homeworkId: string, formData: FormData, user: any, isResubmit = false) {
  try {
    const res = await fetch(`${API_BASE}/api/homework/${homeworkId}/submissions`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) throw new Error('Submission failed');
    const submission = await res.json();
    
    // Fetch homework details to notify teacher
    const homework = getHomework().find(h => h.id === homeworkId);
    if (homework) {
      addNotification({
        title: isResubmit ? 'Homework Re-submitted' : 'Homework Submitted',
        message: `Homework submission received from ${submission.studentName} (Roll ${submission.rollNumber})`,
        description: `Homework: "${homework.title}" | Subject: ${homework.subject}`,
        type: 'success',
        roles: ['teacher'],
        teacherIds: [homework.teacherId],
        classNames: [homework.className],
        sender: 'Parent Portal',
        notificationType: 'Homework',
        branchId: homework.branchId,
      });
    }
    
    await refreshHomework(user);
    return submission;
  } catch (e) {
    console.error(e);
    throw e;
  }
}

// Remove submission
export async function removeSubmissionAPI(homeworkId: string, studentId: string, user: any) {
  try {
    const res = await fetch(`${API_BASE}/api/homework/${homeworkId}/submissions/${studentId}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('Removal failed');
    
    const homework = getHomework().find(h => h.id === homeworkId);
    const student = getStudentById(studentId);
    if (homework && student) {
      addNotification({
        title: 'Homework Submission Removed',
        message: `Homework submission removed by parent of ${student.fullName}`,
        description: `Homework: "${homework.title}" | Subject: ${homework.subject}`,
        type: 'warning',
        roles: ['teacher'],
        teacherIds: [homework.teacherId],
        classNames: [homework.className],
        sender: 'Parent Portal',
        notificationType: 'Homework',
        branchId: homework.branchId,
      });
    }
    
    await refreshHomework(user);
    return true;
  } catch (e) {
    console.error(e);
    throw e;
  }
}

// Review submission (marks reviewed, add remarks)
export async function reviewSubmissionAPI(
  homeworkId: string,
  studentId: string,
  remarks: string,
  reviewedBy: string,
  user: any
) {
  try {
    const res = await fetch(`${API_BASE}/api/homework/${homeworkId}/submissions/${studentId}/review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ remarks, reviewedBy }),
    });
    if (!res.ok) throw new Error('Review failed');
    const submission = await res.json();
    
    const homework = getHomework().find(h => h.id === homeworkId);
    if (homework) {
      addNotification({
        title: 'Homework Reviewed',
        message: `Homework reviewed for "${homework.title}"`,
        description: `Remarks: ${remarks || 'None'} | Reviewed by: ${reviewedBy}`,
        type: 'success',
        roles: ['parent'],
        studentIds: [studentId],
        classNames: [homework.className],
        sender: reviewedBy,
        notificationType: 'Homework',
        branchId: homework.branchId,
      });
    }
    
    await refreshHomework(user);
    return submission;
  } catch (e) {
    console.error(e);
    throw e;
  }
}

// Generate reports PDF/Excel Export
export async function exportHomeworkReport(
  format: 'pdf' | 'excel',
  report: {
    title: string;
    className: string;
    subject: string;
    dueDate: string;
    total: number;
    submitted: number;
    pending: number;
    overdue: number;
    reviewed: number;
    students: Array<{
      name: string;
      rollNumber: string;
      status: string;
      time: string;
      remarks: string;
    }>;
  }
) {
  if (format === 'excel') {
    const workbook = utils.book_new();
    const rows = report.students.map((stu) => ({
      'Student Name': stu.name,
      'Roll Number': stu.rollNumber,
      'Submission Status': stu.status,
      'Submission Time': stu.time ? new Date(stu.time).toLocaleString('en-IN') : '—',
      'Teacher Remarks': stu.remarks || '—',
    }));
    const worksheet = utils.json_to_sheet(rows);
    utils.book_append_sheet(workbook, worksheet, 'Submissions');
    
    // Add a summary row/section for context
    utils.sheet_add_aoa(worksheet, [
      [],
      ['Homework Summary Report'],
      ['Homework Title', report.title],
      ['Class', report.className],
      ['Subject', report.subject],
      ['Due Date', report.dueDate],
      ['Total Enrolled', report.total],
      ['Submitted Count', report.submitted],
      ['Pending Count', report.pending],
      ['Reviewed Count', report.reviewed],
      ['Overdue Count', report.overdue]
    ], { origin: -1 });

    writeFile(workbook, `Homework_Report_${report.className.replace(/\s+/g, '_')}_${report.subject}.xlsx`);
    return;
  }
  
  // PDF Export
  const pdfService = new PDFTemplateService();
  pdfService.addTitle('Homework Submission Report');
  
  pdfService.addSectionHeading('Homework Details');
  const detailsTable = [
    ['Homework Title:', report.title],
    ['Class & Subject:', `${report.className} — ${report.subject}`],
    ['Due Date / Time:', report.dueDate],
    ['Total Enrolled:', String(report.total)],
    ['Submitted:', String(report.submitted)],
    ['Pending:', String(report.pending)],
    ['Reviewed:', String(report.reviewed)],
    ['Overdue:', String(report.overdue)],
  ];
  pdfService.addTable([['Property', 'Value']], detailsTable);
  
  pdfService.addSectionHeading('Submissions');
  const headers = ['Roll', 'Student Name', 'Status', 'Submitted Date/Time', 'Remarks'];
  const body = report.students.map(stu => [
    stu.rollNumber,
    stu.name,
    stu.status,
    stu.time ? new Date(stu.time).toLocaleString('en-IN') : '—',
    stu.remarks || '—'
  ]);
  
  pdfService.addTable([headers], body);
  
  await pdfService.exportWithLetterhead(`Homework_Report_${report.className.replace(/\s+/g, '_')}_${report.subject}.pdf`);
}
