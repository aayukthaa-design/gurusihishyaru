import { createStore, useStoreValue } from './store';

export interface StudentRecord {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  dob?: string;
  rollNumber: string;
  admissionNumber: string;
  className: string;
  branchId: string;
  branchName: string;
  subject?: string;
  fatherName?: string;
  motherName?: string;
  primaryParentName?: string;
  relationship?: string;
  fatherMobile?: string;
  motherMobile?: string;
  primaryParentMobile?: string;
  parentEmail?: string;
  guardianName?: string;
  guardianMobile?: string;
  address?: string;
  status?: string;
}

const API_BASE = 'http://localhost:4000';

const today = new Date();

// No demo seed students - start with an empty list to prepare for real data import
const SEED_STUDENTS: StudentRecord[] = [];

const studentStore = createStore<StudentRecord[]>(SEED_STUDENTS);

export async function refreshStudents(): Promise<StudentRecord[]> {
  try {
    const res = await fetch(`${API_BASE}/api/students`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const mapped: StudentRecord[] = data.map((student: any) => ({
          ...student,
          branchName: student.branchId === 'branch_rajajinagar' ? 'Rajajinagar Branch' :
                      student.branchId === 'branch_jayanagar' ? 'Jayanagar Branch' :
                      student.branchId === 'branch_vijayanagar' ? 'Vijayanagar Branch' :
                      student.branchId === 'branch_hsr' ? 'HSR Layout Branch' : 'Main Branch'
        }));
        studentStore.setState(mapped);
        return mapped;
      }
    }
  } catch (e) {
    console.error('Failed to fetch students, using memory cache:', e);
  }
  return studentStore.getState();
}

// Initial load
void refreshStudents();

export function getStudentsForClass(className?: string, branchId?: string): StudentRecord[] {
  const list = studentStore.getState();
  return list.filter((student) => {
    // Normalise class names
    const sClass = student.className ? student.className.replace('Grade ', '') : '';
    const filterClass = className ? className.replace('Grade ', '') : '';
    const matchesClass = !className || sClass === filterClass;
    const matchesBranch = !branchId || student.branchId === branchId;
    return matchesClass && matchesBranch;
  });
}

export function getStudentsByIds(studentIds: string[]): StudentRecord[] {
  if (!studentIds?.length) return [];
  const list = studentStore.getState();
  return list.filter((student) => studentIds.includes(student.id));
}

export function getStudentById(studentId?: string): StudentRecord | undefined {
  if (!studentId) return undefined;
  const list = studentStore.getState();
  return list.find((student) => student.id === studentId);
}

export function getAllStudents(): StudentRecord[] {
  return studentStore.getState();
}

export async function addStudentAPI(student: Omit<StudentRecord, 'id'>): Promise<StudentRecord | null> {
  try {
    const res = await fetch(`${API_BASE}/api/students`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(student)
    });
    if (res.ok) {
      const saved = await res.json();
      await refreshStudents();
      return saved;
    }
  } catch (err) {
    console.error('addStudentAPI error:', err);
  }
  return null;
}

export async function updateStudentAPI(id: string, student: Partial<StudentRecord>): Promise<StudentRecord | null> {
  try {
    const res = await fetch(`${API_BASE}/api/students/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(student)
    });
    if (res.ok) {
      const saved = await res.json();
      await refreshStudents();
      return saved;
    }
  } catch (err) {
    console.error('updateStudentAPI error:', err);
  }
  return null;
}

export function useStudents() {
  return useStoreValue(studentStore);
}
