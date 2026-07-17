import { Header } from '../components/Header';
import { StatsCard } from '../components/StatsCard';
import { DataTable } from '../components/DataTable';
import { GraduationCap, Award, TrendingUp, BookOpen } from 'lucide-react';
import { subscribeExams, Exam } from '../lib/examService';
import { subscribeMarks, refreshMarks, MarkRecord } from '../lib/examMarksService';
import { PDFTemplateService } from '../lib/pdfTemplateService';
import { utils, writeFile } from 'xlsx';
import React from 'react';
import { Link } from 'react-router';

interface ExamResult {
  id: string;
  studentName: string;
  studentId: string;
  subject: string;
  maxMarks: number;
  obtained: number;
  grade: string;
  percentage: number;
}

const GRADE_BUCKETS = ['A+', 'A', 'B', 'C', 'D', 'F'];

function ExamsList() {
  const [exams, setExams] = React.useState<any[]>([]);
  const [marks, setMarks] = React.useState<MarkRecord[]>([]);

  React.useEffect(() => {
    const unsub = subscribeExams((items) => setExams(items));
    const unsubMarks = subscribeMarks((items) => setMarks(items));
    return () => { unsub(); unsubMarks(); };
  }, []);

  const gradeDistribution = React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (const m of marks) counts[m.grade] = (counts[m.grade] || 0) + 1;
    const total = marks.length || 1;
    return GRADE_BUCKETS
      .filter((g) => counts[g] > 0)
      .map((grade) => ({ grade, count: counts[grade], percent: Math.round((counts[grade] / total) * 100) }));
  }, [marks]);

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
          {gradeDistribution.length === 0 && <p className="text-sm text-muted-foreground">No marks entered yet</p>}
          {gradeDistribution.map((item) => (
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
  const [exams, setExams] = React.useState<Exam[]>([]);
  const [marks, setMarks] = React.useState<MarkRecord[]>([]);
  const [selectedExamId, setSelectedExamId] = React.useState<string>('');

  React.useEffect(() => {
    const unsub = subscribeExams((items) => setExams(items));
    const unsubMarks = subscribeMarks((items) => setMarks(items));
    refreshMarks();
    return () => { unsub(); unsubMarks(); };
  }, []);

  React.useEffect(() => {
    if (!selectedExamId && exams.length > 0) {
      const sorted = [...exams].sort((a, b) => String(b.date).localeCompare(String(a.date)));
      setSelectedExamId(String(sorted[0].id));
    }
  }, [exams, selectedExamId]);

  const selectedExam = exams.find((e) => String(e.id) === selectedExamId);

  const results: ExamResult[] = React.useMemo(() => {
    return marks
      .filter((m) => m.examId === selectedExamId)
      .map((m) => ({
        id: `${m.examId}-${m.studentId}`,
        studentId: m.studentId,
        studentName: m.studentName,
        subject: selectedExam?.subject || '',
        maxMarks: selectedExam?.maxMarks || 100,
        obtained: m.marksObtained,
        grade: m.grade,
        percentage: Math.round(m.percentage),
      }));
  }, [marks, selectedExamId, selectedExam]);

  const stats = React.useMemo(() => {
    const totalExams = exams.length;
    const avgScore = marks.length > 0 ? Math.round((marks.reduce((sum, m) => sum + m.percentage, 0) / marks.length) * 10) / 10 : 0;
    const topPerformers = marks.filter((m) => m.percentage >= 90).length;
    const passRate = marks.length > 0 ? Math.round((marks.filter((m) => m.pass).length / marks.length) * 1000) / 10 : 0;
    return { totalExams, avgScore, topPerformers, passRate };
  }, [exams, marks]);

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
            value={String(stats.totalExams)}
            icon={BookOpen}
            iconColor="bg-primary"
          />
          <StatsCard
            title="Avg Score"
            value={`${stats.avgScore}%`}
            icon={TrendingUp}
            iconColor="bg-chart-3"
          />
          <StatsCard
            title="Top Performers"
            value={String(stats.topPerformers)}
            change="Above 90%"
            changeType="positive"
            icon={Award}
            iconColor="bg-accent"
          />
          <StatsCard
            title="Pass Rate"
            value={`${stats.passRate}%`}
            icon={GraduationCap}
            iconColor="bg-chart-2"
          />
        </div>

        <ExamsList />

        <div>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h3 className="text-lg font-semibold text-foreground">Results</h3>
              <select
                value={selectedExamId}
                onChange={(e) => setSelectedExamId(e.target.value)}
                className="rounded-lg border border-input bg-input-background px-3 py-1.5 text-sm focus:outline-none focus:border-primary"
              >
                {exams.length === 0 && <option value="">No exams yet</option>}
                {[...exams].sort((a, b) => String(b.date).localeCompare(String(a.date))).map((exam) => (
                  <option key={exam.id} value={String(exam.id)}>{exam.name} — {exam.subject} ({exam.className})</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => exportResultsToPdf(results)}
                disabled={results.length === 0}
                className="rounded-lg border border-border bg-card px-4 py-2 text-sm text-primary transition-all hover:bg-secondary disabled:opacity-40"
              >
                Export PDF
              </button>
              <button
                onClick={() => exportResultsToExcel(results)}
                disabled={results.length === 0}
                className="rounded-lg border border-border bg-card px-4 py-2 text-sm text-primary transition-all hover:bg-secondary disabled:opacity-40"
              >
                Export Excel
              </button>
            </div>
          </div>
          {results.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center rounded-xl border border-border bg-card">
              {selectedExamId ? 'No marks entered for this exam yet.' : 'No exams available.'}
            </p>
          ) : (
            <DataTable columns={columns} data={results} />
          )}
        </div>
      </div>
    </div>
  );
}
