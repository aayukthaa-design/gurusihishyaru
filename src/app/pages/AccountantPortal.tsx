import { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router';
import { SEED_TEACHERS, Teacher, useTeacherProfiles } from './TeacherManagement';
import { generateSalarySlip, generateSalarySlipData } from '../lib/reportExport';
import { archiveSalarySlip, buildSalarySnapshot, calculateSalaryFromClasses, getSalaryPerClassRecord, getSalaryRecordsForView, getSalarySlipArchive, getTeacherAttendanceHistory, markSalaryPaid, unlockSalary, type AttendanceSummary, type SalaryPerClassRecord, type SalaryRecord, type SalarySlipArchive, type SalaryStatus, upsertSalaryRecord } from '../lib/teacherSalaryService';
import { Header } from '../components/Header';
import { GreetingBanner } from '../components/GreetingBanner';
import { useAuth } from '../auth/AuthContext';
import { getBranches, getBranchName } from '../lib/branchService';
import { useStudents, refreshStudents } from '../lib/studentService';
import { addNotification } from '../lib/notificationService';
import { formatIndianCurrency } from '../lib/currency';
import { 
  ChevronRight, TrendingUp, TrendingDown, Plus, Search, Trash2, 
  Download, Eye, BookOpen, Box, DollarSign, SlidersHorizontal, 
  Upload, Lock, Unlock, FileText, CheckCircle, Package, AlertTriangle, RefreshCw, Wallet, CreditCard, ClipboardCheck, Boxes, FileSpreadsheet, Users
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { apiFetch } from '../lib/apiClient';

interface LedgerEntry {
  id: number;
  voucherNumber: string;
  date: string;
  type: 'Income' | 'Expense';
  category: string;
  description: string;
  amount: number;
  paymentMode: string;
  referenceNumber?: string;
  enteredBy: string;
  branchId: string;
  attachmentPath?: string | null;
  attachmentName?: string | null;
  attachmentSize?: number | null;
  runningBalance: number;
}

interface InventoryItem {
  id: number;
  itemName: string;
  category: string;
  itemCode: string;
  description: string;
  quantity: number;
  allocatedQuantity: number;
  availableQuantity: number;
  damagedQuantity: number;
  minStock: number;
  unit: string;
  purchaseDate: string;
  supplier: string;
  purchaseCost: number;
  branchId: string;
  status: 'Active' | 'Inactive';
  uniformSize?: string;
}

interface InventoryCategory {
  id: number;
  name: string;
  status: 'Active' | 'Inactive';
}

interface AllocationRecord {
  id: number;
  studentId: string;
  studentName: string;
  admissionNumber: string;
  branchId: string;
  itemId: number;
  itemName: string;
  quantity: number;
  allocatedDate: string;
  allocatedBy: string;
  remarks: string;
}

interface MonthlyReport {
  id: number;
  week: string;
  branchId: string;
  submittedBy: string;
  submittedDate: string;
  status: 'Submitted' | 'Approved' | 'Returned';
  totalIncome: number;
  totalExpense: number;
  netProfit: number;
  ledgerSummary: string;
  inventoryPurchased: number;
  inventoryAllocated: number;
  inventoryRemaining: number;
  lowStockItems: string;
  studentAdmissions: number;
  outstandingFees: number;
  remarks: string;
  comments: string;
}

export function AccountantPortal() {
  const { user } = useAuth();
  const location = useLocation();
  const branches = getBranches();
  const students = useStudents();
  
  const isSuperAdmin = user?.role === 'super_admin';
  const myBranchId = user?.branchId || '';
  const [branchFilter, setBranchFilter] = useState(isSuperAdmin ? '' : myBranchId);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'ledger' | 'inventory' | 'allocations' | 'salaries' | 'reports'>('dashboard');

  // Backend States
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [categories, setCategories] = useState<InventoryCategory[]>([]);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [categoryForm, setCategoryForm] = useState({ id: 0, name: '', status: 'Active' as 'Active' | 'Inactive' });
  const [allocations, setAllocations] = useState<AllocationRecord[]>([]);
  const [reports, setReports] = useState<MonthlyReport[]>([]);
  const [loading, setLoading] = useState(false);
  const teacherProfiles = useTeacherProfiles();
  const [salaryMonth, setSalaryMonth] = useState(new Date().toISOString().slice(0, 7));
  const [salaryBranchFilter, setSalaryBranchFilter] = useState(isSuperAdmin ? '' : myBranchId);
  const [salaryTeacherFilter, setSalaryTeacherFilter] = useState('');
  const [salaryStatusFilter, setSalaryStatusFilter] = useState('');
  const [salaryRecords, setSalaryRecords] = useState<SalaryRecord[]>([]);

  const refreshSalaryRecords = () => {
    const branchId = isSuperAdmin ? (salaryBranchFilter || undefined) : myBranchId;
    const records = getSalaryRecordsForView({
      branchId,
      month: salaryMonth,
      status: salaryStatusFilter || undefined,
    });
    setSalaryRecords(records);
  };

  // Form Modals / Input fields
  const [showAddLedgerModal, setShowAddLedgerModal] = useState(false);
  const [ledgerForm, setLedgerForm] = useState({
    date: new Date().toISOString().split('T')[0],
    type: 'Income' as 'Income' | 'Expense',
    category: 'Tuition Fee',
    description: '',
    amount: '',
    paymentMode: 'UPI',
    referenceNumber: '',
    attachment: null as File | null
  });

  const [showAddInvModal, setShowAddInvModal] = useState(false);
  const [editingInvItem, setEditingInvItem] = useState<InventoryItem | null>(null);
  const [invForm, setInvForm] = useState({
    itemName: '',
    category: 'Books',
    description: '',
    quantity: '',
    minStock: '',
    unit: 'pcs',
    purchaseDate: new Date().toISOString().split('T')[0],
    supplier: '',
    purchaseCost: '',
    status: 'Active' as 'Active' | 'Inactive',
    damagedQuantity: '0'
  });

  const [showAllocateModal, setShowAllocateModal] = useState(false);
  const [allocateForm, setAllocateForm] = useState({
    studentId: '',
    itemId: '',
    quantity: '1',
    remarks: ''
  });

  // Report Compilation Month
  const [reportWeek, setreportWeek] = useState(new Date().toISOString().slice(0, 7));
  const [reportComments, setReportComments] = useState('');
  const [reportRemarks, setReportRemarks] = useState('');

  // Ledger Filter states
  const [ledgerSearch, setLedgerSearch] = useState('');
  const [ledgerTypeFilter, setLedgerTypeFilter] = useState('');
  const [ledgerCategoryFilter, setLedgerCategoryFilter] = useState('');

  // Inventory Filter States
  const [invSearch, setInvSearch] = useState('');
  const [invCategoryFilter, setInvCategoryFilter] = useState('');

  // Tab routing parameters
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tabParam = params.get('tab');
    if (tabParam && ['dashboard', 'ledger', 'inventory', 'allocations', 'reports'].includes(tabParam)) {
      setActiveTab(tabParam as any);
    }
  }, [location.search]);

  // Fetch functions
  const fetchLedger = async () => {
    try {
      const res = await apiFetch(`/api/ledger${branchFilter ? `?branchId=${branchFilter}` : ''}`);
      if (res.ok) {
        const data = await res.json();
        setLedger(Array.isArray(data) ? data : []);
      }
    } catch (e) { console.error(e); }
  };

  const fetchInventory = async () => {
    try {
      const res = await apiFetch(`/api/inventory${branchFilter ? `?branchId=${branchFilter}` : ''}`);
      const data = await res.json();
      setInventory(Array.isArray(data) ? data : []);
    } catch (err) { console.error('Failed to fetch inventory:', err); }
  };

  const fetchCategories = async () => {
    try {
      const res = await apiFetch('/api/inventory-categories');
      const data = await res.json();
      setCategories(Array.isArray(data) ? data : []);
    } catch (err) { console.error('Failed to fetch categories:', err); }
  };

  const fetchAllocations = async () => {
    try {
      const res = await apiFetch(`/api/inventory/allocations${branchFilter ? `?branchId=${branchFilter}` : ''}`);
      if (res.ok) {
        const data = await res.json();
        setAllocations(Array.isArray(data) ? data : []);
      }
    } catch (e) { console.error(e); }
  };

  const fetchReports = async () => {
    try {
      const res = await apiFetch(`/api/financial-reports${branchFilter ? `?branchId=${branchFilter}` : ''}`);
      if (res.ok) {
        const data = await res.json();
        setReports(Array.isArray(data) ? data : []);
      }
    } catch (e) { console.error(e); }
  };

  const loadAll = async () => {
    setLoading(true);
    await Promise.all([
      fetchLedger(),
      fetchInventory(),
      fetchAllocations(),
      fetchReports(),
      refreshStudents()
    ]);
    setLoading(false);
  };

  useEffect(() => {
    loadAll();
  }, [branchFilter]);

  useEffect(() => {
    const branchId = isSuperAdmin ? (salaryBranchFilter || undefined) : myBranchId;
    const records = getSalaryRecordsForView({
      branchId,
      month: salaryMonth,
      status: salaryStatusFilter || undefined,
    });
    setSalaryRecords(records);
  }, [isSuperAdmin, myBranchId, salaryBranchFilter, salaryMonth, salaryStatusFilter]);

  const salaryRows = useMemo(() => {
    return teacherProfiles
      .filter((teacher) => {
        if (salaryBranchFilter && teacher.branchId !== salaryBranchFilter) return false;
        if (!isSuperAdmin && teacher.branchId !== myBranchId) return false;
        if (salaryTeacherFilter && teacher.id !== salaryTeacherFilter) return false;
        return true;
      })
      .map((teacher) => {
        const record = salaryRecords.find((item) => item.teacherId === teacher.id);
        const salaryClassRecord = getSalaryPerClassRecord(teacher.id, salaryMonth);
        const attendance = getTeacherAttendanceHistory(teacher.id, salaryMonth);
        const displayRecord = record ?? (salaryClassRecord ? buildSalarySnapshot({
          teacher,
          month: salaryMonth,
          attendance,
          classesConducted: salaryClassRecord.classesConducted,
          salaryPerClass: salaryClassRecord.salaryPerClass,
          remarks: '',
        }) : null);
        const archive = getSalarySlipArchive(teacher.id, salaryMonth);
        return { teacher, record, salaryClassRecord, attendance, displayRecord, archive };
      })
      .filter(({ record, salaryClassRecord }) => Boolean(record) || Boolean(salaryClassRecord?.classesConducted && salaryClassRecord.salaryPerClass))
      .filter(({ displayRecord }) => {
        if (!salaryStatusFilter) return true;
        return displayRecord?.status === salaryStatusFilter;
      });
  }, [teacherProfiles, salaryRecords, salaryMonth, salaryBranchFilter, salaryTeacherFilter, salaryStatusFilter, isSuperAdmin, myBranchId]);

  const handleCreateDraft = (teacher: Teacher, attendance: AttendanceSummary, salaryClassRecord: SalaryPerClassRecord) => {
    const draft = buildSalarySnapshot({
      teacher,
      month: salaryMonth,
      attendance,
      classesConducted: salaryClassRecord.classesConducted,
      salaryPerClass: salaryClassRecord.salaryPerClass,
      remarks: '',
    });
    upsertSalaryRecord(draft);
    refreshSalaryRecords();
    alert(`Draft salary record created for ${teacher.firstName} ${teacher.lastName}.`);
  };

  const downloadBase64Pdf = (base64: string, fileName: string) => {
    const link = document.createElement('a');
    link.href = `data:application/pdf;base64,${base64}`;
    link.download = fileName;
    link.click();
  };

  const handlePreviewSalarySlip = async (
    teacher: Teacher,
    attendance: AttendanceSummary,
    classesConducted: number,
    salaryPerClass: number,
    month: string
  ) => {
    const teacherName = `${teacher.firstName} ${teacher.lastName}`;
    const netSalary = calculateSalaryFromClasses(classesConducted, salaryPerClass);
    const attendanceStr = `${classesConducted} Classes × ₹${salaryPerClass} = ₹${netSalary}`;
    const base64 = await generateSalarySlipData(
      teacherName,
      teacher.id,
      getBranchName(teacher.branchId),
      month,
      teacher.salaryType || 'Per Class',
      `₹${salaryPerClass}`,
      attendanceStr,
      formatIndianCurrency(netSalary),
      formatIndianCurrency(netSalary),
      user?.name || 'Accountant'
    );

    if (!base64) {
      alert('Unable to generate salary slip preview.');
      return;
    }

    window.open(`data:application/pdf;base64,${base64}`, '_blank', 'noopener');
  };

  const handleDownloadSalarySlip = async (
    teacher: Teacher,
    attendance: AttendanceSummary,
    classesConducted: number,
    salaryPerClass: number,
    month: string
  ) => {
    const teacherName = `${teacher.firstName} ${teacher.lastName}`;
    const netSalary = calculateSalaryFromClasses(classesConducted, salaryPerClass);
    const attendanceStr = `${classesConducted} Classes × ₹${salaryPerClass} = ₹${netSalary}`;
    const base64 = await generateSalarySlipData(
      teacherName,
      teacher.id,
      getBranchName(teacher.branchId),
      month,
      teacher.salaryType || 'Per Class',
      `₹${salaryPerClass}`,
      attendanceStr,
      formatIndianCurrency(netSalary),
      formatIndianCurrency(netSalary),
      user?.name || 'Accountant'
    );

    if (!base64) {
      alert('Unable to download salary slip.');
      return;
    }

    const fileName = `Salary_Slip_${teacherName.replace(/\s+/g, '_')}_${month}.pdf`;
    downloadBase64Pdf(base64, fileName);
  };

  const archiveSalarySlipForEntry = async (
    record: SalaryRecord | null,
    teacher: Teacher,
    attendance: AttendanceSummary,
    classesConducted: number,
    salaryPerClass: number,
    month: string
  ): Promise<SalarySlipArchive | null> => {
    const teacherName = `${teacher.firstName} ${teacher.lastName}`;
    const netSalary = record?.calculatedSalary ?? calculateSalaryFromClasses(classesConducted, salaryPerClass);
    const attendanceStr = `${classesConducted} Classes × ₹${salaryPerClass} = ₹${netSalary}`;
    const base64 = await generateSalarySlipData(
      teacherName,
      teacher.id,
      getBranchName(teacher.branchId),
      month,
      teacher.salaryType || 'Per Class',
      `₹${salaryPerClass}`,
      attendanceStr,
      formatIndianCurrency(netSalary),
      formatIndianCurrency(netSalary),
      user?.name || 'Accountant'
    );

    if (!base64) return null;

    const archive = archiveSalarySlip({
      teacherId: teacher.id,
      month,
      salaryRecordId: record?.id ?? `salary-${teacher.id}-${month}`,
      branchId: teacher.branchId,
      fileName: `Salary_Slip_${teacherName.replace(/\s+/g, '_')}_${month}.pdf`,
      base64Pdf: base64,
      generatedBy: user?.name || 'Accountant',
      generatedByRole: user?.role || 'Accountant',
    });

    return archive;
  };

  const handleMarkPaid = async (record: SalaryRecord) => {
    const updated = markSalaryPaid(record.teacherId, record.month, user?.name || 'Accountant');
    if (!updated) {
      alert('Unable to mark salary as paid.');
      return;
    }
    addNotification({
      title: 'Salary Paid',
      message: `${record.teacherName}'s salary for ${salaryMonth} has been paid.`,
      type: 'success',
      roles: ['super_admin'],
      teacherIds: [record.teacherId],
      recipient: 'Teacher',
      branchId: record.branchId,
      status: 'unread',
    });

    const ledgerFormData = new FormData();
    ledgerFormData.append('date', new Date().toISOString().split('T')[0]);
    ledgerFormData.append('type', 'Expense');
    ledgerFormData.append('category', 'Salary');
    ledgerFormData.append('description', `Salary paid to ${record.teacherName} for ${salaryMonth}`);
    ledgerFormData.append('amount', String(updated.calculatedSalary));
    ledgerFormData.append('paymentMode', 'Bank Transfer');
    ledgerFormData.append('referenceNumber', `${record.teacherId}-${salaryMonth}`);
    ledgerFormData.append('enteredBy', user?.name || 'Accountant');
    ledgerFormData.append('branchId', record.branchId || branchFilter || myBranchId);

    try {
      const res = await apiFetch('/api/ledger', {
        method: 'POST',
        body: ledgerFormData,
      });
      if (res.ok) {
        await fetchLedger();
      }
    } catch (err) {
      console.error('Failed to log salary expense:', err);
    }

    const teacher = teacherProfiles.find((item) => item.id === record.teacherId);
    if (teacher) {
      const attendance = getTeacherAttendanceHistory(teacher.id, record.month);
      const archive = await archiveSalarySlipForEntry(updated, teacher, attendance, updated.classesConducted, updated.salaryPerClass, record.month);
      if (archive) {
        addNotification({
          title: 'Salary Slip Archived',
          message: `Salary slip for ${record.teacherName} (${record.month}) was archived successfully.`,
          type: 'success',
          roles: ['super_admin'],
          teacherIds: [record.teacherId],
          recipient: 'Teacher',
          branchId: record.branchId,
          status: 'unread',
        });
      }
    }

    refreshSalaryRecords();
    alert(`Salary marked as paid for ${record.teacherName}.`);
  };

  const handleUnlock = (record: SalaryRecord) => {
    unlockSalary(record.teacherId, record.month, user?.name || 'Super Admin');
    refreshSalaryRecords();
    alert(`Salary unlocked for ${record.teacherName}.`);
  };

  // Compute stats for current filter
  const todayStr = new Date().toISOString().split('T')[0];
  const currentMonthStr = new Date().toISOString().slice(0, 7);
  const currentMonthReportSubmitted = useMemo(() => {
    return reports.some(r => r.week === currentMonthStr && r.status !== 'Returned');
  }, [reports, currentMonthStr]);

  const todayIncome = useMemo(() => {
    return ledger
      .filter(t => t.type === 'Income' && t.date === todayStr)
      .reduce((sum, t) => sum + t.amount, 0);
  }, [ledger, todayStr]);

  const todayExpenses = useMemo(() => {
    return ledger
      .filter(t => t.type === 'Expense' && t.date === todayStr)
      .reduce((sum, t) => sum + t.amount, 0);
  }, [ledger, todayStr]);

  const pendingAllocationsCount = useMemo(() => {
    const enrolled = students.filter(s => s.status === 'Enrolled');
    const allocatedIds = new Set(allocations.map(a => a.studentId));
    return enrolled.filter(s => !allocatedIds.has(s.id)).length;
  }, [students, allocations]);

  const lowStockCount = useMemo(() => {
    return inventory.filter(item => item.status === 'Active' && item.availableQuantity <= item.minStock).length;
  }, [inventory]);

  const recentActivities = useMemo(() => {
    const list: Array<{ id: string; type: string; date: string; message: string; timestamp: number }> = [];

    // Ledger transactions (Income/Expense Added)
    ledger.forEach((t) => {
      list.push({
        id: `ledger-${t.id}`,
        type: t.type === 'Income' ? 'New Income Added' : 'New Expense Added',
        date: t.date,
        message: `${t.type === 'Income' ? 'Income' : 'Expense'} Voucher ${t.voucherNumber} recorded: ${t.description} (${formatIndianCurrency(t.amount)})`,
        timestamp: new Date(t.date).getTime()
      });
    });

    // Inventory Allocations
    allocations.forEach((a) => {
      list.push({
        id: `alloc-${a.id}`,
        type: 'Inventory Allocated',
        date: a.allocatedDate,
        message: `Allocated ${a.quantity} units of ${a.itemName} to student ${a.studentName} (${a.studentId})`,
        timestamp: new Date(a.allocatedDate).getTime()
      });
    });

    // Student enrollment
    students.filter(s => s.status === 'Enrolled').forEach((s) => {
      const enrolDate = s.admissionDate || s.createdAt?.split('T')[0] || todayStr;
      list.push({
        id: `student-${s.id}`,
        type: 'Student Admission Received',
        date: enrolDate,
        message: `Student enrolled: ${s.fullName} (${s.id}) in class ${s.className}`,
        timestamp: new Date(enrolDate).getTime()
      });
    });

    // Weekly Reports submitted
    reports.forEach((r) => {
      list.push({
        id: `report-${r.id}`,
        type: 'Weekly Report Submitted',
        date: r.submittedDate,
        message: `Weekly Report for ${r.week} submitted by ${r.submittedBy} (Status: ${r.status})`,
        timestamp: new Date(r.submittedDate).getTime()
      });
    });

    // Sort by timestamp DESC, then slice to top 10
    return list.sort((a, b) => b.timestamp - a.timestamp).slice(0, 10);
  }, [ledger, allocations, students, reports, todayStr]);

  const incomeVsExpenseSummary = useMemo(() => {
    const incomeCategories: Record<string, number> = {};
    const expenseCategories: Record<string, number> = {};
    let totalInc = 0;
    let totalExp = 0;

    ledger.forEach(t => {
      if (t.type === 'Income') {
        incomeCategories[t.category] = (incomeCategories[t.category] || 0) + t.amount;
        totalInc += t.amount;
      } else {
        expenseCategories[t.category] = (expenseCategories[t.category] || 0) + t.amount;
        totalExp += t.amount;
      }
    });

    return {
      incomeCategories,
      expenseCategories,
      totalInc,
      totalExp,
      net: totalInc - totalExp
    };
  }, [ledger]);

  const lowStockItemsList = useMemo(() => {
    return inventory.filter(item => item.status === 'Active' && item.availableQuantity <= item.minStock);
  }, [inventory]);

  // Filtered Ledger list
  const filteredLedger = useMemo(() => {
    return ledger.filter(t => {
      const matchesSearch = t.voucherNumber.toLowerCase().includes(ledgerSearch.toLowerCase()) || 
                            t.description.toLowerCase().includes(ledgerSearch.toLowerCase()) ||
                            t.category.toLowerCase().includes(ledgerSearch.toLowerCase());
      const matchesType = !ledgerTypeFilter || t.type === ledgerTypeFilter;
      const matchesCategory = !ledgerCategoryFilter || t.category === ledgerCategoryFilter;
      return matchesSearch && matchesType && matchesCategory;
    }).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  }, [ledger, ledgerSearch, ledgerTypeFilter, ledgerCategoryFilter]);

  // Filtered Inventory list
  const filteredInventory = useMemo(() => {
    return inventory.filter(item => {
      const matchesSearch = item.itemName.toLowerCase().includes(invSearch.toLowerCase()) ||
                            item.itemCode.toLowerCase().includes(invSearch.toLowerCase());
      const matchesCategory = !invCategoryFilter || item.category === invCategoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [inventory, invSearch, invCategoryFilter]);

  // Handle Add transaction
  const handleAddTransactionSubmit = async (e: React.FormEvent) => {
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
    formData.append('branchId', branchFilter || myBranchId);
    if (ledgerForm.attachment) {
      formData.append('attachment', ledgerForm.attachment);
    }

    try {
      const res = await apiFetch('/api/ledger', {
        method: 'POST',
        body: formData
      });
      if (res.ok) {
        setShowAddLedgerModal(false);
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
        await fetchLedger();
      } else {
        const errorData = await res.json();
        alert(errorData.error || 'Failed to submit ledger entry.');
      }
    } catch (e) {
      console.error(e);
      alert('Connection error');
    }
  };

  // Handle Add/Edit Inventory item
  const handleInventorySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invForm.itemName || !invForm.quantity || !invForm.purchaseCost) {
      alert('Item name, quantity, and purchase cost are required.');
      return;
    }

    const payload = {
      itemName: invForm.itemName,
      category: invForm.category,
      description: invForm.description,
      quantity: Number(invForm.quantity),
      uniformSize: invForm.uniformSize,
      minStock: Number(invForm.minStock || 0),
      unit: invForm.unit,
      purchaseDate: invForm.purchaseDate,
      supplier: invForm.supplier,
      purchaseCost: Number(invForm.purchaseCost),
      branchId: branchFilter || myBranchId,
      status: invForm.status,
      damagedQuantity: Number(invForm.damagedQuantity || 0)
    };

    try {
      let res;
      if (editingInvItem) {
        res = await apiFetch(`/api/inventory/${editingInvItem.id}`, {
          method: 'PUT',
          body: payload
        });
      } else {
        res = await apiFetch('/api/inventory', {
          method: 'POST',
          body: payload
        });
      }

      if (res.ok) {
        setShowAddInvModal(false);
        setEditingInvItem(null);
        setInvForm({
          uniformSize: '',
          itemName: '',
          category: 'Books',
          description: '',
          quantity: '',
          minStock: '',
          unit: 'pcs',
          purchaseDate: new Date().toISOString().split('T')[0],
          supplier: '',
          purchaseCost: '',
          status: 'Active',
          damagedQuantity: '0'
        });
        await fetchInventory();
      }
    } catch (e) { console.error(e); }
  };

  const handleDeactivateItem = async (itemId: number) => {
    if (!confirm('Are you sure you want to deactivate this item?')) return;
    try {
      const res = await apiFetch(`/api/inventory/${itemId}`, {
        method: 'DELETE'
      });
      if (res.ok) await fetchInventory();
    } catch (e) { console.error(e); }
  };

  const handleDeleteAttachment = async (ledgerId: number) => {
    if (!confirm('Are you sure you want to remove the uploaded attachment?')) return;
    try {
      const res = await apiFetch(`/api/ledger/${ledgerId}/attachment`, {
        method: 'DELETE'
      });
      if (res.ok) await fetchLedger();
    } catch (e) { console.error(e); }
  };

  // Handle Inventory Allocation
  const handleAllocateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!allocateForm.studentId || !allocateForm.itemId || !allocateForm.quantity) {
      alert('Student, item, and quantity are required.');
      return;
    }

    const studentObj = students.find(s => s.id === allocateForm.studentId);
    if (!studentObj) return;

    const isUniform = inventory.find(i => i.id === Number(allocateForm.itemId))?.category === 'Uniform' || inventory.find(i => i.id === Number(allocateForm.itemId))?.category === 'Uniforms';
    if (isUniform && !allocateForm.uniformSize) {
      alert('Uniform size is required for uniforms.');
      return;
    }
    const finalSize = allocateForm.uniformSize === 'Other' ? customUniformSize : allocateForm.uniformSize;

    const payload = {
      studentId: allocateForm.studentId,
      studentName: studentObj.fullName,
      admissionNumber: studentObj.admissionNumber || '',
      branchId: studentObj.branchId || branchFilter || myBranchId,
      itemId: Number(allocateForm.itemId),
      quantity: Number(allocateForm.quantity),
      allocatedBy: user?.name || 'Accountant',
      remarks: allocateForm.remarks,
      uniformSize: isUniform ? finalSize : ''
    };

    try {
      const res = await apiFetch('/api/inventory/allocate', {
        method: 'POST',
        body: payload
      });

      if (res.ok) {
        setShowAllocateModal(false);
        setAllocateForm({ studentId: '', itemId: '', quantity: '1', remarks: '' });
        await Promise.all([fetchInventory(), fetchAllocations()]);
      } else {
        const err = await res.json();
        alert(err.error || 'Allocation failed.');
      }
    } catch (e) { console.error(e); }
  };

  const handleReturnAllocation = async (allocId: number) => {
    if (!confirm('Are you sure the student is returning this inventory item? Available stock levels will increase.')) return;
    try {
      const res = await apiFetch('/api/inventory/return', {
        method: 'POST',
        body: { allocationId: allocId }
      });
      if (res.ok) {
        await Promise.all([fetchInventory(), fetchAllocations()]);
      }
    } catch (e) { console.error(e); }
  };

  // Compute Weekly Report details dynamically
  const computedReportData = useMemo(() => {
    const filterPrefix = reportWeek;
    
    // Ledger Income & Expenses in select month
    const monthLedger = ledger.filter(t => t.date.startsWith(filterPrefix));
    const income = monthLedger.filter(t => t.type === 'Income').reduce((s, t) => s + t.amount, 0);
    const expense = monthLedger.filter(t => t.type === 'Expense').reduce((s, t) => s + t.amount, 0);
    
    // Admissions in this month
    const admissionsCount = students.filter(s => s.admissionDate?.startsWith(filterPrefix) && (!branchFilter || s.branchId === branchFilter)).length;
    
    // Inventory quantities bought, allocated, available
    const invMonth = inventory.filter(item => item.purchaseDate.startsWith(filterPrefix));
    const purchased = invMonth.reduce((s, item) => s + item.quantity, 0);
    
    const branchAllocations = allocations.filter(a => a.allocatedDate.startsWith(filterPrefix));
    const allocated = branchAllocations.reduce((s, a) => s + a.quantity, 0);
    
    const remaining = inventory.reduce((s, item) => s + item.availableQuantity, 0);
    const lowStock = inventory.filter(item => item.availableQuantity <= item.minStock).map(item => item.itemName);

    // Hardcoded Outstanding Fee computation for mock
    const outstanding = 25500; 

    return {
      income,
      expense,
      netProfit: income - expense,
      purchased,
      allocated,
      remaining,
      lowStockList: lowStock,
      admissionsCount,
      outstanding
    };
  }, [ledger, inventory, allocations, students, reportWeek, branchFilter]);

  // Is Weekly Report already submitted for selected week?
  const submittedReport = useMemo(() => {
    return reports.find(r => r.week === reportWeek && (!branchFilter || r.branchId === branchFilter));
  }, [reports, reportWeek, branchFilter]);

  useEffect(() => {
    if (submittedReport) {
      setReportComments(submittedReport.comments || '');
      setReportRemarks(submittedReport.remarks || '');
    } else {
      setReportComments('');
      setReportRemarks('');
    }
  }, [submittedReport, reportWeek]);

  const handleReportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittedReport && submittedReport.status !== 'Returned') {
      alert('Report is already submitted and locked.');
      return;
    }

    const payload = {
      week: reportWeek,
      branchId: branchFilter || myBranchId,
      submittedBy: user?.name || 'Accountant',
      remarks: reportRemarks,
      comments: reportComments,
      totalIncome: computedReportData.income,
      totalExpense: computedReportData.expense,
      netProfit: computedReportData.netProfit,
      ledgerSummary: ledger.filter(t => t.date.startsWith(reportWeek)).map(t => `${t.voucherNumber}: ${t.type} - ${t.category} (â‚¹${t.amount})`),
      inventoryPurchased: computedReportData.purchased,
      inventoryAllocated: computedReportData.allocated,
      inventoryRemaining: computedReportData.remaining,
      lowStockItems: computedReportData.lowStockList,
      studentAdmissions: computedReportData.admissionsCount,
      outstandingFees: computedReportData.outstanding
    };

    try {
      const res = await apiFetch('/api/financial-reports', {
        method: 'POST',
        body: payload
      });
      if (res.ok) {
        alert('Monthly Financial Report submitted successfully to Super Admin.');
        await fetchReports();
      }
    } catch (e) { console.error(e); }
  };

  return (
    <div className="flex-1 bg-background pb-12">
      <Header title="Accountant Ledger & Inventory Portal" />

      <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <GreetingBanner name={user?.name ?? 'Accountant'} subtitle="Financial and Inventory Operations Dashboard" />
          
          {/* Branch filter box */}
          {isSuperAdmin ? (
            <div className="flex items-center gap-2 self-end">
              <span className="text-sm font-medium text-muted-foreground">Branch Scope:</span>
              <select
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                className="rounded-xl border border-input bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="">All Branches</option>
                {branches.filter(b => b.status === 'Active').map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          ) : (
            <span className="text-xs font-semibold uppercase bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400 px-3 py-1.5 rounded-full self-start">
              Branch: {getBranchName(myBranchId)}
            </span>
          )}
        </div>

        {/* --- Tabs Control Bar --- */}
        <div className="flex overflow-x-auto gap-1 border-b border-border pb-1 shrink-0">
          {[
            { id: 'dashboard', label: 'Overview Dashboard' },
            { id: 'ledger', label: 'Tally Ledger' },
            { id: 'inventory', label: 'Inventory Control' },
            { id: 'allocations', label: 'Student Allocations' },
            { id: 'salaries', label: 'Teacher Salaries' },
            { id: 'reports', label: 'Weekly Report' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-primary text-primary-foreground shadow-md'
                  : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* --- LOADING INDICATOR --- */}
        {loading && (
          <div className="flex justify-center items-center py-12 gap-2 text-muted-foreground text-sm font-medium">
            <RefreshCw className="h-4 w-4 animate-spin text-primary" /> Loading ledger records and inventory items...
          </div>
        )}

        {!loading && (
          <div className="space-y-6">
            {/* ========================================================================= */}
            {/* TAB 1: DASHBOARD OVERVIEW */}
            {/* ========================================================================= */}
            {activeTab === 'dashboard' && (
              <div className="space-y-6">
                {/* 1. Summary Cards */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
                  <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                    <p className="text-xs font-bold uppercase tracking-wider text-green-600 dark:text-green-400 mb-1">Today's Income</p>
                    <p className="text-3xl font-bold text-foreground">{formatIndianCurrency(todayIncome)}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">Voucher receipts collected today</p>
                  </div>
                  <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                    <p className="text-xs font-bold uppercase tracking-wider text-red-500 mb-1">Today's Expenses</p>
                    <p className="text-3xl font-bold text-foreground">{formatIndianCurrency(todayExpenses)}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">Debit payments recorded today</p>
                  </div>
                  <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                    <p className="text-xs font-bold uppercase tracking-wider text-amber-600 mb-1">Pending Inventory Allocation</p>
                    <p className="text-3xl font-bold text-foreground">{pendingAllocationsCount}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">Enrolled students waiting for kits</p>
                  </div>
                  <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                    <p className="text-xs font-bold uppercase tracking-wider text-rose-500 mb-1">Low Stock Items</p>
                    <p className="text-3xl font-bold text-foreground">{lowStockCount}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">Items below min stock threshold</p>
                  </div>
                </div>

                {/* 2. Quick Actions (New Accountant Actions) */}
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
                      onClick={() => setActiveTab('ledger')}
                      className="flex flex-col items-center justify-center p-5 border border-border bg-secondary/10 rounded-2xl cursor-pointer hover:scale-105 hover:bg-secondary/35 shadow-sm hover:shadow-md transition-all duration-200 gap-3"
                    >
                      <span className="p-3 rounded-full bg-blue-50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400">
                        <BookOpen className="h-6 w-6" />
                      </span>
                      <span className="text-xs font-bold text-foreground text-center">Accounts Ledger</span>
                    </div>

                    {/* 4. Allocate Inventory */}
                    <div
                      onClick={() => setActiveTab('allocations')}
                      className="flex flex-col items-center justify-center p-5 border border-border bg-secondary/10 rounded-2xl cursor-pointer hover:scale-105 hover:bg-secondary/35 shadow-sm hover:shadow-md transition-all duration-200 gap-3"
                    >
                      <span className="p-3 rounded-full bg-amber-50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400">
                        <ClipboardCheck className="h-6 w-6" />
                      </span>
                      <span className="text-xs font-bold text-foreground text-center">Allocate Inventory</span>
                    </div>

                    {/* 5. Manage Inventory */}
                    <div
                      onClick={() => setActiveTab('inventory')}
                      className="flex flex-col items-center justify-center p-5 border border-border bg-secondary/10 rounded-2xl cursor-pointer hover:scale-105 hover:bg-secondary/35 shadow-sm hover:shadow-md transition-all duration-200 gap-3"
                    >
                      <span className="p-3 rounded-full bg-purple-50 dark:bg-purple-950/20 text-purple-600 dark:text-purple-400">
                        <Boxes className="h-6 w-6" />
                      </span>
                      <span className="text-xs font-bold text-foreground text-center">Manage Inventory</span>
                    </div>

                    {/* 6. Teacher Salaries */}
                    <div
                      onClick={() => setActiveTab('salaries')}
                      className="flex flex-col items-center justify-center p-5 border border-border bg-secondary/10 rounded-2xl cursor-pointer hover:scale-105 hover:bg-secondary/35 shadow-sm hover:shadow-md transition-all duration-200 gap-3"
                    >
                      <span className="p-3 rounded-full bg-pink-50 dark:bg-pink-950/20 text-pink-600 dark:text-pink-400">
                        <Users className="h-6 w-6" />
                      </span>
                      <span className="text-xs font-bold text-foreground text-center">Teacher Salaries</span>
                    </div>

                    {/* 7. Submit Weekly Report */}
                    <div
                      onClick={() => {
                        if (currentMonthReportSubmitted) {
                          alert("Weekly Report Already Submitted");
                        } else {
                          setreportWeek(currentMonthStr);
                          setActiveTab('reports');
                        }
                      }}
                      className="flex flex-col items-center justify-center p-5 border border-border bg-secondary/10 rounded-2xl cursor-pointer hover:scale-105 hover:bg-secondary/35 shadow-sm hover:shadow-md transition-all duration-200 gap-3"
                    >
                      <span className="p-3 rounded-full bg-teal-50 dark:bg-teal-950/20 text-teal-600 dark:text-teal-400">
                        <FileSpreadsheet className="h-6 w-6" />
                      </span>
                      <span className="text-xs font-bold text-foreground text-center">Submit Weekly Report</span>
                    </div>
                  </div>
                </div>

                {/* 3. Recent Activities */}
                <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
                  <h3 className="font-semibold text-foreground mb-4">Recent Activities</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-border text-muted-foreground uppercase font-bold text-[10px] tracking-wider bg-secondary/20">
                          <th className="px-4 py-3">Activity Type</th>
                          <th className="px-4 py-3">Details</th>
                          <th className="px-4 py-3">Date</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60 text-sm">
                        {recentActivities.map(act => (
                          <tr key={act.id} className="hover:bg-secondary/10 transition-colors">
                            <td className="px-4 py-3 font-semibold text-foreground whitespace-nowrap">
                              <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium ${
                                act.type.includes('Income') ? 'bg-green-50 text-green-700 dark:bg-green-950/20 dark:text-green-400' :
                                act.type.includes('Expense') ? 'bg-red-50 text-red-700 dark:bg-red-950/20 dark:text-red-400' :
                                act.type.includes('Allocated') ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400' :
                                act.type.includes('Admission') ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/20 dark:text-blue-400' :
                                'bg-purple-50 text-purple-700 dark:bg-purple-950/20 dark:text-purple-400'
                              }`}>
                                {act.type}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">{act.message}</td>
                            <td className="px-4 py-3 text-muted-foreground font-mono whitespace-nowrap">{act.date}</td>
                          </tr>
                        ))}
                        {recentActivities.length === 0 && (
                          <tr>
                            <td colSpan={3} className="text-center py-8 text-muted-foreground">No recent activities logged yet.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* 4. Income vs Expense Summary */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Income Breakdown */}
                  <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
                    <div className="flex items-center justify-between border-b border-border pb-3 mb-4">
                      <h3 className="font-semibold text-foreground flex items-center gap-2">
                        <TrendingUp className="h-5 w-5 text-emerald-500" /> Income Summary by Category
                      </h3>
                      <span className="text-sm font-bold text-emerald-600">Total: {formatIndianCurrency(incomeVsExpenseSummary.totalInc)}</span>
                    </div>
                    <div className="space-y-3">
                      {Object.entries(incomeVsExpenseSummary.incomeCategories).map(([cat, amount]) => (
                        <div key={cat} className="flex justify-between items-center text-sm">
                          <span className="text-muted-foreground">{cat}</span>
                          <span className="font-semibold text-foreground">{formatIndianCurrency(amount)}</span>
                        </div>
                      ))}
                      {Object.keys(incomeVsExpenseSummary.incomeCategories).length === 0 && (
                        <p className="text-xs text-muted-foreground italic py-4 text-center">No income records available.</p>
                      )}
                    </div>
                  </div>

                  {/* Expense Breakdown */}
                  <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
                    <div className="flex items-center justify-between border-b border-border pb-3 mb-4">
                      <h3 className="font-semibold text-foreground flex items-center gap-2">
                        <TrendingDown className="h-5 w-5 text-red-500" /> Expense Summary by Category
                      </h3>
                      <span className="text-sm font-bold text-red-500">Total: {formatIndianCurrency(incomeVsExpenseSummary.totalExp)}</span>
                    </div>
                    <div className="space-y-3">
                      {Object.entries(incomeVsExpenseSummary.expenseCategories).map(([cat, amount]) => (
                        <div key={cat} className="flex justify-between items-center text-sm">
                          <span className="text-muted-foreground">{cat}</span>
                          <span className="font-semibold text-foreground">{formatIndianCurrency(amount)}</span>
                        </div>
                      ))}
                      {Object.keys(incomeVsExpenseSummary.expenseCategories).length === 0 && (
                        <p className="text-xs text-muted-foreground italic py-4 text-center">No expense records available.</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* 5. Low Stock Items */}
                <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
                  <div className="flex items-center justify-between border-b border-border pb-3 mb-4">
                    <h3 className="font-semibold text-foreground flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-amber-500" /> Low Stock Alerts
                    </h3>
                    <span className="text-xs font-semibold px-2 py-0.5 bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400 rounded-full">
                      {lowStockItemsList.length} item(s) critical
                    </span>
                  </div>
                  
                  {lowStockItemsList.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-border text-muted-foreground uppercase font-bold text-[10px] tracking-wider bg-secondary/20">
                            <th className="px-4 py-3">Item Name / Code</th>
                            <th className="px-4 py-3">Category</th>
                        <th className="px-4 py-3 text-center">Uniform Size</th>
                            <th className="px-4 py-3 text-center">Available Stock</th>
                            <th className="px-4 py-3 text-center">Min Threshold</th>
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
                              <td className="px-4 py-3 text-muted-foreground">{item.category}</td>
                              <td className="px-4 py-3 text-center text-muted-foreground">{item.category === "Uniform" ? item.uniformSize || "-" : "-"}</td>
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
                    <p className="text-sm text-muted-foreground text-center py-6">All inventory items are currently sufficiently stocked.</p>
                  )}
                </div>
              </div>
            )}

            {/* ========================================================================= */}
            {/* TAB 2: TALLY STYLE LEDGER */}
            {/* ========================================================================= */}
            {activeTab === 'ledger' && (
              <div className="space-y-4">
                {/* Header controls & Filters */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border border-border bg-card rounded-2xl p-4 shadow-sm">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="relative min-w-[200px]">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <input
                        type="text"
                        placeholder="Search ledger entries..."
                        value={ledgerSearch}
                        onChange={(e) => setLedgerSearch(e.target.value)}
                        className="pl-9 pr-3 py-1.5 border border-input rounded-xl bg-input-background text-sm focus:outline-none focus:ring-1 focus:ring-primary w-full"
                      />
                    </div>
                    <select
                      value={ledgerTypeFilter}
                      onChange={(e) => setLedgerTypeFilter(e.target.value)}
                      className="border border-input rounded-xl px-2.5 py-1.5 text-sm bg-input-background focus:outline-none"
                    >
                      <option value="">All Types</option>
                      <option value="Income">Income</option>
                      <option value="Expense">Expense</option>
                    </select>
                    <select
                      value={ledgerCategoryFilter}
                      onChange={(e) => setLedgerCategoryFilter(e.target.value)}
                      className="border border-input rounded-xl px-2.5 py-1.5 text-sm bg-input-background focus:outline-none"
                    >
                      <option value="">All Categories</option>
                      <option value="Tuition Fee">Tuition Fee</option>
                      <option value="Admission Fee">Admission Fee</option>
                      <option value="Utilities">Utilities</option>
                      <option value="Salaries">Salaries</option>
                      <option value="Supplies">Supplies</option>
                      <option value="Maintenance">Maintenance</option>
                      <option value="Stationery">Stationery</option>
                      <option value="Miscellaneous">Miscellaneous</option>
                    </select>
                  </div>

                  <button
                    onClick={() => setShowAddLedgerModal(true)}
                    className="flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground font-semibold rounded-xl text-sm transition-all hover:opacity-90 active:scale-95 shadow-sm"
                  >
                    <Plus className="h-4 w-4" /> Add Voucher Transaction
                  </button>
                </div>

                {/* Ledger table */}
                <div className="border border-border bg-card rounded-2xl shadow-sm overflow-x-auto">
                  <table className="w-full text-left border-collapse min-w-[900px]">
                    <thead>
                      <tr className="bg-secondary/40 border-b border-border text-xs font-semibold text-muted-foreground uppercase">
                        <th className="px-4 py-3">Voucher No</th>
                        <th className="px-4 py-3">Date</th>
                        <th className="px-4 py-3">Category</th>
                        <th className="px-4 py-3 text-center">Uniform Size</th>
                        <th className="px-4 py-3">Description</th>
                        <th className="px-4 py-3 text-right text-green-600">Credit (Income)</th>
                        <th className="px-4 py-3 text-right text-red-500">Debit (Expense)</th>
                        <th className="px-4 py-3 text-right">Balance</th>
                        <th className="px-4 py-3">Mode</th>
                        <th className="px-4 py-3">Attachment</th>
                        <th className="px-4 py-3">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border text-sm">
                      {filteredLedger.map((row) => (
                        <tr key={row.id} className="hover:bg-secondary/20 transition-colors">
                          <td className="px-4 py-3 font-mono text-xs">{row.voucherNumber}</td>
                          <td className="px-4 py-3 whitespace-nowrap">{row.date}</td>
                          <td className="px-4 py-3">{row.category}</td>
                          <td className="px-4 py-3 max-w-[200px] truncate" title={row.description}>{row.description}</td>
                          <td className="px-4 py-3 text-right text-green-600 font-semibold">
                            {row.type === 'Income' ? formatIndianCurrency(row.amount) : '—'}
                          </td>
                          <td className="px-4 py-3 text-right text-red-500 font-semibold">
                            {row.type === 'Expense' ? formatIndianCurrency(row.amount) : '—'}
                          </td>
                          <td className="px-4 py-3 text-right font-bold text-foreground">
                            {formatIndianCurrency(row.runningBalance)}
                          </td>
                          <td className="px-4 py-3 text-xs">{row.paymentMode}</td>
                          <td className="px-4 py-3">
                            {row.attachmentPath ? (
                              <div className="flex items-center gap-1">
                                <a
                                  href={`${row.attachmentPath}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs text-primary font-semibold hover:underline truncate max-w-[100px]"
                                  title={row.attachmentName || 'Bill Attachment'}
                                >
                                  {row.attachmentName || 'View Bill'}
                                </a>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground italic">None</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {row.attachmentPath && (
                              <button
                                onClick={() => handleDeleteAttachment(row.id)}
                                className="text-red-500 hover:text-red-700 p-1 transition-colors"
                                title="Delete attachment file"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                      {filteredLedger.length === 0 && (
                        <tr>
                          <td colSpan={10} className="text-center py-12 text-muted-foreground text-sm">
                            No ledger transactions found matching filters.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ========================================================================= */}
            {/* TAB 3: INVENTORY MANAGEMENT */}
            {/* ========================================================================= */}
            {activeTab === 'inventory' && (
              <div className="space-y-6">
                {/* Inventory stats */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
                  <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                    <p className="text-xs font-semibold text-muted-foreground">Total Stock Purchased</p>
                    <p className="text-2xl font-bold text-foreground mt-1">
                      {inventory.reduce((sum, item) => sum + item.quantity, 0)} {inventory.length > 0 ? inventory[0].unit : 'items'}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                    <p className="text-xs font-semibold text-muted-foreground">Allocated Quantity</p>
                    <p className="text-2xl font-bold text-amber-600 mt-1">
                      {inventory.reduce((sum, item) => sum + item.allocatedQuantity, 0)} items
                    </p>
                  </div>
                  <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                    <p className="text-xs font-semibold text-muted-foreground">Available Quantity</p>
                    <p className="text-2xl font-bold text-emerald-600 mt-1">
                      {inventory.reduce((sum, item) => sum + item.availableQuantity, 0)} items
                    </p>
                  </div>
                  <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                    <p className="text-xs font-semibold text-muted-foreground">Damaged Quantity</p>
                    <p className="text-2xl font-bold text-red-500 mt-1">
                      {inventory.reduce((sum, item) => sum + item.damagedQuantity, 0)} items
                    </p>
                  </div>
                </div>

                {/* Filter and Add Item Controls */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border border-border bg-card rounded-2xl p-4 shadow-sm">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="relative min-w-[200px]">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <input
                        type="text"
                        placeholder="Search items by name/code..."
                        value={invSearch}
                        onChange={(e) => setInvSearch(e.target.value)}
                        className="pl-9 pr-3 py-1.5 border border-input rounded-xl bg-input-background text-sm focus:outline-none focus:ring-1 focus:ring-primary w-full"
                      />
                    </div>
                    <select
                      value={invCategoryFilter}
                      onChange={(e) => setInvCategoryFilter(e.target.value)}
                      className="border border-input rounded-xl px-2.5 py-1.5 text-sm bg-input-background focus:outline-none"
                    >
                      <option value="">All Categories</option>
                      {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                    </select>
                  </div>

                  <button
                    onClick={() => {
                      setEditingInvItem(null);
                      setInvForm({
                        itemName: '',
                        category: 'Books',
                        description: '',
                        quantity: '',
                        minStock: '',
                        unit: 'pcs',
                        purchaseDate: new Date().toISOString().split('T')[0],
                        supplier: '',
                        purchaseCost: '',
                        status: 'Active',
                        damagedQuantity: '0'
                      });
                      setShowAddInvModal(true);
                    }}
                    className="flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground font-semibold rounded-xl text-sm transition-all hover:opacity-90 active:scale-95 shadow-sm"
                  >
                    <Plus className="h-4 w-4" /> Create Inventory Item
                  </button>
                </div>

                {/* Inventory Table */}
                <div className="border border-border bg-card rounded-2xl shadow-sm overflow-x-auto">
                  <table className="w-full text-left border-collapse min-w-[900px]">
                    <thead>
                      <tr className="bg-secondary/40 border-b border-border text-xs font-semibold text-muted-foreground uppercase">
                        <th className="px-4 py-3">Code</th>
                        <th className="px-4 py-3">Item Name</th>
                        <th className="px-4 py-3">Category</th>
                        <th className="px-4 py-3 text-center">Uniform Size</th>
                        <th className="px-4 py-3 text-center">Total Bought</th>
                        <th className="px-4 py-3 text-center">Allocated</th>
                        <th className="px-4 py-3 text-center">Available</th>
                        <th className="px-4 py-3 text-center">Damaged</th>
                        <th className="px-4 py-3 text-center">Min Stock</th>
                        <th className="px-4 py-3 text-right">Cost</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3 text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border text-sm">
                      {filteredInventory.map((item) => (
                        <tr key={item.id} className="hover:bg-secondary/20 transition-colors">
                          <td className="px-4 py-3 font-mono text-xs">{item.itemCode}</td>
                          <td className="px-4 py-3 font-medium text-foreground">{item.itemName}</td>
                          <td className="px-4 py-3">{item.category}</td>
                          <td className="px-4 py-3 text-center font-semibold">{item.quantity} {item.unit}</td>
                          <td className="px-4 py-3 text-center text-amber-600 font-semibold">{item.allocatedQuantity}</td>
                          <td className="px-4 py-3 text-center text-emerald-600 font-semibold">{item.availableQuantity}</td>
                          <td className="px-4 py-3 text-center text-red-500">{item.damagedQuantity}</td>
                          <td className="px-4 py-3 text-center text-muted-foreground">{item.minStock}</td>
                          <td className="px-4 py-3 text-right">{formatIndianCurrency(item.purchaseCost)}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                              item.status === 'Inactive' ? 'bg-red-50 text-red-600' :
                              item.availableQuantity <= item.minStock ? 'bg-amber-50 text-amber-600' : 'bg-green-50 text-green-600'
                            }`}>
                              {item.status === 'Inactive' ? 'Deactivated' : item.availableQuantity <= item.minStock ? 'Low Stock' : 'Active'}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                onClick={() => {
                                  setEditingInvItem(item);
                                  setInvForm({ uniformSize: item.uniformSize || '',
                                    itemName: item.itemName,
                                    category: item.category,
                                    description: item.description,
                                    quantity: String(item.quantity),
                                    minStock: String(item.minStock),
                                    unit: item.unit,
                                    purchaseDate: item.purchaseDate,
                                    supplier: item.supplier,
                                    purchaseCost: String(item.purchaseCost),
                                    status: item.status,
                                    damagedQuantity: String(item.damagedQuantity)
                                  });
                                  setShowAddInvModal(true);
                                }}
                                className="text-primary font-semibold hover:underline text-xs"
                              >
                                Edit
                              </button>
                              {item.status !== 'Inactive' && (
                                <button
                                  onClick={() => handleDeactivateItem(item.id)}
                                  className="text-red-500 hover:underline text-xs"
                                >
                                  Deactivate
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                      {filteredInventory.length === 0 && (
                        <tr>
                          <td colSpan={11} className="text-center py-12 text-muted-foreground text-sm">
                            No inventory items found.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ========================================================================= */}
            {/* TAB 4: STUDENT INVENTORY ALLOCATION */}
            {/* ========================================================================= */}
            {activeTab === 'allocations' && (
              <div className="space-y-6">
                {/* Students with Pending Allocation */}
                <div className="border border-border bg-card rounded-2xl shadow-sm overflow-hidden">
                  <div className="px-6 py-4 border-b border-border bg-amber-500/10">
                    <h4 className="font-semibold text-amber-700 dark:text-amber-500 text-sm">Students Waiting for Inventory Allocation</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">Enrolled students without any allocated items yet.</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-secondary/20 border-b border-border text-xs font-semibold text-muted-foreground uppercase">
                          <th className="px-6 py-3">Student Name</th>
                          <th className="px-6 py-3">Admission No / ID</th>
                          <th className="px-6 py-3">Class</th>
                          <th className="px-6 py-3">Admission Date</th>
                          <th className="px-6 py-3 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border text-sm">
                        {students.filter(s => s.status === 'Enrolled' && !new Set(allocations.map(a => a.studentId)).has(s.id)).map(student => (
                          <tr key={student.id} className="hover:bg-secondary/10 transition-colors">
                            <td className="px-6 py-3 font-semibold text-foreground">{student.fullName}</td>
                            <td className="px-6 py-3 font-mono text-xs text-muted-foreground">{student.admissionNumber || student.id}</td>
                            <td className="px-6 py-3 text-xs text-muted-foreground">{student.className}</td>
                            <td className="px-6 py-3 text-xs text-muted-foreground">{student.admissionDate || 'N/A'}</td>
                            <td className="px-6 py-3 text-center">
                              <button
                                onClick={() => {
                                  setAllocateForm({
                                    studentId: student.id,
                                    itemId: '',
                                    quantity: '1',
                                    remarks: ''
                                  });
                                  setShowAllocateModal(true);
                                }}
                                className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50 text-amber-700 hover:bg-amber-100 font-bold rounded-lg text-xs"
                              >
                                ðŸ“¦ Allocate Kit
                              </button>
                            </td>
                          </tr>
                        ))}
                        {students.filter(s => s.status === 'Enrolled' && !new Set(allocations.map(a => a.studentId)).has(s.id)).length === 0 && (
                          <tr>
                            <td colSpan={5} className="text-center py-6 text-muted-foreground text-xs">All enrolled students have received inventory allocations.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
                {/* Header allocate button */}
                <div className="flex justify-between items-center border border-border bg-card rounded-2xl p-4 shadow-sm">
                  <div>
                    <h3 className="font-semibold text-foreground">Student Inventory Allocations</h3>
                    <p className="text-xs text-muted-foreground">Allocate kits, study materials, or uniforms to newly enrolled students.</p>
                  </div>
                  <button
                    onClick={() => setShowAllocateModal(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground font-semibold rounded-xl text-sm transition-all hover:opacity-90 active:scale-95 shadow-sm"
                  >
                    <Plus className="h-4 w-4" /> Allocate Item to Student
                  </button>
                </div>

                {/* Allocation History Table */}
                <div className="border border-border bg-card rounded-2xl shadow-sm overflow-x-auto">
                  <div className="px-6 py-4 border-b border-border">
                    <h4 className="font-semibold text-foreground">Allocation History</h4>
                  </div>
                  <table className="w-full text-left border-collapse min-w-[800px]">
                    <thead>
                      <tr className="bg-secondary/40 border-b border-border text-xs font-semibold text-muted-foreground uppercase">
                        <th className="px-6 py-3">Student Name</th>
                        <th className="px-6 py-3">Admission No</th>
                        <th className="px-6 py-3">Allocated Item</th>
                        <th className="px-6 py-3 text-center">Quantity</th>
                        <th className="px-6 py-3">Date</th>
                        <th className="px-6 py-3">Allocated By</th>
                        <th className="px-6 py-3">Remarks</th>
                        <th className="px-6 py-3 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border text-sm">
                      {allocations.map((alloc) => (
                        <tr key={alloc.id} className="hover:bg-secondary/20 transition-colors">
                          <td className="px-6 py-3 font-semibold text-foreground">{alloc.studentName}</td>
                          <td className="px-6 py-3 font-mono text-xs">{alloc.admissionNumber}</td>
                          <td className="px-6 py-3">{alloc.itemName}</td>
                          <td className="px-6 py-3 text-center font-bold">{alloc.quantity}</td>
                          <td className="px-6 py-3 whitespace-nowrap">{alloc.allocatedDate}</td>
                          <td className="px-6 py-3 text-xs">{alloc.allocatedBy}</td>
                          <td className="px-6 py-3 max-w-[150px] truncate" title={alloc.remarks}>{alloc.remarks || 'â€”'}</td>
                          <td className="px-6 py-3 text-center">
                            <button
                              onClick={() => handleReturnAllocation(alloc.id)}
                              className="inline-flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700 font-semibold"
                              title="Return item and restore stock levels"
                            >
                              <RefreshCw className="h-3 w-3" /> Return Item
                            </button>
                          </td>
                        </tr>
                      ))}
                      {allocations.length === 0 && (
                        <tr>
                          <td colSpan={8} className="text-center py-12 text-muted-foreground text-sm">
                            No allocations recorded.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ========================================================================= */}
            {/* TAB 5: Salary Management */}
            {/* ========================================================================= */}
            {activeTab === 'salaries' && (
              <div className="space-y-6 max-w-6xl mx-auto">
                <div className="flex flex-col gap-3 border-b border-border pb-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-bold text-foreground">Salary Management</h3>
                      <p className="text-sm text-muted-foreground mt-1">Create draft salary slips from attendance and salary-per-class settings, then mark paid with ledger tracking.</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <input type="month" value={salaryMonth} onChange={(event) => setSalaryMonth(event.target.value)} className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm" />
                    </div>
                  </div>
                  <div className="grid gap-3 md:grid-cols-4">
                    {isSuperAdmin && (
                      <select value={salaryBranchFilter} onChange={(event) => setSalaryBranchFilter(event.target.value)} className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm">
                        <option value="">All Branches</option>
                        {branches.filter((branch) => branch.status === 'Active').map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                      </select>
                    )}
                    <select value={salaryTeacherFilter} onChange={(event) => setSalaryTeacherFilter(event.target.value)} className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm">
                      <option value="">All Teachers</option>
                      {teacherProfiles.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.firstName} {teacher.lastName}</option>)}
                    </select>
                    <select value={salaryStatusFilter} onChange={(event) => setSalaryStatusFilter(event.target.value)} className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm">
                      <option value="">All Status</option>
                      <option value="Draft">Draft</option>
                      <option value="Paid">Paid</option>
                    </select>
                    <button onClick={refreshSalaryRecords} className="rounded-xl border border-border px-3 py-2 text-sm font-semibold hover:bg-secondary">Refresh Records</button>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                    <p className="text-sm text-muted-foreground">Draft salary slips</p>
                    <p className="mt-2 text-2xl font-bold text-foreground">{salaryRows.filter((row) => row.record?.status === 'Draft').length}</p>
                  </div>
                  <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                    <p className="text-sm text-muted-foreground">Paid salaries</p>
                    <p className="mt-2 text-2xl font-bold text-green-600">{salaryRows.filter((row) => row.record?.status === 'Paid').length}</p>
                  </div>
                  <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                    <p className="text-sm text-muted-foreground">Salary per class set</p>
                    <p className="mt-2 text-2xl font-bold text-amber-600">{salaryRows.filter((row) => !row.record && row.salaryClassRecord?.salaryPerClass > 0).length}</p>
                  </div>
                </div>

                {salaryRows.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border bg-secondary/30 p-8 text-center text-sm text-muted-foreground">
                    No salary drafts or payments available for selected filters. Ensure attendance and salary per class are recorded.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-2xl border border-border bg-card p-4 shadow-sm">
                    <table className="min-w-full divide-y divide-border text-sm">
                      <thead className="bg-secondary/50">
                        <tr>
                          <th className="px-4 py-3 text-left font-semibold text-foreground">Teacher Name</th>
                          <th className="px-4 py-3 text-left font-semibold text-foreground">Employee ID</th>
                          <th className="px-4 py-3 text-left font-semibold text-foreground">Branch</th>
                          <th className="px-4 py-3 text-left font-semibold text-foreground">Salary Month</th>
                          <th className="px-4 py-3 text-right font-semibold text-foreground">Classes Conducted</th>
                          <th className="px-4 py-3 text-right font-semibold text-foreground">Salary Per Class</th>
                          <th className="px-4 py-3 text-right font-semibold text-foreground">Final Salary</th>
                          <th className="px-4 py-3 text-left font-semibold text-foreground">Payment Status</th>
                          <th className="px-4 py-3 text-left font-semibold text-foreground">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {salaryRows.map(({ teacher, record, salaryClassRecord, attendance }) => {
                          const salaryEntry = record ?? (salaryClassRecord ? buildSalarySnapshot({ teacher, month: salaryMonth, attendance, classesConducted: salaryClassRecord.classesConducted, salaryPerClass: salaryClassRecord.salaryPerClass, remarks: '' }) : null);
                          const classesConducted = salaryClassRecord?.classesConducted ?? salaryEntry?.classesConducted ?? 0;
                          const salaryPerClass = salaryClassRecord?.salaryPerClass ?? salaryEntry?.salaryPerClass ?? 0;
                          const netSalary = record?.calculatedSalary ?? calculateSalaryFromClasses(classesConducted, salaryPerClass);
                          const canMarkPaid = Boolean(record && record.status === 'Draft');
                          const canPreview = classesConducted > 0 && salaryPerClass > 0;
                          const canDownload = canPreview;
                          const branchName = getBranchName(teacher.branchId) || '—';

                          if (!salaryEntry) return null;

                          return (
                            <tr key={teacher.id} className="hover:bg-secondary/10 transition-colors">
                              <td className="px-4 py-3 font-medium text-foreground">{teacher.firstName} {teacher.lastName}</td>
                              <td className="px-4 py-3 font-mono text-xs text-foreground">{teacher.id}</td>
                              <td className="px-4 py-3 text-muted-foreground">{branchName}</td>
                              <td className="px-4 py-3 text-muted-foreground">{salaryMonth}</td>
                              <td className="px-4 py-3 text-right text-foreground">{classesConducted || '—'}</td>
                              <td className="px-4 py-3 text-right text-foreground">{salaryPerClass ? `₹${salaryPerClass}` : '—'}</td>
                              <td className="px-4 py-3 text-right text-green-700 font-semibold">{canPreview ? formatIndianCurrency(netSalary) : '—'}</td>
                              <td className="px-4 py-3 text-left">
                                <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${salaryEntry.status === 'Paid' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-700'}`}>
                                  {salaryEntry.status}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    onClick={() => handlePreviewSalarySlip(teacher, attendance, classesConducted, salaryPerClass, salaryMonth)}
                                    disabled={!canPreview}
                                    className="rounded-xl border border-border bg-white px-3 py-2 text-xs font-semibold text-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    Preview Payslip
                                  </button>
                                  <button
                                    onClick={() => handleDownloadSalarySlip(teacher, attendance, classesConducted, salaryPerClass, salaryMonth)}
                                    disabled={!canDownload}
                                    className="rounded-xl border border-border bg-white px-3 py-2 text-xs font-semibold text-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    Download PDF
                                  </button>
                                  {!record && salaryClassRecord && canPreview && (
                                    <button
                                      onClick={() => handleCreateDraft(teacher, attendance, salaryClassRecord)}
                                      className="rounded-xl bg-slate-700 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                                    >
                                      Create Draft
                                    </button>
                                  )}
                                  {record && record.isLocked && user?.role === 'super_admin' && (
                                    <button
                                      onClick={() => handleUnlock(record)}
                                      className="rounded-xl bg-amber-500 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-600"
                                    >
                                      Unlock Salary
                                    </button>
                                  )}
                                  <button
                                    onClick={() => record && handleMarkPaid(record)}
                                    disabled={!canMarkPaid}
                                    className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    Mark Salary Paid
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'reports' && (
              <div className="space-y-6 max-w-3xl mx-auto">
                <form onSubmit={handleReportSubmit} className="border border-border bg-card rounded-2xl shadow-sm p-6 space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
                    <div>
                      <h3 className="text-lg font-bold text-foreground">Submit Monthly Financial Report</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">Locks ledger and compiles inventory summary for Super Admin review.</p>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-muted-foreground">Select week:</span>
                      <input
                        type="month"
                        value={reportWeek}
                        onChange={(e) => setreportWeek(e.target.value)}
                        className="rounded-xl border border-input bg-input-background px-3 py-1.5 text-sm focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Submission Status Alert */}
                  {submittedReport && (
                    <div className={`p-4 rounded-xl flex items-center gap-3 border ${
                      submittedReport.status === 'Approved' ? 'bg-green-50 border-green-200 text-green-700 dark:bg-green-950/20 dark:text-green-400' :
                      submittedReport.status === 'Returned' ? 'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400' :
                      'bg-sky-50 border-sky-200 text-sky-700 dark:bg-sky-950/20 dark:text-sky-400'
                    }`}>
                      {submittedReport.status === 'Approved' ? <CheckCircle className="h-5 w-5 shrink-0" /> : <Lock className="h-5 w-5 shrink-0" />}
                      <div className="text-sm">
                        <span className="font-bold">Status: Report {submittedReport.status}</span>
                        <p className="text-xs mt-0.5">Submitted by {submittedReport.submittedBy} on {submittedReport.submittedDate}. {
                          submittedReport.status === 'Returned' ? 'Reason: returned for correction. Please update comments and re-submit.' : 'Locked from edit.'
                        }</p>
                      </div>
                    </div>
                  )}

                  {/* Metrics List Preview */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {[
                      { label: 'Total Month Income', value: formatIndianCurrency(computedReportData.income) },
                      { label: 'Total Month Expenses', value: formatIndianCurrency(computedReportData.expense) },
                      { label: 'Computed Net Profit', value: formatIndianCurrency(computedReportData.netProfit) },
                      { label: 'Student Admissions Count', value: `${computedReportData.admissionsCount} enrolled` },
                      { label: 'Inventory Purchased (Total)', value: `${computedReportData.purchased} items` },
                      { label: 'Inventory Allocated (This week)', value: `${computedReportData.allocated} items` },
                      { label: 'Inventory Stock Remaining', value: `${computedReportData.remaining} items` },
                      { label: 'Estimated Dues Outstanding', value: formatIndianCurrency(computedReportData.outstanding) }
                    ].map((metric) => (
                      <div key={metric.label} className="flex justify-between items-center p-3 border border-border bg-secondary/10 rounded-xl text-sm">
                        <span className="text-muted-foreground font-medium">{metric.label}</span>
                        <span className="font-bold text-foreground">{metric.value}</span>
                      </div>
                    ))}
                  </div>

                  {/* Low stock indicators */}
                  {computedReportData.lowStockList.length > 0 && (
                    <div className="p-3 border border-red-200 bg-red-50 dark:bg-red-950/10 rounded-xl flex items-start gap-2.5">
                      <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                      <div className="text-xs text-red-700 dark:text-red-400">
                        <span className="font-bold">Low stock warning:</span> The following items are below minimum stock threshold and require reordering: {
                          computedReportData.lowStockList.join(', ')
                        }
                      </div>
                    </div>
                  )}

                  {/* Comments Fields */}
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1">Accountant Comments / Monthly Review Summary</label>
                      <textarea
                        value={reportComments}
                        onChange={(e) => setReportComments(e.target.value)}
                        disabled={submittedReport && submittedReport.status !== 'Returned'}
                        placeholder="Provide details on general cash balance, discrepancies, pending receipts, or inventory orders..."
                        rows={4}
                        className="w-full rounded-xl border border-input bg-input-background p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-75 disabled:bg-secondary"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1">Report Remarks (Optional)</label>
                      <input
                        type="text"
                        value={reportRemarks}
                        onChange={(e) => setReportRemarks(e.target.value)}
                        disabled={submittedReport && submittedReport.status !== 'Returned'}
                        placeholder="e.g. June Weekly Report Final Copy"
                        className="w-full rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-75 disabled:bg-secondary"
                      />
                    </div>
                  </div>

                  {/* Submit buttons */}
                  {(!submittedReport || submittedReport.status === 'Returned') && (
                    <button
                      type="submit"
                      className="w-full flex items-center justify-center gap-2 py-3 bg-primary text-primary-foreground font-bold rounded-xl text-sm transition-all hover:opacity-90 active:scale-95 shadow-sm"
                    >
                      <FileText className="h-4 w-4" /> Submit Weekly Report to Super Admin
                    </button>
                  )}
                </form>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* ADD LEDGER TRANSACTION MODAL */}
      {/* ========================================================================= */}
      {showAddLedgerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
          <form onSubmit={handleAddTransactionSubmit} className="bg-card border border-border rounded-2xl w-full max-w-lg p-6 shadow-xl space-y-4">
            <div className="flex justify-between items-center border-b border-border pb-3">
              <h3 className="font-bold text-foreground">Record Voucher Transaction</h3>
              <button type="button" onClick={() => setShowAddLedgerModal(false)} className="text-sm text-muted-foreground hover:text-foreground">âœ•</button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Date</label>
                <input
                  type="date"
                  value={ledgerForm.date}
                  onChange={(e) => setLedgerForm(prev => ({ ...prev, date: e.target.value }))}
                  className="w-full rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Type</label>
                <select
                  value={ledgerForm.type}
                  onChange={(e) => setLedgerForm(prev => ({ ...prev, type: e.target.value as any, category: e.target.value === 'Income' ? 'Tuition Fee' : 'Utilities' }))}
                  className="w-full rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="Income">Credit (Income)</option>
                  <option value="Expense">Debit (Expense)</option>
                </select>
              </div>

              <div>
                
                <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Category</label>
                <select
                  value={ledgerForm.category}
                  onChange={(e) => setLedgerForm(prev => ({ ...prev, category: e.target.value }))}
                  className="w-full rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm focus:outline-none"
                >
                  <option value="Tuition Fee">Tuition Fee</option>
                  <option value="Uniforms">Uniforms</option>
                  <option value="Books">Books</option>
                  <option value="Utilities">Utilities</option>
                  <option value="Salary">Salary</option>
                  <option value="Rent">Rent</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Amount (?)</label>
                <input
                  type="number"
                  placeholder="e.g. 5000"
                  value={ledgerForm.amount}
                  onChange={(e) => setLedgerForm(prev => ({ ...prev, amount: e.target.value }))}
                  className="w-full rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Payment Mode</label>
                <select
                  value={ledgerForm.mode}
                  onChange={(e) => setLedgerForm(prev => ({ ...prev, mode: e.target.value as any }))}
                  className="w-full rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm focus:outline-none"
                >
                  <option value="Cash">Cash</option>
                  <option value="Bank Transfer">Bank Transfer</option>
                  <option value="UPI">UPI</option>
                  <option value="Cheque">Cheque</option>
                </select>
              </div>
            </div>
            
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Description / Remarks</label>
              <input
                type="text"
                placeholder="Brief description of the transaction"
                value={ledgerForm.description}
                onChange={(e) => setLedgerForm(prev => ({ ...prev, description: e.target.value }))}
                className="w-full rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm focus:outline-none"
              />
            </div>

            <div className="flex justify-end gap-3 pt-3">
              <button type="button" onClick={() => setShowAddLedgerModal(false)} className="rounded-xl border border-border px-5 py-2 text-sm font-medium hover:bg-secondary">Cancel</button>
              <button type="submit" className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">Confirm Entry</button>
            </div>
          </form>
        </div>
      )}

      {showCategoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card shadow-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-foreground">Manage Inventory Categories</h3>
              <button type="button" onClick={() => setShowCategoryModal(false)} className="text-sm text-muted-foreground hover:text-foreground">?</button>
            </div>
            
            <form onSubmit={handleSaveCategory} className="flex gap-2 mb-4 items-end">
              <div className="flex-1">
                <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Category Name</label>
                <input value={categoryForm.name} onChange={(e) => setCategoryForm(prev => ({...prev, name: e.target.value}))} required className="w-full rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none" />
              </div>
              <div className="w-24">
                <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Status</label>
                <select value={categoryForm.status} onChange={(e) => setCategoryForm(prev => ({...prev, status: e.target.value as any}))} className="w-full rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none">
                  <option>Active</option>
                  <option>Inactive</option>
                </select>
              </div>
              <button type="submit" className="bg-primary text-primary-foreground px-4 py-2 rounded-xl text-sm font-semibold">{categoryForm.id === 0 ? 'Add' : 'Update'}</button>
            </form>
            
            <div className="max-h-60 overflow-y-auto border border-border rounded-xl">
              <table className="w-full text-left text-sm">
                <thead><tr className="border-b border-border bg-muted/50"><th className="px-3 py-2">Name</th><th className="px-3 py-2 text-center">Status</th><th className="px-3 py-2 text-right">Actions</th></tr></thead>
                <tbody>
                  {categories.map(c => (
                    <tr key={c.id} className="border-b border-border">
                      <td className="px-3 py-2">{c.name}</td>
                      <td className="px-3 py-2 text-center"><span className={`px-2 py-0.5 rounded text-xs ${c.status==='Active'?'bg-green-100 text-green-700':'bg-gray-100 text-gray-700'}`}>{c.status}</span></td>
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => setCategoryForm({id: c.id, name: c.name, status: c.status})} className="text-blue-500 hover:underline mr-3 text-xs">Edit</button>
                        <button onClick={() => handleDeleteCategory(c.id)} className="text-red-500 hover:underline text-xs">Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ADD/EDIT INVENTORY MODAL */}
      {/* ========================================================================= */}
      {showAddInvModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
          <form onSubmit={handleInventorySubmit} className="bg-card border border-border rounded-2xl w-full max-w-md p-6 shadow-xl space-y-4">
            <div className="flex justify-between items-center border-b border-border pb-3">
              <h3 className="font-bold text-foreground">{editingInvItem ? 'Edit Inventory Item' : 'Add to Inventory'}</h3>
              <button type="button" onClick={() => setShowAddInvModal(false)} className="text-sm text-muted-foreground hover:text-foreground">?</button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Item Code</label>
                <input
                  type="text"
                  placeholder="e.g. BKS-001"
                  value={invForm.itemCode}
                  onChange={(e) => setInvForm(prev => ({ ...prev, itemCode: e.target.value }))}
                  className="w-full rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Item Name</label>
                <input
                  type="text"
                  placeholder="e.g. 10th Science Textbook"
                  value={invForm.itemName}
                  onChange={(e) => setInvForm(prev => ({ ...prev, itemName: e.target.value }))}
                  className="w-full rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Category</label>
                <div className="flex gap-2">
                  <select
                    value={invForm.category}
                    onChange={(e) => setInvForm(prev => ({ ...prev, category: e.target.value }))}
                    className="flex-1 rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm focus:outline-none"
                    required
                  >
                    <option value="">Select Category</option>
                    {categories.filter(c => c.status === 'Active').map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                  </select>
                  <button type="button" onClick={() => setShowCategoryModal(true)} className="px-3 rounded-xl border border-border bg-secondary text-xs hover:bg-secondary/70">Manage</button>
                </div>
              </div>
              
              {invForm.category === 'Uniform' && (
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Uniform Size</label>
                  <input
                    type="text"
                    value={invForm.uniformSize}
                    onChange={(e) => setInvForm(prev => ({ ...prev, uniformSize: e.target.value }))}
                    placeholder="e.g. S, M, L, XL, 32, 34"
                    className="w-full rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm focus:outline-none"
                    required
                  />
                </div>
              )}

              


              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Unit</label>
                <input
                  type="text"
                  placeholder="pcs, sets, units"
                  value={invForm.unit}
                  onChange={(e) => setInvForm(prev => ({ ...prev, unit: e.target.value }))}
                  className="w-full rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Initial Quantity Bought</label>
                <input
                  type="number"
                  placeholder="e.g. 100"
                  value={invForm.quantity}
                  onChange={(e) => setInvForm(prev => ({ ...prev, quantity: e.target.value }))}
                  className="w-full rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Minimum Stock Threshold</label>
                <input
                  type="number"
                  placeholder="e.g. 20"
                  value={invForm.minStock}
                  onChange={(e) => setInvForm(prev => ({ ...prev, minStock: e.target.value }))}
                  className="w-full rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Purchase Unit Cost (â‚¹)</label>
                <input
                  type="number"
                  placeholder="e.g. 150"
                  value={invForm.purchaseCost}
                  onChange={(e) => setInvForm(prev => ({ ...prev, purchaseCost: e.target.value }))}
                  className="w-full rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Damaged Count</label>
                <input
                  type="number"
                  value={invForm.damagedQuantity}
                  onChange={(e) => setInvForm(prev => ({ ...prev, damagedQuantity: e.target.value }))}
                  className="w-full rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Purchase Date</label>
                <input
                  type="date"
                  value={invForm.purchaseDate}
                  onChange={(e) => setInvForm(prev => ({ ...prev, purchaseDate: e.target.value }))}
                  className="w-full rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Supplier Name</label>
                <input
                  type="text"
                  placeholder="e.g. NCERT Printers"
                  value={invForm.supplier}
                  onChange={(e) => setInvForm(prev => ({ ...prev, supplier: e.target.value }))}
                  className="w-full rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm focus:outline-none"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Item Description</label>
                <input
                  type="text"
                  placeholder="Additional details..."
                  value={invForm.description}
                  onChange={(e) => setInvForm(prev => ({ ...prev, description: e.target.value }))}
                  className="w-full rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm focus:outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-3">
              <button type="button" onClick={() => setShowAddInvModal(false)} className="rounded-xl border border-border px-5 py-2 text-sm font-medium hover:bg-secondary">Cancel</button>
              <button type="submit" className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
                {editingInvItem ? 'Save Updates' : 'Create Item'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ALLOCATE INVENTORY MODAL */}
      {/* ========================================================================= */}
      {showAllocateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
          <form onSubmit={handleAllocateSubmit} className="bg-card border border-border rounded-2xl w-full max-w-md p-6 shadow-xl space-y-4">
            <div className="flex justify-between items-center border-b border-border pb-3">
              <h3 className="font-bold text-foreground">Allocate Inventory to Student</h3>
              <button type="button" onClick={() => setShowAllocateModal(false)} className="text-sm text-muted-foreground hover:text-foreground">âœ•</button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Select Student</label>
                <select
                  value={allocateForm.studentId}
                  onChange={(e) => setAllocateForm(prev => ({ ...prev, studentId: e.target.value }))}
                  className="w-full rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm focus:outline-none"
                  required
                >
                  <option value="">Choose Student...</option>
                  {students.filter(s => !branchFilter || s.branchId === branchFilter).map(s => (
                    <option key={s.id} value={s.id}>{s.fullName} ({s.id} - {s.className})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Select Item to Allocate</label>
                <select
                  value={allocateForm.itemId}
                  onChange={(e) => setAllocateForm(prev => ({ ...prev, itemId: e.target.value }))}
                  className="w-full rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm focus:outline-none"
                  required
                >
                  <option value="">Choose Item...</option>
                  {inventory.filter(item => item.status === 'Active' && item.availableQuantity > 0).map(item => (
                    <option key={item.id} value={item.id}>{item.itemName} (Available: {item.availableQuantity} {item.unit})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Quantity</label>
                <input
                  type="number"
                  min="1"
                  value={allocateForm.quantity}
                  onChange={(e) => setAllocateForm(prev => ({ ...prev, quantity: e.target.value }))}
                  className="w-full rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Remarks / Notes</label>
                <input
                  type="text"
                  placeholder="e.g. Distributed uniform and textbooks set"
                  value={allocateForm.remarks}
                  onChange={(e) => setAllocateForm(prev => ({ ...prev, remarks: e.target.value }))}
                  className="w-full rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm focus:outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-3">
              <button type="button" onClick={() => setShowAllocateModal(false)} className="rounded-xl border border-border px-5 py-2 text-sm font-medium hover:bg-secondary">Cancel</button>
              <button type="submit" className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">Confirm Allocation</button>
            </div>
          </form>
        </div>
      )}

    </div>
  );
}






