import { addExam, refreshExams } from './examService';
import { apiFetch } from './apiClient';

// Try to POST to backend; if unavailable, fall back to in-memory addExam
const API_BASE = '';

export async function saveExamAPI(exam: any) {
  try {
    // if exam.attachment?.file exists, send multipart/form-data
    if (exam.attachment && exam.attachment.file) {
      const fd = new FormData();
      fd.append('name', exam.name);
      fd.append('subject', exam.subject);
      fd.append('className', exam.className);
      fd.append('batch', exam.batch || '');
      fd.append('date', exam.date);
      fd.append('maxMarks', String(exam.maxMarks));
      fd.append('description', exam.description || '');
      fd.append('status', exam.status || 'draft');
      fd.append('createdBy', exam.createdBy || '');
      fd.append('attachment', exam.attachment.file);
      const resp = await apiFetch(`${API_BASE}/api/exams`, { method: 'POST', body: fd });
      if (!resp.ok) throw new Error('network');
      const created = await resp.json();
      await refreshExams();
      return created;
    }

    const resp = await apiFetch(`${API_BASE}/api/exams`, {
      method: 'POST',
      body: exam,
    });
    if (!resp.ok) throw new Error('network');
    const data = await resp.json();
    await refreshExams();
    return data;
  } catch (err) {
    // fallback to in-memory
    return addExam(exam);
  }
}
