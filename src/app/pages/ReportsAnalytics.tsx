import { useMemo, useState, useEffect } from 'react';
import { Header } from '../components/Header';
import { BarChart3, TrendingUp, FileSpreadsheet, FileText, Loader2, Mail, MessageSquare, CheckCircle, AlertTriangle, RefreshCw, XCircle, Plus } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import { useAuth } from '../auth/AuthContext';
import { getBranches, getBranchName } from '../lib/branchService';
import { buildReportExportData, exportReportToExcel, exportReportToPdf } from '../lib/reportExport';
import { PDFTemplateService } from '../lib/pdfTemplateService';
import { formatIndianCurrency } from '../lib/currency';
import { utils, writeFile } from 'xlsx';
import { apiFetch } from '../lib/apiClient';
import { fetchAttendance } from '../lib/attendanceService';
import { fetchFeeStats, type FeeStats } from '../lib/feeService';
import { useExams } from '../lib/examService';
import { refreshMarks, type MarkRecord } from '../lib/examMarksService';

const FEE_INCOME_CATEGORIES = ['Tuition Fee', 'Admission Fee', 'Special Class Fee', 'Material Purchase Fee'];
const CONDUCTED_EXAM_STATUSES = ['attendance_completed', 'marks_entry_open', 'results_published', 'completed'];
const EMPTY_FEE_STATS: FeeStats = { totalCollected: 0, totalPending: 0, overdueCount: 0, paidCount: 0, totalRecords: 0 };

function getLastMonths(count: number) {
  const months: { key: string; label: string }[] = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleString('default', { month: 'short' }),
    });
  }
  return months;
}

