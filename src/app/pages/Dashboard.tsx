import React from 'react';
import { Header } from '../components/Header';
import { GreetingBanner } from '../components/GreetingBanner';
import BirthdayWidget from '../components/BirthdayWidget';
import BirthdayChecker from '../components/BirthdayChecker';
import { useAuth } from '../auth/AuthContext';
import { getRoleLabel } from '../auth/rbac';
import { getBranches, getBranchName, filterByBranch } from '../lib/branchService';
import { Link, useNavigate } from 'react-router';
import {
  Users, CreditCard, ClipboardCheck, CalendarDays,
  UserPlus, DollarSign, BookOpen, ChevronRight,
  UserCog, Shield, Settings, BarChart3, HardDrive,
  Bell, Wallet, TrendingUp, School, GraduationCap, FileText,
  Plus, X, CheckCircle2, MessageSquare, Boxes, FileSpreadsheet, TrendingDown, AlertTriangle
} from 'lucide-react';
import { useSubmissions } from '../lib/dailySubmissionService';
import { getNotificationStats, useNotifications } from '../lib/notificationService';
import { useExams } from '../lib/examService';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, LineChart, Line,
} from 'recharts';
import type { Role } from '../auth/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { addTeacher, getTeachersForBranch } from '../lib/teacherService';
import { addClass, getClassesForBranch } from '../lib/classService';
import { addNotification } from '../lib/notificationService';
import { useSchoolExamSchedules } from '../lib/schoolExamScheduleService';
import { formatIndianCurrency } from '../lib/currency';

// ─── Chart data ───────────────────────────────────────────────────────────────

const attendanceTrend = [
  { week: 'Wk 1', value: 92 },
  { week: 'Wk 2', value: 88 },
  { week: 'Wk 3', value: 95 },
  { week: 'Wk 4', value: 91 },
  { week: 'Wk 5', value: 94 },
  { week: 'Wk 6', value: 96 },
];

const systemUsageTrend = [
  { day: 'Mon', logins: 42 },
  { day: 'Tue', logins: 38 },
  { day: 'Wed', logins: 51 },
  { day: 'Thu', logins: 45 },
  { day: 'Fri', logins: 49 },
  { day: 'Sat', logins: 12 },
  { day: 'Sun', logins: 8 },
];

// ─── Recent alerts ────────────────────────────────────────────────────────────

const ADMIN_ALERTS = [
  { id: 1, icon: '💰', text: 'Fee due: 12 students overdue this month',   time: '2h ago' },
  { id: 2, icon: '📝', text: 'New admission: Arjun Sharma — Grade 10',    time: '3h ago' },
  { id: 3, icon: '📅', text: 'Exam scheduled: Math — Grade 10, Jun 25',  time: 'Yesterday' },
  { id: 4, icon: '✅', text: 'Attendance marked for all classes today',   time: 'Yesterday' },
  { id: 5, icon: '🔔', text: 'Parent meeting: Grade 8A — Jun 24, 4 PM',  time: '2 days ago' },
];

const SUPERADMIN_ALERTS = [
  { id: 1, icon: '👤', text: 'New Admin account created: admin6@tutorials.com',  time: '1h ago' },
  { id: 2, icon: '🔐', text: 'Role updated: Teacher User 3 → Admin',             time: '3h ago' },
  { id: 3, icon: '💾', text: 'Backup completed successfully — 46 MB',            time: 'Yesterday' },
  { id: 4, icon: '⚙️', text: 'System settings updated: Academic year 2026–27',  time: 'Yesterday' },
  { id: 5, icon: '📊', text: 'Monthly report generated and exported',           time: '2 days ago' },
];

// ─── Per-role configuration ───────────────────────────────────────────────────

interface StatCard {
  label: string;
  value: string;
  icon: React.ElementType;
  color: string;
  iconColor: string;
  border: string;
}

interface QuickAction {
  label: string;
  icon: React.ElementType;
  path: string;
  color: string;
}

function getSuperAdminConfig(): { stats: StatCard[]; actions: QuickAction[] } {
  return {
    stats: [
      { label: 'Total Users',      value: '25',   icon: UserCog,    color: 'bg-violet-50 dark:bg-violet-950/40',  iconColor: 'text-violet-600 dark:text-violet-400',  border: 'border-violet-100 dark:border-violet-900' },
      { label: 'Total Admins',     value: '5',    icon: Shield,     color: 'bg-sky-50 dark:bg-sky-950/40',         iconColor: 'text-sky-600 dark:text-sky-400',         border: 'border-sky-100 dark:border-sky-900' },
      { label: 'System Logins',    value: '49',   icon: TrendingUp, color: 'bg-green-50 dark:bg-green-950/40',    iconColor: 'text-green-600 dark:text-green-400',    border: 'border-green-100 dark:border-green-900' },
      { label: 'Pending Reports',  value: '3',    icon: BarChart3,  color: 'bg-amber-50 dark:bg-amber-950/40',    iconColor: 'text-amber-600 dark:text-amber-400',    border: 'border-amber-100 dark:border-amber-900' },
    ],
    actions: [
      { label: 'Add Admin',       icon: UserPlus, path: '/users?tab=admins',      color: 'bg-violet-600 hover:bg-violet-700' },
      { label: 'Add Accountant',  icon: Wallet,   path: '/users?tab=accountants', color: 'bg-teal-600 hover:bg-teal-700' },
      { label: 'Manage Users',    icon: UserCog,  path: '/users',                 color: 'bg-sky-600 hover:bg-sky-700' },
      { label: 'Manage Roles',    icon: Shield,   path: '/roles',                 color: 'bg-indigo-600 hover:bg-indigo-700' },
      { label: 'System Settings', icon: Settings, path: '/settings',              color: 'bg-slate-600 hover:bg-slate-700' },
      { label: 'View Reports',    icon: BarChart3,path: '/reports',               color: 'bg-green-600 hover:bg-green-700' },
    ],
  };
}

