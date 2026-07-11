import { useEffect, useMemo, useState } from 'react';
import { Header } from '../components/Header';
import { GreetingBanner } from '../components/GreetingBanner';
import { DataTable } from '../components/DataTable';
import { useAuth } from '../auth/AuthContext';
import { subscribeExams } from '../lib/examService';
import { getMarksForExam, subscribeMarks } from '../lib/examMarksService';
import { getTeacherExamAttendanceDashboard, subscribeExamAttendance } from '../lib/examAttendanceService';
import { PDFTemplateService } from '../lib/pdfTemplateService';
import { utils, writeFile } from 'xlsx';
import { BarChart3, PieChart } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Pie, Cell } from 'recharts';

const GRADE_COLORS: Record<string, string> = {
  'A+': '#10b981',
  A: '#3b82f6',
  B: '#8b5cf6',
  C: '#f59e0b',
  D: '#f97316',
  F: '#ef4444',
};

export function TeacherScoreboard() {
  const { user } = useAuth();
  const [exams, setExams] = useState<any[]>([]);
  const [selectedExamId, setSelectedExamId] = useState('');
  const [marksVersion, setMarksVersion] = useState(0);
  const [attendanceVersion, setAttendanceVersion] = useState(0);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribeExams = subscribeExams((items) => setExams(items));
    const unsubscribeMarks = subscribeMarks(() => setMarksVersion((value) => value + 1));
    const unsubscribeAttendance = subscribeExamAttendance(() => setAttendanceVersion((value) => value + 1));

    return () => {
      unsubscribeExams();
      unsubscribeMarks();
      unsubscribeAttendance();
    };
  }, []);

  const dashboard = getTeacherExamAttendanceDashboard(user, exams, []);
  void attendanceVersion;

  const visibleExams = useMemo(() => {
    if (!user) return [];
    if (user.role === 'teacher') {
      return exams.filter((exam) => exam.teacherId === user.id);
    }
    return exams;
  }, [exams, user]);

  useEffect(() => {
    if (!selectedExamId && visibleExams.length > 0) {
      setSelectedExamId(visibleExams[0].id);
    }
  }, [selectedExamId, visibleExams]);

  const selectedExam = useMemo(
    () => visibleExams.find((exam) => exam.id === selectedExamId) ?? visibleExams[0] ?? null,
    [selectedExamId, visibleExams],
  );

  const examMarks = useMemo(() => {
    if (!selectedExam) return [];
    return getMarksForExam(selectedExam.id);
  }, [selectedExam, marksVersion]);

  const rankedMarks = useMemo(() => {
    return [...examMarks]
      .sort((a, b) => {
        if (b.percentage !== a.percentage) return b.percentage - a.percentage;
        return b.marksObtained - a.marksObtained;
      })
      .map((record, index) => ({
        ...record,
        rank: index + 1,
      }));
  }, [examMarks]);

  const gradeDistribution = useMemo(() => {
    const gradeMap = rankedMarks.reduce((acc: Record<string, number>, record) => {
      acc[record.grade] = (acc[record.grade] ?? 0) + 1;
      return acc;
    }, {});
    return Object.entries(gradeMap).map(([grade, value]) => ({ name: grade, value }));
  }, [rankedMarks]);

  const examSummary = useMemo(() => {
    const total = rankedMarks.length;
    const averageScore = total
      ? Number((rankedMarks.reduce((sum, record) => sum + record.marksObtained, 0) / total).toFixed(1))
      : 0;
    const passCount = rankedMarks.filter((record) => record.pass).length;
    return {
      total,
      averageScore,
      passRate: total ? Math.round((passCount / total) * 100) : 0,
      highestScore: rankedMarks[0]?.marksObtained ?? 0,
      lowestScore: rankedMarks.at(-1)?.marksObtained ?? 0,
      topPerformers: rankedMarks.slice(0, 3),
    };
  }, [rankedMarks]);

  const exportScoreboardToExcel = () => {
    if (!selectedExam) {
      setStatusMessage('Select an exam before exporting.');
      return;
    }

    setIsExportingExcel(true);
    setStatusMessage('Preparing Excel export...');

    try {
      const workbook = utils.book_new();
      const rows = [
        ['Class Scoreboard', selectedExam.name],
        ['Class', `${selectedExam.className}`],
        ['Subject', `${selectedExam.subject}`],
        [],
        ['Rank', 'Student', 'Roll', 'Marks', 'Passing Marks', 'Percentage', 'Grade', 'Result'],
        ...rankedMarks.map((record) => [
          record.rank,
          record.studentName,
          record.rollNumber,
          record.marksObtained,
          selectedExam.passingMarks ?? 35,
          record.percentage.toFixed(1),
          record.grade,
          record.pass ? '✅ Pass' : '❌ Fail',
        ]),
      ];

      const sheet = utils.aoa_to_sheet(rows);
      utils.book_append_sheet(workbook, sheet, 'Scoreboard');
      writeFile(workbook, `teacher-scoreboard-${selectedExam.id}.xlsx`);
      setStatusMessage('Scoreboard Excel export downloaded.');
    } catch (error) {
      setStatusMessage('Unable to generate Excel export.');
    } finally {
      setIsExportingExcel(false);
    }
  };

  const exportScoreboardToPdf = async () => {
    if (!selectedExam) {
      setStatusMessage('Select an exam before exporting.');
      return;
    }

    setIsExportingPdf(true);
    setStatusMessage('Preparing PDF export...');

    try {
      const pdfService = new PDFTemplateService();
      pdfService.addTitle(`Exam Scoreboard Report — ${selectedExam.name}`);

      pdfService.addSectionHeading('Exam Details & Specifications');
      const details = [
        ['Exam Name', selectedExam.name, 'Subject', selectedExam.subject],
        ['Class', selectedExam.className, 'Branch', getBranchName(user?.branchId || '') || 'All Branches'],
        ['Maximum Marks', String(selectedExam.maxMarks), 'Passing Marks', String(selectedExam.passingMarks ?? 35)],
        ['Teacher', selectedExam.teacherName, '', '']
      ];
      pdfService.addTable([['Detail', 'Value', 'Detail', 'Value']], details);

      pdfService.addSectionHeading('Overall Summary');
      const totalStudents = examSummary.total;
      const passedCount = rankedMarks.filter((r) => r.pass).length;
      const failedCount = totalStudents - passedCount;
      const passRate = examSummary.passRate;
      const failRate = 100 - passRate;

      const summaryDetails = [
        ['Students Appeared', String(totalStudents)],
        ['Students Passed', String(passedCount)],
        ['Students Failed', String(failedCount)],
        ['Pass Percentage', `${passRate}%`],
        ['Fail Percentage', `${failRate}%`],
      ];
      pdfService.addTable([['Metric', 'Value']], summaryDetails);

      pdfService.addSectionHeading('Student Results Table');
      const headers = ['Student Name', 'Marks Obtained', 'Passing Marks', 'Percentage', 'Grade', 'Result'];
      const body = rankedMarks.map((record) => [
        record.studentName,
        String(record.marksObtained),
        String(selectedExam.passingMarks ?? 35),
        `${record.percentage.toFixed(1)}%`,
        record.grade,
        record.pass ? 'PASS' : 'FAIL',
      ]);
      pdfService.addTable([headers], body);

      await pdfService.exportWithLetterhead(`teacher-scoreboard-${selectedExam.id}.pdf`);
      setStatusMessage('Scoreboard PDF exported successfully.');
    } catch (error) {
      console.error(error);
      setStatusMessage('Unable to generate PDF export.');
    } finally {
      setIsExportingPdf(false);
    }
  };

  return (
    <div className="flex-1 bg-background">
      <Header title="Teacher Scoreboard" />
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <GreetingBanner name={user?.name ?? 'Teacher'} subtitle="Class Scoreboard and export center" />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card p-6">
            <h2 className="text-lg font-semibold text-foreground">Scoreboard Overview</h2>
            <p className="mt-2 text-sm text-muted-foreground">Choose a class exam to view ranked results, grade distribution, and export the scoreboard for your classroom.</p>
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-sm font-medium text-foreground">Select exam</label>
                <select
                  value={selectedExam?.id ?? ''}
                  onChange={(event) => setSelectedExamId(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                >
                  {visibleExams.length === 0 ? (
                    <option value="">No exams available</option>
                  ) : (
                    visibleExams.map((exam) => (
                      <option key={exam.id} value={exam.id}>
                        {exam.name} — {exam.className}
                      </option>
                    ))
                  )}
                </select>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={exportScoreboardToPdf}
                  disabled={!selectedExam || isExportingPdf}
                  className="rounded-lg border border-border bg-card px-4 py-2 text-sm text-primary transition hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isExportingPdf ? 'Exporting PDF…' : 'Export PDF'}
                </button>
                <button
                  onClick={exportScoreboardToExcel}
                  disabled={!selectedExam || isExportingExcel}
                  className="rounded-lg border border-border bg-card px-4 py-2 text-sm text-primary transition hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isExportingExcel ? 'Exporting Excel…' : 'Export Excel'}
                </button>
              </div>
              {statusMessage && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  {statusMessage}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-6">
            <h2 className="text-lg font-semibold text-foreground">Exam Metrics</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-border bg-secondary/40 p-4">
                <p className="text-xs text-muted-foreground">Total Students</p>
                <p className="mt-2 text-3xl font-semibold text-foreground">{examSummary.total}</p>
              </div>
              <div className="rounded-2xl border border-border bg-secondary/40 p-4">
                <p className="text-xs text-muted-foreground">Average Score</p>
                <p className="mt-2 text-3xl font-semibold text-foreground">{examSummary.averageScore}%</p>
              </div>
              <div className="rounded-2xl border border-border bg-secondary/40 p-4">
                <p className="text-xs text-muted-foreground">Pass Rate</p>
                <p className="mt-2 text-3xl font-semibold text-foreground">{examSummary.passRate}%</p>
              </div>
              <div className="rounded-2xl border border-border bg-secondary/40 p-4">
                <p className="text-xs text-muted-foreground">Top Score</p>
                <p className="mt-2 text-3xl font-semibold text-foreground">{examSummary.highestScore}</p>
              </div>
            </div>
          </div>
        </div>

        {selectedExam ? (
          <div className="grid gap-6 xl:grid-cols-[1.4fr_0.8fr]">
            <div className="rounded-2xl border border-border bg-card p-6">
              <div className="mb-4 flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-primary" />
                <h3 className="font-semibold text-card-foreground">Ranked Student Scoreboard</h3>
              </div>
              {examSummary.total === 0 ? (
                <div className="rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">
                  No marks have been submitted for this exam yet. After scores are entered, the scoreboard will update automatically.
                </div>
              ) : (
                <DataTable
                  columns={[
                    { header: 'Rank', accessor: 'rank' },
                    { header: 'Student', accessor: 'studentName' },
                    { header: 'Roll', accessor: 'rollNumber' },
                    { header: 'Marks', accessor: 'marksObtained' },
                    { header: 'Passing Marks', accessor: () => selectedExam?.passingMarks ?? 35 },
                    { header: '%', accessor: 'percentage' },
                    { header: 'Grade', accessor: 'grade' },
                    { header: 'Result', accessor: (item) => (item.pass ? '✅ Pass' : '❌ Fail') },
                  ]}
                  data={rankedMarks.map((record) => ({ id: `${selectedExam.id}-${record.studentId}`, ...record }))}
                />
              )}
            </div>

            <div className="rounded-2xl border border-border bg-card p-6">
              <div className="mb-4 flex items-center gap-2">
                <PieChart className="h-5 w-5 text-accent" />
                <h3 className="font-semibold text-card-foreground">Grade Distribution</h3>
              </div>
              {gradeDistribution.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">
                  Grade distribution will appear once marks are recorded for this exam.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={gradeDistribution}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis allowDecimals={false} />
                    <Tooltip formatter={(value: number) => `${value} students`} />
                    <Bar dataKey="value" fill="#3b82f6">
                      {gradeDistribution.map((entry) => (
                        <Cell key={entry.name} fill={GRADE_COLORS[entry.name] ?? '#64748b'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
              <div className="mt-4 space-y-2 text-sm text-muted-foreground">
                <div>Lowest score: <span className="font-semibold text-foreground">{examSummary.lowestScore}</span></div>
                <div>Top performers: <span className="font-semibold text-foreground">{examSummary.topPerformers.map((item) => item.studentName).join(', ') || 'N/A'}</span></div>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border bg-muted p-6 text-sm text-muted-foreground">
            No exams are available for your scoreboard yet. Create an exam or request marks entry to view the class scoreboard.
          </div>
        )}
      </div>
    </div>
  );
}
