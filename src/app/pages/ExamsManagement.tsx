import { Header } from '../components/Header';
import { StatsCard } from '../components/StatsCard';
import { DataTable } from '../components/DataTable';
import { GraduationCap, Award, TrendingUp, BookOpen } from 'lucide-react';
import { subscribeExams } from '../lib/examService';
import { PDFTemplateService } from '../lib/pdfTemplateService';
import { utils, writeFile } from 'xlsx';
import React from 'react';
import { Link } from 'react-router';

interface ExamResult {
  id: number;
  studentName: string;
  studentId: string;
  subject: string;
  maxMarks: number;
  obtained: number;
  grade: string;
  percentage: number;
}

const results: ExamResult[] = [
  { id: 1, studentName: 'Alice Johnson', studentId: 'STU001', subject: 'Mathematics', maxMarks: 100, obtained: 92, grade: 'A+', percentage: 92 },
  { id: 2, studentName: 'Bob Smith', studentId: 'STU002', subject: 'Mathematics', maxMarks: 100, obtained: 78, grade: 'B', percentage: 78 },
  { id: 3, studentName: 'Carol Davis', studentId: 'STU003', subject: 'Mathematics', maxMarks: 100, obtained: 85, grade: 'A', percentage: 85 },
  { id: 4, studentName: 'David Wilson', studentId: 'STU004', subject: 'Mathematics', maxMarks: 100, obtained: 88, grade: 'A', percentage: 88 },
  { id: 5, studentName: 'Emma Brown', studentId: 'STU005', subject: 'Mathematics', maxMarks: 100, obtained: 95, grade: 'A+', percentage: 95 },
];

function ExamsList() {
  const [exams, setExams] = React.useState<any[]>([]);

  React.useEffect(() => {
    const unsub = subscribeExams((items) => setExams(items));
    return unsub;
  }, []);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="rounded-xl border border-border bg-card p-6 transition-colors duration-200">
        <h3 className="mb-4 text-lg font-semibold text-card-foreground">Upcoming Exams</h3>
        <div className="space-y-3">
          {exams.slice(0,6).map((exam) => (
            <div key={exam.id} className="flex items-center justify-between rounded-lg border border-border bg-secondary p-4">
              <div>
                <p className="font-medium text-card-foreground">{exam.name} — {exam.subject}</p>
                <p className="text-xs text-muted-foreground">Date: {exam.date} · {exam.className}</p>
              </div>
              <div className="flex gap-2">
                <span className="text-xs text-muted-foreground">{exam.status === 'attendance_completed' || exam.status === 'marks_entry_open' || exam.status === 'results_published' ? 'Attendance complete' : 'Complete Attendance first'}</span>
                <Link to={`/exams/${exam.id}/marks`} className={`text-xs ${exam.status === 'attendance_completed' || exam.status === 'marks_entry_open' || exam.status === 'results_published' ? 'text-primary' : 'pointer-events-none text-muted-foreground'}`}>
                  {exam.status === 'attendance_completed' || exam.status === 'marks_entry_open' || exam.status === 'results_published' ? 'Enter Marks' : 'Enter Marks'}
                </Link>
              </div>
            </div>
          ))}
          {exams.length === 0 && <p className="text-sm text-muted-foreground">No upcoming exams</p>}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-6 transition-colors duration-200">
        <h3 className="mb-4 text-lg font-semibold text-card-foreground">Grade Distribution</h3>
        <div className="space-y-3">
          {[
            { grade: 'A+', count: 142, percent: 28 },
            { grade: 'A', count: 198, percent: 39 },
            { grade: 'B', count: 124, percent: 25 },
            { grade: 'C', count: 40, percent: 8 },
          ].map((item) => (
            <div key={item.grade}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-card-foreground">Grade {item.grade}</span>
                <span className="text-sm text-muted-foreground">{item.count} students</span>
              </div>
              <div className="h-2 rounded-full bg-secondary">
                <div
                  className="h-2 rounded-full bg-primary"
                  style={{ width: `${item.percent}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ExamsManagement() {
  const columns = [
    { header: 'Student ID', accessor: 'studentId' as const },
    { header: 'Student Name', accessor: 'studentName' as const },
    { header: 'Subject', accessor: 'subject' as const },
    { header: 'Max Marks', accessor: 'maxMarks' as const },
    { header: 'Obtained', accessor: 'obtained' as const },
    {
      header: 'Percentage',
      accessor: (record: ExamResult) => `${record.percentage}%`,
    },
    {
      header: 'Grade',
      accessor: (record: ExamResult) => (
        <span
          className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
            record.percentage >= 90
              ? 'bg-chart-3/10 text-chart-3'
              : record.percentage >= 75
              ? 'bg-primary/10 text-primary'
              : 'bg-chart-4/10 text-chart-4'
          }`}
        >
          {record.grade}
        </span>
      ),
    },
  ];

  const exportResultsToExcel = (rows: ExamResult[]) => {
    const workbook = utils.book_new();
    const sheetData = [
      ['Student ID', 'Student Name', 'Subject', 'Max Marks', 'Obtained', 'Percentage', 'Grade'],
      ...rows.map((row) => [
        row.studentId,
        row.studentName,
        row.subject,
        row.maxMarks,
        row.obtained,
        `${row.percentage}%`,
        row.grade,
      ]),
    ];
    const worksheet = utils.aoa_to_sheet(sheetData);
    utils.book_append_sheet(workbook, worksheet, 'Exam Results');
    writeFile(workbook, 'exam-results.xlsx');
  };

  const exportResultsToPdf = async (rows: ExamResult[]) => {
    const pdfService = new PDFTemplateService();
    pdfService.addTitle('Exam Results');
    
    const headers = ['Student ID', 'Name', 'Subject', 'Max', 'Obtained', 'Percentage', 'Grade'];
    const body = rows.map((row) => [
      row.studentId,
      row.studentName,
      row.subject,
      String(row.maxMarks),
      String(row.obtained),
      `${row.percentage}%`,
      row.grade,
    ]);
    
    pdfService.addTable([headers], body);
    await pdfService.exportWithLetterhead('exam-results.pdf');
  };

  return (
    <div className="flex-1">
      <Header title="Exam & Marks Management" />
      
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <StatsCard
            title="Total Exams"
            value="24"
            change="3 upcoming"
            icon={BookOpen}
            iconColor="bg-primary"
          />
          <StatsCard
            title="Avg Score"
            value="87.6%"
            change="+3.2% from last term"
            changeType="positive"
            icon={TrendingUp}
            iconColor="bg-chart-3"
          />
          <StatsCard
            title="Top Performers"
            value="142"
            change="Above 90%"
            changeType="positive"
            icon={Award}
            iconColor="bg-accent"
          />
          <StatsCard
            title="Pass Rate"
            value="96.8%"
            change="+2.1% improvement"
            changeType="positive"
            icon={GraduationCap}
            iconColor="bg-chart-2"
          />
        </div>

        <ExamsList />

        <div>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-foreground">Mathematics - Mid-Term Results</h3>
            <div className="flex gap-2">
              <button
                onClick={() => exportResultsToPdf(results)}
                className="rounded-lg border border-border bg-card px-4 py-2 text-sm text-primary transition-all hover:bg-secondary"
              >
                Export PDF
              </button>
              <button
                onClick={() => exportResultsToExcel(results)}
                className="rounded-lg border border-border bg-card px-4 py-2 text-sm text-primary transition-all hover:bg-secondary"
              >
                Export Excel
              </button>
            </div>
          </div>
          <DataTable columns={columns} data={results} />
        </div>
      </div>
    </div>
  );
}