export function ReportsAnalytics() {
  const { user } = useAuth();
  const branches = getBranches();
  const [branchFilter, setBranchFilter] = useState(user?.role === 'accountant' ? (user?.branchId || '') : '');
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [isGeneratingExcel, setIsGeneratingExcel] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [whatsappLogs, setWhatsappLogs] = useState<any[]>([]);
  const [submittedReports, setSubmittedReports] = useState<any[]>([]);
  const [analyticsTeachers, setAnalyticsTeachers] = useState<any[]>([]);
  const [analyticsParents, setAnalyticsParents] = useState<any[]>([]);
  const [accountantsCount, setAccountantsCount] = useState(0);
  const [attendanceRecords, setAttendanceRecords] = useState<any[]>([]);
  const [examMarks, setExamMarks] = useState<MarkRecord[]>([]);
  const [feeStats, setFeeStats] = useState<FeeStats>(EMPTY_FEE_STATS);
  const exams = useExams();

  const fetchReports = async () => {
    try {
      const res = await apiFetch(`/api/financial-reports${branchFilter ? `?branchId=${branchFilter}` : ''}`);
      if (res.ok) {
        const data = await res.json();
        setSubmittedReports(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      console.error('Failed to load monthly reports', e);
    }
  };

  useEffect(() => {
    fetchReports();
  }, [branchFilter]);

  useEffect(() => {
    if (user?.role !== 'super_admin') return;
    const loadAnalyticsData = async () => {
      try {
        const branchParam = branchFilter ? `?branchId=${branchFilter}` : '';
        const [resTeachers, resParents, resUsers, records, marks, stats] = await Promise.all([
          apiFetch(`/api/teachers${branchParam}`),
          apiFetch(`/api/parents${branchParam}`),
          apiFetch(`/api/users`),
          fetchAttendance(),
          refreshMarks(),
          fetchFeeStats(branchFilter ? { branchId: branchFilter } : {}),
        ]);
        if (resTeachers.ok) setAnalyticsTeachers(await resTeachers.json());
        if (resParents.ok) setAnalyticsParents(await resParents.json());
        if (resUsers.ok) {
          const usersList = await resUsers.json();
          setAccountantsCount(
            Array.isArray(usersList)
              ? usersList.filter((u: any) => u.roles?.includes('accountant') && (!branchFilter || u.branchId === branchFilter)).length
              : 0
          );
        }
        setAttendanceRecords(Array.isArray(records) ? records : []);
        setExamMarks(Array.isArray(marks) ? marks : []);
        setFeeStats(stats);
      } catch (err) {
        console.error('Failed to load analytics data in reports', err);
      }
    };
    void loadAnalyticsData();
  }, [branchFilter, user?.role]);

  const handleApproveReport = async (reportId: number) => {
    try {
      const res = await apiFetch(`/api/financial-reports/${reportId}/action`, {
        method: 'POST',
        body: { status: 'Approved', remarks: 'Approved by Super Admin' }
      });
      if (res.ok) {
        fetchReports();
        setStatusMessage('Monthly Financial Report APPROVED successfully.');
      }
    } catch (e) { console.error(e); }
  };

  const handleReturnReport = async (reportId: number) => {
    const reason = prompt('Enter the reason/feedback for returning this report for correction:');
    if (reason === null) return;
    if (!reason.trim()) {
      alert('A reason is required to return a report.');
      return;
    }
    try {
      const res = await apiFetch(`/api/financial-reports/${reportId}/action`, {
        method: 'POST',
        body: { status: 'Returned', remarks: reason }
      });
      if (res.ok) {
        fetchReports();
        setStatusMessage('Monthly Financial Report returned for correction.');
      }
    } catch (e) { console.error(e); }
  };

  const exportMonthlyReportToPdf = async (report: any) => {
    try {
      const pdfService = new PDFTemplateService();
      pdfService.addTitle(`Monthly Financial & Inventory Report - ${report.month}`);
      
      const metaHeaders = ['Property', 'Value'];
      const metaBody = [
        ['Branch ID', getBranchName(report.branchId) || report.branchId],
        ['Submitted By', report.submittedBy],
        ['Submission Date', report.submittedDate],
        ['Approval Status', report.status],
        ...(report.remarks ? [['Super Admin Feedback', report.remarks]] : [])
      ];
      pdfService.addTable([metaHeaders], metaBody);

      pdfService.addSectionHeading('Key Summary Metrics');
      const metricsBody = [
        ['Total Branch Monthly Income', formatIndianCurrency(report.totalIncome)],
        ['Total Branch Monthly Expense', formatIndianCurrency(report.totalExpense)],
        ['Calculated Net Profit', formatIndianCurrency(report.netProfit)],
        ['New Student Admissions Count', `${report.studentAdmissions} students`],
        ['Inventory Materials Purchased', `${report.inventoryPurchased} items`],
        ['Inventory Materials Allocated', `${report.inventoryAllocated} items`],
        ['Inventory Stock Remaining', `${report.inventoryRemaining} items`],
        ['Outstanding Fees (Estimated)', formatIndianCurrency(report.outstandingFees)]
      ];
      pdfService.addTable([metaHeaders], metricsBody);
      
      pdfService.addSectionHeading('Accountant Comments');
      pdfService.addParagraph(report.comments || 'No comments provided.');

      await pdfService.exportWithLetterhead(`Financial_Report_${report.branchId}_${report.month}.pdf`);
    } catch (err) {
      console.error(err);
      alert('Failed to generate PDF.');
    }
  };


  const exportMonthlyReportToExcel = (report: any) => {
    try {
      const summaryData = [
        { Metric: 'Month', Value: report.month },
        { Metric: 'Branch', Value: getBranchName(report.branchId) || report.branchId },
        { Metric: 'Status', Value: report.status },
        { Metric: 'Submitted By', Value: report.submittedBy },
        { Metric: 'Submitted Date', Value: report.submittedDate },
        { Metric: 'Total Income', Value: report.totalIncome },
        { Metric: 'Total Expense', Value: report.totalExpense },
        { Metric: 'Net Profit', Value: report.netProfit },
        { Metric: 'Student Admissions', Value: report.studentAdmissions },
        { Metric: 'Inventory Purchased', Value: report.inventoryPurchased },
        { Metric: 'Inventory Allocated', Value: report.inventoryAllocated },
        { Metric: 'Inventory Remaining', Value: report.inventoryRemaining },
        { Metric: 'Outstanding Fees (Est.)', Value: report.outstandingFees },
        { Metric: 'Remarks', Value: report.remarks || '' },
        { Metric: 'Comments', Value: report.comments || '' }
      ];

      let ledgerEntries: string[] = [];
      try {
        ledgerEntries = JSON.parse(report.ledgerSummary || '[]');
      } catch (e) {
        ledgerEntries = [];
      }

      const ledgerData = ledgerEntries.map((line: string) => ({ Entry: line }));

      const wb = utils.book_new();
      const wsSummary = utils.json_to_sheet(summaryData);
      const wsLedger = utils.json_to_sheet(ledgerData);

      utils.book_append_sheet(wb, wsSummary, 'Summary Metrics');
      utils.book_append_sheet(wb, wsLedger, 'Ledger Transactions');

      writeFile(wb, `Financial_Report_${report.branchId}_${report.month}.xlsx`);
    } catch (err) {
      console.error(err);
      alert('Failed to generate Excel.');
    }
  };
  // Extra states for Simplified Reports (Accountant & Admin)
  const myBranchId = user?.branchId || '';
  const [filterMonth, setFilterMonth] = useState<string>(new Date().toISOString().slice(5, 7)); // '01'-'12'
  const [filterYear, setFilterYear] = useState<string>(new Date().getFullYear().toString()); // '2026'
  const [reportCategory, setReportCategory] = useState<'income' | 'expense' | 'inventory' | 'monthly'>('income');

  const [ledger, setLedger] = useState<any[]>([]);
  const [inventory, setInventory] = useState<any[]>([]);
  const [allocations, setAllocations] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);

  useEffect(() => {
    const fetchAllData = async () => {
      try {
        const branchParam = branchFilter ? `?branchId=${branchFilter}` : '';
        
        const [resLedger, resInv, resAlloc, resStudents] = await Promise.all([
          apiFetch(`/api/ledger${branchParam}`),
          apiFetch(`/api/inventory${branchParam}`),
          apiFetch(`/api/inventory/allocations${branchParam}`),
          apiFetch(`/api/students`)
        ]);

        if (resLedger.ok) {
          const data = await resLedger.json();
          setLedger(Array.isArray(data) ? data : []);
        }
        if (resInv.ok) {
          const data = await resInv.json();
          setInventory(Array.isArray(data) ? data : []);
        }
        if (resAlloc.ok) {
          const data = await resAlloc.json();
          setAllocations(Array.isArray(data) ? data : []);
        }
        if (resStudents.ok) {
          const sData = await resStudents.json();
          setStudents(Array.isArray(sData) ? sData : (sData.students || []));
        }
      } catch (err) {
        console.error('Error fetching data for simplified reports', err);
      }
    };
    fetchAllData();
  }, [branchFilter]);

  const activeBranchLabel = branchFilter ? getBranchName(branchFilter) : 'All Branches';

  useEffect(() => {
    const loadLogs = async () => {
      try {
        let url = `/api/whatsapp/logs`;
        const qParams = new URLSearchParams();
        if (branchFilter) qParams.append('branchId', branchFilter);
        if (user?.role) qParams.append('userRole', user.role);
        if (user?.branchId) qParams.append('userBranchId', user.branchId);
        if (user?.assignedClassIds) qParams.append('assignedClassIds', user.assignedClassIds.join(','));
        url += `?${qParams.toString()}`;
        
        const res = await apiFetch(url);
        if (res.ok) {
          const list = await res.json();
          setWhatsappLogs(Array.isArray(list) ? list : []);
        }
      } catch (err) {
        console.error('Failed to load WhatsApp logs in reports', err);
      }
    };
    void loadLogs();
  }, [branchFilter, user]);

  const trendMonths = useMemo(() => getLastMonths(6), []);

  const scopedAnalyticsStudents = useMemo(
    () => students.filter((s: any) => !branchFilter || s.branchId === branchFilter),
    [students, branchFilter]
  );

  const monthlyData = useMemo(() => {
    const revenueByMonth = new Map<string, number>();
    ledger.forEach((t: any) => {
      if (t.type === 'Income' && t.date) {
        const key = t.date.slice(0, 7);
        revenueByMonth.set(key, (revenueByMonth.get(key) || 0) + (t.amount || 0));
      }
    });
    return trendMonths.map(({ key, label }) => ({
      month: label,
      revenue: revenueByMonth.get(key) || 0,
      students: scopedAnalyticsStudents.filter((s: any) => s.admissionDate && s.admissionDate.slice(0, 7) <= key).length,
    }));
  }, [ledger, scopedAnalyticsStudents, trendMonths]);

  const attendanceData = useMemo(() => {
    const byMonth = new Map<string, { present: number; total: number }>();
    attendanceRecords.forEach((r: any) => {
      if (!r.date) return;
      const key = r.date.slice(0, 7);
      const bucket = byMonth.get(key) || { present: 0, total: 0 };
      bucket.total += 1;
      if (r.status === 'present') bucket.present += 1;
      byMonth.set(key, bucket);
    });
    return trendMonths.map(({ key, label }) => {
      const bucket = byMonth.get(key);
      return { month: label, attendance: bucket && bucket.total > 0 ? Math.round((bucket.present / bucket.total) * 100) : 0 };
    });
  }, [attendanceRecords, trendMonths]);

  const feeCollectionData = useMemo(() => {
    const byMonth = new Map<string, number>();
    ledger.forEach((t: any) => {
      if (t.type === 'Income' && t.date && FEE_INCOME_CATEGORIES.includes(t.category)) {
        const key = t.date.slice(0, 7);
        byMonth.set(key, (byMonth.get(key) || 0) + (t.amount || 0));
      }
    });
    return trendMonths.map(({ key, label }) => ({ month: label, collected: byMonth.get(key) || 0 }));
  }, [ledger, trendMonths]);

  const examPerformanceData = useMemo(() => {
    const examDateById = new Map(exams.map((e) => [e.id, e.date]));
    const byMonth = new Map<string, { sum: number; count: number }>();
    examMarks.forEach((m) => {
      const date = examDateById.get(m.examId);
      if (!date) return;
      const key = date.slice(0, 7);
      const bucket = byMonth.get(key) || { sum: 0, count: 0 };
      bucket.sum += m.percentage || 0;
      bucket.count += 1;
      byMonth.set(key, bucket);
    });
    return trendMonths.map(({ key, label }) => {
      const bucket = byMonth.get(key);
      return { month: label, average: bucket && bucket.count > 0 ? Math.round(bucket.sum / bucket.count) : 0 };
    });
  }, [examMarks, exams, trendMonths]);

  const activeBatchesCount = useMemo(() => {
    const names = new Set(
      scopedAnalyticsStudents
        .filter((s: any) => !s.status || s.status === 'Active' || s.status === 'Enrolled')
        .map((s: any) => s.className)
        .filter(Boolean)
    );
    return names.size;
  }, [scopedAnalyticsStudents]);

  const examsConductedCount = useMemo(
    () => exams.filter((e) => CONDUCTED_EXAM_STATUSES.includes(e.status)).length,
    [exams]
  );

  const reportData = useMemo(() => buildReportExportData({
    monthlyData,
    attendanceData,
    feeCollectionData,
    examPerformanceData,
    generatedBy: user?.name ?? 'Super Admin',
    teachers: analyticsTeachers.length,
    parents: analyticsParents.length,
    accountants: accountantsCount,
    attendancePercentage: attendanceData.at(-1)?.attendance ?? 0,
    examsConducted: examsConductedCount,
    activeBatches: activeBatchesCount,
    pendingFees: feeStats.totalPending,
    branchName: activeBranchLabel,
    smsLogs: whatsappLogs
  }), [monthlyData, attendanceData, feeCollectionData, examPerformanceData, activeBranchLabel, user?.name, whatsappLogs, analyticsTeachers, analyticsParents, accountantsCount, examsConductedCount, activeBatchesCount, feeStats]);

  const exportPdf = async () => {
    if (!reportData.summaryCards.length) {
      setStatusMessage('No report data available to export.');
      return;
    }

    setIsGeneratingPdf(true);
    setStatusMessage('Generating PDF report...');
    try {
      await exportReportToPdf(reportData, {
        monthlyData,
        attendanceData,
        feeCollectionData,
        examPerformanceData,
      });
      setStatusMessage('PDF exported successfully.');
    } catch (error) {
      setStatusMessage('Unable to generate PDF at the moment.');
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const exportExcel = () => {
    if (!reportData.summaryCards.length) {
      setStatusMessage('No report data available to export.');
      return;
    }

    setIsGeneratingExcel(true);
    setStatusMessage('Generating Excel workbook...');
    try {
      exportReportToExcel(reportData);
      setStatusMessage('Excel workbook exported successfully.');
    } catch (error) {
      setStatusMessage('Unable to generate Excel workbook at the moment.');
    } finally {
      setIsGeneratingExcel(false);
    }
  };

  // Simplified Reports Data Calculations
  const filteredIncome = useMemo(() => {
    const prefix = `${filterYear}-${filterMonth}`;
    return ledger.filter(t => t.type === 'Income' && t.date.startsWith(prefix));
  }, [ledger, filterYear, filterMonth]);

  const filteredExpense = useMemo(() => {
    const prefix = `${filterYear}-${filterMonth}`;
    return ledger.filter(t => t.type === 'Expense' && t.date.startsWith(prefix));
  }, [ledger, filterYear, filterMonth]);

  const filteredInventoryData = useMemo(() => {
    return inventory;
  }, [inventory]);

  const selectedMonthlyReport = useMemo(() => {
    const prefix = `${filterYear}-${filterMonth}`;
    return submittedReports.find(r => r.month === prefix);
  }, [submittedReports, filterYear, filterMonth]);

  const pendingAllocationCount = useMemo(() => {
    const enrolled = students.filter(s => s.status === 'Active' && (!branchFilter || s.branchId === branchFilter));
    const allocatedIds = new Set(allocations.map(a => a.studentId));
    return enrolled.filter(s => !allocatedIds.has(s.id)).length;
  }, [students, allocations, branchFilter]);

  const handleExportCategoryToPdf = async () => {
    try {
      const pdfService = new PDFTemplateService();
      
      const branchName = getBranchName(branchFilter || myBranchId) || 'All Branches';

      if (reportCategory === 'income') {
        pdfService.addTitle(`Income Report - ${filterMonth}/${filterYear} (${branchName})`);
        const headers = ['Date', 'Voucher', 'Category', 'Amount', 'Description'];
        const body = filteredIncome.map(t => [t.date, t.voucherNumber, t.category, formatIndianCurrency(t.amount), t.description]);
        pdfService.addTable([headers], body);
      } else if (reportCategory === 'expense') {
        pdfService.addTitle(`Expense Report - ${filterMonth}/${filterYear} (${branchName})`);
        const headers = ['Date', 'Voucher', 'Category', 'Amount', 'Description'];
        const body = filteredExpense.map(t => [t.date, t.voucherNumber, t.category, formatIndianCurrency(t.amount), t.description]);
        pdfService.addTable([headers], body);
      } else if (reportCategory === 'inventory') {
        pdfService.addTitle(`Inventory Levels Report (${branchName})`);
        const headers = ['Item Code', 'Item Name', 'Category', 'Purchased', 'Allocated', 'Available', 'Status'];
        const body = filteredInventoryData.map(item => [
          item.itemCode,
          item.itemName,
          item.category,
          String(item.quantity),
          String(item.allocatedQuantity),
          String(item.availableQuantity),
          item.availableQuantity <= item.minStock ? 'Low Stock' : 'Normal'
        ]);
        pdfService.addTable([headers], body);
      } else if (reportCategory === 'monthly') {
        pdfService.addTitle(`Monthly Financial Report - ${filterMonth}/${filterYear} (${branchName})`);
        if (selectedMonthlyReport) {
          const headers = ['Metric', 'Value'];
          const body = [
            ['Total Income', formatIndianCurrency(selectedMonthlyReport.totalIncome)],
            ['Total Expenses', formatIndianCurrency(selectedMonthlyReport.totalExpense)],
            ['Net Balance', formatIndianCurrency(selectedMonthlyReport.netProfit)],
            ['Inventory Purchased', `${selectedMonthlyReport.inventoryPurchased} items`],
            ['Inventory Allocated', `${selectedMonthlyReport.inventoryAllocated} items`],
            ['Remaining Inventory', `${selectedMonthlyReport.inventoryRemaining} items`],
            ['Student Admissions', `${selectedMonthlyReport.studentAdmissions} enrolled`],
            ['Status', selectedMonthlyReport.status],
            ['Submitted Date', selectedMonthlyReport.submittedDate],
            ['Remarks', selectedMonthlyReport.remarks || 'N/A'],
          ];
          pdfService.addTable([headers], body);
        } else {
          pdfService.addParagraph('No monthly financial report has been compiled or submitted for this period.');
        }
      }
      
      await pdfService.exportWithLetterhead(`Category_Report_${reportCategory}.pdf`);
    } catch (err) {
      console.error(err);
      alert('Failed to generate PDF.');
    }
  };


  const handleExportCategoryToExcel = () => {
    try {
      let sheetData: any[] = [];
      const branchName = getBranchName(branchFilter || myBranchId) || 'All Branches';

      if (reportCategory === 'income') {
        sheetData = filteredIncome.map(t => ({
          Date: t.date,
          'Voucher Number': t.voucherNumber,
          Category: t.category,
          Description: t.description,
          Amount: t.amount,
          'Payment Mode': t.paymentMode,
          Reference: t.referenceNumber || ''
        }));
      } else if (reportCategory === 'expense') {
        sheetData = filteredExpense.map(t => ({
          Date: t.date,
          'Voucher Number': t.voucherNumber,
          Category: t.category,
          Description: t.description,
          Amount: t.amount,
          'Payment Mode': t.paymentMode,
          Reference: t.referenceNumber || ''
        }));
      } else if (reportCategory === 'inventory') {
        sheetData = filteredInventoryData.map(item => ({
          'Item Code': item.itemCode,
          Item: item.itemName,
          Category: item.category,
          Purchased: item.quantity,
          Allocated: item.allocatedQuantity,
          Available: item.availableQuantity,
          Damaged: item.damagedQuantity,
          Status: item.availableQuantity <= item.minStock ? 'Low Stock' : 'Normal'
        }));
      } else if (reportCategory === 'monthly') {
        if (selectedMonthlyReport) {
          const report = selectedMonthlyReport;
          sheetData = [
            { Metric: 'Total Income', Value: report.totalIncome },
            { Metric: 'Total Expenses', Value: report.totalExpense },
            { Metric: 'Net Balance', Value: report.netProfit },
            { Metric: 'Inventory Purchased', Value: report.inventoryPurchased },
            { Metric: 'Inventory Allocated', Value: report.inventoryAllocated },
            { Metric: 'Remaining Inventory', Value: report.inventoryRemaining },
            { Metric: 'Student Admissions', Value: report.studentAdmissions },
            { Metric: 'Status', Value: report.status },
            { Metric: 'Submitted Date', Value: report.submittedDate },
            { Metric: 'Remarks', Value: report.remarks || '' }
          ];
        } else {
          sheetData = [{ Status: 'No report submitted for this period' }];
        }
      }

      const wb = utils.book_new();
      const ws = utils.json_to_sheet(sheetData);
      utils.book_append_sheet(wb, ws, 'Report Data');
      const fileBranch = branchFilter || myBranchId || 'all';
      writeFile(wb, `${reportCategory}_report_${fileBranch}_${filterYear}_${filterMonth}.xlsx`);
    } catch (e) {
      console.error(e);
      alert('Error exporting Excel');
    }
  };

  // Condition check for Accountant / Admin simplified report page
  if (user?.role === 'accountant' || user?.role === 'admin') {
    return (
      <div className="flex-1 bg-background pb-12">
        <Header title="Simplified Reports" />
        <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
          
          {/* Title and Filters */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border border-border bg-card rounded-2xl p-5 shadow-sm">
            <div>
              <h2 className="text-xl font-bold text-foreground">Operational Financial Reports</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Select filters and report categories below to inspect entries and download files.</p>
            </div>
            
            <div className="flex flex-wrap items-center gap-3">
              {/* Branch Filter (hidden/locked for accountant) */}
              {user?.role !== 'accountant' ? (
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Branch</span>
                  <select
                    value={branchFilter}
                    onChange={(e) => setBranchFilter(e.target.value)}
                    className="rounded-xl border border-input bg-card px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary bg-input-background"
                  >
                    <option value="">All Branches</option>
                    {branches.filter(b => b.status === 'Active').map(b => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Branch Scope</span>
                  <span className="text-xs font-semibold px-3 py-2 border border-border rounded-xl bg-secondary/20 text-foreground">
                    {getBranchName(myBranchId)}
                  </span>
                </div>
              )}

              {/* Month Filter */}
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Month</span>
                <select
                  value={filterMonth}
                  onChange={(e) => setFilterMonth(e.target.value)}
                  className="rounded-xl border border-input bg-card px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary bg-input-background"
                >
                  {['01','02','03','04','05','06','07','08','09','10','11','12'].map(m => (
                    <option key={m} value={m}>
                      {new Date(2000, Number(m) - 1).toLocaleString('default', { month: 'long' })}
                    </option>
                  ))}
                </select>
              </div>

              {/* Year Filter */}
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Year</span>
                <select
                  value={filterYear}
                  onChange={(e) => setFilterYear(e.target.value)}
                  className="rounded-xl border border-input bg-card px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary bg-input-background"
                >
                  {['2025', '2026', '2027', '2028'].map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Report Category Select */}
          <div className="flex gap-1 border-b border-border pb-1 shrink-0 overflow-x-auto">
            {[
              { id: 'income', label: 'Income Report' },
              { id: 'expense', label: 'Expense Report' },
              { id: 'inventory', label: 'Inventory Report' },
              { id: 'monthly', label: 'Monthly Financial Report' }
            ].map(cat => (
              <button
                key={cat.id}
                onClick={() => setReportCategory(cat.id as any)}
                className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all whitespace-nowrap ${
                  reportCategory === cat.id
                    ? 'bg-primary text-primary-foreground shadow-md'
                    : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Export Buttons */}
          <div className="flex justify-end gap-2">
            <button
              onClick={handleExportCategoryToPdf}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl border border-border bg-card hover:bg-secondary transition-colors"
            >
              <FileText className="h-4 w-4 text-red-500" /> Export PDF
            </button>
            <button
              onClick={handleExportCategoryToExcel}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl border border-border bg-card hover:bg-secondary transition-colors"
            >
              <FileSpreadsheet className="h-4 w-4 text-emerald-600" /> Export Excel
            </button>
          </div>

          {/* Report Category Content Table */}
          <div className="border border-border bg-card rounded-2xl shadow-sm overflow-hidden">
            {reportCategory === 'income' && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse min-w-[700px]">
                  <thead>
                    <tr className="bg-secondary/40 border-b border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground font-sans">
                      <th className="px-6 py-3">Date</th>
                      <th className="px-6 py-3">Voucher Number</th>
                      <th className="px-6 py-3">Description</th>
                      <th className="px-6 py-3">Category</th>
                      <th className="px-6 py-3 text-right">Amount</th>
                      <th className="px-6 py-3">Attachment</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {filteredIncome.map(t => (
                      <tr key={t.id} className="hover:bg-secondary/10 transition-colors">
                        <td className="px-6 py-3 font-mono text-xs whitespace-nowrap">{t.date}</td>
                        <td className="px-6 py-3 font-semibold text-foreground font-mono text-xs">{t.voucherNumber}</td>
                        <td className="px-6 py-3 max-w-[250px] truncate text-muted-foreground" title={t.description}>{t.description}</td>
                        <td className="px-6 py-3 text-xs text-muted-foreground">{t.category}</td>
                        <td className="px-6 py-3 text-right font-bold text-green-600">{formatIndianCurrency(t.amount)}</td>
                        <td className="px-6 py-3">
                          {t.attachmentPath ? (
                            <a href={`${t.attachmentPath}`} target="_blank" rel="noopener noreferrer" className="text-xs text-primary font-semibold hover:underline">
                              {t.attachmentName || 'View Bill'}
                            </a>
                          ) : (
                            <span className="text-xs text-muted-foreground italic">None</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {filteredIncome.length === 0 && (
                      <tr>
                        <td colSpan={6} className="text-center py-12 text-muted-foreground">No income transactions found for this period.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {reportCategory === 'expense' && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse min-w-[700px]">
                  <thead>
                    <tr className="bg-secondary/40 border-b border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground font-sans">
                      <th className="px-6 py-3">Date</th>
                      <th className="px-6 py-3">Voucher Number</th>
                      <th className="px-6 py-3">Description</th>
                      <th className="px-6 py-3">Category</th>
                      <th className="px-6 py-3 text-right">Amount</th>
                      <th className="px-6 py-3">Attachment</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {filteredExpense.map(t => (
                      <tr key={t.id} className="hover:bg-secondary/10 transition-colors">
                        <td className="px-6 py-3 font-mono text-xs whitespace-nowrap">{t.date}</td>
                        <td className="px-6 py-3 font-semibold text-foreground font-mono text-xs">{t.voucherNumber}</td>
                        <td className="px-6 py-3 max-w-[250px] truncate text-muted-foreground" title={t.description}>{t.description}</td>
                        <td className="px-6 py-3 text-xs text-muted-foreground">{t.category}</td>
                        <td className="px-6 py-3 text-right font-bold text-red-500">{formatIndianCurrency(t.amount)}</td>
                        <td className="px-6 py-3">
                          {t.attachmentPath ? (
                            <a href={`${t.attachmentPath}`} target="_blank" rel="noopener noreferrer" className="text-xs text-primary font-semibold hover:underline">
                              {t.attachmentName || 'View Bill'}
                            </a>
                          ) : (
                            <span className="text-xs text-muted-foreground italic">None</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {filteredExpense.length === 0 && (
                      <tr>
                        <td colSpan={6} className="text-center py-12 text-muted-foreground">No expense transactions found for this period.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {reportCategory === 'inventory' && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse min-w-[700px]">
                  <thead>
                    <tr className="bg-secondary/40 border-b border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground font-sans">
                      <th className="px-6 py-3">Item Name</th>
                      <th className="px-6 py-3">Total Purchased</th>
                      <th className="px-6 py-3">Allocated</th>
                      <th className="px-6 py-3">Available</th>
                      <th className="px-6 py-3 text-center">Low Stock Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {inventory.map(item => (
                      <tr key={item.id} className="hover:bg-secondary/10 transition-colors">
                        <td className="px-6 py-3 font-semibold text-foreground">
                          {item.itemName}
                          <span className="ml-1.5 font-mono text-xs text-muted-foreground">({item.itemCode})</span>
                        </td>
                        <td className="px-6 py-3 text-muted-foreground">{item.quantity} {item.unit}</td>
                        <td className="px-6 py-3 text-amber-600 font-semibold">{item.allocatedQuantity}</td>
                        <td className="px-6 py-3 text-emerald-600 font-semibold">{item.availableQuantity}</td>
                        <td className="px-6 py-3 text-center">
                          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                            item.availableQuantity <= item.minStock
                              ? 'bg-red-50 text-red-700 dark:bg-red-950/20 dark:text-red-400'
                              : 'bg-green-50 text-green-700 dark:bg-green-950/20 dark:text-green-400'
                          }`}>
                            {item.availableQuantity <= item.minStock ? 'Low Stock' : 'Normal'}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {inventory.length === 0 && (
                      <tr>
                        <td colSpan={5} className="text-center py-12 text-muted-foreground">No inventory items found.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {reportCategory === 'monthly' && (
              <div className="p-6 space-y-6">
                {selectedMonthlyReport ? (
                  <div className="space-y-6">
                    {/* Status Banner */}
                    <div className={`p-4 rounded-xl flex items-center gap-3 border ${
                      selectedMonthlyReport.status === 'Approved' ? 'bg-green-50 border-green-200 text-green-700 dark:bg-green-950/20 dark:text-green-400' :
                      selectedMonthlyReport.status === 'Returned' ? 'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400' :
                      'bg-sky-50 border-sky-200 text-sky-700 dark:bg-sky-950/20 dark:text-sky-400'
                    }`}>
                      <CheckCircle className="h-5 w-5 shrink-0" />
                      <div className="text-sm">
                        <span className="font-bold">Status: {selectedMonthlyReport.status}</span>
                        <p className="text-xs mt-0.5">Submitted on {selectedMonthlyReport.submittedDate} by {selectedMonthlyReport.submittedBy}</p>
                      </div>
                    </div>

                    {/* Summary Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                      {[
                        { label: 'Total Income', value: formatIndianCurrency(selectedMonthlyReport.totalIncome) },
                        { label: 'Total Expenses', value: formatIndianCurrency(selectedMonthlyReport.totalExpense) },
                        { label: 'Net Balance', value: formatIndianCurrency(selectedMonthlyReport.netProfit), highlight: true },
                        { label: 'Inventory Purchased', value: `${selectedMonthlyReport.inventoryPurchased} items` },
                        { label: 'Inventory Allocated', value: `${selectedMonthlyReport.inventoryAllocated} items` },
                        { label: 'Remaining Inventory', value: `${selectedMonthlyReport.inventoryRemaining} items` },
                        { label: 'Student Admissions', value: `${selectedMonthlyReport.studentAdmissions} enrolled` },
                        { label: 'Pending Allocations', value: `${pendingAllocationCount} waiting` }
                      ].map(metric => (
                        <div key={metric.label} className="p-4 border border-border bg-secondary/10 rounded-xl space-y-1">
                          <span className="text-xs text-muted-foreground font-medium">{metric.label}</span>
                          <p className={`text-lg font-bold ${metric.highlight ? 'text-primary' : 'text-foreground'}`}>{metric.value}</p>
                        </div>
                      ))}
                    </div>

                    {/* Comments Block */}
                    <div className="border border-border rounded-xl p-4 space-y-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Accountant Remarks & Comments</span>
                      <p className="text-sm text-foreground bg-secondary/5 p-3 rounded-lg border border-border/45 whitespace-pre-wrap">
                        {selectedMonthlyReport.comments || 'No comment notes registered.'}
                      </p>
                      {selectedMonthlyReport.remarks && (
                        <div className="pt-2 border-t border-border mt-2">
                          <span className="text-[11px] font-bold text-amber-600 font-sans">Super Admin Feedback:</span>
                          <p className="text-xs text-muted-foreground mt-0.5">{selectedMonthlyReport.remarks}</p>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-12 space-y-4">
                    <p className="text-sm text-muted-foreground">No monthly financial report has been compiled or submitted for {filterMonth}/{filterYear}.</p>
                    {user?.role === 'accountant' && (
                      <button
                        onClick={() => window.location.href = '/accountant?tab=reports'}
                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground font-bold rounded-xl text-xs hover:opacity-90 active:scale-95 shadow-sm font-sans"
                      >
                        <Plus className="h-4 w-4" /> Go Compile & Submit Report
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

        </div>
      </div>
    );
  }

  return (
    <div className="flex-1">
      <Header title="Reports & Analytics" />
      <div id="reports-export-root" className="p-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Comprehensive analytics across all modules</p>
            <p className="text-sm font-medium text-foreground">Viewing scope: {activeBranchLabel}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {user?.role === 'super_admin' && (
              <select
                value={branchFilter}
                onChange={(event) => setBranchFilter(event.target.value)}
                className="rounded-lg border border-input bg-card px-3 py-2 text-sm focus:border-primary focus:outline-none"
              >
                <option value="">All Branches</option>
                {branches.filter((branch) => branch.status === 'Active').map((branch) => (
                  <option key={branch.id} value={branch.id}>{branch.name}</option>
                ))}
              </select>
            )}
            <button
              onClick={exportPdf}
              disabled={isGeneratingPdf || isGeneratingExcel || !reportData.summaryCards.length}
              className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isGeneratingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              Download PDF
            </button>
            <button
              onClick={exportExcel}
              disabled={isGeneratingPdf || isGeneratingExcel || !reportData.summaryCards.length}
              className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isGeneratingExcel ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
              Download Excel
            </button>
          </div>
        </div>

        {statusMessage && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
            {statusMessage}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {reportData.summaryCards.map((card) => (
            <div key={card.label} className="rounded-xl border border-border bg-card p-4">
              <p className="text-sm text-muted-foreground">{card.label}</p>
              <p className="mt-2 text-2xl font-semibold text-foreground">{card.value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{card.note}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-border bg-card p-6">
            <div className="mb-4 flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              <h3 className="font-semibold text-card-foreground">Monthly Revenue</h3>
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" stroke="var(--muted-foreground)" fontSize={12} />
                <YAxis stroke="var(--muted-foreground)" fontSize={12} />
                <Tooltip contentStyle={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', borderRadius: '0.5rem', color: 'var(--card-foreground)' }} />
                <Bar dataKey="revenue" fill="var(--chart-1)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <p className="mt-4 text-sm text-muted-foreground">{reportData.charts.find((chart) => chart.title === 'Monthly Revenue')?.insight}</p>
          </div>

          <div className="rounded-xl border border-border bg-card p-6">
            <div className="mb-4 flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-accent" />
              <h3 className="font-semibold text-card-foreground">Student Enrollment Trend</h3>
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" stroke="var(--muted-foreground)" fontSize={12} />
                <YAxis stroke="var(--muted-foreground)" fontSize={12} />
                <Tooltip contentStyle={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', borderRadius: '0.5rem', color: 'var(--card-foreground)' }} />
                <Line type="monotone" dataKey="students" stroke="var(--chart-2)" strokeWidth={2} dot={{ fill: 'var(--chart-2)' }} />
              </LineChart>
            </ResponsiveContainer>
            <p className="mt-4 text-sm text-muted-foreground">{reportData.charts.find((chart) => chart.title === 'Student Enrollment Trend')?.insight}</p>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="mb-3 font-semibold text-card-foreground">Executive Summary</h3>
          <p className="text-sm text-muted-foreground">{reportData.executiveSummary}</p>
          <div className="mt-4">
            <h4 className="mb-2 text-sm font-semibold text-foreground">Recommendations</h4>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {reportData.recommendations.map((recommendation) => (
                <li key={recommendation}>{recommendation}</li>
              ))}
            </ul>
          </div>
        </div>

        {/* Accountant Monthly Financial Reports section */}
        {user?.role === 'super_admin' && (
          <div className="rounded-xl border border-border bg-card p-6">
            <div className="flex items-center gap-3 border-b border-border pb-3 mb-4">
              <FileText className="h-5 w-5 text-primary" />
              <div>
                <h3 className="font-semibold text-card-foreground">Accountant Monthly Financial & Inventory Reports</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Approve, return for correction, or download financial summaries submitted by accountants.</p>
              </div>
            </div>

            {submittedReports.length === 0 ? (
              <div className="text-center py-6 text-sm text-muted-foreground">No monthly financial reports have been submitted yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      <th className="pb-3 pr-4">Month</th>
                      <th className="pb-3 px-4">Branch</th>
                      <th className="pb-3 px-4 text-right">Income</th>
                      <th className="pb-3 px-4 text-right">Expense</th>
                      <th className="pb-3 px-4 text-right">Net Profit</th>
                      <th className="pb-3 px-4 text-center">Status</th>
                      <th className="pb-3 px-4">Submitted By</th>
                      <th className="pb-3 px-4 text-center">Actions</th>
                      <th className="pb-3 pl-4 text-center">Export</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {submittedReports.map((report) => (
                      <tr key={report.id} className="hover:bg-secondary/20 transition-colors">
                        <td className="py-3 pr-4 font-semibold text-foreground font-mono">{report.month}</td>
                        <td className="py-3 px-4 text-muted-foreground">{getBranchName(report.branchId) || report.branchId}</td>
                        <td className="py-3 px-4 text-right font-medium text-green-600">{formatIndianCurrency(report.totalIncome)}</td>
                        <td className="py-3 px-4 text-right font-medium text-red-500">{formatIndianCurrency(report.totalExpense)}</td>
                        <td className="py-3 px-4 text-right font-bold text-foreground">{formatIndianCurrency(report.netProfit)}</td>
                        <td className="py-3 px-4 text-center">
                          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                            report.status === 'Approved' ? 'bg-green-50 text-green-700 dark:bg-green-950/20 dark:text-green-400' :
                            report.status === 'Returned' ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400' :
                            'bg-sky-50 text-sky-700 dark:bg-sky-950/20 dark:text-sky-400'
                          }`}>
                            {report.status === 'Returned' ? 'Correction Required' : report.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-xs text-muted-foreground whitespace-nowrap">
                          {report.submittedBy}<br />
                          <span className="text-[10px] text-muted-foreground/80">{report.submittedDate}</span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center justify-center gap-2">
                            {report.status === 'Submitted' && (
                              <>
                                <button
                                  onClick={() => handleApproveReport(report.id)}
                                  className="inline-flex items-center gap-0.5 rounded bg-green-50 hover:bg-green-100 text-green-700 px-2 py-1 text-xs font-semibold"
                                >
                                  <CheckCircle className="h-3 w-3" /> Approve
                                </button>
                                <button
                                  onClick={() => handleReturnReport(report.id)}
                                  className="inline-flex items-center gap-0.5 rounded bg-amber-50 hover:bg-amber-100 text-amber-700 px-2 py-1 text-xs font-semibold"
                                >
                                  <XCircle className="h-3 w-3" /> Return
                                </button>
                              </>
                            )}
                            {report.status !== 'Submitted' && (
                              <span className="text-xs text-muted-foreground italic">Reviewed</span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 pl-4">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => exportMonthlyReportToPdf(report)}
                              className="text-xs text-primary font-semibold hover:underline flex items-center gap-0.5"
                              title="Download PDF"
                            >
                              <FileText className="h-3.5 w-3.5" /> PDF
                            </button>
                            <span className="text-muted-foreground/30">|</span>
                            <button
                              onClick={() => exportMonthlyReportToExcel(report)}
                              className="text-xs text-emerald-600 font-semibold hover:underline flex items-center gap-0.5"
                              title="Download Excel"
                            >
                              <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* WhatsApp logs table */}
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-center gap-3 border-b border-border pb-3 mb-4">
            <MessageSquare className="h-5 w-5 text-emerald-500" />
            <div>
              <h3 className="font-semibold text-card-foreground">Attendance WhatsApp Delivery Tracking Logs</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Real-time status tracking for parent notifications triggered by teachers.</p>
            </div>
          </div>

          {whatsappLogs.length === 0 ? (
            <div className="text-center py-6 text-sm text-muted-foreground">No WhatsApp alerts have been logged for this branch scope.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <th className="pb-3 pr-4">Student</th>
                    <th className="pb-3 px-4">Branch</th>
                    <th className="pb-3 px-4">Parent Name</th>
                    <th className="pb-3 px-4">Parent Mobile</th>
                    <th className="pb-3 px-4">Date</th>
                    <th className="pb-3 px-4">Status</th>
                    <th className="pb-3 px-4">Teacher</th>
                    <th className="pb-3 pl-4">Retries</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {whatsappLogs.slice(0, 10).map((log) => (
                    <tr key={log.id} className="hover:bg-secondary/20">
                      <td className="py-3 pr-4 font-semibold text-foreground">
                        {log.studentName}
                        <span className="ml-1.5 text-xs text-muted-foreground">({log.studentId})</span>
                      </td>
                      <td className="py-3 px-4 text-muted-foreground">{getBranchName(log.branchId) || 'Rajajinagar'}</td>
                      <td className="py-3 px-4 text-muted-foreground">{log.parentName}</td>
                      <td className="py-3 px-4 text-foreground">{log.mobile}</td>
                      <td className="py-3 px-4 text-muted-foreground">{log.attendanceDate}</td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          log.status === 'Delivered' || log.status === 'Read'
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
                            : log.status === 'Failed'
                            ? 'bg-red-100 text-red-700 dark:bg-red-950/20 dark:text-red-400'
                            : 'bg-amber-100 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400'
                        }`}>
                          {log.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-muted-foreground font-semibold">{log.teacher || 'Teacher'}</td>
                      <td className="py-3 pl-4 text-muted-foreground">{log.retryCount || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
