import { useEffect, useMemo, useState } from 'react';
import { Header } from '../components/Header';
import { GreetingBanner } from '../components/GreetingBanner';
import { DataTable } from '../components/DataTable';
import { useAuth } from '../auth/AuthContext';
import { getBranches, getBranchName } from '../lib/branchService';
import { subscribeExams } from '../lib/examService';
import { subscribeMarks } from '../lib/examMarksService';
import { getStudentsForClass } from '../lib/studentService';
import { PDFTemplateService } from '../lib/pdfTemplateService';
import {
  BarChart3,
  PieChart as PieIcon,
  TrendingUp,
  Download,
  AlertTriangle,
  Award,
  Layers,
  Calendar,
  Filter,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';

interface JoinedRecord {
  id: string;
  studentId: string;
  studentName: string;
  rollNumber: string;
  admissionNumber: string;
  branchId: string;
  branchName: string;
  className: string;
  batch: string;
  subject: string;
  examId: string;
  examName: string;
  examDate: string;
  maxMarks: number;
  marksObtained: number;
  percentage: number;
  grade: string;
  pass: boolean;
}

export function StudentPerformanceAnalytics() {
  const { user } = useAuth();
  const [exams, setExams] = useState<any[]>([]);
  const [marks, setMarks] = useState<any[]>([]);
  const [examsVersion, setExamsVersion] = useState(0);
  const [marksVersion, setMarksVersion] = useState(0);

  // Filters State
  const [academicYear, setAcademicYear] = useState('2025-2026');
  const [branchSelection, setBranchSelection] = useState('all');
  const [classSelection, setClassSelection] = useState('all');
  const [batchSelection, setBatchSelection] = useState('all');
  const [subjectSelection, setSubjectSelection] = useState('all');
  const [examSelection, setExamSelection] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Branches to compare (when compare mode is selected)
  const [branchesToCompare, setBranchesToCompare] = useState<string[]>([]);

  // Export State
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Subscribe to changes in exams & marks stores
  useEffect(() => {
    const unsubExams = subscribeExams((items) => {
      setExams(items);
      setExamsVersion((v) => v + 1);
    });
    const unsubMarks = subscribeMarks((items) => {
      setMarks(items);
      setMarksVersion((v) => v + 1);
    });
    return () => {
      unsubExams();
      unsubMarks();
    };
  }, []);

  // Initialize branches to compare
  useEffect(() => {
    const activeBranches = getBranches().filter((b) => b.status === 'Active');
    setBranchesToCompare(activeBranches.map((b) => b.id));
  }, []);

  // Join marks with exams and students
  const joinedRecords = useMemo(() => {
    const students = getStudentsForClass();
    return marks.map((mark) => {
      const exam = exams.find((e) => e.id === mark.examId);
      const student = students.find((s) => s.id === mark.studentId);

      return {
        id: `${mark.examId}-${mark.studentId}`,
        studentId: mark.studentId,
        studentName: student?.fullName || mark.studentName,
        rollNumber: student?.rollNumber || mark.rollNumber,
        admissionNumber: student?.admissionNumber || 'ADM' + mark.studentId.replace(/\D/g, ''),
        branchId: student?.branchId || (exam?.teacherId === 'TCH002' ? 'branch_jayanagar' : 'branch_rajajinagar'),
        branchName: student?.branchName || (exam?.teacherId === 'TCH002' ? 'Jayanagar Branch' : 'Rajajinagar Branch'),
        className: exam?.className || student?.className || '10th A',
        batch: exam?.batch || 'Batch A',
        subject: exam?.subject || 'Mathematics',
        examId: mark.examId,
        examName: exam?.name || 'Unknown Exam',
        examDate: exam?.date || '2026-06-01',
        maxMarks: exam?.maxMarks || 100,
        marksObtained: mark.marksObtained,
        percentage: mark.percentage,
        grade: mark.grade,
        pass: mark.marksObtained >= (exam?.passingMarks ?? 35),
      };
    });
  }, [marksVersion, examsVersion, exams, marks]);

  // Extract filter options dynamically from active records
  const filterOptions = useMemo(() => {
    const branches = getBranches();
    const classes = Array.from(new Set(joinedRecords.map((r) => r.className)));
    const batches = Array.from(new Set(joinedRecords.map((r) => r.batch)));
    const subjects = Array.from(new Set(joinedRecords.map((r) => r.subject)));
    const uniqueExams = Array.from(
      new Set(joinedRecords.map((r) => JSON.stringify({ id: r.examId, name: r.examName })))
    ).map((str) => JSON.parse(str));

    return { branches, classes, batches, subjects, exams: uniqueExams };
  }, [joinedRecords]);

  // Apply filters
  const filteredRecords = useMemo(() => {
    return joinedRecords.filter((r) => {
      // 1. Branch filter
      if (branchSelection === 'compare') {
        if (!branchesToCompare.includes(r.branchId)) return false;
      } else if (branchSelection !== 'all') {
        if (r.branchId !== branchSelection) return false;
      }

      // 2. Class filter
      if (classSelection !== 'all' && r.className !== classSelection) return false;

      // 3. Batch filter
      if (batchSelection !== 'all' && r.batch !== batchSelection) return false;

      // 4. Subject filter
      if (subjectSelection !== 'all' && r.subject !== subjectSelection) return false;

      // 5. Exam filter
      if (examSelection !== 'all' && r.examId !== examSelection) return false;

      // 6. Date Range filter
      if (startDate && new Date(r.examDate) < new Date(startDate)) return false;
      if (endDate && new Date(r.examDate) > new Date(endDate)) return false;

      return true;
    });
  }, [joinedRecords, branchSelection, branchesToCompare, classSelection, batchSelection, subjectSelection, examSelection, startDate, endDate]);

  // Rankings and color coding
  const rankedRecords = useMemo(() => {
    const sorted = [...filteredRecords].sort((a, b) => b.percentage - a.percentage);
    return sorted.map((record, index) => {
      let status: 'green' | 'orange' | 'red' = 'orange';
      let badgeLabel = 'Average Performer';

      if (record.percentage >= 85 && (record.grade === 'A' || record.grade === 'A+')) {
        status = 'green';
        badgeLabel = 'Top Performer';
      } else if (record.percentage < 40 || !record.pass) {
        status = 'red';
        badgeLabel = 'Needs Improvement';
      }

      return {
        ...record,
        rank: index + 1,
        indicatorStatus: status,
        badgeLabel,
      };
    });
  }, [filteredRecords]);

  // Summary Metrics
  const summaryMetrics = useMemo(() => {
    const appeared = rankedRecords.length;
    if (appeared === 0) {
      return {
        totalStudents: 0,
        appeared: 0,
        passed: 0,
        failed: 0,
        passPercentage: 0,
        classAverage: 0,
        highestScore: 0,
        lowestScore: 0,
        overallAverageMarks: 0,
      };
    }

    const uniqueStudents = new Set(rankedRecords.map((r) => r.studentId)).size;
    const passed = rankedRecords.filter((r) => r.pass).length;
    const failed = appeared - passed;
    const sumPercentages = rankedRecords.reduce((sum, r) => sum + r.percentage, 0);
    const sumMarks = rankedRecords.reduce((sum, r) => sum + r.marksObtained, 0);
    const highest = Math.max(...rankedRecords.map((r) => r.marksObtained));
    const lowest = Math.min(...rankedRecords.map((r) => r.marksObtained));

    return {
      totalStudents: uniqueStudents,
      appeared,
      passed,
      failed,
      passPercentage: Math.round((passed / appeared) * 100),
      classAverage: Number((sumPercentages / appeared).toFixed(1)),
      highestScore: highest,
      lowestScore: lowest,
      overallAverageMarks: Number((sumMarks / appeared).toFixed(1)),
    };
  }, [rankedRecords]);

  // Section: Top 10 Students
  const top10Students = useMemo(() => {
    return rankedRecords.slice(0, 10);
  }, [rankedRecords]);

  // Section: Students Requiring Attention (Red indicator)
  const strugglingStudents = useMemo(() => {
    return rankedRecords.filter((r) => r.indicatorStatus === 'red');
  }, [rankedRecords]);

  // Chart 1: Branch-wise Average Marks (always shows all active branches, respecting other filters)
  const branchAverageChart = useMemo(() => {
    const activeBranches = getBranches().filter((b) => b.status === 'Active');
    
    return activeBranches.map((b) => {
      // Find records that match all filters EXCEPT the branch selection filter
      const recordsForBranch = joinedRecords.filter((r) => {
        if (r.branchId !== b.id) return false;
        
        // Apply all other filters
        if (classSelection !== 'all' && r.className !== classSelection) return false;
        if (batchSelection !== 'all' && r.batch !== batchSelection) return false;
        if (subjectSelection !== 'all' && r.subject !== subjectSelection) return false;
        if (examSelection !== 'all' && r.examId !== examSelection) return false;
        if (startDate && new Date(r.examDate) < new Date(startDate)) return false;
        if (endDate && new Date(r.examDate) > new Date(endDate)) return false;
        
        return true;
      });

      const avg = recordsForBranch.length 
        ? (recordsForBranch.reduce((sum, r) => sum + r.percentage, 0) / recordsForBranch.length) 
        : 0;

      return { name: b.code, average: Number(avg.toFixed(1)) };
    });
  }, [joinedRecords, classSelection, batchSelection, subjectSelection, examSelection, startDate, endDate]);

  // Chart 2: Class-wise Average Marks
  const classAverageChart = useMemo(() => {
    const classes = Array.from(new Set(joinedRecords.map((r) => r.className)));
    return classes
      .map((c) => {
        const records = joinedRecords.filter((r) => r.className === c);
        const avg = records.length ? records.reduce((sum, r) => sum + r.percentage, 0) / records.length : 0;
        return { name: c, average: Number(avg.toFixed(1)) };
      })
      .sort((a, b) => b.average - a.average);
  }, [joinedRecords]);

  // Chart 3: Pass vs Fail Ratio
  const passFailChart = useMemo(() => {
    return [
      { name: 'Passed', value: summaryMetrics.passed, color: '#10b981' },
      { name: 'Failed', value: summaryMetrics.failed, color: '#ef4444' },
    ].filter((d) => d.value > 0);
  }, [summaryMetrics]);

  // Chart 4: Grade Distribution
  const gradeDistributionChart = useMemo(() => {
    const grades = ['A+', 'A', 'B', 'C', 'D', 'F'];
    return grades.map((g) => {
      const count = rankedRecords.filter((r) => r.grade === g).length;
      return { name: g, count };
    });
  }, [rankedRecords]);

  // Chart 5: Subject-wise Performance
  const subjectPerformanceChart = useMemo(() => {
    const subjects = Array.from(new Set(joinedRecords.map((r) => r.subject)));
    return subjects.map((sub) => {
      const records = joinedRecords.filter((r) => r.subject === sub);
      const avg = records.length ? records.reduce((sum, r) => sum + r.percentage, 0) / records.length : 0;
      return { name: sub, average: Number(avg.toFixed(1)) };
    });
  }, [joinedRecords]);

  // Dynamic Executive Summary Text
  const executiveSummary = useMemo(() => {
    if (rankedRecords.length === 0) return 'No academic performance data matches the selected filter configuration.';

    const overallPass = summaryMetrics.passPercentage;
    const branchSummaries = getBranches()
      .map((b) => {
        const bRecords = rankedRecords.filter((r) => r.branchId === b.id);
        const avg = bRecords.length ? bRecords.reduce((sum, r) => sum + r.percentage, 0) / bRecords.length : 0;
        const passRate = bRecords.length ? (bRecords.filter((r) => r.pass).length / bRecords.length) * 100 : 0;
        return { name: b.name, avg, passRate, count: bRecords.length };
      })
      .filter((b) => b.count > 0);

    const topBranch = [...branchSummaries].sort((a, b) => b.avg - a.avg)[0];
    const topClass = classAverageChart[0];

    let summaryText = `The academic assessment indicates a robust overall pass rate of ${overallPass}% across the filtered datasets. `;
    if (topBranch) {
      summaryText += `The ${topBranch.name} achieved the highest average academic score of ${Math.round(topBranch.avg)}% with a localized pass percentage of ${Math.round(topBranch.passRate)}%. `;
    }
    if (topClass) {
      summaryText += `Class ${topClass.name} recorded the strongest average marks distribution of ${Math.round(topClass.average)}%. `;
    }

    if (strugglingStudents.length > 0) {
      summaryText += `Additional structured academic support and targeted remedial classes are recommended for the ${strugglingStudents.length} student(s) identified in the 'Needs Improvement' category.`;
    } else {
      summaryText += `All students are performing within acceptable benchmarks, showing excellent academic stability.`;
    }

    return summaryText;
  }, [rankedRecords, summaryMetrics, classAverageChart, strugglingStudents]);

  // Dynamic Recommendations List
  const recommendations = useMemo(() => {
    const list: string[] = [];

    if (strugglingStudents.length > 0) {
      list.push(
        `Conduct mandatory remedial classes and focused assignments for the ${strugglingStudents.length} student(s) currently scoring under the 40% threshold.`
      );
    }
    if (top10Students.length > 0) {
      list.push(
        `Formally recognize the top-performing students achieving Grade A/A+ to foster motivation and academic excellence.`
      );
    }

    const lowestSubject = [...subjectPerformanceChart].sort((a, b) => a.average - b.average)[0];
    if (lowestSubject && lowestSubject.average < 75) {
      list.push(
        `Focus extra revision sessions and assign targeted worksheets in "${lowestSubject.name}" to address the lower class average of ${lowestSubject.average}%.`
      );
    }

    if (branchSelection === 'compare' && branchAverageChart.length > 1) {
      list.push(
        `Organize cross-branch collaborative educator meetings to transfer pedagogical best practices from higher performing zones.`
      );
    }

    if (list.length === 0) {
      list.push('Continue regular academic tracking and periodic diagnostic assessments.');
    }

    return list;
  }, [strugglingStudents, top10Students, subjectPerformanceChart, branchSelection, branchAverageChart]);

  // Export PDF functionality
  const exportPdfReport = async () => {
    setIsExportingPdf(true);
    setStatusMessage('Generating PDF Report...');

    try {
      const pdfService = new PDFTemplateService();
      
      pdfService.addTitle('Student Performance Analytics Report');
      
      const today = new Date().toLocaleString();
      const meta = [
        ['Academic Year', academicYear],
        ['Date & Time Generated', today],
        ['Generated By', `${user?.name || 'Super Admin'} (Super Admin)`],
        ['Active Filters', `Branch: ${branchSelection === 'all' ? 'All' : branchSelection === 'compare' ? 'Compare' : getBranchName(branchSelection)}, Class: ${classSelection}, Subject: ${subjectSelection}`]
      ];
      pdfService.addTable([['Report Details', '']], meta);

      pdfService.addSectionHeading('Dashboard Summary Metrics');
      const kpis = [
        ['Total Students', String(summaryMetrics.totalStudents), 'Passed Students', String(summaryMetrics.passed)],
        ['Students Appeared', String(summaryMetrics.appeared), 'Failed Students', String(summaryMetrics.failed)],
        ['Overall Pass %', `${summaryMetrics.passPercentage}%`, 'Overall Average Marks', `${summaryMetrics.overallAverageMarks}%`],
        ['Class Average %', `${summaryMetrics.classAverage}%`, 'Highest Score (Marks)', String(summaryMetrics.highestScore)],
        ['Lowest Score (Marks)', String(summaryMetrics.lowestScore), '', '']
      ];
      pdfService.addTable([['Metric', 'Value', 'Metric', 'Value']], kpis);
      
      const selectedExamObj = examSelection !== 'all' ? exams.find((e) => e.id === examSelection) : null;
      if (selectedExamObj) {
        pdfService.addSectionHeading('Exam Details & Specifications');
        const details = [
          ['Exam Name', selectedExamObj.name, 'Subject', selectedExamObj.subject],
          ['Class', selectedExamObj.className, 'Branch', getBranchName(selectedExamObj.branchId || '') || 'All Branches'],
          ['Maximum Marks', String(selectedExamObj.maxMarks), 'Passing Marks', String(selectedExamObj.passingMarks ?? 35)],
          ['Assigned Teacher', selectedExamObj.teacherName, '', '']
        ];
        pdfService.addTable([['Detail', 'Value', 'Detail', 'Value']], details);
      }
      
      pdfService.addSectionHeading('Executive Summary');
      pdfService.addParagraph(executiveSummary);
      
      pdfService.addSectionHeading('Key Recommendations');
      recommendations.forEach(rec => {
         pdfService.addParagraph(`• ${rec}`);
      });
      
      if (selectedExamObj) {
        pdfService.addSectionHeading(`Student Results Table — ${selectedExamObj.name}`);
        const headers = ['Student Name', 'Marks Obtained', 'Passing Marks', 'Percentage', 'Grade', 'Result'];
        const body = rankedRecords.map(student => [
            student.studentName,
            String(student.marksObtained),
            String(selectedExamObj.passingMarks ?? 35),
            `${student.percentage.toFixed(1)}%`,
            student.grade,
            student.pass ? 'PASS' : 'FAIL'
        ]);
        pdfService.addTable([headers], body);
      } else {
        pdfService.addSectionHeading('Branch-Wise Average Marks');
        const branchAvgHeaders = ['Branch', 'Average Marks (%)'];
        const branchAvgBody = branchAverageChart.map(d => [d.name, `${d.average}%`]);
        pdfService.addTable([branchAvgHeaders], branchAvgBody);
        
        pdfService.addSectionHeading('Top 10 Performing Students');
        const top10Headers = ['Rank', 'Student Name', 'Branch', 'Class', 'Marks %', 'Grade'];
        const top10Body = top10Students.map(student => [
            String(student.rank),
            student.studentName,
            student.branchName.replace(' Branch', ''),
            student.className,
            `${student.percentage.toFixed(1)}%`,
            student.grade
        ]);
        pdfService.addTable([top10Headers], top10Body);
      }
      
      if (strugglingStudents.length > 0) {
        pdfService.addSectionHeading('Students Requiring Attention (Below 40%)');
        const strugglingHeaders = ['Student Name', 'Branch', 'Class', 'Percentage', 'Subject'];
        const strugglingBody = strugglingStudents.map(student => [
            student.studentName,
            student.branchName.replace(' Branch', ''),
            student.className,
            `${student.percentage.toFixed(1)}%`,
            student.subject
        ]);
        pdfService.addTable([strugglingHeaders], strugglingBody);
      }

      await pdfService.exportWithLetterhead(`student-performance-analytics-${academicYear}.pdf`);
      setStatusMessage('Performance PDF Report exported successfully.');
    } catch (error) {
      console.error(error);
      setStatusMessage('Unable to generate PDF Report.');
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleBranchToCompareToggle = (branchId: string) => {
    setBranchesToCompare((prev) =>
      prev.includes(branchId) ? prev.filter((id) => id !== branchId) : [...prev, branchId]
    );
  };

  return (
    <div className="flex-1 bg-background">
      <Header title="Student Performance Analytics" />
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <GreetingBanner name={user?.name ?? 'Super Admin'} subtitle="Institute-wide academic performance metrics & reports" />

        {/* Filters Panel */}
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Filter className="h-5 w-5 text-primary" />
            <h2 className="text-base font-semibold text-foreground">Analytics Filters</h2>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Academic Year</label>
              <select
                value={academicYear}
                onChange={(e) => setAcademicYear(e.target.value)}
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:ring-2 focus:ring-primary/20"
              >
                <option value="2025-2026">2025-2026</option>
                <option value="2026-2027">2026-2027</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">Branch View</label>
              <select
                value={branchSelection}
                onChange={(e) => setBranchSelection(e.target.value)}
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:ring-2 focus:ring-primary/20"
              >
                <option value="all">All Branches</option>
                <option value="compare">⚡ Compare Multiple Branches</option>
                {filterOptions.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">Class</label>
              <select
                value={classSelection}
                onChange={(e) => setClassSelection(e.target.value)}
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:ring-2 focus:ring-primary/20"
              >
                <option value="all">All Classes</option>
                {filterOptions.classes.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">Subject</label>
              <select
                value={subjectSelection}
                onChange={(e) => setSubjectSelection(e.target.value)}
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:ring-2 focus:ring-primary/20"
              >
                <option value="all">All Subjects</option>
                {filterOptions.subjects.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">Batch</label>
              <select
                value={batchSelection}
                onChange={(e) => setBatchSelection(e.target.value)}
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:ring-2 focus:ring-primary/20"
              >
                <option value="all">All Batches</option>
                {filterOptions.batches.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">Exam Name</label>
              <select
                value={examSelection}
                onChange={(e) => setExamSelection(e.target.value)}
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:ring-2 focus:ring-primary/20"
              >
                <option value="all">All Exams</option>
                {filterOptions.exams.map((ex) => (
                  <option key={ex.id} value={ex.id}>
                    {ex.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground"
              />
            </div>
          </div>

          {/* Branch multi-selector checkboxes (when in compare mode) */}
          {branchSelection === 'compare' && (
            <div className="mt-4 border-t border-border pt-4">
              <label className="text-xs font-semibold text-foreground">Select Branches to Compare:</label>
              <div className="mt-2 flex flex-wrap gap-4">
                {filterOptions.branches.map((b) => (
                  <label key={b.id} className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={branchesToCompare.includes(b.id)}
                      onChange={() => handleBranchToCompareToggle(b.id)}
                      className="rounded border-input text-primary focus:ring-primary/20"
                    />
                    {b.name}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* PDF Download Button */}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4">
            <button
              onClick={exportPdfReport}
              disabled={rankedRecords.length === 0 || isExportingPdf}
              className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Download className="h-4 w-4" />
              {isExportingPdf ? 'Generating PDF Report…' : 'Download Performance Report (PDF)'}
            </button>
            {statusMessage && (
              <span className="text-sm font-medium text-primary bg-primary/5 border border-primary/10 rounded-lg px-3 py-1">
                {statusMessage}
              </span>
            )}
          </div>
        </div>

        {/* Dashboard Summary cards */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3">
          {[
            { title: 'Total Students', value: summaryMetrics.totalStudents, desc: 'Enrolled in selected filter' },
            { title: 'Students Appeared', value: summaryMetrics.appeared, desc: 'Students with submitted scores' },
            { title: 'Students Passed', value: summaryMetrics.passed, desc: 'Passing score >= 40%' },
            { title: 'Students Failed', value: summaryMetrics.failed, desc: 'Below standard < 40%' },
            { title: 'Overall Pass Percentage', value: `${summaryMetrics.passPercentage}%`, desc: 'Average pass benchmark rate' },
            { title: 'Class Average', value: `${summaryMetrics.classAverage}%`, desc: 'Average score distribution' },
            { title: 'Highest Score', value: `${summaryMetrics.highestScore}`, desc: 'Top marks scored' },
            { title: 'Lowest Score', value: `${summaryMetrics.lowestScore}`, desc: 'Lowest marks scored' },
            { title: 'Overall Average Marks', value: `${summaryMetrics.overallAverageMarks}%`, desc: 'Normalised average marks' },
          ].map((card, i) => (
            <div key={i} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{card.title}</p>
              <p className="mt-3 text-3xl font-semibold text-foreground">{card.value}</p>
              <p className="mt-2 text-xs text-muted-foreground">{card.desc}</p>
            </div>
          ))}
        </div>

        {/* Analytics Section - Charts */}
        <div className="grid grid-cols-1 gap-6">
          {/* Chart 1: Branch Comparison */}
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <h3 className="text-base font-semibold text-foreground flex items-center gap-2 mb-4">
              <Layers className="h-5 w-5 text-primary" />
              Branch-wise Average Marks (%)
            </h3>
            <div className="h-72">
              {branchAverageChart.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  No data available.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={branchAverageChart}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" />
                    <YAxis domain={[0, 100]} />
                    <Tooltip formatter={(value) => `${value}%`} />
                    <Bar dataKey="average" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>

        {/* Executive Summary Narrative & Recommendations */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {/* Executive Summary */}
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <h3 className="text-base font-semibold text-foreground flex items-center gap-2 mb-3">
              <Award className="h-5 w-5 text-primary" />
              Executive Summary
            </h3>
            <div className="text-sm leading-relaxed text-muted-foreground bg-secondary/30 rounded-xl p-4 border border-border/50">
              {executiveSummary}
            </div>
          </div>

          {/* Action Recommendations */}
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <h3 className="text-base font-semibold text-foreground flex items-center gap-2 mb-3">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Action Recommendations
            </h3>
            <ul className="space-y-2.5">
              {recommendations.map((rec, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                  <span className="text-primary font-bold mt-0.5">•</span>
                  <span>{rec}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Top 10 Performers Section & Struggling Students */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Top 10 Performers */}
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <Award className="h-5.5 w-5.5 text-amber-500" />
              <h3 className="text-base font-semibold text-foreground">🥇 Top 10 Performing Students</h3>
            </div>
            {top10Students.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                No performance records match the current filters.
              </div>
            ) : (
              <div className="space-y-3">
                {top10Students.map((s) => (
                  <div key={s.id} className="flex items-center justify-between rounded-xl border border-border bg-secondary/30 px-4 py-3 shadow-xs">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-700 text-xs font-bold">
                        {s.rank}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-foreground">{s.studentName}</p>
                        <p className="text-xs text-muted-foreground">{s.branchName.replace(' Branch', '')} — {s.className}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-foreground">{s.percentage.toFixed(1)}%</p>
                      <p className="text-xs text-muted-foreground">{s.marksObtained}/{s.maxMarks} Marks</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Students Requiring Attention */}
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle className="h-5.5 w-5.5 text-rose-500" />
              <h3 className="text-base font-semibold text-foreground">⚠️ Students Requiring Academic Support</h3>
            </div>
            {strugglingStudents.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                🟢 Excellent: No student requires academic support in this filter.
              </div>
            ) : (
              <div className="space-y-3">
                {strugglingStudents.map((s) => (
                  <div key={s.id} className="flex items-center justify-between rounded-xl border border-border bg-rose-500/5 px-4 py-3 shadow-xs">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{s.studentName}</p>
                      <p className="text-xs text-muted-foreground">{s.branchName.replace(' Branch', '')} — {s.className}</p>
                    </div>
                    <div className="text-right">
                      <span className="inline-block rounded-md bg-rose-500/10 px-2.5 py-1 text-xs font-semibold text-rose-600">
                        {s.percentage.toFixed(1)}% ({s.subject})
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Detailed Performance Table */}
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Layers className="h-5.5 w-5.5 text-primary" />
            <h3 className="text-base font-semibold text-card-foreground">Full Student Performance Ledger</h3>
          </div>
          {rankedRecords.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No performance marks match the current filters.
            </div>
          ) : (
            <DataTable
              columns={[
                { header: 'Rank', accessor: 'rank' },
                { header: 'Roll No', accessor: 'rollNumber' },
                { header: 'Admission No', accessor: 'admissionNumber' },
                { header: 'Student Name', accessor: 'studentName' },
                { header: 'Branch', accessor: (item) => item.branchName.replace(' Branch', '') },
                { header: 'Class', accessor: 'className' },
                { header: 'Subject', accessor: 'subject' },
                { header: 'Score', accessor: (item) => `${item.marksObtained} / ${item.maxMarks}` },
                { header: 'Percentage', accessor: (item) => `${item.percentage.toFixed(1)}%` },
                { header: 'Grade', accessor: 'grade' },
                {
                  header: 'Academic Standing',
                  accessor: (item) => {
                    const badgeStyles: Record<string, string> = {
                      green: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20',
                      orange: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20',
                      red: 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/20',
                    };
                    const labels: Record<string, string> = {
                      green: '🏆 Top Performer',
                      orange: '📘 Average Performer',
                      red: '⚠️ Needs Improvement',
                    };
                    return (
                      <span className={`inline-block rounded-md px-2.5 py-1 text-xs font-semibold ${badgeStyles[item.indicatorStatus]}`}>
                        {labels[item.indicatorStatus]}
                      </span>
                    );
                  },
                },
              ]}
              data={rankedRecords}
            />
          )}
        </div>
      </div>
    </div>
  );
}
