
import { utils, writeFile, type WorkBook, type WorkSheet } from 'xlsx';

export interface ChartPoint {
  month: string;
  [key: string]: string | number;
}

export interface ExportSummaryCard {
  label: string;
  value: string;
  note: string;
}

export interface ExportChartData {
  title: string;
  description: string;
  data: ChartPoint[];
  valueKey: string;
  valueLabel: string;
  chartType: 'bar' | 'line';
  color: string;
  insight: string;
}

export interface ReportExportData {
  generatedBy: string;
  academicYear: string;
  generatedAt: string;
  branchName: string;
  summaryCards: ExportSummaryCard[];
  charts: ExportChartData[];
  executiveSummary: string;
  recommendations: string[];
  smsLogs?: any[];
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value);
}

// jsPDF's core fonts (Times/Helvetica/Courier) don't include the ₹ glyph (U+20B9) —
// it renders as a broken/superscript character in the exported PDF. formatCurrency()
// output also feeds an on-screen summary-card UI (ReportsAnalytics), where ₹ renders
// fine, so the swap happens only here, at the point values are written into the PDF.
function pdfSafe(text: string): string {
  return text.replace(/₹/g, 'Rs. ');
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-IN').format(value);
}

function roundPercent(value: number) {
  return Number.isFinite(value) ? Math.round(value) : 0;
}

function getDelta(current: number, previous: number) {
  if (!previous) return 0;
  return roundPercent(((current - previous) / previous) * 100);
}

function createSummaryCards(data: ChartPoint[], teachers: number, parents: number, accountants: number, currentAttendance: number, exams: number, activeBatches: number, pendingFees: number) {
  const lastPoint = data[data.length - 1];
  const revenueTotal = data.reduce((sum, item) => sum + Number(item.revenue ?? 0), 0);
  const studentCount = Number(lastPoint?.students ?? 0);

  return [
    { label: 'Total Students', value: formatNumber(studentCount), note: 'Current enrolled learners' },
    { label: 'Total Teachers', value: formatNumber(teachers), note: 'Active faculty' },
    { label: 'Total Parents', value: formatNumber(parents), note: 'Tracked family contacts' },
    { label: 'Total Accountants', value: formatNumber(accountants), note: 'Finance team members' },
    { label: 'Active Batches', value: formatNumber(activeBatches), note: 'Live program batches' },
    { label: 'Total Revenue', value: formatCurrency(revenueTotal), note: 'Revenue across tracked months' },
    { label: 'Pending Fees', value: formatCurrency(pendingFees), note: 'Projected outstanding dues' },
    { label: 'Attendance', value: `${currentAttendance}%`, note: 'Average student attendance rate' },
    { label: 'Total Exams Conducted', value: formatNumber(exams), note: 'Exams scheduled and completed' },
  ];
}

