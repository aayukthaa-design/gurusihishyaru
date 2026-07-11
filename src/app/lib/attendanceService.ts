const API_BASE = '';

export interface AttendanceRecord {
  id?: number;
  className: string;
  date: string;
  studentId: string;
  status: 'present' | 'absent';
  markedBy?: string;
  createdAt?: string;
}

export interface WhatsappLogRecord {
  id: number;
  studentId: string;
  studentName: string;
  parentName: string;
  mobile: string;
  branchId: string;
  className: string;
  attendanceDate: string;
  sentTime: string;
  status: 'Queued' | 'Sent' | 'Delivered' | 'Read' | 'Failed' | 'Retrying';
  failureReason?: string;
  retryCount?: number;
  teacher?: string;
}

export interface WhatsappStats {
  todayCount: number;
  todaySent: number;
  todayFailed: number;
  deliveryRate: number;
  failureRate: number;
  branchStats: Array<{
    branchId: string;
    total: number;
    delivered: number;
    failed: number;
  }>;
  // Teacher dashboard specific metrics
  todayAbsent?: number;
  todayWhatsappSent?: number;
  pendingNotifications?: number;
  failedMessages?: number;
}

// No demo in-memory attendance; fall back to empty when API unavailable
const TODAY = new Date().toISOString().slice(0, 10);
const SEED_ATTENDANCE: AttendanceRecord[] = [];

export async function fetchAttendance(className?: string, date?: string): Promise<AttendanceRecord[]> {
  try {
    const params = new URLSearchParams();
    if (className) params.append('className', className);
    if (date) params.append('date', date);
    const res = await fetch(`${API_BASE}/api/attendance?${params.toString()}`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) return data;
    }
  } catch (err) {
    console.error('fetchAttendance error:', err);
  }
  // Fallback to empty when API is unavailable or returns no data
  return [];
}

export async function saveAttendanceAPI(
  className: string,
  date: string,
  attendanceRecords: Record<string, 'present' | 'absent'>,
  markedBy?: string
): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/attendance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ className, date, attendanceRecords, markedBy })
    });
    return res.ok;
  } catch (err) {
    console.error('saveAttendanceAPI error:', err);
    return false;
  }
}

export async function fetchWhatsappLogs(params: {
  branchId?: string;
  date?: string;
  userRole?: string;
  userBranchId?: string;
  assignedClassIds?: string;
} = {}): Promise<WhatsappLogRecord[]> {
  try {
    const qParams = new URLSearchParams();
    if (params.branchId) qParams.append('branchId', params.branchId);
    if (params.date) qParams.append('date', params.date);
    if (params.userRole) qParams.append('userRole', params.userRole);
    if (params.userBranchId) qParams.append('userBranchId', params.userBranchId);
    if (params.assignedClassIds) qParams.append('assignedClassIds', params.assignedClassIds);
    
    const res = await fetch(`${API_BASE}/api/whatsapp/logs?${qParams.toString()}`);
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.error('fetchWhatsappLogs error:', err);
  }
  return [];
}

export async function fetchWhatsappStats(params: {
  date?: string;
  role?: string;
  teacherId?: string;
  classNames?: string;
  branchId?: string;
} = {}): Promise<WhatsappStats> {
  try {
    const qParams = new URLSearchParams();
    if (params.date) qParams.append('date', params.date);
    if (params.role) qParams.append('role', params.role);
    if (params.teacherId) qParams.append('teacherId', params.teacherId);
    if (params.classNames) qParams.append('classNames', params.classNames);
    if (params.branchId) qParams.append('branchId', params.branchId);
    
    const res = await fetch(`${API_BASE}/api/whatsapp/stats?${qParams.toString()}`);
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.error('fetchWhatsappStats error:', err);
  }
  return {
    todayCount: 0,
    todaySent: 0,
    todayFailed: 0,
    deliveryRate: 100,
    failureRate: 0,
    branchStats: []
  };
}

export async function fetchWhatsappSettings(): Promise<Record<string, string>> {
  try {
    const res = await fetch(`${API_BASE}/api/settings`);
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.error('fetchWhatsappSettings error:', err);
  }
  return {
    enable_whatsapp: 'false',
    whatsapp_provider: 'WhatsApp Business Cloud API',
    official_contact: '6363099546',
    retry_attempts: '3'
  };
}

export async function saveWhatsappSettingsAPI(settings: Record<string, string>): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });
    return res.ok;
  } catch (err) {
    console.error('saveWhatsappSettingsAPI error:', err);
    return false;
  }
}

export async function sendTestWhatsappAPI(mobile: string, message: string): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/api/whatsapp/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile, message })
    });
    const data = await res.json();
    if (res.ok) {
      return { success: true, message: data.message };
    }
    return { success: false, error: data.error };
  } catch (err) {
    console.error('sendTestWhatsappAPI error:', err);
    return { success: false, error: 'Connection failed' };
  }
}

