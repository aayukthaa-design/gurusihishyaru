import { useEffect, useMemo, useState } from 'react';
import { Header } from '../components/Header';
import { useAuth } from '../auth/AuthContext';
import { useTeacherProfiles } from './TeacherManagement';
import { fetchSalaryRecords, type SalaryRecord } from '../lib/teacherSalaryService';
import { generateSalarySlipData } from '../lib/reportExport';
import { formatIndianCurrency } from '../lib/currency';
import { getBranchName } from '../lib/branchService';
import { Download, FileText } from 'lucide-react';

export function TeacherSalarySlips() {
  const { user } = useAuth();
  const teachers = useTeacherProfiles();
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  const [records, setRecords] = useState<SalaryRecord[]>([]);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  useEffect(() => {
    if (!user) return;
    fetchSalaryRecords({ teacherId: user.id, month: selectedMonth }).then(setRecords);
  }, [selectedMonth, user]);

  const selectedTeacher = useMemo(() => {
    return teachers.find((teacher) => teacher.id === user?.id);
  }, [teachers, user]);

  const downloadSlip = async (record: SalaryRecord) => {
    setDownloadingId(record.id);
    try {
      const teacherName = record.teacherName || `${selectedTeacher?.firstName ?? ''} ${selectedTeacher?.lastName ?? ''}`.trim();
      const attendanceStr = `${record.classesConducted} Classes × ₹${record.salaryPerClass} = ${formatIndianCurrency(record.calculatedSalary)}`;
      const base64 = await generateSalarySlipData(
        teacherName,
        record.teacherId,
        getBranchName(record.branchId),
        record.month,
        record.salaryType || 'Per Class',
        `₹${record.salaryPerClass}`,
        attendanceStr,
        formatIndianCurrency(record.calculatedSalary),
        formatIndianCurrency(record.calculatedSalary),
        record.paidBy || 'Accountant'
      );
      if (!base64) {
        alert('Unable to generate salary slip.');
        return;
      }
      const link = document.createElement('a');
      link.href = `data:application/pdf;base64,${base64}`;
      link.download = `Salary_Slip_${teacherName.replace(/\s+/g, '_')}_${record.month}.pdf`;
      link.click();
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="flex-1 bg-background">
      <Header title="My Salary Slips" />
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-xl font-bold text-foreground">My Salary Slip History</h1>
              <p className="mt-1 text-sm text-muted-foreground">Review salary records for the selected month and download your payslip.</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">Month</label>
                <input type="month" className="w-full rounded-xl border border-input bg-input-background px-3 py-2 text-sm" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} />
              </div>
            </div>
          </div>
        </div>

        {records.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-secondary/30 p-8 text-center text-sm text-muted-foreground">
            No salary record found for {selectedMonth}. Ask your accountant if your salary for this month has been processed.
          </div>
        ) : (
          <div className="grid gap-4">
            {records.map((record) => (
              <div key={record.id} className="rounded-2xl border border-border bg-card p-5 shadow-sm flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Month</p>
                  <p className="text-lg font-semibold text-foreground">{record.month}</p>
                  <p className="text-sm text-muted-foreground mt-2">Branch: {getBranchName(record.branchId)}</p>
                  <p className="text-sm text-muted-foreground">Status: <span className={record.status === 'Paid' ? 'text-green-600 font-semibold' : 'text-slate-500 font-semibold'}>{record.status}</span></p>
                  <p className="text-sm text-muted-foreground">Net Salary: {formatIndianCurrency(record.calculatedSalary)}</p>
                  {record.paidDate && <p className="text-sm text-muted-foreground">Paid On: {new Date(record.paidDate).toLocaleString()}</p>}
                </div>
                <button
                  onClick={() => downloadSlip(record)}
                  disabled={downloadingId === record.id}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {downloadingId === record.id ? <FileText className="h-4 w-4 animate-pulse" /> : <Download className="h-4 w-4" />}
                  {downloadingId === record.id ? 'Generating…' : 'Download Slip'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