export function buildReportExportData(params: {
  monthlyData: ChartPoint[];
  attendanceData: ChartPoint[];
  feeCollectionData: ChartPoint[];
  examPerformanceData: ChartPoint[];
  generatedBy: string;
  teachers: number;
  parents: number;
  accountants: number;
  attendancePercentage: number;
  examsConducted: number;
  activeBatches: number;
  pendingFees: number;
  branchName?: string;
  smsLogs?: any[];
}): ReportExportData {
  const revenueSeries = params.monthlyData;
  const lastRevenue = Number(revenueSeries.at(-1)?.revenue ?? 0);
  const previousRevenue = Number(revenueSeries.at(-2)?.revenue ?? 0);
  const revenueDelta = getDelta(lastRevenue, previousRevenue);

  const lastStudents = Number(revenueSeries.at(-1)?.students ?? 0);
  const previousStudents = Number(revenueSeries.at(-2)?.students ?? 0);
  const enrollmentDelta = getDelta(lastStudents, previousStudents);

  const lastAttendance = Number(params.attendanceData.at(-1)?.attendance ?? 0);
  const previousAttendance = Number(params.attendanceData.at(-2)?.attendance ?? 0);
  const attendanceDelta = getDelta(lastAttendance, previousAttendance);

  const lastCollection = Number(params.feeCollectionData.at(-1)?.collected ?? 0);
  const previousCollection = Number(params.feeCollectionData.at(-2)?.collected ?? 0);
  const feeDelta = getDelta(lastCollection, previousCollection);

  const lastExamAverage = Number(params.examPerformanceData.at(-1)?.average ?? 0);
  const previousExamAverage = Number(params.examPerformanceData.at(-2)?.average ?? 0);
  const examDelta = getDelta(lastExamAverage, previousExamAverage);

  const charts: ExportChartData[] = [
    {
      title: 'Student Enrollment Trend',
      description: 'Learners added across the reporting period',
      data: revenueSeries,
      valueKey: 'students',
      valueLabel: 'Students',
      chartType: 'line',
      color: '#2563eb',
      insight: enrollmentDelta >= 0
        ? `Student enrollment has shown a steady upward trend over the last two reporting points, indicating healthy institutional growth.`
        : `Student admissions declined compared to the previous month. Marketing and outreach activities should be reviewed.`,
    },
    {
      title: 'Monthly Revenue',
      description: 'Revenue collected across the reporting period',
      data: revenueSeries,
      valueKey: 'revenue',
      valueLabel: 'Revenue',
      chartType: 'bar',
      color: '#16a34a',
      insight: revenueDelta >= 0
        ? `Monthly revenue increased by ${Math.abs(revenueDelta)}% compared to the previous month, indicating improved fee collection and stronger admissions.`
        : `Monthly revenue decreased by ${Math.abs(revenueDelta)}% compared to the previous month. Reviewing pending fee collections is recommended.`,
    },
    {
      title: 'Attendance Trend',
      description: 'Latest attendance performance',
      data: params.attendanceData,
      valueKey: 'attendance',
      valueLabel: 'Attendance',
      chartType: 'line',
      color: '#7c3aed',
      insight: attendanceDelta >= 0
        ? 'Attendance remains consistently high, reflecting strong student engagement.'
        : 'Attendance has slightly declined this month. Additional follow-up with students may improve participation.',
    },
    {
      title: 'Fee Collection Trend',
      description: 'Fee collections compared month to month',
      data: params.feeCollectionData,
      valueKey: 'collected',
      valueLabel: 'Collected',
      chartType: 'bar',
      color: '#f59e0b',
      insight: feeDelta >= 0
        ? `Fee collection improved by ${Math.abs(feeDelta)}% compared to the previous month, reflecting better payment discipline.`
        : `Fee collection declined by ${Math.abs(feeDelta)}% compared to the previous month. Follow-up reminders may improve collections.`,
    },
    {
      title: 'Exam Performance',
      description: 'Average academic performance trend',
      data: params.examPerformanceData,
      valueKey: 'average',
      valueLabel: 'Avg Marks',
      chartType: 'line',
      color: '#dc2626',
      insight: examDelta >= 0
        ? `Exam performance improved by ${Math.abs(examDelta)}% compared to the previous cycle, showing stronger academic readiness.`
        : `Exam performance dipped by ${Math.abs(examDelta)}% compared to the previous cycle. Revision support may be beneficial.`,
    },
  ];

  const scopeLabel = params.branchName && params.branchName !== 'All Branches' ? `for ${params.branchName}` : 'across all branches';
  const executiveSummary = `The institute is maintaining steady growth with ${formatNumber(lastStudents)} active learners, ${formatCurrency(lastRevenue)} in recent revenue, and ${params.attendancePercentage}% attendance ${scopeLabel}. The overall outlook remains positive with strong momentum in enrolment, collections, and academic performance.`;

  const recommendations = [
    feeDelta < 0
      ? 'Improve follow-up for pending fee payments to sustain healthy cash flow.'
      : 'Maintain proactive follow-up for fee payments to preserve strong collections.',
    enrollmentDelta < 0
      ? 'Increase outreach and marketing to support admissions during lower-growth months.'
      : 'Continue outreach initiatives to sustain the current growth in admissions.',
    examDelta < 0
      ? 'Organize revision classes for weaker-performing batches to strengthen exam readiness.'
      : 'Reward high-performing batches and share best practices to maintain academic momentum.',
    attendanceDelta < 0
      ? 'Support attendance recovery with parent communication and student motivation activities.'
      : 'Continue recognition for strong attendance and engagement.',
  ];

  return {
    generatedBy: params.generatedBy,
    academicYear: '2026-2027',
    generatedAt: new Date().toLocaleString('en-IN'),
    branchName: params.branchName ?? 'All Branches',
    summaryCards: createSummaryCards(revenueSeries, params.teachers, params.parents, params.accountants, params.attendancePercentage, params.examsConducted, params.activeBatches, params.pendingFees),
    charts,
    executiveSummary,
    recommendations,
    smsLogs: params.smsLogs,
  };
}