function getAdminConfig(): { stats: StatCard[]; actions: QuickAction[] } {
  return {
    stats: [
      { label: 'Total Students',     value: '1,000',  icon: Users,         color: 'bg-green-50 dark:bg-green-950/40',  iconColor: 'text-green-600 dark:text-green-400',  border: 'border-green-100 dark:border-green-900' },
      { label: 'Pending Fees',       value: formatIndianCurrency(42500),icon: CreditCard,    color: 'bg-amber-50 dark:bg-amber-950/40',  iconColor: 'text-amber-600 dark:text-amber-400',  border: 'border-amber-100 dark:border-amber-900' },
      { label: "Today's Attendance", value: '94.5%',  icon: ClipboardCheck,color: 'bg-sky-50 dark:bg-sky-950/40',      iconColor: 'text-sky-600 dark:text-sky-400',      border: 'border-sky-100 dark:border-sky-900' },
      { label: 'Upcoming Events',    value: '3',      icon: CalendarDays,  color: 'bg-violet-50 dark:bg-violet-950/40',iconColor: 'text-violet-600 dark:text-violet-400',border: 'border-violet-100 dark:border-violet-900' },
    ],
    actions: [
      { label: 'Add Teacher',       icon: UserPlus,     path: '/teachers',   color: 'bg-green-600 hover:bg-green-700' },
      { label: 'Create Class',      icon: GraduationCap,path: '/allocations',color: 'bg-amber-600 hover:bg-amber-700' },
      { label: 'Mark Attendance',   icon: ClipboardCheck,path: '/attendance',color: 'bg-sky-600 hover:bg-sky-700' },
      { label: 'Notifications',     icon: Bell,         path: '/notifications', color: 'bg-violet-600 hover:bg-violet-700' },
      { label: 'Manage Timetable',  icon: CalendarDays, path: '/timetable',  color: 'bg-teal-600 hover:bg-teal-700' },
      { label: 'Manage Admissions', icon: School,       path: '/admissions', color: 'bg-indigo-600 hover:bg-indigo-700' },
    ],
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function Dashboard() {
  const { user } = useAuth();
  const navigate  = useNavigate();
  const branches = getBranches();
  const [branchFilter, setBranchFilter] = React.useState(user?.role === 'super_admin' ? '' : user?.branchId ?? '');
  const role      = user?.role as Role | undefined;
  const roleLabel = getRoleLabel(role);
  const isSuperAdmin = role === 'super_admin';
  const isAdmin      = role === 'admin';
  const isTeacher    = role === 'teacher';
  const activeBranchLabel = branchFilter ? getBranchName(branchFilter) : 'All Branches';

  const [whatsappStats, setWhatsappStats] = React.useState<any>(null);
  const [specialClasses, setSpecialClasses] = React.useState<any[]>([]);

  React.useEffect(() => {
    const loadSpecialClasses = async () => {
      try {
        const res = await fetch(`http://localhost:4000/api/special-classes`);
        if (res.ok) {
          const data = await res.json();
          setSpecialClasses(data);
        }
      } catch (err) {
        console.error('Failed to load Special Classes in dashboard', err);
      }
    };
    void loadSpecialClasses();
  }, []);

  React.useEffect(() => {
    const loadStats = async () => {
      try {
        let url = `http://localhost:4000/api/whatsapp/stats`;
        if (isTeacher) {
          url += `?role=teacher&teacherId=${encodeURIComponent(user?.id || '')}&classNames=${encodeURIComponent((user?.assignedClassIds || []).join(','))}`;
        } else {
          url += `?branchId=${encodeURIComponent(branchFilter)}`;
        }
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          setWhatsappStats(data);
        }
      } catch (err) {
        console.error('Failed to load WhatsApp stats in dashboard', err);
      }
    };
    void loadStats();
  }, [branchFilter, isTeacher, user]);


  // Teacher-specific values — must be declared before effects that reference them
  const myClasses: string[] = user?.assignedClassIds ?? [];
  const todayISO = new Date().toISOString().slice(0, 10);

  const { stats, actions } = isSuperAdmin
    ? getSuperAdminConfig()
    : getAdminConfig();
  const [teacherModalOpen, setTeacherModalOpen] = React.useState(false);
  const [classModalOpen, setClassModalOpen] = React.useState(false);
  const [teacherForm, setTeacherForm] = React.useState({
    fullName: '', gender: 'Female', dob: '', phone: '', email: '', address: '', qualification: '', experience: '', specialization: '', username: '', password: '', confirmPassword: '', employmentType: 'Full Time', status: 'Active' as 'Active' | 'Inactive', dateOfJoining: '', profilePhoto: ''
  });
  const [classForm, setClassForm] = React.useState({
    className: '', batchName: '', course: '', subject: '', assignedTeacherId: '', branchId: user?.branchId ?? '', roomNumber: '', maxStudents: '30', startDate: '', endDate: '', classTiming: '', daysOfWeek: [] as string[], status: 'Active' as 'Active' | 'Inactive'
  });
  const [notificationModalOpen, setNotificationModalOpen] = React.useState(false);
  const [notificationForm, setNotificationForm] = React.useState({
    title: '', message: '', type: 'info' as 'info' | 'warning' | 'alert', recipient: 'All' as 'All' | 'Teachers' | 'Students' | 'Class', classNames: [] as string[]
  });
  const [feedback, setFeedback] = React.useState<string | null>(null);

  // Accountant dashboard specific states & handlers
  const [ledger, setLedger] = React.useState<any[]>([]);
  const [inventory, setInventory] = React.useState<any[]>([]);
  const [allocations, setAllocations] = React.useState<any[]>([]);
  const [reports, setReports] = React.useState<any[]>([]);
  const [students, setStudents] = React.useState<any[]>([]);
  const [loadingAccountantData, setLoadingAccountantData] = React.useState(false);

  // Form modals state for Add Income/Add Expense quick actions
  const [showAddLedgerModal, setShowAddLedgerModal] = React.useState(false);
  const [ledgerForm, setLedgerForm] = React.useState({
    date: new Date().toISOString().split('T')[0],
    type: 'Income' as 'Income' | 'Expense',
    category: 'Tuition Fee',
    description: '',
    amount: '',
    paymentMode: 'UPI',
    referenceNumber: '',
    attachment: null as File | null
  });

  const myBranchId = user?.branchId || '';
  const isAccountant = user?.role === 'accountant';

  const fetchLedger = async () => {
    try {
      const res = await fetch(`http://localhost:4000/api/ledger?branchId=${myBranchId}`);
      if (res.ok) setLedger(await res.json());
    } catch (e) { console.error(e); }
  };

  const fetchInventory = async () => {
    try {
      const res = await fetch(`http://localhost:4000/api/inventory?branchId=${myBranchId}`);
      if (res.ok) setInventory(await res.json());
    } catch (e) { console.error(e); }
  };

  const fetchAllocations = async () => {
    try {
      const res = await fetch(`http://localhost:4000/api/inventory/allocations?branchId=${myBranchId}`);
      if (res.ok) setAllocations(await res.json());
    } catch (e) { console.error(e); }
  };

  const fetchReports = async () => {
    try {
      const res = await fetch(`http://localhost:4000/api/financial-reports?branchId=${myBranchId}`);
      if (res.ok) setReports(await res.json());
    } catch (e) { console.error(e); }
  };

  const fetchStudents = async () => {
    try {
      const res = await fetch(`http://localhost:4000/api/students`);
      if (res.ok) {
        const data = await res.json();
        setStudents(data.students || data || []);
      }
    } catch (e) { console.error(e); }
  };

  const loadAccountantDashboardData = async () => {
    setLoadingAccountantData(true);
    await Promise.all([
      fetchLedger(),
      fetchInventory(),
      fetchAllocations(),
      fetchReports(),
      fetchStudents()
    ]);
    setLoadingAccountantData(false);
  };

  React.useEffect(() => {
    if (isAccountant) {
      loadAccountantDashboardData();
    }
  }, [isAccountant]);

  // Dynamic calculations for Accountant KPI dashboard cards
  const todayIncome = React.useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    return ledger.filter(t => t.type === 'Income' && t.date === today).reduce((sum, t) => sum + t.amount, 0);
  }, [ledger]);

  const todayExpenses = React.useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    return ledger.filter(t => t.type === 'Expense' && t.date === today).reduce((sum, t) => sum + t.amount, 0);
  }, [ledger]);

  const pendingAllocationsCount = React.useMemo(() => {
    const enrolled = students.filter(s => s.status === 'Enrolled' && s.branchId === myBranchId);
    const allocatedIds = new Set(allocations.map(a => a.studentId));
    return enrolled.filter(s => !allocatedIds.has(s.id)).length;
  }, [students, allocations, myBranchId]);

  const totalInventoryItems = React.useMemo(() => {
    return inventory.filter(item => item.status === 'Active').reduce((sum, item) => sum + item.quantity, 0);
  }, [inventory]);

  const lowStockCount = React.useMemo(() => {
    return inventory.filter(item => item.status === 'Active' && item.availableQuantity <= item.minStock).length;
  }, [inventory]);

  const currentMonthStr = new Date().toISOString().slice(0, 7);
  const currentMonthReport = React.useMemo(() => {
    return reports.find(r => r.month === currentMonthStr);
  }, [reports, currentMonthStr]);
  const currentMonthReportStatus = currentMonthReport ? currentMonthReport.status : 'Pending';

  const handleMonthlyReportQuickAction = () => {
    const submitted = reports.some(r => r.month === currentMonthStr && r.status !== 'Returned');
    if (submitted) {
      alert("Monthly Report Already Submitted");
    } else {
      navigate('/accountant?tab=reports');
    }
  };

  // Recharts Monthly aggregation for Accountant chart
  const monthlyBarChartData = React.useMemo(() => {
    const months = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const currentYear = new Date().getFullYear();

    return months.map((m, idx) => {
      const prefix = `${currentYear}-${m}`;
      const inc = ledger.filter(t => t.type === 'Income' && t.date && t.date.startsWith(prefix)).reduce((s, t) => s + t.amount, 0);
      const exp = ledger.filter(t => t.type === 'Expense' && t.date && t.date.startsWith(prefix)).reduce((s, t) => s + t.amount, 0);
      return {
        month: monthNames[idx],
        Income: inc,
        Expense: exp
      };
    }).filter(d => d.Income > 0 || d.Expense > 0);
  }, [ledger]);

  // Recent Financial Activities (Latest 10 logs)
  const recentFinancialActivities = React.useMemo(() => {
    const list: Array<{ id: string; type: string; date: string; message: string; timestamp: number }> = [];

    // Ledger transactions (Income/Expense Added)
    ledger.forEach((t) => {
      list.push({
        id: `ledger-${t.id}`,
        type: t.type === 'Income' ? 'Income Added' : 'Expense Added',
        date: t.date || '',
        message: `${t.type === 'Income' ? 'Income' : 'Expense'} Voucher ${t.voucherNumber || ''} recorded: ${t.description || ''} (${formatIndianCurrency(t.amount || 0)})`,
        timestamp: t.date ? new Date(t.date).getTime() : 0
      });
    });

    // Inventory Allocations
    allocations.forEach((a) => {
      list.push({
        id: `alloc-${a.id}`,
        type: 'Inventory Allocated',
        date: a.allocatedDate || '',
        message: `Allocated ${a.quantity || 0} units of ${a.itemName || ''} to student ${a.studentName || ''} (${a.studentId || ''})`,
        timestamp: a.allocatedDate ? new Date(a.allocatedDate).getTime() : 0
      });
    });

    // Student enrollment
    students.filter(s => s.status === 'Enrolled' && s.branchId === myBranchId).forEach((s) => {
      const enrolDate = s.admissionDate || s.createdAt?.split('T')[0] || todayISO;
      list.push({
        id: `student-${s.id}`,
        type: 'Student Admission Waiting for Inventory',
        date: enrolDate,
        message: `New student enrolled: ${s.fullName || ''} (${s.id || ''}) in class ${s.className || ''}`,
        timestamp: enrolDate ? new Date(enrolDate).getTime() : 0
      });
    });

    // Monthly reports submitted
    reports.forEach((r) => {
      list.push({
        id: `report-${r.id}`,
        type: 'Monthly Report Submitted',
        date: r.submittedDate || '',
        message: `Monthly report for ${r.month || ''} submitted by ${r.submittedBy || ''} (Status: ${r.status || ''})`,
        timestamp: r.submittedDate ? new Date(r.submittedDate).getTime() : 0
      });
    });

    // Sort by timestamp DESC, then slice to top 10
    return list.sort((a, b) => b.timestamp - a.timestamp).slice(0, 10);
  }, [ledger, allocations, students, reports, myBranchId]);

  // Low Stock Items Alerts List
  const lowStockItemsList = React.useMemo(() => {
    return inventory.filter(item => item.status === 'Active' && item.availableQuantity <= item.minStock);
  }, [inventory]);

  const handleLedgerFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ledgerForm.description || !ledgerForm.amount || Number(ledgerForm.amount) <= 0) {
      alert('Description and a valid amount are required.');
      return;
    }

    const formData = new FormData();
    formData.append('date', ledgerForm.date);
    formData.append('type', ledgerForm.type);
    formData.append('category', ledgerForm.category);
    formData.append('description', ledgerForm.description);
    formData.append('amount', ledgerForm.amount);
    formData.append('paymentMode', ledgerForm.paymentMode);
    formData.append('referenceNumber', ledgerForm.referenceNumber);
    formData.append('enteredBy', user?.name || 'Accountant');
    formData.append('branchId', myBranchId);
    if (ledgerForm.attachment) {
      formData.append('attachment', ledgerForm.attachment);
    }

    try {
      const res = await fetch('http://localhost:4000/api/ledger', {
        method: 'POST',
        body: formData
      });
      if (res.ok) {
        setLedgerForm({
          date: new Date().toISOString().split('T')[0],
          type: 'Income',
          category: 'Tuition Fee',
          description: '',
          amount: '',
          paymentMode: 'UPI',
          referenceNumber: '',
          attachment: null
        });
        setFeedback('Ledger entry added successfully.');
        setShowAddLedgerModal(false);
        await loadAccountantDashboardData();
      } else {
        const errorData = await res.json();
        alert(errorData.error || 'Failed to submit ledger entry.');
      }
    } catch (e) {
      console.error(e);
      alert('Connection error');
    }
  };

  const teacherOptions = React.useMemo(() => getTeachersForBranch(user?.branchId), [user?.branchId, teacherModalOpen]);
  const classOptions = React.useMemo(() => getClassesForBranch(user?.branchId), [user?.branchId, classModalOpen]);

  const alerts = isSuperAdmin ? SUPERADMIN_ALERTS : ADMIN_ALERTS;
  const submissions = useSubmissions();

  React.useEffect(() => {
    if (!teacherModalOpen && !classModalOpen) {
      document.body.style.overflow = '';
      document.body.style.paddingRight = '';
      return;
    }

    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      document.body.style.overflow = '';
      document.body.style.paddingRight = '';
    };
  }, [teacherModalOpen, classModalOpen]);
  const notifications = useNotifications();
  const notificationStats = React.useMemo(() => getNotificationStats(notifications, user), [notifications, user]);
  const exams = useExams();
  const schoolExamSchedules = useSchoolExamSchedules();
  const scopedSubmissions = filterByBranch(submissions as Array<{ branchId?: string | null }>, user, branchFilter);
  const scopedExams = filterByBranch(exams as Array<{ branchId?: string | null }>, user, branchFilter);
  const myExams = React.useMemo(() => {
    const published = scopedExams.filter(
      (ex: { status?: string; className?: string }) =>
        ex.status === 'published' && myClasses.includes(ex.className ?? '')
    );
    return published.slice(0, 5);
  }, [exams, myClasses]);
  const mySubmissionsToday = scopedSubmissions.filter((s) => s.teacherId === user?.id && s.date === todayISO);
  const submittedClasses = mySubmissionsToday.map((s) => s.className);
  const pendingClasses = myClasses.filter((c) => !submittedClasses.includes(c));
  const adminSchoolExams = React.useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return schoolExamSchedules.filter((schedule) => {
      if (!branchFilter) return schedule.startDate >= today;
      return schedule.branchId === branchFilter && schedule.startDate >= today;
    }).slice(0, 5);
  }, [branchFilter, schoolExamSchedules]);

  const teacherSchoolExams = React.useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return schoolExamSchedules.filter((schedule) => {
      const matchesTeacher = !schedule.teacherId || schedule.teacherId === user?.id;
      const matchesClass = !myClasses.length || myClasses.includes(schedule.schoolClass);
      return matchesTeacher && matchesClass && schedule.startDate >= today;
    }).slice(0, 5);
  }, [myClasses, schoolExamSchedules, user?.id]);

  const todaySchoolExams = React.useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return schoolExamSchedules.filter((schedule) => schedule.startDate === today || schedule.endDate === today);
  }, [schoolExamSchedules]);

  const unreadNotificationsForTeacher = notifications.filter((n) => {
    if (!user) return false;
    if (n.userIds?.includes(user.id)) return true;
    if (n.roles?.includes('teacher')) {
      if (!n.classNames?.length) return true;
      return n.classNames.some((cn: string) => myClasses.includes(cn));
    }
    return false;
  }).filter((n) => !n.read).length;

  const branchAwareStats = React.useMemo(() => {
    const scopeLabel = branchFilter ? getBranchName(branchFilter) : 'All Branches';
    if (isSuperAdmin) {
      return [
        { label: 'Students', value: '1,240', icon: Users, color: 'bg-green-50 dark:bg-green-950/40', iconColor: 'text-green-600 dark:text-green-400', border: 'border-green-100 dark:border-green-900' },
        { label: 'Teachers', value: '48', icon: BookOpen, color: 'bg-sky-50 dark:bg-sky-950/40', iconColor: 'text-sky-600 dark:text-sky-400', border: 'border-sky-100 dark:border-sky-900' },
        { label: "Today's WhatsApp Sent", value: whatsappStats ? String(whatsappStats.todaySent) : '0', icon: MessageSquare, color: 'bg-emerald-50 dark:bg-emerald-950/40', iconColor: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-100 dark:border-emerald-900' },
        { label: 'Failed WhatsApp Today', value: whatsappStats ? String(whatsappStats.todayFailed) : '0', icon: X, color: 'bg-rose-50 dark:bg-rose-950/40', iconColor: 'text-rose-600 dark:text-rose-400', border: 'border-rose-100 dark:border-rose-900' },
        { label: 'WhatsApp Delivery Rate', value: whatsappStats ? `${whatsappStats.deliveryRate}%` : '100%', icon: CheckCircle2, color: 'bg-green-50 dark:bg-green-950/40', iconColor: 'text-green-600 dark:text-green-400', border: 'border-green-100 dark:border-green-900' },
      ];
    }

    return [
      { label: 'Students', value: '320', icon: Users, color: 'bg-green-50 dark:bg-green-950/40', iconColor: 'text-green-600 dark:text-green-400', border: 'border-green-100 dark:border-green-900' },
      { label: 'Teachers', value: '12', icon: BookOpen, color: 'bg-sky-50 dark:bg-sky-950/40', iconColor: 'text-sky-600 dark:text-sky-400', border: 'border-sky-100 dark:border-sky-900' },
      { label: "Today's WhatsApp Sent", value: whatsappStats ? String(whatsappStats.todaySent) : '0', icon: MessageSquare, color: 'bg-emerald-50 dark:bg-emerald-950/40', iconColor: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-100 dark:border-emerald-900' },
      { label: 'Failed WhatsApp Today', value: whatsappStats ? String(whatsappStats.todayFailed) : '0', icon: X, color: 'bg-rose-50 dark:bg-rose-950/40', iconColor: 'text-rose-600 dark:text-rose-400', border: 'border-rose-100 dark:border-rose-900' },
      { label: 'WhatsApp Success Rate', value: whatsappStats ? `${whatsappStats.deliveryRate}%` : '100%', icon: CheckCircle2, color: 'bg-green-50 dark:bg-green-950/40', iconColor: 'text-green-600 dark:text-green-400', border: 'border-green-100 dark:border-green-900' },
    ];
  }, [branchFilter, isSuperAdmin, whatsappStats]);


  const chartData = React.useMemo(() => {
    if (isSuperAdmin) {
      return [
        { branch: 'Rajajinagar', students: 320, revenue: 180000 },
        { branch: 'Jayanagar', students: 280, revenue: 152000 },
        { branch: 'Vijayanagar', students: 240, revenue: 128000 },
      ].filter((item) => (!branchFilter ? true : item.branch === getBranchName(branchFilter)));
    }

    return [
      { week: 'Wk 1', value: 92 },
      { week: 'Wk 2', value: 88 },
      { week: 'Wk 3', value: 95 },
      { week: 'Wk 4', value: 91 },
      { week: 'Wk 5', value: 94 },
      { week: 'Wk 6', value: 96 },
    ];
  }, [branchFilter, isSuperAdmin]);

  const handleTeacherSave = () => {
    if (!user?.branchId) {
      setFeedback('Please sign in with an admin branch to create a teacher.');
      return;
    }
    const result = addTeacher({
      ...teacherForm,
      confirmPassword: teacherForm.confirmPassword,
      status: teacherForm.status,
    }, user.branchId);
    if (!result.success) {
      setFeedback(result.error ?? 'Unable to create teacher.');
      return;
    }
    addNotification({
      title: 'Teacher Added',
      message: `${result.teacher?.fullName} was created and assigned to your branch.`,
      type: 'success',
      roles: ['admin', 'super_admin'],
      branchId: user.branchId,
      recipient: 'Admin',
      notificationType: 'General Announcement',
      priority: 'high',
      recipientRole: 'admin',
    });
    setFeedback('Teacher created successfully.');
    setTeacherModalOpen(false);
    setTeacherForm({ fullName: '', gender: 'Female', dob: '', phone: '', email: '', address: '', qualification: '', experience: '', specialization: '', username: '', password: '', confirmPassword: '', employmentType: 'Full Time', status: 'Active', dateOfJoining: '', profilePhoto: '' });
  };

  const handleClassSave = () => {
    if (!user?.branchId) {
      setFeedback('Your branch scope is required to create a class.');
      return;
    }
    const result = addClass({
      ...classForm,
      branchId: user.branchId,
      maxStudents: Number(classForm.maxStudents || 30),
      daysOfWeek: classForm.daysOfWeek,
      status: classForm.status,
    });
    if (!result.success) {
      setFeedback(result.error ?? 'Unable to create class.');
      return;
    }
    addNotification({
      title: 'Class Created',
      message: `${result.class?.className} was created for ${result.class?.subject}.`,
      type: 'info',
      roles: ['teacher', 'admin', 'super_admin'],
      branchId: user.branchId,
      recipient: 'Teachers',
      notificationType: 'General Announcement',
      priority: 'high',
      recipientRole: 'teacher',
      classNames: [result.class?.className].filter(Boolean) as string[],
    });
    setFeedback('Class created successfully.');
    setClassModalOpen(false);
    setClassForm({ className: '', batchName: '', course: '', subject: '', assignedTeacherId: '', branchId: user.branchId, roomNumber: '', maxStudents: '30', startDate: '', endDate: '', classTiming: '', daysOfWeek: [], status: 'Active' });
  };

  if (isAccountant) {
    return (
      <div className="flex-1 bg-background pb-12">
        <Header title="Accountant Dashboard" />
        <div className="max-w-5xl mx-auto p-6 space-y-6">
          <GreetingBanner
            name={user?.name ?? 'Accountant'}
            subtitle={`Accountant · ${activeBranchLabel} · Guru Shishyaru Tutorials`}
          />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
            <div className="lg:col-span-1">
              <BirthdayWidget />
            </div>
          </div>
          <BirthdayChecker />

          {/* SUMMARY CARDS */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {/* 1. Today's Income */}
            <div
              onClick={() => navigate('/accountant?tab=ledger')}
              className="rounded-2xl border border-green-100 bg-green-50/40 p-4 hover:shadow-md cursor-pointer transition-all flex flex-col justify-between"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-green-700">Today's Income</span>
                <span className="text-xl">💰</span>
              </div>
              <p className="text-lg font-bold text-foreground">{formatIndianCurrency(todayIncome)}</p>
            </div>

            {/* 2. Today's Expense */}
            <div
              onClick={() => navigate('/accountant?tab=ledger')}
              className="rounded-2xl border border-red-100 bg-red-50/40 p-4 hover:shadow-md cursor-pointer transition-all flex flex-col justify-between"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-red-700">Today's Expense</span>
                <span className="text-xl">💸</span>
              </div>
              <p className="text-lg font-bold text-foreground">{formatIndianCurrency(todayExpenses)}</p>
            </div>

            {/* 3. Pending Inventory Allocation */}
            <div
              onClick={() => navigate('/accountant?tab=allocations')}
              className="rounded-2xl border border-amber-100 bg-amber-50/40 p-4 hover:shadow-md cursor-pointer transition-all flex flex-col justify-between"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-amber-700">Pending Alloc.</span>
                <span className="text-xl">📦</span>
              </div>
              <p className="text-lg font-bold text-foreground">{pendingAllocationsCount}</p>
            </div>

            {/* 4. Total Inventory Items */}
            <div
              onClick={() => navigate('/accountant?tab=inventory')}
              className="rounded-2xl border border-blue-100 bg-blue-50/40 p-4 hover:shadow-md cursor-pointer transition-all flex flex-col justify-between"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-blue-700">Total Inv. Items</span>
                <span className="text-xl">📚</span>
              </div>
              <p className="text-lg font-bold text-foreground">{totalInventoryItems}</p>
            </div>

            {/* 5. Low Stock Items */}
            <div
              onClick={() => navigate('/accountant?tab=inventory')}
              className="rounded-2xl border border-rose-100 bg-rose-50/40 p-4 hover:shadow-md cursor-pointer transition-all flex flex-col justify-between"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-rose-700">Low Stock Items</span>
                <span className="text-xl">⚠️</span>
              </div>
              <p className="text-lg font-bold text-foreground">{lowStockCount}</p>
            </div>

            {/* 6. Monthly Report Status */}
            <div
              onClick={() => navigate('/accountant?tab=reports')}
              className="rounded-2xl border border-teal-100 bg-teal-50/40 p-4 hover:shadow-md cursor-pointer transition-all flex flex-col justify-between"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-teal-700">Report Status</span>
                <span className="text-xl">📄</span>
              </div>
              <div className="space-y-0.5">
                <span className="text-[10px] text-muted-foreground font-mono">{currentMonthStr}</span>
                <p className="text-sm font-bold text-foreground">{currentMonthReportStatus}</p>
              </div>
            </div>
          </div>

          {/* REPLACE QUICK ACTIONS */}
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <h3 className="font-semibold text-foreground mb-4">Quick Actions</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              {/* 1. Add Income */}
              <div
                onClick={() => {
                  setLedgerForm({
                    date: new Date().toISOString().split('T')[0],
                    type: 'Income',
                    category: 'Tuition Fee',
                    description: '',
                    amount: '',
                    paymentMode: 'UPI',
                    referenceNumber: '',
                    attachment: null
                  });
                  setShowAddLedgerModal(true);
                }}
                className="flex flex-col items-center justify-center p-5 border border-border bg-secondary/10 rounded-2xl cursor-pointer hover:scale-105 hover:bg-secondary/35 shadow-sm hover:shadow-md transition-all duration-200 gap-3"
              >
                <span className="p-3 rounded-full bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400">
                  <Wallet className="h-6 w-6" />
                </span>
                <span className="text-xs font-bold text-foreground text-center">Add Income</span>
              </div>
              
              {/* 2. Add Expense */}
              <div
                onClick={() => {
                  setLedgerForm({
                    date: new Date().toISOString().split('T')[0],
                    type: 'Expense',
                    category: 'Utilities',
                    description: '',
                    amount: '',
                    paymentMode: 'UPI',
                    referenceNumber: '',
                    attachment: null
                  });
                  setShowAddLedgerModal(true);
                }}
                className="flex flex-col items-center justify-center p-5 border border-border bg-secondary/10 rounded-2xl cursor-pointer hover:scale-105 hover:bg-secondary/35 shadow-sm hover:shadow-md transition-all duration-200 gap-3"
              >
                <span className="p-3 rounded-full bg-rose-50 dark:bg-rose-950/20 text-rose-600 dark:text-rose-400">
                  <CreditCard className="h-6 w-6" />
                </span>
                <span className="text-xs font-bold text-foreground text-center">Add Expense</span>
              </div>

              {/* 3. Accounts Ledger */}
              <div
                onClick={() => navigate('/accountant?tab=ledger')}
                className="flex flex-col items-center justify-center p-5 border border-border bg-secondary/10 rounded-2xl cursor-pointer hover:scale-105 hover:bg-secondary/35 shadow-sm hover:shadow-md transition-all duration-200 gap-3"
              >
                <span className="p-3 rounded-full bg-blue-50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400">
                  <BookOpen className="h-6 w-6" />
                </span>
                <span className="text-xs font-bold text-foreground text-center">Accounts Ledger</span>
              </div>

              {/* 4. Allocate Inventory */}
              <div
                onClick={() => navigate('/accountant?tab=allocations')}
                className="flex flex-col items-center justify-center p-5 border border-border bg-secondary/10 rounded-2xl cursor-pointer hover:scale-105 hover:bg-secondary/35 shadow-sm hover:shadow-md transition-all duration-200 gap-3"
              >
                <span className="p-3 rounded-full bg-amber-50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400">
                  <ClipboardCheck className="h-6 w-6" />
                </span>
                <span className="text-xs font-bold text-foreground text-center">Allocate Inventory</span>
              </div>

              {/* 5. Manage Inventory */}
              <div
                onClick={() => navigate('/accountant?tab=inventory')}
                className="flex flex-col items-center justify-center p-5 border border-border bg-secondary/10 rounded-2xl cursor-pointer hover:scale-105 hover:bg-secondary/35 shadow-sm hover:shadow-md transition-all duration-200 gap-3"
              >
                <span className="p-3 rounded-full bg-purple-50 dark:bg-purple-950/20 text-purple-600 dark:text-purple-400">
                  <Boxes className="h-6 w-6" />
                </span>
                <span className="text-xs font-bold text-foreground text-center">Manage Inventory</span>
              </div>

              {/* 6. Submit Monthly Report */}
              <div
                onClick={handleMonthlyReportQuickAction}
                className="flex flex-col items-center justify-center p-5 border border-border bg-secondary/10 rounded-2xl cursor-pointer hover:scale-105 hover:bg-secondary/35 shadow-sm hover:shadow-md transition-all duration-200 gap-3"
              >
                <span className="p-3 rounded-full bg-teal-50 dark:bg-teal-950/20 text-teal-600 dark:text-teal-400">
                  <FileSpreadsheet className="h-6 w-6" />
                </span>
                <span className="text-xs font-bold text-foreground text-center">Submit Report</span>
              </div>
            </div>
          </div>

          {/* REPLACE ATTENDANCE TREND & RECENT FIN ACTIVITIES */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Monthly Income vs Expense Bar Chart */}
            <div className="lg:col-span-2 rounded-2xl border border-border bg-card p-5 shadow-sm">
              <h3 className="font-semibold text-foreground mb-4">Monthly Income vs Expense</h3>
              {monthlyBarChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={monthlyBarChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="month" stroke="var(--muted-foreground)" fontSize={12} axisLine={false} tickLine={false} />
                    <YAxis stroke="var(--muted-foreground)" fontSize={11} axisLine={false} tickLine={false} tickFormatter={(v) => formatIndianCurrency(Number(v))} />
                    <Tooltip formatter={(v) => formatIndianCurrency(Number(v))} contentStyle={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', borderRadius: '12px' }} />
                    <Bar dataKey="Income" fill="#10B981" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Expense" fill="#EF4444" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground text-sm">
                  <Boxes className="h-8 w-8 mb-2 opacity-30" /> No data available.
                </div>
              )}
            </div>

            {/* Recent Financial Activities */}
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm flex flex-col justify-between">
              <h3 className="font-semibold text-foreground mb-3">Recent Financial Activities</h3>
              <div className="space-y-3 flex-1 overflow-y-auto max-h-[280px] pr-1">
                {recentFinancialActivities.map(act => (
                  <div key={act.id} className="flex items-start gap-2 border-b border-border/40 pb-2">
                    <span className={`inline-flex rounded px-1.5 py-0.5 text-[9px] font-bold ${
                      act.type.includes('Income') ? 'bg-green-50 text-green-700 dark:bg-green-950/20 dark:text-green-400' :
                      act.type.includes('Expense') ? 'bg-red-50 text-red-700 dark:bg-red-950/20 dark:text-red-400' :
                      act.type.includes('Allocated') ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400' :
                      act.type.includes('Waiting') ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/20 dark:text-blue-400' :
                      'bg-purple-50 text-purple-700 dark:bg-purple-950/20 dark:text-purple-400'
                    }`}>
                      {act.type}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-foreground font-medium line-clamp-2">{act.message}</p>
                      <span className="text-[10px] text-muted-foreground font-mono">{act.date}</span>
                    </div>
                  </div>
                ))}
                {recentFinancialActivities.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-8">No recent activity logged.</p>
                )}
              </div>
            </div>
          </div>

          {/* MONTHLY REPORT STATUS CARD */}
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-4">
            <h3 className="font-semibold text-foreground">Monthly report</h3>
            <div
              onClick={() => navigate('/accountant?tab=reports')}
              className="flex items-center justify-between border border-border bg-secondary/10 rounded-xl p-4 cursor-pointer hover:bg-secondary/25 transition-all"
            >
              <div>
                <p className="text-sm font-bold text-foreground">Report for Month {currentMonthStr}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Click to view/compile reports in detail</p>
              </div>
              <div className="text-right">
                <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                  currentMonthReportStatus === 'Approved' ? 'bg-green-100 text-green-700 dark:bg-green-950/20 dark:text-green-400' :
                  currentMonthReportStatus === 'Returned' ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400' :
                  currentMonthReportStatus === 'Submitted' ? 'bg-sky-100 text-sky-700 dark:bg-sky-950/20 dark:text-sky-400' :
                  'bg-secondary text-secondary-foreground'
                }`}>
                  {currentMonthReportStatus}
                </span>
              </div>
            </div>
          </div>

          {/* BOTTOM SECTION - Low Stock Items */}
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <h3 className="font-semibold text-foreground mb-4">Low Stock Items</h3>
            {lowStockItemsList.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground uppercase font-bold text-[10px] tracking-wider bg-secondary/20">
                      <th className="px-4 py-3">Item</th>
                      <th className="px-4 py-3 text-center">Available Quantity</th>
                      <th className="px-4 py-3 text-center">Minimum Quantity</th>
                      <th className="px-4 py-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60 text-sm">
                    {lowStockItemsList.map(item => (
                      <tr key={item.id} className="hover:bg-secondary/10 transition-colors">
                        <td className="px-4 py-3 font-semibold text-foreground">
                          {item.itemName}
                          <span className="ml-1.5 font-mono text-xs text-muted-foreground">({item.itemCode})</span>
                        </td>
                        <td className="px-4 py-3 text-center text-red-500 font-bold">{item.availableQuantity} {item.unit}</td>
                        <td className="px-4 py-3 text-center text-muted-foreground">{item.minStock} {item.unit}</td>
                        <td className="px-4 py-3 text-center">
                          <span className="inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold bg-red-50 text-red-700 dark:bg-red-950/20 dark:text-red-400">
                            Restock Needed
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-6">No Low Stock Items</p>
            )}
          </div>
        </div>

        {/* Form Modal for Add Income / Add Expense Quick Actions */}
        {showAddLedgerModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
            <div className="bg-card border border-border rounded-2xl w-full max-w-lg p-6 shadow-xl space-y-4">
              <div className="flex justify-between items-center border-b border-border pb-3">
                <h3 className="font-bold text-foreground">Record new {ledgerForm.type} Entry</h3>
                <button type="button" onClick={() => setShowAddLedgerModal(false)} className="text-sm text-muted-foreground hover:text-foreground">✕</button>
              </div>

              <form onSubmit={handleLedgerFormSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Date</label>
                    <input
                      type="date"
                      value={ledgerForm.date}
                      onChange={(e) => setLedgerForm(prev => ({ ...prev, date: e.target.value }))}
                      className="w-full rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm focus:outline-none"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Transaction Type</label>
                    <select
                      value={ledgerForm.type}
                      onChange={(e) => setLedgerForm(prev => ({ ...prev, type: e.target.value as any, category: e.target.value === 'Income' ? 'Tuition Fee' : 'Utilities' }))}
                      className="w-full rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm focus:outline-none"
                    >
                      <option value="Income">Income (Credit)</option>
                      <option value="Expense">Expense (Debit)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Category</label>
                    {ledgerForm.type === 'Income' ? (
                      <select
                        value={ledgerForm.category}
                        onChange={(e) => setLedgerForm(prev => ({ ...prev, category: e.target.value }))}
                        className="w-full rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm focus:outline-none"
                      >
                        <option value="Tuition Fee">Tuition Fee</option>
                        <option value="Admission Fee">Admission Fee</option>
                        <option value="Material Purchase Fee">Material Purchase Fee</option>
                        <option value="Special Class Fee">Special Class Fee</option>
                        <option value="Other Income">Other Income</option>
                      </select>
                    ) : (
                      <select
                        value={ledgerForm.category}
                        onChange={(e) => setLedgerForm(prev => ({ ...prev, category: e.target.value }))}
                        className="w-full rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm focus:outline-none"
                      >
                        <option value="Utilities">Utilities</option>
                        <option value="Salaries & Wages">Salaries & Wages</option>
                        <option value="Rent & Taxes">Rent & Taxes</option>
                        <option value="Inventory Purchase">Inventory Purchase</option>
                        <option value="Marketing & Print">Marketing & Print</option>
                        <option value="Repairs & General">Repairs & General</option>
                        <option value="Other Expense">Other Expense</option>
                      </select>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Amount (₹)</label>
                    <input
                      type="number"
                      placeholder="e.g. 5000"
                      value={ledgerForm.amount}
                      onChange={(e) => setLedgerForm(prev => ({ ...prev, amount: e.target.value }))}
                      className="w-full rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm focus:outline-none"
                      required
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Description</label>
                    <input
                      type="text"
                      placeholder="e.g. Tuition fee collected for July 2026 Batch A"
                      value={ledgerForm.description}
                      onChange={(e) => setLedgerForm(prev => ({ ...prev, description: e.target.value }))}
                      className="w-full rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm focus:outline-none"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Payment Mode</label>
                    <select
                      value={ledgerForm.paymentMode}
                      onChange={(e) => setLedgerForm(prev => ({ ...prev, paymentMode: e.target.value }))}
                      className="w-full rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm focus:outline-none"
                    >
                      <option value="UPI">UPI</option>
                      <option value="Cash">Cash</option>
                      <option value="Bank Transfer">Bank Transfer</option>
                      <option value="Cheque">Cheque</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Reference Number</label>
                    <input
                      type="text"
                      placeholder="Optional ref key"
                      value={ledgerForm.referenceNumber}
                      onChange={(e) => setLedgerForm(prev => ({ ...prev, referenceNumber: e.target.value }))}
                      className="w-full rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm focus:outline-none"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Attachment</label>
                    <input
                      type="file"
                      onChange={(e) => setLedgerForm(prev => ({ ...prev, attachment: e.target.files?.[0] || null }))}
                      className="w-full text-xs text-muted-foreground"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-3">
                  <button type="button" onClick={() => setShowAddLedgerModal(false)} className="rounded-xl border border-border px-5 py-2 text-sm font-medium hover:bg-secondary">Cancel</button>
                  <button type="submit" className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">Confirm Entry</button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 bg-background">
      <Header title="Dashboard" />

      <div className="max-w-5xl mx-auto p-6 space-y-7">

        {/* ── Greeting ── */}
        <GreetingBanner
          name={user?.name ?? 'User'}
          subtitle={`${roleLabel} · ${activeBranchLabel} · Guru Shishyaru Tutorials`}
        />

        {/* ── Role badge ── */}
        {isSuperAdmin && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-2xl border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/30 px-5 py-3">
              <Shield className="h-4 w-4 text-violet-600 dark:text-violet-400 shrink-0" />
              <p className="text-sm font-medium text-violet-700 dark:text-violet-300">
                You are logged in as <strong>Super Admin</strong> — system-level controls only.
                Day-to-day operations are managed by Admins.
              </p>
            </div>
            <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3">
              <label className="text-sm font-medium text-foreground">Branch Scope</label>
              <select
                value={branchFilter}
                onChange={(event) => setBranchFilter(event.target.value)}
                className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
              >
                <option value="">All Branches</option>
                {branches.filter((branch) => branch.status === 'Active').map((branch) => (
                  <option key={branch.id} value={branch.id}>{branch.name}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Teacher dashboard: simplified widgets */}
              {isTeacher ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-2xl border border-border bg-card p-5">
                <h3 className="text-sm font-semibold mb-2">My Classes</h3>
                <div className="space-y-2">
                  {myClasses.length === 0 && <p className="text-sm text-muted-foreground">No classes assigned</p>}
                  {myClasses.map((c) => (
                    <div key={c} className="rounded-md border border-border px-3 py-2 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">{c}</p>
                        <p className="text-xs text-muted-foreground">Section</p>
                      </div>
                      <Link to="/timetable" className="text-xs text-primary">View</Link>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-card p-5">
                <h3 className="text-sm font-semibold mb-2">Today's Timetable</h3>
                <div className="text-sm text-muted-foreground">Quick view of today's periods</div>
                <div className="mt-3 space-y-2">
                  {['08:00-09:00','09:00-10:00','10:00-11:00'].map((p) => (
                    <div key={p} className="flex items-center justify-between">
                      <span className="text-sm">{p}</span>
                      <span className="text-sm text-muted-foreground">Subject</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3">
                  <Link to="/timetable" className="text-xs text-primary">Open Timetable</Link>
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-card p-5">
                <h3 className="text-sm font-semibold mb-2">Pending Attendance</h3>
                <p className="text-2xl font-bold">{pendingClasses.length}</p>
                <div className="mt-3">
                  <Link to="/attendance" className="text-xs text-primary">Mark Attendance</Link>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-border bg-card p-5">
                <h3 className="text-sm font-semibold mb-2">Upcoming Exams</h3>
                <div className="space-y-2 text-sm text-muted-foreground">
                  {myExams.length === 0 && <div className="text-sm text-muted-foreground">No upcoming exams</div>}
                  {myExams.map((exam) => (
                    <div key={exam.id} className="flex items-center justify-between">
                      <span>{exam.name} — {exam.date}</span>
                      <Link to="/exams" className="text-xs text-muted-foreground">View</Link>
                    </div>
                  ))}
                </div>
                <div className="mt-3"><Link to="/exams" className="text-xs text-primary">View Exams</Link></div>
              </div>

              <div className="rounded-2xl border border-border bg-card p-5">
                <h3 className="text-sm font-semibold mb-2">Upcoming School Exams</h3>
                <div className="space-y-2 text-sm text-muted-foreground">
                  {teacherSchoolExams.length === 0 && <div className="text-sm text-muted-foreground">No upcoming school exams</div>}
                  {teacherSchoolExams.map((exam) => (
                    <div key={exam.id} className="flex items-center justify-between gap-2">
                      <span>{exam.studentName} · {exam.examName}</span>
                      <span className="text-xs text-primary">{exam.startDate}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3"><Link to="/school-exam-schedules" className="text-xs text-primary">Manage schedules</Link></div>
              </div>

              <div className="rounded-2xl border border-border bg-card p-5">
                <h3 className="text-sm font-semibold mb-2">Today's School Exams</h3>
                <div className="space-y-2 text-sm text-muted-foreground">
                  {todaySchoolExams.length === 0 && <div className="text-sm text-muted-foreground">No school exams today</div>}
                  {todaySchoolExams.map((exam) => (
                    <div key={exam.id} className="flex items-center justify-between gap-2">
                      <span>{exam.studentName} · {exam.examName}</span>
                      <span className="text-xs text-primary">{exam.schoolName}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3"><Link to="/school-exam-schedules" className="text-xs text-primary">Open schedules</Link></div>
              </div>

              <div className="rounded-2xl border border-border bg-card p-5">
                <h3 className="text-sm font-semibold mb-2">Notifications</h3>
                <p className="text-2xl font-bold">{unreadNotificationsForTeacher}</p>
                <div className="mt-3"><Link to="/notifications" className="text-xs text-primary">Open Notifications</Link></div>
              </div>

              <div className="rounded-2xl border border-border bg-card p-5">
                <h3 className="text-sm font-semibold mb-2">Today's WhatsApp Attendance</h3>
                <div className="grid grid-cols-2 gap-2 text-center mt-3">
                  <div className="rounded-lg bg-secondary/50 p-2">
                    <p className="text-lg font-bold text-foreground">{whatsappStats ? whatsappStats.todayAbsent : 0}</p>
                    <p className="text-[10px] text-muted-foreground">Absent Ward(s)</p>
                  </div>
                  <div className="rounded-lg bg-secondary/50 p-2">
                    <p className="text-lg font-bold text-emerald-600">{whatsappStats ? whatsappStats.todayWhatsappSent : 0}</p>
                    <p className="text-[10px] text-muted-foreground">Alerts Sent</p>
                  </div>
                  <div className="rounded-lg bg-secondary/50 p-2">
                    <p className="text-lg font-bold text-amber-500">{whatsappStats ? whatsappStats.pendingNotifications : 0}</p>
                    <p className="text-[10px] text-muted-foreground">Pending</p>
                  </div>
                  <div className="rounded-lg bg-secondary/50 p-2">
                    <p className="text-lg font-bold text-rose-500">{whatsappStats ? whatsappStats.failedMessages : 0}</p>
                    <p className="text-[10px] text-muted-foreground">Failed</p>
                  </div>
                </div>
                <div className="mt-3"><Link to="/reports" className="text-xs text-primary">View WhatsApp Reports</Link></div>
              </div>

            </div>

            <div className="rounded-2xl border border-border bg-card p-5">
              <h3 className="text-sm font-semibold mb-2">Daily Submission Status</h3>
              <div className="space-y-2">
                {myClasses.map((c) => (
                  <div key={c} className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{c}</p>
                      <p className="text-xs text-muted-foreground">{submittedClasses.includes(c) ? 'Submitted' : 'Not Submitted'}</p>
                    </div>
                    <div className="text-xs">
                      {submittedClasses.includes(c)
                        ? new Date(mySubmissionsToday.find((s:any)=>s.className===c)?.createdAt || '').toLocaleTimeString()
                        : <Link to="/daily-submission" className="text-primary">Submit</Link>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="rounded-2xl border border-border bg-card p-5">
              <h3 className="text-sm font-semibold mb-2">Upcoming School Exams</h3>
              <div className="space-y-2 text-sm text-muted-foreground">
                {adminSchoolExams.length === 0 && <div className="text-sm text-muted-foreground">No upcoming school exams</div>}
                {adminSchoolExams.map((exam) => (
                  <div key={exam.id} className="flex items-center justify-between gap-2">
                    <span>{exam.studentName} · {exam.examName}</span>
                    <span className="text-xs text-primary">{exam.startDate}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3"><Link to="/school-exam-schedules" className="text-xs text-primary">View schedules</Link></div>
            </div>

            <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
              {branchAwareStats.map((s) => (
                <div key={s.label} className={`rounded-2xl border ${s.border} ${s.color} p-5`}>
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-white dark:bg-black/20 shadow-sm">
                    <s.icon className={`h-5 w-5 ${s.iconColor}`} />
                  </div>
                  <p className="text-2xl font-bold text-foreground">{s.value}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{s.label}</p>
                </div>
              ))}
            </div>

            {/* Special Classes Dashboard Section */}
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              {/* Today's Special Classes Card */}
              <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-foreground">Today's Special Classes</h3>
                    <p className="text-xs text-muted-foreground">Extra coaching and revision sessions scheduled for today.</p>
                  </div>
                  <CalendarDays className="h-5 w-5 text-purple-500" />
                </div>
                <div className="space-y-3">
                  {specialClasses.filter(c => c.date === new Date().toISOString().split('T')[0] && c.status !== 'Cancelled' && (branchFilter ? c.branchId === branchFilter : true)).length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center italic bg-muted/10 rounded-xl border border-dashed border-border">No special classes scheduled for today.</p>
                  ) : (
                    specialClasses.filter(c => c.date === new Date().toISOString().split('T')[0] && c.status !== 'Cancelled' && (branchFilter ? c.branchId === branchFilter : true)).map((c) => (
                      <div key={c.id} className="p-3 rounded-xl border border-border bg-background flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold text-foreground">{c.title}</p>
                          <p className="text-xs text-muted-foreground">{c.subject} · {c.className} · {c.venue} · {c.startTime}-{c.endTime}</p>
                        </div>
                        <span className="text-xs font-semibold text-purple-600 dark:text-purple-400 bg-purple-100 dark:bg-purple-950/40 px-2 py-0.5 rounded-full shrink-0">
                          {c.purpose}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Branch-wise Special Classes / Upcoming classes */}
              <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-foreground">
                      {isSuperAdmin ? 'Branch-wise Special Classes' : 'Upcoming Extra Classes'}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {isSuperAdmin ? 'Distribution of scheduled classes across branches.' : 'Special sessions upcoming in your branch.'}
                    </p>
                  </div>
                  <BarChart3 className="h-5 w-5 text-purple-500" />
                </div>
                <div className="space-y-3">
                  {isSuperAdmin ? (
                    branches.map((b) => {
                      const branchClassesCount = specialClasses.filter(c => c.branchId === b.id).length;
                      return (
                        <div key={b.id} className="flex items-center justify-between py-1 border-b border-border last:border-0">
                          <span className="text-sm font-medium text-foreground">{b.name}</span>
                          <span className="text-xs font-bold text-muted-foreground bg-secondary px-2.5 py-0.5 rounded-full">
                            {branchClassesCount} classes
                          </span>
                        </div>
                      );
                    })
                  ) : (
                    specialClasses.filter(c => c.status !== 'Cancelled' && new Date(c.date + 'T' + c.startTime) > new Date() && c.branchId === user?.branchId).slice(0, 4).length === 0 ? (
                      <p className="text-sm text-muted-foreground py-4 text-center italic bg-muted/10 rounded-xl border border-dashed border-border">No upcoming special classes scheduled.</p>
                    ) : (
                      specialClasses.filter(c => c.status !== 'Cancelled' && new Date(c.date + 'T' + c.startTime) > new Date() && c.branchId === user?.branchId).slice(0, 4).map((c) => (
                        <div key={c.id} className="flex items-center justify-between text-xs py-1.5 border-b border-border last:border-0">
                          <div>
                            <p className="font-semibold text-foreground">{c.title}</p>
                            <p className="text-muted-foreground">{c.date} · {c.startTime}</p>
                          </div>
                          <span className="text-[10px] bg-secondary px-2 py-0.5 rounded-full font-semibold">{c.subject}</span>
                        </div>
                      ))
                    )
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground">Notification Summary</h2>
            <Bell className="h-5 w-5 text-primary" />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-border p-3">
              <p className="text-sm text-muted-foreground">Unread</p>
              <p className="text-2xl font-bold">{notificationStats.unread}</p>
            </div>
            <div className="rounded-xl border border-border p-3">
              <p className="text-sm text-muted-foreground">Read</p>
              <p className="text-2xl font-bold">{notificationStats.read}</p>
            </div>
            <div className="rounded-xl border border-border p-3">
              <p className="text-sm text-muted-foreground">Deleted</p>
              <p className="text-2xl font-bold">{notificationStats.deleted}</p>
            </div>
            <div className="rounded-xl border border-border p-3">
              <p className="text-sm text-muted-foreground">Scheduled</p>
              <p className="text-2xl font-bold">{notificationStats.scheduled}</p>
            </div>
          </div>
        </div>

        {/* ── Quick Actions ── */}
        <div>
          <h2 className="mb-3 text-base font-semibold text-foreground">Quick Actions</h2>
          {feedback && <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">{feedback}</div>}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {isTeacher ? (
              [
                { label: 'Add Student', icon: UserPlus, path: '/students' },
                { label: 'Mark Attendance', icon: ClipboardCheck, path: '/attendance' },
                { label: 'Enter Marks', icon: BookOpen, path: '/exams' },
                { label: 'Manage Timetable', icon: CalendarDays, path: '/timetable' },
                { label: 'Create Exam', icon: GraduationCap, path: '/teacher/exams/create' },
                { label: 'Daily Submission', icon: FileText, path: '/daily-submission' },
              ].map((a) => (
                <button
                  key={a.label}
                  onClick={() => navigate((a as any).path)}
                  className={`flex flex-col items-center justify-center gap-2 rounded-2xl px-3 py-4 text-xs font-semibold text-white transition-all active:scale-95 bg-sky-600 hover:bg-sky-700`}
                >
                  <a.icon className="h-6 w-6" />
                  {a.label}
                </button>
              ))
            ) : (
              actions.map((a) => {
                const handleAction = () => {
                  if (a.label === 'Add Teacher') {
                    setTeacherModalOpen(true);
                    setFeedback(null);
                    return;
                  }
                  if (a.label === 'Create Class') {
                    setClassModalOpen(true);
                    setFeedback(null);
                    return;
                  }
                  if (a.label === 'Notifications') {
                    navigate('/notifications');
                    return;
                  }
                  if (a.label.startsWith('Add ')) {
                    const role = a.label.split(' ')[1].toLowerCase();
                    navigate(a.path.split('?')[0], { state: { openAdd: true, role } });
                    return;
                  }
                  navigate(a.path);
                };

                return (
                  <button
                    key={a.label}
                    onClick={handleAction}
                    className={`flex flex-col items-center justify-center gap-2 rounded-2xl px-3 py-4 text-xs font-semibold text-white transition-all active:scale-95 ${a.color}`}
                  >
                    <a.icon className="h-6 w-6" />
                    {a.label}
                  </button>
                );
              })
            )}
          </div>
        </div>

        <Dialog open={teacherModalOpen} onOpenChange={setTeacherModalOpen}>
          <DialogContent className="max-h-[90dvh] max-w-3xl overflow-hidden p-6">
            <DialogHeader className="shrink-0">
              <DialogTitle>Add Teacher</DialogTitle>
            </DialogHeader>
            <div className="mt-4 flex-1 overflow-y-auto pr-1">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-3">
                  <div><label className="mb-1 block text-sm font-medium">Full Name</label><Input value={teacherForm.fullName} onChange={(e) => setTeacherForm((prev) => ({ ...prev, fullName: e.target.value }))} /></div>
                  <div><label className="mb-1 block text-sm font-medium">Employee ID</label><Input value={`Auto generated`} readOnly /></div>
                  <div><label className="mb-1 block text-sm font-medium">Gender</label><select className="w-full rounded-xl border border-input bg-input-background px-3 py-2 text-sm" value={teacherForm.gender} onChange={(e) => setTeacherForm((prev) => ({ ...prev, gender: e.target.value }))}><option>Female</option><option>Male</option><option>Other</option></select></div>
                  <div><label className="mb-1 block text-sm font-medium">Date of Birth</label><Input type="date" value={teacherForm.dob} onChange={(e) => setTeacherForm((prev) => ({ ...prev, dob: e.target.value }))} /></div>
                  <div><label className="mb-1 block text-sm font-medium">Phone Number</label><Input value={teacherForm.phone} onChange={(e) => setTeacherForm((prev) => ({ ...prev, phone: e.target.value }))} /></div>
                  <div><label className="mb-1 block text-sm font-medium">Email</label><Input type="email" value={teacherForm.email} onChange={(e) => setTeacherForm((prev) => ({ ...prev, email: e.target.value }))} /></div>
                  <div><label className="mb-1 block text-sm font-medium">Address</label><Input value={teacherForm.address} onChange={(e) => setTeacherForm((prev) => ({ ...prev, address: e.target.value }))} /></div>
                  <div><label className="mb-1 block text-sm font-medium">Qualification</label><Input value={teacherForm.qualification} onChange={(e) => setTeacherForm((prev) => ({ ...prev, qualification: e.target.value }))} /></div>
                </div>
                <div className="space-y-3">
                  <div><label className="mb-1 block text-sm font-medium">Experience</label><Input value={teacherForm.experience} onChange={(e) => setTeacherForm((prev) => ({ ...prev, experience: e.target.value }))} /></div>
                  <div><label className="mb-1 block text-sm font-medium">Specialization / Subjects</label><Input value={teacherForm.specialization} onChange={(e) => setTeacherForm((prev) => ({ ...prev, specialization: e.target.value }))} /></div>
                  <div><label className="mb-1 block text-sm font-medium">Branch</label><Input value={getBranchName(user?.branchId)} readOnly /></div>
                  <div><label className="mb-1 block text-sm font-medium">Date of Joining</label><Input type="date" value={teacherForm.dateOfJoining} onChange={(e) => setTeacherForm((prev) => ({ ...prev, dateOfJoining: e.target.value }))} /></div>
                  <div><label className="mb-1 block text-sm font-medium">Username</label><Input value={teacherForm.username} onChange={(e) => setTeacherForm((prev) => ({ ...prev, username: e.target.value }))} /></div>
                  <div><label className="mb-1 block text-sm font-medium">Password</label><Input type="password" value={teacherForm.password} onChange={(e) => setTeacherForm((prev) => ({ ...prev, password: e.target.value }))} /></div>
                  <div><label className="mb-1 block text-sm font-medium">Confirm Password</label><Input type="password" value={teacherForm.confirmPassword} onChange={(e) => setTeacherForm((prev) => ({ ...prev, confirmPassword: e.target.value }))} /></div>
                  <div><label className="mb-1 block text-sm font-medium">Employment Type</label><select className="w-full rounded-xl border border-input bg-input-background px-3 py-2 text-sm" value={teacherForm.employmentType} onChange={(e) => setTeacherForm((prev) => ({ ...prev, employmentType: e.target.value }))}><option>Full Time</option><option>Part Time</option></select></div>
                  <div><label className="mb-1 block text-sm font-medium">Status</label><select className="w-full rounded-xl border border-input bg-input-background px-3 py-2 text-sm" value={teacherForm.status} onChange={(e) => setTeacherForm((prev) => ({ ...prev, status: e.target.value as 'Active' | 'Inactive' }))}><option value="Active">Active</option><option value="Inactive">Inactive</option></select></div>
                </div>
              </div>
            </div>
            <DialogFooter className="mt-4 shrink-0 border-t border-border/60 pt-4">
              <Button variant="ghost" onClick={() => setTeacherModalOpen(false)}>Cancel</Button>
              <Button onClick={handleTeacherSave}><CheckCircle2 className="mr-2 h-4 w-4" />Save Teacher</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={classModalOpen} onOpenChange={setClassModalOpen}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Create Class</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-3">
                <div><label className="mb-1 block text-sm font-medium">Class Name</label><Input value={classForm.className} onChange={(e) => setClassForm((prev) => ({ ...prev, className: e.target.value }))} /></div>
                <div><label className="mb-1 block text-sm font-medium">Batch Name</label><Input value={classForm.batchName} onChange={(e) => setClassForm((prev) => ({ ...prev, batchName: e.target.value }))} /></div>
                <div><label className="mb-1 block text-sm font-medium">Course</label><Input value={classForm.course} onChange={(e) => setClassForm((prev) => ({ ...prev, course: e.target.value }))} /></div>
                <div><label className="mb-1 block text-sm font-medium">Subject</label><Input value={classForm.subject} onChange={(e) => setClassForm((prev) => ({ ...prev, subject: e.target.value }))} /></div>
                <div><label className="mb-1 block text-sm font-medium">Assigned Teacher</label><select className="w-full rounded-xl border border-input bg-input-background px-3 py-2 text-sm" value={classForm.assignedTeacherId} onChange={(e) => setClassForm((prev) => ({ ...prev, assignedTeacherId: e.target.value }))}><option value="">Select teacher</option>{teacherOptions.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.fullName}</option>)}</select></div>
                <div><label className="mb-1 block text-sm font-medium">Branch</label><Input value={getBranchName(user?.branchId)} readOnly /></div>
              </div>
              <div className="space-y-3">
                <div><label className="mb-1 block text-sm font-medium">Room Number</label><Input value={classForm.roomNumber} onChange={(e) => setClassForm((prev) => ({ ...prev, roomNumber: e.target.value }))} /></div>
                <div><label className="mb-1 block text-sm font-medium">Maximum Students</label><Input type="number" value={classForm.maxStudents} onChange={(e) => setClassForm((prev) => ({ ...prev, maxStudents: e.target.value }))} /></div>
                <div><label className="mb-1 block text-sm font-medium">Start Date</label><Input type="date" value={classForm.startDate} onChange={(e) => setClassForm((prev) => ({ ...prev, startDate: e.target.value }))} /></div>
                <div><label className="mb-1 block text-sm font-medium">End Date</label><Input type="date" value={classForm.endDate} onChange={(e) => setClassForm((prev) => ({ ...prev, endDate: e.target.value }))} /></div>
                <div><label className="mb-1 block text-sm font-medium">Class Timing</label><Input value={classForm.classTiming} onChange={(e) => setClassForm((prev) => ({ ...prev, classTiming: e.target.value }))} /></div>
                <div><label className="mb-1 block text-sm font-medium">Days of Week</label><input value={classForm.daysOfWeek.join(', ')} onChange={(e) => setClassForm((prev) => ({ ...prev, daysOfWeek: e.target.value.split(',').map((item) => item.trim()).filter(Boolean) }))} className="w-full rounded-xl border border-input bg-input-background px-3 py-2 text-sm" /></div>
                <div><label className="mb-1 block text-sm font-medium">Status</label><select className="w-full rounded-xl border border-input bg-input-background px-3 py-2 text-sm" value={classForm.status} onChange={(e) => setClassForm((prev) => ({ ...prev, status: e.target.value as 'Active' | 'Inactive' }))}><option value="Active">Active</option><option value="Inactive">Inactive</option></select></div>
              </div>
            </div>
            <DialogFooter className="mt-4">
              <Button variant="ghost" onClick={() => setClassModalOpen(false)}>Cancel</Button>
              <Button onClick={handleClassSave}><CheckCircle2 className="mr-2 h-4 w-4" />Create Class</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Chart + Alerts ── */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">

          {/* Chart — different per role */}
          <div className="lg:col-span-3 rounded-2xl border border-border bg-card p-6 shadow-sm">
            {isSuperAdmin ? (
              <>
                <h2 className="mb-5 text-base font-semibold text-card-foreground">
                  Branch Comparison {branchFilter ? `· ${getBranchName(branchFilter)}` : '· All Branches'}
                </h2>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chartData} barSize={36}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="branch" stroke="var(--muted-foreground)" fontSize={12} axisLine={false} tickLine={false} />
                    <YAxis stroke="var(--muted-foreground)" fontSize={11} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', borderRadius: '12px', color: 'var(--card-foreground)', fontSize: '13px' }} />
                    <Bar dataKey="students" fill="#7C3AED" radius={[8, 8, 0, 0]} />
                    <Bar dataKey="revenue" fill="#0EA5E9" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </>
            ) : (
              <>
                <h2 className="mb-5 text-base font-semibold text-card-foreground">
                  Attendance Trend ({getBranchName(branchFilter || user?.branchId)})
                </h2>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chartData} barSize={32}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="week" stroke="var(--muted-foreground)" fontSize={12} axisLine={false} tickLine={false} />
                    <YAxis domain={[80, 100]} stroke="var(--muted-foreground)" fontSize={11} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
                    <Tooltip
                      formatter={(v: number) => [`${v}%`, 'Attendance']}
                      contentStyle={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', borderRadius: '12px', color: 'var(--card-foreground)', fontSize: '13px' }}
                      cursor={{ fill: 'var(--secondary)' }}
                    />
                    <Bar dataKey="value" fill="#15803D" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </>
            )}
          </div>

          {/* Alerts */}
          <div className="lg:col-span-2 rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-card-foreground">
                {isSuperAdmin ? 'System Activity' : 'Recent Alerts'}
              </h2>
              <button className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                View all <ChevronRight className="h-3 w-3" />
              </button>
            </div>
            <div className="space-y-3">
              {alerts.map((a) => (
                <div key={a.id} className="flex items-start gap-3 rounded-xl bg-secondary/60 px-3 py-2.5">
                  <span className="mt-0.5 shrink-0 text-base">{a.icon}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug text-card-foreground">{a.text}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{a.time}</p>
                  </div>
                </div>
              ))}
              {/* Recent teacher submissions for admins */}
              {(isAdmin || isSuperAdmin) && submissions.slice(0,5).map((s) => (
                <div key={s.id} className="flex items-start gap-3 rounded-xl bg-secondary/60 px-3 py-2.5">
                  <span className="mt-0.5 shrink-0 text-base">📝</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug text-card-foreground">{s.teacherName} submitted report for {s.className} — {s.subject}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{new Date(s.createdAt).toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Super Admin system overview panel ── */}
        {isSuperAdmin && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              { label: 'Total Students',  value: '1,000', icon: Users,    color: 'text-green-600 dark:text-green-400' },
              { label: 'Total Teachers',  value: '42',    icon: BookOpen, color: 'text-sky-600 dark:text-sky-400' },
              { label: 'Total Parents',   value: '850',   icon: UserCog,  color: 'text-amber-600 dark:text-amber-400' },
              { label: 'Accountants',     value: '5',     icon: Wallet,   color: 'text-teal-600 dark:text-teal-400' },
            ].map((s) => (
              <div key={s.label} className="rounded-2xl border border-border bg-card p-5">
                <s.icon className={`h-5 w-5 mb-2 ${s.color}`} />
                <p className="text-xl font-bold text-foreground">{s.value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