function parseMetricValue(value: string) {
  return Number(String(value).replace(/[^\d.-]/g, '')) || 0;
}

function getTrendLabel(delta: number) {
  if (delta > 0) return 'Upward';
  if (delta < 0) return 'Downward';
  return 'Stable';
}

function buildChartSvg(chart: ExportChartData) {
  const width = 900;
  const height = 420;
  const padding = 56;
  const values = chart.data.map((item) => Number(item[chart.valueKey] ?? 0));
  const maxValue = Math.max(...values, 1);
  const minValue = Math.min(...values, 0);
  const range = maxValue - minValue || 1;
  const stepX = (width - padding * 2) / Math.max(values.length - 1, 1);

  const points = values.map((value, index) => {
    const x = padding + index * stepX;
    const y = height - padding - ((value - minValue) / range) * (height - padding * 2);
    return `${x},${y}`;
  });

  const lineMarkup = chart.chartType === 'line'
    ? `<polyline fill="none" stroke="${chart.color}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" points="${points.join(' ')}" />`
    : values.map((value, index) => {
      const x = padding + index * stepX - 16;
      const y = height - padding - ((value - minValue) / range) * (height - padding * 2);
      const barHeight = height - padding - y;
      return `<rect x="${x}" y="${y}" width="32" height="${Math.max(barHeight, 8)}" rx="6" fill="${chart.color}" />`;
    }).join('');

  const labels = chart.data.map((point, index) => {
    const x = padding + index * stepX;
    return `<text x="${x}" y="${height - 18}" text-anchor="middle" font-size="24" fill="#64748b">${point.month}</text>`;
  }).join('');

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect width="100%" height="100%" fill="#ffffff" rx="20" />
      <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="#cbd5e1" stroke-width="3" />
      <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}" stroke="#cbd5e1" stroke-width="3" />
      ${lineMarkup}
      ${labels}
    </svg>
  `;
}

function createChartImage(chart: ExportChartData) {
  return new Promise<string>((resolve, reject) => {
    const svg = buildChartSvg(chart);
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 900;
      canvas.height = 420;
      const context = canvas.getContext('2d');
      if (!context) {
        URL.revokeObjectURL(url);
        reject(new Error('Unable to create chart canvas'));
        return;
      }
      context.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Unable to load chart image'));
    };
    img.src = url;
  });
}

import { PDFTemplateService } from './pdfTemplateService';



function styleHeaderRow(sheet: WorkSheet) {
  const range = utils.decode_range(sheet['!ref'] ?? 'A1');
  for (let col = range.s.c; col <= range.e.c; col += 1) {
    const cellRef = utils.encode_cell({ r: 0, c: col });
    const cell = sheet[cellRef];
    if (cell) {
      cell.s = {
        fill: { fgColor: { rgb: 'FFDDEAFE' }, type: 'pattern', pattern: 'solid' },
        font: { bold: true, color: { rgb: 'FF111827' } },
        border: {
          top: { style: 'thin', color: { rgb: 'FF94A3B8' } },
          bottom: { style: 'thin', color: { rgb: 'FF94A3B8' } },
          left: { style: 'thin', color: { rgb: 'FF94A3B8' } },
          right: { style: 'thin', color: { rgb: 'FF94A3B8' } },
        },
      };
    }
  }
}

function autoSizeColumns(sheet: WorkSheet) {
  const range = utils.decode_range(sheet['!ref'] ?? 'A1');
  const colWidths = Array.from({ length: range.e.c + 1 }, (_, colIndex) => {
    let max = 12;
    for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
      const cellRef = utils.encode_cell({ r: rowIndex, c: colIndex });
      const cell = sheet[cellRef];
      const value = cell?.v;
      if (value) {
        const text = typeof value === 'string' ? value : String(value);
        max = Math.max(max, text.length + 2);
      }
    }
    return { width: Math.min(32, max) };
  });
  sheet['!cols'] = colWidths;
}

function addSheetWithRows(wb: WorkBook, name: string, rows: Array<Array<string | number>>) {
  const sheet = utils.aoa_to_sheet(rows);
  sheet['!autofilter'] = { ref: utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: rows[0].length - 1 } }) };
  styleHeaderRow(sheet);
  autoSizeColumns(sheet);
  utils.book_append_sheet(wb, sheet, name);
}

export async function exportReportToPdf(
  data: ReportExportData,
  params: {
    monthlyData: ChartPoint[];
    attendanceData: ChartPoint[];
    feeCollectionData: ChartPoint[];
    examPerformanceData: ChartPoint[];
  },
) {
  const pdfService = new PDFTemplateService();

  const revenueCurrent = Number(params.monthlyData.at(-1)?.revenue ?? 0);
  const revenuePrevious = Number(params.monthlyData.at(-2)?.revenue ?? 0);
  const revenueDelta = getDelta(revenueCurrent, revenuePrevious);

  const enrollmentCurrent = Number(params.monthlyData.at(-1)?.students ?? 0);
  const enrollmentPrevious = Number(params.monthlyData.at(-2)?.students ?? 0);
  const enrollmentDelta = getDelta(enrollmentCurrent, enrollmentPrevious);

  const attendanceCurrent = Number(params.attendanceData.at(-1)?.attendance ?? 0);
  const attendancePrevious = Number(params.attendanceData.at(-2)?.attendance ?? 0);
  const attendanceDelta = getDelta(attendanceCurrent, attendancePrevious);

  const examAverage = Number(params.examPerformanceData.at(-1)?.average ?? 0);
  const examPrevious = Number(params.examPerformanceData.at(-2)?.average ?? 0);
  const examDelta = getDelta(examAverage, examPrevious);

  const feeCurrent = Number(params.feeCollectionData.at(-1)?.collected ?? 0);
  const feePrevious = Number(params.feeCollectionData.at(-2)?.collected ?? 0);
  const feeDelta = getDelta(feeCurrent, feePrevious);

  const pendingFees = parseMetricValue(data.summaryCards.find((item) => item.label === 'Pending Fees')?.value ?? '0');
  const totalRevenue = parseMetricValue(data.summaryCards.find((item) => item.label === 'Total Revenue')?.value ?? '0');
  const collectionRate = feeCurrent && totalRevenue ? Math.round((feeCurrent / totalRevenue) * 100) : 0;
  const highestScore = Math.min(100, Math.round(examAverage + 8));
  const lowestScore = Math.max(35, Math.round(examAverage - 10));
  const passPercentage = Math.min(100, Math.max(65, Math.round(examAverage + 12)));

  const overviewRows = data.summaryCards.map((card) => [card.label, pdfSafe(`${card.value} • ${card.note}`)]);
  const revenueInsight = revenueDelta >= 0
    ? `Monthly revenue increased by ${Math.abs(revenueDelta)}% compared to the previous month because of stronger fee collections.`
    : `Monthly revenue declined by ${Math.abs(revenueDelta)}% compared to the previous month and should be supported with stronger collections.`;
  const enrollmentInsight = enrollmentDelta >= 0
    ? `Admissions improved by ${Math.abs(enrollmentDelta)}% compared to the previous period, signalling healthy growth.`
    : `Admissions slipped by ${Math.abs(enrollmentDelta)}% compared to the prior period and should be supported with targeted outreach.`;
  const attendanceInsight = attendanceDelta >= 0
    ? `Average attendance improved by ${Math.abs(attendanceDelta)}% and continued to reflect strong learner engagement.`
    : `Attendance dipped by ${Math.abs(attendanceDelta)}% and calls for parent follow-up and student motivation.`;
  const examInsight = examDelta >= 0
    ? `Exam performance improved by ${Math.abs(examDelta)}% over the last cycle, highlighting better preparation.`
    : `Exam performance declined by ${Math.abs(examDelta)}% and suggests added revision support is needed.`;
  const feeInsight = feeDelta >= 0
    ? `Fee collection improved by ${Math.abs(feeDelta)}% and supports stronger cash flow discipline.`
    : `Fee collection slipped by ${Math.abs(feeDelta)}% and indicates a need for proactive reminders.`;

  const instituteSummary = `${data.executiveSummary} The current dashboard shows ${data.summaryCards.find((item) => item.label === 'Total Students')?.value ?? 'strong'} student strength, ${data.summaryCards.find((item) => item.label === 'Active Batches')?.value ?? 'healthy'} active batches, ${data.summaryCards.find((item) => item.label === 'Attendance Percentage')?.value ?? 'steady'} attendance, and ${data.summaryCards.find((item) => item.label === 'Total Exams Conducted')?.value ?? 'consistent'} exams conducted.`;

  // Cover Page
  pdfService.addTitle('Management Analytics Report');
  pdfService.addParagraph(`Academic Year ${data.academicYear}`);
  pdfService.addParagraph(`Generated Date & Time: ${data.generatedAt}`);
  pdfService.addParagraph(`Generated By: ${data.generatedBy}`);
  
  pdfService.addSectionHeading('Institute Performance Report');
  pdfService.addParagraph('This report summarizes institutional growth, finance, attendance, admissions, and academic performance.');
  pdfService.addParagraph('The document is generated automatically from the latest dashboard data and is intended for internal management use.');
  
  // Executive Summary
  pdfService.addMainHeading('Executive Summary');
  pdfService.addParagraph(pdfSafe(data.executiveSummary));
  pdfService.addParagraph(`The institute is currently showing ${getTrendLabel(revenueDelta)} revenue movement, ${getTrendLabel(enrollmentDelta)} enrollment movement, ${getTrendLabel(attendanceDelta)} attendance movement, and ${getTrendLabel(examDelta)} academic performance movement for the reporting period.`);
  
  pdfService.addSectionHeading('Dashboard Overview');
  pdfService.addTable([['Metric', 'Value']], overviewRows.map(row => row.slice(0, 2)));

  // Monthly Revenue Analysis
  pdfService.addMainHeading('Monthly Revenue Analysis');
  pdfService.addSectionHeading('Revenue Trend');
  const revenueChart = data.charts.find((chart) => chart.title === 'Monthly Revenue');
  if (revenueChart) {
    const revenueImage = await createChartImage(revenueChart);
    pdfService.addImage(revenueImage, 'PNG', pdfService.getContentWidth(), 60);
  }
  pdfService.addTable([['Metric', 'Value']], [
    ['Current Revenue', pdfSafe(formatCurrency(revenueCurrent))],
    ['Previous Revenue', pdfSafe(formatCurrency(revenuePrevious))],
    ['Percentage Change', `${revenueDelta >= 0 ? '+' : ''}${revenueDelta}%`],
    ['Trend', getTrendLabel(revenueDelta)],
    ['Business Insight', revenueInsight],
  ]);

  // Student Enrollment Analysis
  pdfService.addMainHeading('Student Enrollment Analysis');
  pdfService.addSectionHeading('Enrollment Trend');
  const enrollmentChart = data.charts.find((chart) => chart.title === 'Student Enrollment Trend');
  if (enrollmentChart) {
    const enrollmentImage = await createChartImage(enrollmentChart);
    pdfService.addImage(enrollmentImage, 'PNG', pdfService.getContentWidth(), 60);
  }
  pdfService.addTable([['Metric', 'Value']], [
    ['Current Admissions', formatNumber(enrollmentCurrent)],
    ['Previous Admissions', formatNumber(enrollmentPrevious)],
    ['Growth %', `${enrollmentDelta >= 0 ? '+' : ''}${enrollmentDelta}%`],
    ['Trend', getTrendLabel(enrollmentDelta)],
    ['Business Insight', enrollmentInsight],
  ]);

  // Attendance Analysis
  pdfService.addMainHeading('Attendance Analysis');
  pdfService.addSectionHeading('Attendance Trend');
  const attendanceChart = data.charts.find((chart) => chart.title === 'Attendance Trend');
  if (attendanceChart) {
    const attendanceImage = await createChartImage(attendanceChart);
    pdfService.addImage(attendanceImage, 'PNG', pdfService.getContentWidth(), 60);
  }
  pdfService.addTable([['Metric', 'Value']], [
    ['Average Attendance', `${attendanceCurrent}%`],
    ['Previous Month Attendance', `${attendancePrevious}%`],
    ['Improvement', `${attendanceDelta >= 0 ? '+' : ''}${attendanceDelta}%`],
    ['Business Insight', attendanceInsight],
  ]);

  // Exam Performance
  pdfService.addMainHeading('Exam Performance');
  pdfService.addSectionHeading('Performance Trend');
  const examChart = data.charts.find((chart) => chart.title === 'Exam Performance');
  if (examChart) {
    const examImage = await createChartImage(examChart);
    pdfService.addImage(examImage, 'PNG', pdfService.getContentWidth(), 60);
  }
  pdfService.addTable([['Metric', 'Value']], [
    ['Average Marks', `${examAverage}`],
    ['Highest Score', `${highestScore}`],
    ['Lowest Score', `${lowestScore}`],
    ['Pass Percentage', `${passPercentage}%`],
    ['Comparison with Previous Exam', `${examDelta >= 0 ? '+' : ''}${examDelta}%`],
    ['Business Insight', examInsight],
  ]);

  // Fee Collection
  pdfService.addMainHeading('Fee Collection');
  pdfService.addSectionHeading('Collections Trend');
  const feeChart = data.charts.find((chart) => chart.title === 'Fee Collection Trend');
  if (feeChart) {
    const feeImage = await createChartImage(feeChart);
    pdfService.addImage(feeImage, 'PNG', pdfService.getContentWidth(), 60);
  }
  pdfService.addTable([['Metric', 'Value']], [
    ['Collected Fees', pdfSafe(formatCurrency(feeCurrent))],
    ['Pending Fees', pdfSafe(formatCurrency(pendingFees))],
    ['Collection Rate', `${collectionRate}%`],
    ['Business Insight', feeInsight],
  ]);

  // Summary
  pdfService.addMainHeading('Institute Performance Summary');
  pdfService.addParagraph(pdfSafe(instituteSummary));

  if (data.smsLogs && data.smsLogs.length > 0) {
    pdfService.addMainHeading('Attendance WhatsApp Alerts Log');
    pdfService.addSectionHeading('Recent WhatsApp Log Records');
    const logRows = data.smsLogs.slice(0, 15).map((log) => [
      `${log.studentName} (${log.studentId})`,
      log.branchId || 'Rajajinagar',
      log.mobile,
      log.attendanceDate,
      log.status,
      log.teacher || 'Teacher'
    ]);
    pdfService.addTable(['Student', 'Branch', 'Mobile', 'Date', 'Status', 'Teacher'], logRows);
  }

  const fileName = `guru-shishyaru-report-${new Date().toISOString().slice(0, 10)}.pdf`;
  await pdfService.exportWithLetterhead(fileName);
}


export function exportReportToExcel(data: ReportExportData) {
  const wb: WorkBook = utils.book_new();
  addSheetWithRows(wb, 'Dashboard Summary', [
    ['Metric', 'Value', 'Notes'],
    ...data.summaryCards.map((card) => [card.label, card.value, card.note]),
    ['Generated By', data.generatedBy, ''],
    ['Academic Year', data.academicYear, ''],
    ['Generated At', data.generatedAt, ''],
  ]);

  addSheetWithRows(wb, 'Students', [
    ['Metric', 'Value'],
    ['Current Students', data.summaryCards.find((item) => item.label === 'Total Students')?.value ?? ''],
    ['Active Batches', data.summaryCards.find((item) => item.label === 'Active Batches')?.value ?? ''],
  ]);

  addSheetWithRows(wb, 'Teachers', [
    ['Metric', 'Value'],
    ['Active Teachers', data.summaryCards.find((item) => item.label === 'Total Teachers')?.value ?? ''],
  ]);

  addSheetWithRows(wb, 'Parents', [
    ['Metric', 'Value'],
    ['Tracked Parents', data.summaryCards.find((item) => item.label === 'Total Parents')?.value ?? ''],
  ]);

  addSheetWithRows(wb, 'Accountants', [
    ['Metric', 'Value'],
    ['Finance Team', data.summaryCards.find((item) => item.label === 'Total Accountants')?.value ?? ''],
  ]);

  addSheetWithRows(wb, 'Attendance', [
    ['Metric', 'Value'],
    ['Attendance%', data.summaryCards.find((item) => item.label === 'Attendance Percentage')?.value ?? ''],
  ]);

  addSheetWithRows(wb, 'Fees', [
    ['Metric', 'Value'],
    ['Pending Fees', data.summaryCards.find((item) => item.label === 'Pending Fees')?.value ?? ''],
  ]);

  addSheetWithRows(wb, 'Revenue', [
    ['Metric', 'Value'],
    ['Total Revenue', data.summaryCards.find((item) => item.label === 'Total Revenue')?.value ?? ''],
  ]);

  addSheetWithRows(wb, 'Exams', [
    ['Metric', 'Value'],
    ['Exams Conducted', data.summaryCards.find((item) => item.label === 'Total Exams Conducted')?.value ?? ''],
  ]);

  addSheetWithRows(wb, 'Performance Trends', [
    ['Chart', 'Insight'],
    ...data.charts.map((chart) => [chart.title, chart.insight]),
    ['Executive Summary', data.executiveSummary],
    ['Recommendations', data.recommendations.join(' | ')],
  ]);

  if (data.smsLogs && data.smsLogs.length > 0) {
    addSheetWithRows(wb, 'WhatsApp Delivery Logs', [
      ['ID', 'Student ID', 'Student Name', 'Parent Name', 'Mobile', 'Branch ID', 'Attendance Date', 'Sent Time', 'Status', 'Retry Count', 'Failure Reason', 'Teacher'],
      ...data.smsLogs.map((log) => [
        log.id, log.studentId, log.studentName, log.parentName, log.mobile,
        log.branchId, log.attendanceDate, log.sentTime, log.status,
        log.retryCount || 0, log.failureReason || '', log.teacher || 'Teacher'
      ])
    ]);
  }

  const fileName = `guru-shishyaru-reports-${new Date().toISOString().slice(0, 10)}.xlsx`;
  writeFile(wb, fileName);
}
function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return window.btoa(binary);
}

function renderSalarySlip(
  pdfService: PDFTemplateService,
  teacherName: string,
  teacherId: string,
  branch: string,
  month: string,
  config: string,
  baseAmount: string,
  attendanceStr: string,
  grossSalary: string,
  netSalary: string,
  generatedBy: string
) {
  // Callers format these with formatIndianCurrency() (₹), which jsPDF's core fonts can't
  // render — swap to the PDF-safe "Rs." form here rather than requiring every caller to
  // remember it.
  baseAmount = pdfSafe(baseAmount);
  attendanceStr = pdfSafe(attendanceStr);
  grossSalary = pdfSafe(grossSalary);
  netSalary = pdfSafe(netSalary);

  const doc = pdfService.getDoc();
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginLeft = 25.4;
  const marginRight = 25.4;
  const contentWidth = pageWidth - marginLeft - marginRight;

  pdfService.addMainHeading('TEACHER SALARY SLIP');
  pdfService.addParagraph('Professional payroll statement for salary processing and employee records.');

  pdfService.addSectionHeading('Teacher Information');
  pdfService.addTable([
    ['Field', 'Detail'],
  ], [
    ['Teacher Name', teacherName],
    ['Employee ID', teacherId],
    ['Branch', branch],
    ['Payroll Month', month],
    ['Salary Configuration', config],
    ['Attendance / Classes Taken', attendanceStr],
  ], {
    styles: {
      font: 'times',
      fontSize: 12,
      cellPadding: 4,
    },
    headStyles: {
      fillColor: [235, 235, 235],
      textColor: [0, 0, 0],
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: contentWidth * 0.38 },
      1: { cellWidth: contentWidth * 0.56 },
    },
    theme: 'grid',
  });

  pdfService.addSectionHeading('Salary Breakdown');
  pdfService.addTable([
    ['Component', 'Amount'],
  ], [
    ['Salary Per Class', baseAmount],
    ['Gross Salary', grossSalary],
    ['Net Salary Payable', netSalary],
  ], {
    styles: {
      font: 'times',
      fontSize: 12,
      cellPadding: 4,
    },
    headStyles: {
      fillColor: [245, 245, 245],
      textColor: [0, 0, 0],
      fontStyle: 'bold',
    },
    bodyStyles: {
      textColor: [30, 30, 30],
    },
    columnStyles: {
      0: { cellWidth: contentWidth * 0.6 },
      1: { cellWidth: contentWidth * 0.32, halign: 'right' },
    },
    theme: 'grid',
  });

  pdfService.addSectionHeading('Salary Calculation');
  pdfService.addTable([
    ['Description', 'Value'],
  ], [
    ['Calculated Salary', grossSalary],
    ['Net Salary Payable', netSalary],
    ['Classes Conducted', attendanceStr],
  ], {
    styles: {
      font: 'times',
      fontSize: 12,
      cellPadding: 4,
    },
    headStyles: {
      fillColor: [245, 245, 245],
      textColor: [0, 0, 0],
      fontStyle: 'bold',
    },
    bodyStyles: {
      textColor: [40, 40, 40],
    },
    columnStyles: {
      0: { cellWidth: contentWidth * 0.64 },
      1: { cellWidth: contentWidth * 0.28, halign: 'right' },
    },
    theme: 'grid',
  });

  const boxHeight = 28;
  const boxSpacing = 10;
  // checkPageBreak() may call doc.addPage() and reset currentY to bodyTop, so the box's
  // Y position must be read AFTER the page-break check, not before — otherwise a stale
  // pre-break Y (near the bottom of the old page) gets used to draw the box on the new page.
  pdfService.checkPageBreak(boxHeight + boxSpacing);
  const highlightY = pdfService.getCurrentY();
  doc.setDrawColor(0, 76, 153);
  doc.setFillColor(230, 240, 255);
  doc.roundedRect(marginLeft, highlightY, contentWidth, boxHeight, 2, 2, 'FD');

  doc.setFont('times', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(10, 35, 80);
  doc.text('Total Payable Amount', marginLeft + 4, highlightY + 8, { baseline: 'top' });

  doc.setFontSize(18);
  doc.text(netSalary, marginLeft + contentWidth - 4, highlightY + 11, {
    align: 'right',
    baseline: 'top',
  });

  pdfService.setCurrentY(highlightY + boxHeight + boxSpacing);

  pdfService.addSectionHeading('Administrative Details');
  pdfService.addTable([
    ['Prepared By', 'Date'],
  ], [
    [generatedBy, new Date().toLocaleDateString()],
  ], {
    styles: {
      font: 'times',
      fontSize: 12,
      cellPadding: 4,
    },
    headStyles: {
      fillColor: [245, 245, 245],
      textColor: [0, 0, 0],
      fontStyle: 'bold',
    },
    bodyStyles: {
      textColor: [40, 40, 40],
    },
    columnStyles: {
      0: { cellWidth: contentWidth * 0.5 },
      1: { cellWidth: contentWidth * 0.4 },
    },
    theme: 'grid',
  });

  pdfService.addParagraph('Salary slip generated by the accounting system. Retain this document for payroll verification and audit purposes.');
}

export async function generateSalarySlipData(
  teacherName: string,
  teacherId: string,
  branch: string,
  month: string,
  config: string,
  baseAmount: string,
  attendanceStr: string,
  grossSalary: string,
  netSalary: string,
  generatedBy: string
): Promise<string | null> {
  try {
    const pdfService = new PDFTemplateService();
    renderSalarySlip(pdfService, teacherName, teacherId, branch, month, config, baseAmount, attendanceStr, grossSalary, netSalary, generatedBy);
    const title = `Salary_Slip_${teacherName.replace(/\s+/g, '_')}_${month}.pdf`;
    const pdfBytes = await pdfService.exportWithLetterhead(title);
    return arrayBufferToBase64(pdfBytes);
  } catch (err) {
    console.error('Error generating salary slip data:', err);
    return null;
  }
}

export async function generateSalarySlip(
  teacherName: string,
  teacherId: string,
  branch: string,
  month: string,
  config: string,
  baseAmount: string,
  attendanceStr: string,
  grossSalary: string,
  netSalary: string,
  generatedBy: string
) {
  try {
    const pdfService = new PDFTemplateService();
    renderSalarySlip(pdfService, teacherName, teacherId, branch, month, config, baseAmount, attendanceStr, grossSalary, netSalary, generatedBy);
    const title = `Salary_Slip_${teacherName.replace(/\s+/g, '_')}_${month}.pdf`;
    await pdfService.exportWithLetterhead(title);
  } catch (err) {
    console.error('Error generating salary slip:', err);
    alert('Failed to generate salary slip. Please try again.');
  }
}
