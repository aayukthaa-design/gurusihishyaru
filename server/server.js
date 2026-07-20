import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import archiver from 'archiver';
import extract from 'extract-zip';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { WhatsAppService } from './whatsappService.js';

// Safety net: every route handler already catches its own errors, but this
// guards against anything that slips through (a missed try/catch, a
// fire-and-forget async call that rejects) so a single bug can't take the
// whole server down for every user.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});


const PORT = process.env.PORT || 4000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const INSECURE_DEFAULT_JWT_SECRET = 'dev-only-insecure-secret-change-in-production';
const UPLOAD_DIR = path.resolve(process.cwd(), 'server', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Study material files live outside UPLOAD_DIR so they can never be reached via the
// public /uploads static mount — the only way to fetch one is the ownership-checked
// GET /api/materials/:id/file route.
const PRIVATE_UPLOAD_DIR = path.resolve(process.cwd(), 'server', 'private_uploads', 'materials');
if (!fs.existsSync(PRIVATE_UPLOAD_DIR)) fs.mkdirSync(PRIVATE_UPLOAD_DIR, { recursive: true });

const BACKUP_DIR = path.resolve(process.cwd(), 'server', 'backups');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
const RESTORE_TMP_DIR = path.resolve(process.cwd(), 'server', 'tmp_restore');
if (!fs.existsSync(RESTORE_TMP_DIR)) fs.mkdirSync(RESTORE_TMP_DIR, { recursive: true });
const DB_PATH = path.resolve(process.cwd(), 'server', 'data.db');

const JWT_SECRET = process.env.JWT_SECRET || INSECURE_DEFAULT_JWT_SECRET;
if (!process.env.JWT_SECRET) {
  console.warn('WARNING: JWT_SECRET is not set in the environment — using an insecure development default. Set JWT_SECRET in .env before deploying.');
}
if (IS_PRODUCTION && (!process.env.JWT_SECRET || process.env.JWT_SECRET === INSECURE_DEFAULT_JWT_SECRET)) {
  console.error('FATAL: JWT_SECRET must be set to a strong, unique secret when NODE_ENV=production. Generate one with `openssl rand -base64 32` and set it in your environment. Refusing to start.');
  process.exit(1);
}
const TOKEN_EXPIRY = '24h';
const REMEMBER_ME_EXPIRY = '7d';
const BCRYPT_ROUNDS = 10;

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

const materialsStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, PRIVATE_UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}-${file.originalname}`),
});
const materialsUpload = multer({ storage: materialsStorage, limits: { fileSize: 25 * 1024 * 1024 } });

const restoreUpload = multer({ dest: RESTORE_TMP_DIR, limits: { fileSize: 500 * 1024 * 1024 } });

function parseJsonList(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseArrayParam(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

function serializeList(value) {
  return Array.isArray(value) ? JSON.stringify(value) : JSON.stringify([]);
}

function computeSchoolExamStatus(startDate, endDate, referenceDate = new Date()) {
  if (!startDate || !endDate) return 'Upcoming';
  const today = referenceDate.toISOString().slice(0, 10);
  if (today < startDate) return 'Upcoming';
  if (today > endDate) return 'Completed';
  return 'Ongoing';
}

function formatReminderDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function addDays(dateString, days) {
  const date = new Date(dateString);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function mapSchoolExamRowToSchedule(row) {
  return {
    id: String(row.id),
    studentId: row.studentId,
    studentName: row.studentName,
    branchId: row.branchId,
    schoolName: row.schoolName,
    schoolClass: row.schoolClass,
    examName: row.examName,
    startDate: row.startDate,
    endDate: row.endDate,
    subject: row.subject,
    description: row.description,
    attachmentPath: row.attachmentPath,
    attachmentName: row.attachmentName,
    attachmentSize: row.attachmentSize,
    status: computeSchoolExamStatus(row.startDate, row.endDate),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    teacherId: row.teacherId,
    teacherName: row.teacherName,
  };
}

async function upsertSchoolExamReminderNotifications(db, schedule) {
  if (!schedule?.id) return;
  const scheduleId = schedule.id;
  const studentName = schedule.studentName || 'the student';
  const examName = schedule.examName || 'school examination';
  const startDate = schedule.startDate;
  const branchId = schedule.branchId || null;
  const teacherId = schedule.teacherId || null;

  await db.run(`DELETE FROM notifications WHERE notificationType = ? AND description = ?`, 'school_exam_schedule_reminder', `schoolExamScheduleId:${scheduleId}`);

  const reminders = [
    {
      id: `SE-${scheduleId}-3days`,
      title: `Reminder: ${studentName}'s school ${examName} begins in 3 days`,
      message: `Reminder: ${studentName}'s school ${examName} examination begins in 3 days (${formatReminderDate(startDate)}). Please ensure revision planning is completed.`,
      description: `schoolExamScheduleId:${scheduleId}`,
      type: 'warning',
      priority: 'high',
      roles: JSON.stringify(['admin']),
      teacherIds: JSON.stringify([]),
      classNames: JSON.stringify([]),
      userIds: JSON.stringify([]),
      studentIds: JSON.stringify([]),
      sender: 'System',
      notificationType: 'school_exam_schedule_reminder',
      recipient: 'Admin',
      recipientRole: 'admin',
      branchId,
      status: 'unread',
      read: 0,
      createdAt: new Date().toISOString(),
      scheduledFor: startDate ? addDays(startDate, -3) : null,
      expiresAt: null,
    },
    {
      id: `SE-${scheduleId}-1day`,
      title: `Reminder: Tomorrow is ${studentName}'s school ${examName} examination`,
      message: `Reminder: Tomorrow is ${studentName}'s school ${examName} examination.`,
      description: `schoolExamScheduleId:${scheduleId}`,
      type: 'warning',
      priority: 'high',
      roles: JSON.stringify([]),
      teacherIds: teacherId ? JSON.stringify([teacherId]) : JSON.stringify([]),
      classNames: JSON.stringify([]),
      userIds: JSON.stringify([]),
      studentIds: JSON.stringify([]),
      sender: 'System',
      notificationType: 'school_exam_schedule_reminder',
      recipient: 'Assigned Teacher',
      recipientRole: 'teacher',
      branchId,
      status: 'unread',
      read: 0,
      createdAt: new Date().toISOString(),
      scheduledFor: startDate ? addDays(startDate, -1) : null,
      expiresAt: null,
    },
    {
      id: `SE-${scheduleId}-start`,
      title: `Today ${studentName}'s school examination begins`,
      message: `Today ${studentName}'s school examination begins.`,
      description: `schoolExamScheduleId:${scheduleId}`,
      type: 'info',
      priority: 'high',
      roles: JSON.stringify(['admin']),
      teacherIds: teacherId ? JSON.stringify([teacherId]) : JSON.stringify([]),
      classNames: JSON.stringify([]),
      userIds: JSON.stringify([]),
      studentIds: JSON.stringify([]),
      sender: 'System',
      notificationType: 'school_exam_schedule_reminder',
      recipient: 'Admin and Teacher',
      recipientRole: 'admin',
      branchId,
      status: 'unread',
      read: 0,
      createdAt: new Date().toISOString(),
      scheduledFor: startDate || null,
      expiresAt: null,
    },
  ];

  const insert = await db.prepare(`INSERT OR REPLACE INTO notifications (id, title, message, description, type, priority, roles, teacherIds, classNames, userIds, studentIds, sender, notificationType, recipient, recipientRole, branchId, status, read, createdAt, scheduledFor, expiresAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const reminder of reminders) {
    await insert.run(reminder.id, reminder.title, reminder.message, reminder.description, reminder.type, reminder.priority, reminder.roles, reminder.teacherIds, reminder.classNames, reminder.userIds, reminder.studentIds, reminder.sender, reminder.notificationType, reminder.recipient, reminder.recipientRole, reminder.branchId, reminder.status, reminder.read, reminder.createdAt, reminder.scheduledFor, reminder.expiresAt);
  }
  await insert.finalize();
}

function matchesUserScope(notification, user) {
  if (!user) return true;
  if (user.role === 'super_admin') return true;

  const roles = parseJsonList(notification.roles);
  if (roles.length > 0 && !roles.includes(user.role) && !roles.includes('all') && !roles.includes('everyone')) {
    return false;
  }

  if (notification.userIds?.includes(user.id)) return true;
  if (notification.teacherIds?.includes(user.id)) return true;
  if (notification.studentIds?.some((studentId) => user.linkedStudentIds?.includes(studentId))) return true;

  if (user.role === 'teacher') {
    const assignedClasses = user.assignedClassIds ?? [];
    if (notification.classNames?.some((className) => assignedClasses.includes(className))) return true;
    if (roles.includes('teacher')) return true;
    return false;
  }

  if (user.role === 'parent') {
    if (notification.classNames?.length && (user.linkedStudentIds?.length ?? 0) > 0) return true;
    if (roles.includes('parent')) return true;
    return false;
  }

  if (user.role === 'admin' || user.role === 'accountant') {
    return !notification.branchId || notification.branchId === user.branchId;
  }

  return true;
}

function mapRowToNotification(row) {
  return {
    id: row.id,
    title: row.title,
    message: row.message,
    description: row.description,
    type: row.type,
    priority: row.priority,
    roles: parseJsonList(row.roles),
    teacherIds: parseJsonList(row.teacherIds),
    classNames: parseJsonList(row.classNames),
    userIds: parseJsonList(row.userIds),
    studentIds: parseJsonList(row.studentIds),
    sender: row.sender,
    notificationType: row.notificationType,
    recipient: row.recipient,
    recipientRole: row.recipientRole,
    branchId: row.branchId,
    status: row.status || 'unread',
    read: Boolean(row.read),
    createdAt: row.createdAt,
    readAt: row.readAt,
    readBy: row.readBy,
    readByRole: row.readByRole,
    readByBranch: row.readByBranch,
    deletedAt: row.deletedAt,
    deletedBy: row.deletedBy,
    deletedByBranch: row.deletedByBranch,
    scheduledFor: row.scheduledFor,
    expiresAt: row.expiresAt,
  };
}

async function initDb() {
  const db = await open({ filename: path.resolve(process.cwd(), 'server', 'data.db'), driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE IF NOT EXISTS exams (
      id INTEGER PRIMARY KEY,
      name TEXT,
      subject TEXT,
      className TEXT,
      batch TEXT,
      date TEXT,
      maxMarks INTEGER,
      passingMarks INTEGER,
      description TEXT,
      status TEXT,
      createdBy TEXT,
      createdAt TEXT,
      attachmentPath TEXT,
      attachmentName TEXT,
      attachmentSize INTEGER
    );
  `);

  try {
    await db.exec(`ALTER TABLE exams ADD COLUMN passingMarks INTEGER DEFAULT 35`);
  } catch (err) {
    // Ignore error if column already exists
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS allocations (
      id INTEGER PRIMARY KEY,
      teacherId TEXT,
      className TEXT,
      subject TEXT,
      batch TEXT
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS homework (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      className TEXT,
      batch TEXT,
      subject TEXT,
      title TEXT,
      description TEXT,
      dueDate TEXT,
      dueTime TEXT,
      teacherId TEXT,
      assignedBy TEXT,
      branchId TEXT,
      createdAt TEXT,
      attachments TEXT
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS homework_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      homeworkId INTEGER,
      studentId TEXT,
      studentName TEXT,
      rollNumber TEXT,
      submissionTime TEXT,
      submissionStatus TEXT,
      filePath TEXT,
      fileName TEXT,
      fileSize INTEGER,
      remarks TEXT,
      reviewedAt TEXT,
      reviewedBy TEXT
    );
  `);

  const homeworkCount = await db.get('SELECT COUNT(1) as c FROM homework');
  if (homeworkCount.c === 0) {
    const now = new Date().toISOString();
    const dueDate = new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0]; // 2 days from now
    
    const seedHw = [
      {
        className: '10th A',
        batch: '2026-Day',
        subject: 'Mathematics',
        title: 'Algebraic Equations Exercise 4.2',
        description: 'Complete all questions from Section 4.2. Submit a scanned copy of your working out.',
        dueDate: dueDate,
        dueTime: '23:59',
        teacherId: 'teacher_1',
        assignedBy: 'Teacher User 1',
        branchId: 'branch_rajajinagar',
        createdAt: now,
        attachments: JSON.stringify([])
      },
      {
        className: '10th A',
        batch: '2026-Day',
        subject: 'Mathematics',
        title: 'Quadratic Equations Worksheet',
        description: 'Please find the attached question paper and answer all equations. Show all step-by-step proofs.',
        dueDate: new Date(Date.now() - 86400000).toISOString().split('T')[0], // yesterday (overdue)
        dueTime: '17:00',
        teacherId: 'teacher_1',
        assignedBy: 'Teacher User 1',
        branchId: 'branch_rajajinagar',
        createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
        attachments: JSON.stringify([])
      }
    ];
    
    const insertHw = await db.prepare(`INSERT INTO homework (className, batch, subject, title, description, dueDate, dueTime, teacherId, assignedBy, branchId, createdAt, attachments) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const hw of seedHw) {
      await insertHw.run(hw.className, hw.batch, hw.subject, hw.title, hw.description, hw.dueDate, hw.dueTime, hw.teacherId, hw.assignedBy, hw.branchId, hw.createdAt, hw.attachments);
    }
    await insertHw.finalize();
  }


  await db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      title TEXT,
      message TEXT,
      description TEXT,
      type TEXT,
      priority TEXT,
      roles TEXT,
      teacherIds TEXT,
      classNames TEXT,
      userIds TEXT,
      studentIds TEXT,
      sender TEXT,
      notificationType TEXT,
      recipient TEXT,
      recipientRole TEXT,
      branchId TEXT,
      status TEXT,
      read INTEGER DEFAULT 0,
      createdAt TEXT,
      readAt TEXT,
      readBy TEXT,
      readByRole TEXT,
      readByBranch TEXT,
      deletedAt TEXT,
      deletedBy TEXT,
      deletedByBranch TEXT,
      scheduledFor TEXT,
      expiresAt TEXT
    );
  `);

  const allocationCount = await db.get('SELECT COUNT(1) as c FROM allocations');
  if (allocationCount.c === 0) {
    const sample = [
      { teacherId: 'teacher_1', className: '10th A', subject: 'Mathematics', batch: '2026-Day' },
      { teacherId: 'teacher_1', className: '10th B', subject: 'Chemistry', batch: '2026-Day' },
      { teacherId: 'teacher_2', className: '9th A', subject: 'Math', batch: '2026-Morning' },
      { teacherId: 'teacher_3', className: '8th A', subject: 'Science', batch: '2026-Morning' },
      { teacherId: 'teacher_4', className: '11th A', subject: 'Physics', batch: '2026-Day' },
    ];
    const insert = await db.prepare('INSERT INTO allocations (teacherId, className, subject, batch) VALUES (?,?,?,?)');
    for (const s of sample) await insert.run(s.teacherId, s.className, s.subject, s.batch);
    await insert.finalize();
  }

  const notificationCount = await db.get('SELECT COUNT(1) as c FROM notifications');
  if (notificationCount.c === 0) {
    const now = new Date().toISOString();
    const sampleNotifications = [
      {
        id: 'N001',
        title: 'Welcome to Guru Shishyaru Tutorials',
        message: 'Your account has been set up successfully.',
        description: 'Account setup completed successfully for your institution profile.',
        type: 'success',
        priority: 'medium',
        roles: JSON.stringify(['teacher', 'admin', 'super_admin', 'accountant', 'parent']),
        teacherIds: JSON.stringify([]),
        classNames: JSON.stringify([]),
        userIds: JSON.stringify([]),
        studentIds: JSON.stringify([]),
        sender: 'System',
        notificationType: 'Account',
        recipient: 'All Users',
        recipientRole: 'all',
        branchId: null,
        status: 'unread',
        read: 0,
        createdAt: now,
      },
      {
        id: 'N002',
        title: 'You have been assigned to Class 10A — Mathematics',
        message: 'Admin has allocated you to Class 10A for Mathematics, Batch A. 35 students enrolled.',
        description: 'New class allocation for the current batch.',
        type: 'info',
        priority: 'high',
        roles: JSON.stringify(['teacher']),
        teacherIds: JSON.stringify([]),
        classNames: JSON.stringify(['10th A']),
        userIds: JSON.stringify([]),
        studentIds: JSON.stringify([]),
        sender: 'Admin',
        notificationType: 'Allocation',
        recipient: 'Teacher',
        recipientRole: 'teacher',
        branchId: 'BR001',
        status: 'unread',
        read: 0,
        createdAt: now,
      },
    ];

    const insert = await db.prepare(`INSERT INTO notifications (id, title, message, description, type, priority, roles, teacherIds, classNames, userIds, studentIds, sender, notificationType, recipient, recipientRole, branchId, status, read, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const item of sampleNotifications) {
      await insert.run(item.id, item.title, item.message, item.description, item.type, item.priority, item.roles, item.teacherIds, item.classNames, item.userIds, item.studentIds, item.sender, item.notificationType, item.recipient, item.recipientRole, item.branchId, item.status, item.read, item.createdAt);
    }
    await insert.finalize();
  }

  // Create parents, students, parent_student, attendance, sms_logs, sms_settings tables
  await db.exec(`
    CREATE TABLE IF NOT EXISTS parents (
      id TEXT PRIMARY KEY,
      firstName TEXT,
      lastName TEXT,
      mobile TEXT UNIQUE,
      email TEXT,
      password TEXT DEFAULT 'Password@123',
      branchId TEXT,
      status TEXT DEFAULT 'Active',
      createdAt TEXT
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS students (
      id TEXT PRIMARY KEY,
      firstName TEXT,
      lastName TEXT,
      fullName TEXT,
      gender TEXT,
      dob TEXT,
      className TEXT,
      batch TEXT,
      branchId TEXT,
      rollNumber TEXT,
      admissionNumber TEXT,
      admissionDate TEXT,
      status TEXT DEFAULT 'Active',
      fatherName TEXT,
      motherName TEXT,
      primaryParentName TEXT,
      relationship TEXT,
      fatherMobile TEXT,
      motherMobile TEXT,
      primaryParentMobile TEXT,
      parentEmail TEXT,
      guardianName TEXT,
      guardianMobile TEXT,
      address TEXT
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS parent_student (
      parentId TEXT,
      studentId TEXT,
      PRIMARY KEY (parentId, studentId)
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      className TEXT,
      date TEXT,
      studentId TEXT,
      status TEXT,
      markedBy TEXT,
      createdAt TEXT,
      UNIQUE(className, date, studentId)
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS sms_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studentId TEXT,
      studentName TEXT,
      parentName TEXT,
      mobile TEXT,
      branchId TEXT,
      attendanceDate TEXT,
      sentTime TEXT,
      status TEXT,
      failureReason TEXT,
      retryCount INTEGER DEFAULT 0,
      teacher TEXT
    );
  `);

  try {
    await db.exec('ALTER TABLE sms_logs ADD COLUMN teacher TEXT;');
  } catch (err) {
    // Column already exists, ignore
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS sms_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS whatsapp_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studentId TEXT,
      studentName TEXT,
      parentName TEXT,
      mobile TEXT,
      branchId TEXT,
      className TEXT,
      attendanceDate TEXT,
      sentTime TEXT,
      status TEXT,
      failureReason TEXT,
      retryCount INTEGER DEFAULT 0,
      teacher TEXT
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS whatsapp_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS ledger_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      voucherNumber TEXT UNIQUE,
      date TEXT,
      type TEXT,
      category TEXT,
      description TEXT,
      amount REAL,
      paymentMode TEXT,
      referenceNumber TEXT,
      enteredBy TEXT,
      branchId TEXT,
      attachmentPath TEXT,
      attachmentName TEXT,
      attachmentSize INTEGER,
      runningBalance REAL
    );
  `);

  await db.exec(`
    
    CREATE TABLE IF NOT EXISTS inventory_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      status TEXT DEFAULT 'Active'
    );
    CREATE TABLE IF NOT EXISTS inventory_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      itemName TEXT,
      category TEXT,
      itemCode TEXT UNIQUE,
      description TEXT,
      quantity INTEGER,
      allocatedQuantity INTEGER DEFAULT 0,
      availableQuantity INTEGER DEFAULT 0,
      damagedQuantity INTEGER DEFAULT 0,
      minStock INTEGER,
      unit TEXT,
      purchaseDate TEXT,
      supplier TEXT,
      purchaseCost REAL,
      branchId TEXT,
      status TEXT DEFAULT 'Active'
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studentId TEXT,
      studentName TEXT,
      admissionNumber TEXT,
      branchId TEXT,
      itemId INTEGER,
      itemName TEXT,
      quantity INTEGER,
      allocatedDate TEXT,
      allocatedBy TEXT,
      remarks TEXT
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS monthly_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      month TEXT,
      branchId TEXT,
      submittedBy TEXT,
      submittedDate TEXT,
      status TEXT DEFAULT 'Submitted',
      totalIncome REAL,
      totalExpense REAL,
      netProfit REAL,
      ledgerSummary TEXT,
      inventoryPurchased INTEGER,
      inventoryAllocated INTEGER,
      inventoryRemaining INTEGER,
      lowStockItems TEXT,
      studentAdmissions INTEGER,
      outstandingFees REAL,
      remarks TEXT,
      comments TEXT
    );
  `);


  await db.exec(`
    CREATE TABLE IF NOT EXISTS special_classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      subject TEXT,
      branchId TEXT,
      className TEXT,
      batch TEXT,
      date TEXT,
      startTime TEXT,
      endTime TEXT,
      venue TEXT,
      purpose TEXT,
      description TEXT,
      attachmentPath TEXT,
      status TEXT,
      teacherId TEXT,
      teacherName TEXT,
      createdAt TEXT
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS school_exam_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studentId TEXT,
      studentName TEXT,
      branchId TEXT,
      schoolName TEXT,
      schoolClass TEXT,
      examName TEXT,
      startDate TEXT,
      endDate TEXT,
      subject TEXT,
      description TEXT,
      attachmentPath TEXT,
      attachmentName TEXT,
      attachmentSize INTEGER,
      status TEXT,
      createdBy TEXT,
      createdAt TEXT,
      updatedAt TEXT,
      teacherId TEXT,
      teacherName TEXT
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS bonus_attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studentId TEXT,
      studentName TEXT,
      specialClassId INTEGER,
      date TEXT,
      attendanceStatus TEXT,
      teacherName TEXT,
      branchId TEXT,
      createdAt TEXT,
      UNIQUE(studentId, specialClassId)
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE,
      mobile TEXT UNIQUE,
      passwordHash TEXT NOT NULL,
      roles TEXT NOT NULL,
      branchId TEXT,
      status TEXT DEFAULT 'Active',
      mustChangePassword INTEGER DEFAULT 0,
      createdAt TEXT,
      updatedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS teacher_profiles (
      id TEXT PRIMARY KEY,
      qualification TEXT,
      experience TEXT,
      subjects TEXT,
      department TEXT,
      salaryType TEXT DEFAULT 'Monthly Fixed',
      salaryAmount REAL DEFAULT 0,
      monthlySalary REAL,
      salaryPerClass REAL,
      createdAt TEXT,
      updatedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS admissions (
      id TEXT PRIMARY KEY,
      applicantName TEXT NOT NULL,
      grade TEXT,
      appliedDate TEXT,
      contactNumber TEXT,
      email TEXT,
      branchId TEXT,
      status TEXT DEFAULT 'Enquiry',
      createdAt TEXT,
      updatedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS teacher_tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      teacherId TEXT,
      teacherName TEXT,
      branchId TEXT,
      priority TEXT DEFAULT 'medium',
      dueDate TEXT,
      dueTime TEXT,
      relatedClass TEXT,
      relatedSubject TEXT,
      attachmentUrl TEXT,
      status TEXT DEFAULT 'pending',
      progress INTEGER DEFAULT 0,
      completionRemarks TEXT,
      createdAt TEXT,
      updatedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS exam_marks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      examId TEXT NOT NULL,
      studentId TEXT NOT NULL,
      studentName TEXT,
      rollNumber TEXT,
      marksObtained REAL,
      percentage REAL,
      grade TEXT,
      pass INTEGER,
      createdAt TEXT,
      updatedAt TEXT,
      UNIQUE(examId, studentId)
    );

    CREATE TABLE IF NOT EXISTS timetable_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      className TEXT NOT NULL,
      dayOfWeek TEXT NOT NULL,
      period TEXT NOT NULL,
      subject TEXT,
      teacherId TEXT,
      teacherName TEXT,
      room TEXT,
      branchId TEXT,
      createdAt TEXT,
      updatedAt TEXT,
      UNIQUE(className, dayOfWeek, period)
    );
  `);

  try { await db.exec("ALTER TABLE allocations ADD COLUMN branchId TEXT;"); } catch(e) {}
  try { await db.exec("ALTER TABLE allocations ADD COLUMN status TEXT DEFAULT 'Assigned';"); } catch(e) {}
  try { await db.exec("ALTER TABLE allocations ADD COLUMN students INTEGER DEFAULT 0;"); } catch(e) {}
  try { await db.exec("ALTER TABLE allocations ADD COLUMN weeklyHours INTEGER DEFAULT 0;"); } catch(e) {}
  try { await db.exec("ALTER TABLE allocations ADD COLUMN teacherName TEXT;"); } catch(e) {}
  try { await db.exec("ALTER TABLE allocations ADD COLUMN createdAt TEXT;"); } catch(e) {}
  try { await db.exec("ALTER TABLE allocations ADD COLUMN updatedAt TEXT;"); } catch(e) {}
  try { await db.exec("ALTER TABLE teacher_profiles ADD COLUMN gender TEXT;"); } catch(e) {}
  try { await db.exec("ALTER TABLE teacher_profiles ADD COLUMN dob TEXT;"); } catch(e) {}
  try { await db.exec("ALTER TABLE teacher_profiles ADD COLUMN address TEXT;"); } catch(e) {}
  try { await db.exec("ALTER TABLE teacher_profiles ADD COLUMN employmentType TEXT;"); } catch(e) {}
  try { await db.exec("ALTER TABLE teacher_profiles ADD COLUMN profilePhoto TEXT;"); } catch(e) {}
  try { await db.exec("ALTER TABLE teacher_profiles ADD COLUMN dateOfJoining TEXT;"); } catch(e) {}
  try { await db.exec("DELETE FROM allocations WHERE teacherId IN ('teacher_1','teacher_2','teacher_3','teacher_4');"); } catch(e) {}

  // Seed default SMS settings

  try { await db.exec("ALTER TABLE inventory_items ADD COLUMN uniformSize TEXT;"); } catch(e) {}
  try { await db.exec("ALTER TABLE inventory_allocations ADD COLUMN uniformSize TEXT;"); } catch(e) {}
  try { await db.exec("INSERT OR IGNORE INTO inventory_categories (name, status) VALUES ('Books', 'Active'), ('Uniform', 'Active'), ('Stationery', 'Active');"); } catch(e) {}

  const settingsCount = await db.get('SELECT COUNT(1) as c FROM sms_settings');
  if (settingsCount.c === 0) {
    const defaultSettings = [
      { key: 'enable_sms', value: 'true' },
      { key: 'sms_provider', value: 'MSG91' },
      { key: 'api_key', value: 'dummy_key_123456' },
      { key: 'sender_id', value: 'GURUSH' },
      { key: 'official_contact', value: '6363099546' },
      { key: 'retry_attempts', value: '3' }
    ];
    const insertSettings = await db.prepare('INSERT INTO sms_settings (key, value) VALUES (?, ?)');
    for (const s of defaultSettings) {
      await insertSettings.run(s.key, s.value);
    }
    await insertSettings.finalize();
  }

  // Seed default WhatsApp settings
  const whatsappSettingsCount = await db.get('SELECT COUNT(1) as c FROM whatsapp_settings');
  if (whatsappSettingsCount.c === 0) {
    const defaultSettings = [
      { key: 'enable_whatsapp', value: 'true' },
      { key: 'whatsapp_provider', value: 'WhatsApp Business Cloud API' },
      { key: 'api_token', value: 'dummy_token_123456' },
      { key: 'phone_number_id', value: 'dummy_phone_id_123456' },
      { key: 'business_account_id', value: 'dummy_business_id_123456' },
      { key: 'official_contact', value: '6363099546' },
      { key: 'template_name', value: 'attendance_absence_alert' },
      { key: 'retry_attempts', value: '3' },
      { key: 'business_name', value: 'Guru Shishyaru Tutorials' },
      { key: 'webhook_url', value: '' },
      { key: 'api_version', value: 'v17.0' }
    ];
    const insertSettings = await db.prepare('INSERT INTO whatsapp_settings (key, value) VALUES (?, ?)');
    for (const s of defaultSettings) {
      await insertSettings.run(s.key, s.value);
    }
    await insertSettings.finalize();
  } else {
    // Ensure new fields are registered if DB was already seeded
    const seedNewKeys = [
      { key: 'business_name', value: 'Guru Shishyaru Tutorials' },
      { key: 'webhook_url', value: '' },
      { key: 'api_version', value: 'v17.0' }
    ];
    for (const k of seedNewKeys) {
      await db.run('INSERT OR IGNORE INTO whatsapp_settings (key, value) VALUES (?, ?)', k.key, k.value);
    }
  }


  // Seed students & parent relationships
  const studentsCount = await db.get('SELECT COUNT(1) as c FROM students');
  if (studentsCount.c === 0) {
    const defaultStudents = [
      { id: 'STU001', firstName: 'Alice', lastName: 'Johnson', fullName: 'Alice Johnson', gender: 'Female', dob: '2010-03-15', className: '10th A', batch: 'Batch A', branchId: 'branch_rajajinagar', rollNumber: '01', admissionNumber: 'ADM001', admissionDate: '2023-06-01', status: 'Active', fatherName: 'Robert Johnson', motherName: 'Jane Johnson', primaryParentName: 'Robert Johnson', relationship: 'Father', fatherMobile: '9876543210', motherMobile: '9876543219', primaryParentMobile: '9876543210', parentEmail: 'robert@email.com', guardianName: '', guardianMobile: '', address: 'Bangalore, Karnataka' },
      { id: 'STU002', firstName: 'Bob', lastName: 'Smith', fullName: 'Bob Smith', gender: 'Male', dob: '2011-07-22', className: '9th B', batch: 'Batch B', branchId: 'branch_jayanagar', rollNumber: '02', admissionNumber: 'ADM002', admissionDate: '2023-06-01', status: 'Active', fatherName: 'John Smith', motherName: 'Emily Smith', primaryParentName: 'Emily Smith', relationship: 'Mother', fatherMobile: '9876543220', motherMobile: '9876543211', primaryParentMobile: '9876543211', parentEmail: 'emily@email.com', guardianName: '', guardianMobile: '', address: 'Mysore, Karnataka' },
      { id: 'STU003', firstName: 'Carol', lastName: 'Davis', fullName: 'Carol Davis', gender: 'Female', dob: '2009-11-08', className: '11th A', batch: 'Batch A', branchId: 'branch_rajajinagar', rollNumber: '03', admissionNumber: 'ADM003', admissionDate: '2022-06-01', status: 'Active', fatherName: 'Michael Davis', motherName: 'Mary Davis', primaryParentName: 'Michael Davis', relationship: 'Father', fatherMobile: '9876543212', motherMobile: '9876543229', primaryParentMobile: '9876543212', parentEmail: 'michael@email.com', guardianName: '', guardianMobile: '', address: 'Bangalore, Karnataka' },
      { id: 'STU004', firstName: 'David', lastName: 'Wilson', fullName: 'David Wilson', gender: 'Male', dob: '2010-05-30', className: '10th C', batch: 'Batch C', branchId: 'branch_vijayanagar', rollNumber: '04', admissionNumber: 'ADM004', admissionDate: '2023-06-01', status: 'Active', fatherName: 'David Wilson Sr', motherName: 'Sarah Wilson', primaryParentName: 'Sarah Wilson', relationship: 'Mother', fatherMobile: '9876543230', motherMobile: '9876543213', primaryParentMobile: '9876543213', parentEmail: 'sarah@email.com', guardianName: '', guardianMobile: '', address: 'Hubli, Karnataka' },
      { id: 'STU005', firstName: 'Emma', lastName: 'Brown', fullName: 'Emma Brown', gender: 'Female', dob: '2008-09-12', className: '12th B', batch: 'Evening', branchId: 'branch_hsr', rollNumber: '05', admissionNumber: 'ADM005', admissionDate: '2021-06-01', status: 'Inactive', fatherName: 'James Brown', motherName: 'Helen Brown', primaryParentName: 'James Brown', relationship: 'Father', fatherMobile: '9876543214', motherMobile: '9876543239', primaryParentMobile: '9876543214', parentEmail: 'james@email.com', guardianName: '', guardianMobile: '', address: 'Mangalore, Karnataka' },
      { id: 'STU006', firstName: 'Arjun', lastName: 'Sharma', fullName: 'Arjun Sharma', gender: 'Male', dob: '2010-01-18', className: '10th A', batch: 'Batch A', branchId: 'branch_rajajinagar', rollNumber: '06', admissionNumber: 'ADM006', admissionDate: '2023-06-01', status: 'Active', fatherName: 'Ravi Sharma', motherName: 'Seema Sharma', primaryParentName: 'Ravi Sharma', relationship: 'Father', fatherMobile: '9876543215', motherMobile: '9876543249', primaryParentMobile: '9876543215', parentEmail: 'ravi@email.com', guardianName: '', guardianMobile: '', address: 'Bangalore, Karnataka' },
      { id: 'STU007', firstName: 'Priya', lastName: 'Nair', fullName: 'Priya Nair', gender: 'Female', dob: '2011-04-25', className: '9th A', batch: 'Morning', branchId: 'branch_jayanagar', rollNumber: '07', admissionNumber: 'ADM007', admissionDate: '2024-06-01', status: 'Active', fatherName: 'Suresh Nair', motherName: 'Lata Nair', primaryParentName: 'Suresh Nair', relationship: 'Father', fatherMobile: '9876543216', motherMobile: '9876543259', primaryParentMobile: '9876543216', parentEmail: 'suresh@email.com', guardianName: '', guardianMobile: '', address: 'Bangalore, Karnataka' },
      { id: 'STU008', firstName: 'Rohit', lastName: 'Verma', fullName: 'Rohit Verma', gender: 'Male', dob: '2010-08-14', className: '10th B', batch: 'Batch B', branchId: 'branch_vijayanagar', rollNumber: '08', admissionNumber: 'ADM008', admissionDate: '2023-06-01', status: 'Active', fatherName: 'Ajay Verma', motherName: 'Rita Verma', primaryParentName: 'Ajay Verma', relationship: 'Father', fatherMobile: '9876543217', motherMobile: '9876543269', primaryParentMobile: '9876543217', parentEmail: 'ajay@email.com', guardianName: '', guardianMobile: '', address: 'Dharwad, Karnataka' },
      { id: 'STU009', firstName: 'Rahul', lastName: 'Gowda', fullName: 'Rahul Gowda', gender: 'Male', dob: '2010-04-10', className: '10th A', batch: 'Batch A', branchId: 'branch_rajajinagar', rollNumber: '09', admissionNumber: 'ADM009', admissionDate: '2023-06-01', status: 'Active', fatherName: 'Kiran Gowda', motherName: 'Deepa Gowda', primaryParentName: 'Kiran Gowda', relationship: 'Father', fatherMobile: '9148478969', motherMobile: '9876543279', primaryParentMobile: '9148478969', parentEmail: 'kiran@email.com', guardianName: '', guardianMobile: '', address: 'Bangalore, Karnataka' },
      { id: 'STU010', firstName: 'Priya', lastName: 'Gowda', fullName: 'Priya Gowda', gender: 'Female', dob: '2012-05-15', className: '8th A', batch: 'Batch B', branchId: 'branch_rajajinagar', rollNumber: '10', admissionNumber: 'ADM010', admissionDate: '2024-06-01', status: 'Active', fatherName: 'Kiran Gowda', motherName: 'Deepa Gowda', primaryParentName: 'Kiran Gowda', relationship: 'Father', fatherMobile: '9148478969', motherMobile: '9876543279', primaryParentMobile: '9148478969', parentEmail: 'kiran@email.com', guardianName: '', guardianMobile: '', address: 'Bangalore, Karnataka' }
    ];

    const insertStudent = await db.prepare(`
      INSERT INTO students (
        id, firstName, lastName, fullName, gender, dob, className, batch, branchId,
        rollNumber, admissionNumber, admissionDate, status, fatherName, motherName,
        primaryParentName, relationship, fatherMobile, motherMobile, primaryParentMobile,
        parentEmail, guardianName, guardianMobile, address
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);

    let parentCounter = 1;
    const parentMobileToId = {};

    for (const student of defaultStudents) {
      await insertStudent.run(
        student.id, student.firstName, student.lastName, student.fullName, student.gender, student.dob,
        student.className, student.batch, student.branchId, student.rollNumber, student.admissionNumber,
        student.admissionDate, student.status, student.fatherName, student.motherName, student.primaryParentName,
        student.relationship, student.fatherMobile, student.motherMobile, student.primaryParentMobile,
        student.parentEmail, student.guardianName, student.guardianMobile, student.address
      );

      const pMobile = student.primaryParentMobile;
      if (pMobile) {
        let parentId = parentMobileToId[pMobile];
        if (!parentId) {
          parentId = `PAR${String(parentCounter++).padStart(3, '0')}`;
          parentMobileToId[pMobile] = parentId;

          // Parse Parent names
          const parts = (student.primaryParentName || 'Parent').split(' ');
          const fName = parts[0];
          const lName = parts.slice(1).join(' ') || 'User';

          await db.run(`
            INSERT OR IGNORE INTO parents (id, firstName, lastName, mobile, email, password, branchId, status, createdAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'Active', ?)
          `, parentId, fName, lName, pMobile, student.parentEmail || '', 'Password@123', student.branchId, new Date().toISOString());
        }

        // link parent to student
        await db.run(`
          INSERT OR IGNORE INTO parent_student (parentId, studentId)
          VALUES (?, ?)
        `, parentId, student.id);
      }
    }
    await insertStudent.finalize();
  }

  // Seed special class announcement
  const classCount = await db.get('SELECT COUNT(1) as c FROM special_classes');
  if (classCount.c === 0) {
    await db.run(`
      INSERT INTO special_classes (
        title, subject, branchId, className, batch, date, startTime, endTime, venue, purpose, description, attachmentPath, status, teacherId, teacherName, createdAt
      ) VALUES (
        'Mathematics Revision Class', 'Mathematics', 'branch_rajajinagar', '10th A', 'Batch A', '2026-07-12', '17:00', '19:00', 'Room 204', 'Revision', 'Extra revision class covering Algebra and Calculus.', '', 'Published', 'teacher_kumar', 'Mr. Kumar', ?
      )
    `, new Date().toISOString());
  }

  // Seed ledger transactions
  const ledgerCount = await db.get('SELECT COUNT(1) as c FROM ledger_transactions');
  if (ledgerCount.c === 0) {
    const seedTransactions = [
      { voucherNumber: 'VOU-20260601-001', date: '2026-06-01', type: 'Income', category: 'Admission Fee', description: 'Admission Fee received from Rahul.', amount: 5000, paymentMode: 'UPI', referenceNumber: 'REF12345', enteredBy: 'Accountant User', branchId: 'branch_rajajinagar', runningBalance: 5000 },
      { voucherNumber: 'VOU-20260610-001', date: '2026-06-10', type: 'Expense', category: 'Supplies', description: 'Purchased 25 chairs.', amount: 12500, paymentMode: 'Bank Transfer', referenceNumber: 'TXN77889', enteredBy: 'Accountant User', branchId: 'branch_rajajinagar', runningBalance: -7500 },
      { voucherNumber: 'VOU-20260615-001', date: '2026-06-15', type: 'Expense', category: 'Utilities', description: 'Paid Electricity Bill.', amount: 2400, paymentMode: 'Cash', referenceNumber: '', enteredBy: 'Accountant User', branchId: 'branch_rajajinagar', runningBalance: -9900 },
      { voucherNumber: 'VOU-20260619-001', date: '2026-06-19', type: 'Income', category: 'Tuition Fee', description: 'Fee — Alice Johnson', amount: 5000, paymentMode: 'Cheque', referenceNumber: 'CHQ998822', enteredBy: 'Accountant User', branchId: 'branch_rajajinagar', runningBalance: -4900 },
      { voucherNumber: 'VOU-20260620-001', date: '2026-06-20', type: 'Expense', category: 'Salaries', description: 'Salary Payment.', amount: 45000, paymentMode: 'Bank Transfer', referenceNumber: 'TXN112233', enteredBy: 'Accountant User', branchId: 'branch_rajajinagar', runningBalance: -49900 }
    ];

    const insertLedger = await db.prepare(`
      INSERT INTO ledger_transactions (voucherNumber, date, type, category, description, amount, paymentMode, referenceNumber, enteredBy, branchId, runningBalance)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const t of seedTransactions) {
      await insertLedger.run(t.voucherNumber, t.date, t.type, t.category, t.description, t.amount, t.paymentMode, t.referenceNumber, t.enteredBy, t.branchId, t.runningBalance);
    }
    await insertLedger.finalize();
  }

  // Seed inventory items
  const inventoryCount = await db.get('SELECT COUNT(1) as c FROM inventory_items');
  if (inventoryCount.c === 0) {
    const seedInventory = [
      { itemName: 'Textbooks - Mathematics', category: 'Books', itemCode: 'INV-001', description: 'Class 10th Math Textbooks', quantity: 150, allocatedQuantity: 50, availableQuantity: 100, damagedQuantity: 0, minStock: 20, unit: 'pcs', purchaseDate: '2026-05-10', supplier: 'NCERT Publishers', purchaseCost: 150, branchId: 'branch_rajajinagar' },
      { itemName: 'Guru Shishyaru School Uniform', category: 'Uniform', itemCode: 'INV-002', description: 'Uniform Sets size 38', quantity: 80, allocatedQuantity: 30, availableQuantity: 45, damagedQuantity: 5, minStock: 10, unit: 'sets', purchaseDate: '2026-05-12', supplier: 'Textile World', purchaseCost: 850, branchId: 'branch_rajajinagar' },
      { itemName: 'Tutorial Bags', category: 'Bag', itemCode: 'INV-003', description: 'Standard student back bags', quantity: 40, allocatedQuantity: 10, availableQuantity: 28, damagedQuantity: 2, minStock: 5, unit: 'pcs', purchaseDate: '2026-05-15', supplier: 'Bag Masters', purchaseCost: 400, branchId: 'branch_rajajinagar' },
      { itemName: 'Student ID Cards', category: 'ID Card', itemCode: 'INV-004', description: 'Plastic ID Cards with Lanyards', quantity: 200, allocatedQuantity: 0, availableQuantity: 200, damagedQuantity: 0, minStock: 50, unit: 'pcs', purchaseDate: '2026-06-01', supplier: 'ID Printing Ltd', purchaseCost: 45, branchId: 'branch_rajajinagar' }
    ];

    const insertInv = await db.prepare(`
      INSERT INTO inventory_items (itemName, category, itemCode, description, quantity, allocatedQuantity, availableQuantity, damagedQuantity, minStock, unit, purchaseDate, supplier, purchaseCost, branchId)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const item of seedInventory) {
      await insertInv.run(item.itemName, item.category, item.itemCode, item.description, item.quantity, item.allocatedQuantity, item.availableQuantity, item.damagedQuantity, item.minStock, item.unit, item.purchaseDate, item.supplier, item.purchaseCost, item.branchId);
    }
    await insertInv.finalize();
  }

  // Seed real staff accounts (one-time; initial password = each person's own mobile number)
  const usersCount = await db.get('SELECT COUNT(1) as c FROM users');
  if (usersCount.c === 0) {
    const staff = [
      { id: 'USR001', name: 'Shwetha', email: 'shwetha931998@gmail.com', mobile: '6363099546', roles: ['super_admin'], branchId: null },
      { id: 'USR002', name: 'Jeevana Marakala', email: 'jeevannadoor@gmail.com', mobile: '9742879907', roles: ['super_admin'], branchId: null },
      { id: 'USR003', name: 'Keerthana G D', email: 'keerthanagd27@gmail.com', mobile: '8296776223', roles: ['admin'], branchId: 'branch_main' },
      { id: 'USR004', name: 'Varuna M', email: 'madanu666@gmail.com', mobile: '9980522847', roles: ['admin'], branchId: 'branch_main' },
      { id: 'USR005', name: 'Nithya R', email: 'nithyaraghu10@gmail.com', mobile: '9611963995', roles: ['teacher'], branchId: 'branch_main' },
      { id: 'USR006', name: 'Pooja R', email: 'rameshpooja486@gmail.com', mobile: '9538542048', roles: ['teacher'], branchId: 'branch_main' },
      { id: 'USR007', name: 'Pallavi M P', email: 'pallavimp456@gmail.com', mobile: '8431281224', roles: ['teacher'], branchId: 'branch_main' },
      { id: 'USR008', name: 'Shalini H S', email: 'shalinihs63@gmail.com', mobile: '9945052954', roles: ['teacher'], branchId: 'branch_main' },
      { id: 'USR009', name: 'Meghana', email: 'megharathnamegharathna@gmail.com', mobile: '9353721344', roles: ['teacher'], branchId: 'branch_main' },
      { id: 'USR010', name: 'Mamatha P K', email: 'mamathapk0207@gmail.com', mobile: '9742448558', roles: ['teacher'], branchId: 'branch_main' },
      { id: 'USR011', name: 'Renuka', email: 'renukajhsathish@gmail.com', mobile: '9036431738', roles: ['teacher'], branchId: 'branch_main' },
    ];

    const insertUser = await db.prepare(`
      INSERT INTO users (id, name, email, mobile, passwordHash, roles, branchId, status, mustChangePassword, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'Active', 0, ?, ?)
    `);
    for (const person of staff) {
      const passwordHash = bcrypt.hashSync(person.mobile, BCRYPT_ROUNDS);
      const now = new Date().toISOString();
      await insertUser.run(person.id, person.name, person.email, person.mobile, passwordHash, JSON.stringify(person.roles), person.branchId, now, now);
    }
    await insertUser.finalize();
  }

  // --- Study Materials, Lesson Plans & Backup History tables ---
  await db.exec(`
    CREATE TABLE IF NOT EXISTS materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      subject TEXT,
      className TEXT,
      batch TEXT,
      branchId TEXT,
      teacherId TEXT,
      teacherName TEXT,
      storedFileName TEXT,
      originalFileName TEXT,
      fileSize INTEGER,
      mimeType TEXT,
      createdAt TEXT,
      updatedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS lesson_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacherId TEXT,
      teacherName TEXT,
      branchId TEXT,
      className TEXT,
      batch TEXT,
      subject TEXT,
      chapterTitle TEXT,
      topic TEXT,
      textbookReference TEXT,
      plannedDate TEXT,
      objectives TEXT,
      notes TEXT,
      status TEXT DEFAULT 'Planned',
      createdAt TEXT,
      updatedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS backup_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT,
      sizeBytes INTEGER,
      createdAt TEXT,
      createdBy TEXT,
      type TEXT DEFAULT 'manual',
      status TEXT DEFAULT 'success'
    );
  `);

  // whatsapp_logs predates the homework-alert feature — add the new columns
  // idempotently for databases created before this change.
  try { await db.exec("ALTER TABLE whatsapp_logs ADD COLUMN type TEXT DEFAULT 'attendance';"); } catch (e) {}
  try { await db.exec("ALTER TABLE whatsapp_logs ADD COLUMN homeworkId INTEGER;"); } catch (e) {}
  try { await db.exec("ALTER TABLE parents ADD COLUMN occupation TEXT;"); } catch (e) {}
  try { await db.exec("ALTER TABLE parents ADD COLUMN address TEXT;"); } catch (e) {}
  try { await db.exec("ALTER TABLE users ADD COLUMN failedLoginAttempts INTEGER DEFAULT 0;"); } catch (e) {}
  try { await db.exec("ALTER TABLE users ADD COLUMN lockedUntil TEXT;"); } catch (e) {}

  await db.exec(`
    CREATE TABLE IF NOT EXISTS otp_codes (
      mobile TEXT PRIMARY KEY,
      code TEXT,
      purpose TEXT DEFAULT 'parent_login',
      expiresAt TEXT,
      attempts INTEGER DEFAULT 0,
      createdAt TEXT
    );
  `);

  await db.run('INSERT OR IGNORE INTO whatsapp_settings (key, value) VALUES (?, ?)', 'homework_template_name', 'homework_update_alert');

  // --- Fee Management & Event Management tables ---
  await db.exec(`
    CREATE TABLE IF NOT EXISTS fee_structures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      className TEXT,
      branchId TEXT,
      academicYear TEXT,
      feeType TEXT,
      amount REAL,
      dueDate TEXT,
      createdAt TEXT,
      updatedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS fee_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studentId TEXT,
      studentName TEXT,
      className TEXT,
      branchId TEXT,
      feeType TEXT,
      academicYear TEXT,
      totalAmount REAL,
      paidAmount REAL DEFAULT 0,
      dueDate TEXT,
      status TEXT DEFAULT 'Pending',
      createdAt TEXT,
      updatedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS fee_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      feeRecordId INTEGER,
      studentId TEXT,
      amount REAL,
      paymentMode TEXT,
      referenceNumber TEXT,
      receivedBy TEXT,
      paymentDate TEXT,
      receiptNumber TEXT,
      branchId TEXT,
      createdAt TEXT
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      eventType TEXT DEFAULT 'Other',
      date TEXT,
      time TEXT,
      venue TEXT,
      expectedAttendees INTEGER DEFAULT 0,
      branchId TEXT,
      createdBy TEXT,
      createdByName TEXT,
      status TEXT DEFAULT 'Scheduled',
      createdAt TEXT,
      updatedAt TEXT
    );
  `);

  return db;
}

async function main() {
  const app = express();

  const corsOrigins = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (IS_PRODUCTION && corsOrigins.length === 0) {
    console.warn('WARNING: CORS_ORIGIN is not set in production — cross-origin requests will be rejected by default. Set CORS_ORIGIN to a comma-separated list of your frontend URL(s).');
  }
  app.use(cors({
    origin: corsOrigins.length > 0 ? corsOrigins : (IS_PRODUCTION ? false : true),
    credentials: true,
  }));
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(express.json());

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts. Please try again later.' },
  });
  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api/', apiLimiter);

  let db = await initDb();
  let restoreInProgress = false;

  app.use((req, res, next) => {
    if (restoreInProgress && !req.path.startsWith('/api/backup/')) {
      return res.status(503).json({ error: 'System is restoring from backup, please try again shortly.' });
    }
    next();
  });

  // Uploaded files require authentication — direct URL access without a valid
  // session token is no longer permitted (previously served with zero auth).
  app.use('/uploads', authMiddleware, express.static(UPLOAD_DIR));

  // ─── Auth helpers ───────────────────────────────────────────────────────────

  function mapUserRow(row) {
    const roles = parseJsonList(row.roles);
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      mobile: row.mobile,
      roles,
      role: roles[0] || 'teacher',
      branchId: row.branchId || undefined,
      status: row.status,
      mustChangePassword: Boolean(row.mustChangePassword),
      createdAt: row.createdAt,
    };
  }

  function signToken(userRow, rememberMe) {
    const roles = parseJsonList(userRow.roles);
    return jwt.sign(
      {
        sub: userRow.id,
        name: userRow.name,
        email: userRow.email,
        mobile: userRow.mobile,
        roles,
        branchId: userRow.branchId || null,
      },
      JWT_SECRET,
      { expiresIn: rememberMe ? REMEMBER_ME_EXPIRY : TOKEN_EXPIRY }
    );
  }

  function authMiddleware(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      req.user = payload;
      next();
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }
  }

  // Applied to every route registered below except /api/auth/* (/uploads/* has its
  // own dedicated authMiddleware attached directly to that mount, above).
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/auth/')) return next();
    return authMiddleware(req, res, next);
  });

  // Non-super_admin requests are pinned to their own branch: query/body branchId
  // is ignored and overwritten server-side, so a scoped user can never read or
  // write another branch's data by tampering with the client.
  function resolveBranchId(req, requestedBranchId) {
    const roles = req.user?.roles || [];
    if (roles.includes('super_admin')) return requestedBranchId || undefined;
    return req.user?.branchId || undefined;
  }

  const MAX_FAILED_LOGIN_ATTEMPTS = 5;
  const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

  app.post('/api/auth/login', authLimiter, async (req, res) => {
    try {
      const identifier = String(req.body?.identifier || '').trim();
      const password = String(req.body?.password || '');
      if (!identifier || !password) {
        return res.status(400).json({ error: 'Identifier and password are required' });
      }
      const row = await db.get(
        'SELECT * FROM users WHERE (LOWER(email) = LOWER(?) OR mobile = ?) AND status = ?',
        identifier, identifier, 'Active'
      );
      if (!row) return res.status(401).json({ error: 'Invalid credentials' });

      // Per-account lockout — the IP-based authLimiter above stops a single
      // attacker from brute-forcing, but not a distributed attempt against one
      // specific account from many IPs. This closes that gap independently.
      if (row.lockedUntil && new Date(row.lockedUntil) > new Date()) {
        const minutesLeft = Math.ceil((new Date(row.lockedUntil) - new Date()) / 60000);
        return res.status(423).json({ error: `Too many failed attempts. Try again in ${minutesLeft} minute(s).` });
      }

      const match = await bcrypt.compare(password, row.passwordHash);
      if (!match) {
        const attempts = (row.failedLoginAttempts || 0) + 1;
        const lockedUntil = attempts >= MAX_FAILED_LOGIN_ATTEMPTS
          ? new Date(Date.now() + LOCKOUT_DURATION_MS).toISOString()
          : null;
        await db.run('UPDATE users SET failedLoginAttempts=?, lockedUntil=? WHERE id=?', attempts, lockedUntil, row.id);
        if (lockedUntil) {
          return res.status(423).json({ error: `Too many failed attempts. Account locked for 15 minutes.` });
        }
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      if (row.failedLoginAttempts || row.lockedUntil) {
        await db.run('UPDATE users SET failedLoginAttempts=0, lockedUntil=NULL WHERE id=?', row.id);
      }

      const rememberMe = Boolean(req.body?.rememberMe);
      const token = signToken(row, rememberMe);
      res.json({ token, user: mapUserRow(row) });
    } catch (err) {
      console.error('Login error:', err);
      res.status(500).json({ error: 'Login failed' });
    }
  });

  app.post('/api/account/change-password', async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body || {};
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'Current and new password are required' });
      }
      if (String(newPassword).length < 8) {
        return res.status(400).json({ error: 'New password must be at least 8 characters' });
      }
      const row = await db.get('SELECT * FROM users WHERE id = ?', req.user.sub);
      if (!row) return res.status(404).json({ error: 'User not found' });

      const match = await bcrypt.compare(currentPassword, row.passwordHash);
      if (!match) return res.status(401).json({ error: 'Current password is incorrect' });

      const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
      await db.run(
        'UPDATE users SET passwordHash=?, mustChangePassword=0, updatedAt=? WHERE id=?',
        newHash, new Date().toISOString(), req.user.sub
      );
      res.json({ success: true });
    } catch (err) {
      console.error('Change password error:', err);
      res.status(500).json({ error: 'Failed to change password' });
    }
  });

  // ─── Users CRUD (Super Admin manages staff accounts) ───────────────────────

  app.get('/api/users', async (req, res) => {
    if (!req.user.roles.includes('super_admin')) return res.status(403).json({ error: 'Forbidden' });
    const rows = await db.all('SELECT * FROM users ORDER BY createdAt DESC');
    res.json(rows.map(mapUserRow));
  });

  app.post('/api/users', async (req, res) => {
    if (!req.user.roles.includes('super_admin')) return res.status(403).json({ error: 'Forbidden' });
    try {
      const body = req.body || {};
      if (!body.name || !body.mobile || !Array.isArray(body.roles) || body.roles.length === 0) {
        return res.status(400).json({ error: 'name, mobile and at least one role are required' });
      }
      const id = `USR${Date.now()}`;
      const initialPassword = body.password || body.mobile;
      const passwordHash = await bcrypt.hash(initialPassword, BCRYPT_ROUNDS);
      const now = new Date().toISOString();
      const branchId = body.roles.includes('super_admin') ? null : (body.branchId || null);
      await db.run(
        `INSERT INTO users (id, name, email, mobile, passwordHash, roles, branchId, status, mustChangePassword, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'Active', 1, ?, ?)`,
        id, body.name, body.email || null, body.mobile, passwordHash, JSON.stringify(body.roles), branchId, now, now
      );
      const row = await db.get('SELECT * FROM users WHERE id = ?', id);
      res.status(201).json(mapUserRow(row));
    } catch (err) {
      console.error('Create user error:', err);
      if (String(err.message || '').includes('UNIQUE')) {
        return res.status(409).json({ error: 'A user with this email or mobile already exists' });
      }
      res.status(500).json({ error: 'Failed to create user' });
    }
  });

  app.put('/api/users/:id', async (req, res) => {
    if (!req.user.roles.includes('super_admin')) return res.status(403).json({ error: 'Forbidden' });
    try {
      const existing = await db.get('SELECT * FROM users WHERE id = ?', req.params.id);
      if (!existing) return res.status(404).json({ error: 'User not found' });
      const body = req.body || {};
      const name = body.name ?? existing.name;
      const email = body.email ?? existing.email;
      const mobile = body.mobile ?? existing.mobile;
      const roles = Array.isArray(body.roles) ? body.roles : parseJsonList(existing.roles);
      const branchId = roles.includes('super_admin') ? null : (body.branchId ?? existing.branchId);
      const status = body.status ?? existing.status;
      await db.run(
        `UPDATE users SET name=?, email=?, mobile=?, roles=?, branchId=?, status=?, updatedAt=? WHERE id=?`,
        name, email, mobile, JSON.stringify(roles), branchId, status, new Date().toISOString(), req.params.id
      );
      if (body.password) {
        const passwordHash = await bcrypt.hash(body.password, BCRYPT_ROUNDS);
        await db.run('UPDATE users SET passwordHash=?, mustChangePassword=0 WHERE id=?', passwordHash, req.params.id);
      }
      const row = await db.get('SELECT * FROM users WHERE id = ?', req.params.id);
      res.json(mapUserRow(row));
    } catch (err) {
      console.error('Update user error:', err);
      res.status(500).json({ error: 'Failed to update user' });
    }
  });

  // ─── Teachers CRUD (users with role=teacher + HR profile extension) ───────

  const TEACHER_PROFILE_COLUMNS = ['qualification', 'experience', 'subjects', 'department', 'salaryType', 'salaryAmount', 'monthlySalary', 'salaryPerClass', 'gender', 'dob', 'address', 'employmentType', 'profilePhoto', 'dateOfJoining'];
  const TEACHER_JOIN_SELECT = `SELECT u.*, ${TEACHER_PROFILE_COLUMNS.map((c) => `tp.${c}`).join(', ')} FROM users u LEFT JOIN teacher_profiles tp ON tp.id = u.id`;

  function mapTeacherRow(row) {
    const roles = parseJsonList(row.roles);
    const nameParts = String(row.name || '').trim().split(/\s+/);
    return {
      id: row.id,
      firstName: nameParts[0] || row.name || '',
      lastName: nameParts.slice(1).join(' ') || '',
      mobile: row.mobile,
      phone: row.mobile,
      email: row.email || '',
      branchId: row.branchId || undefined,
      status: row.status,
      roles,
      qualification: row.qualification || '',
      experience: row.experience || '',
      subjects: row.subjects || '',
      specialization: row.subjects || '',
      department: row.department || '',
      salaryType: row.salaryType || 'Monthly Fixed',
      salaryAmount: row.salaryAmount || 0,
      monthlySalary: row.monthlySalary ?? null,
      salaryPerClass: row.salaryPerClass ?? null,
      gender: row.gender || '',
      dob: row.dob || '',
      address: row.address || '',
      employmentType: row.employmentType || '',
      profilePhoto: row.profilePhoto || '',
      dateOfJoining: row.dateOfJoining || '',
      createdAt: row.createdAt,
    };
  }

  app.get('/api/teachers', async (req, res) => {
    // Includes salary and DOB/address from teacher_profiles — restricted to
    // admin/super_admin, not any authenticated user (previously any teacher could
    // pull every coworker's pay and home address via this endpoint).
    if (!req.user.roles.includes('super_admin') && !req.user.roles.includes('admin')) return res.status(403).json({ error: 'Forbidden' });
    try {
      const branchId = resolveBranchId(req, req.query.branchId);
      let query = `${TEACHER_JOIN_SELECT} WHERE u.roles LIKE '%teacher%'`;
      const params = [];
      if (branchId) { query += ' AND u.branchId = ?'; params.push(branchId); }
      query += ' ORDER BY u.name';
      const rows = await db.all(query, ...params);
      res.json(rows.map(mapTeacherRow));
    } catch (err) {
      console.error('List teachers error:', err);
      res.status(500).json({ error: 'Failed to load teachers' });
    }
  });

  app.post('/api/teachers', async (req, res) => {
    if (!req.user.roles.includes('super_admin') && !req.user.roles.includes('admin')) return res.status(403).json({ error: 'Forbidden' });
    try {
      const body = req.body || {};
      const mobile = body.mobile || body.phone;
      if (!body.firstName || !mobile) {
        return res.status(400).json({ error: 'First name and phone/mobile are required' });
      }
      const name = body.fullName || `${body.firstName} ${body.lastName || ''}`.trim();
      const id = `USR${Date.now()}`;
      const initialPassword = body.password || mobile;
      const passwordHash = await bcrypt.hash(initialPassword, BCRYPT_ROUNDS);
      const now = new Date().toISOString();
      const branchId = resolveBranchId(req, body.branchId) || req.user?.branchId || null;
      await db.run(
        `INSERT INTO users (id, name, email, mobile, passwordHash, roles, branchId, status, mustChangePassword, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        id, name, body.email || null, mobile, passwordHash, JSON.stringify(['teacher']), branchId, body.status || 'Active', now, now
      );
      await db.run(
        `INSERT INTO teacher_profiles (id, qualification, experience, subjects, department, salaryType, salaryAmount, monthlySalary, salaryPerClass, gender, dob, address, employmentType, profilePhoto, dateOfJoining, createdAt, updatedAt)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id, body.qualification || '', body.experience || '', body.subjects || body.specialization || '', body.department || '',
        body.salaryType || 'Monthly Fixed', Number(body.salaryAmount || 0),
        body.monthlySalary !== undefined && body.monthlySalary !== '' ? Number(body.monthlySalary) : null,
        body.salaryPerClass !== undefined && body.salaryPerClass !== '' ? Number(body.salaryPerClass) : null,
        body.gender || '', body.dob || '', body.address || '', body.employmentType || '', body.profilePhoto || '', body.dateOfJoining || '',
        now, now
      );
      const row = await db.get(`${TEACHER_JOIN_SELECT} WHERE u.id = ?`, id);
      res.status(201).json(mapTeacherRow(row));
    } catch (err) {
      console.error('Create teacher error:', err);
      if (String(err.message || '').includes('UNIQUE')) {
        return res.status(409).json({ error: 'A user with this email or mobile already exists' });
      }
      res.status(500).json({ error: 'Failed to create teacher' });
    }
  });

  app.put('/api/teachers/:id', async (req, res) => {
    if (!req.user.roles.includes('super_admin') && !req.user.roles.includes('admin')) return res.status(403).json({ error: 'Forbidden' });
    try {
      const existing = await db.get('SELECT * FROM users WHERE id = ?', req.params.id);
      if (!existing) return res.status(404).json({ error: 'Teacher not found' });
      const body = req.body || {};
      const name = body.fullName || (body.firstName ? `${body.firstName} ${body.lastName || ''}`.trim() : existing.name);
      const email = body.email ?? existing.email;
      const mobile = body.mobile ?? body.phone ?? existing.mobile;
      const branchId = resolveBranchId(req, body.branchId) ?? existing.branchId;
      const status = body.status ?? existing.status;
      const now = new Date().toISOString();
      await db.run(
        `UPDATE users SET name=?, email=?, mobile=?, branchId=?, status=?, updatedAt=? WHERE id=?`,
        name, email, mobile, branchId, status, now, req.params.id
      );
      const existingProfile = await db.get('SELECT * FROM teacher_profiles WHERE id = ?', req.params.id);
      const merged = {
        qualification: body.qualification ?? existingProfile?.qualification ?? '',
        experience: body.experience ?? existingProfile?.experience ?? '',
        subjects: body.subjects ?? body.specialization ?? existingProfile?.subjects ?? '',
        department: body.department ?? existingProfile?.department ?? '',
        salaryType: body.salaryType ?? existingProfile?.salaryType ?? 'Monthly Fixed',
        salaryAmount: body.salaryAmount !== undefined ? Number(body.salaryAmount) : (existingProfile?.salaryAmount ?? 0),
        monthlySalary: body.monthlySalary !== undefined ? Number(body.monthlySalary) : (existingProfile?.monthlySalary ?? null),
        salaryPerClass: body.salaryPerClass !== undefined ? Number(body.salaryPerClass) : (existingProfile?.salaryPerClass ?? null),
        gender: body.gender ?? existingProfile?.gender ?? '',
        dob: body.dob ?? existingProfile?.dob ?? '',
        address: body.address ?? existingProfile?.address ?? '',
        employmentType: body.employmentType ?? existingProfile?.employmentType ?? '',
        profilePhoto: body.profilePhoto ?? existingProfile?.profilePhoto ?? '',
        dateOfJoining: body.dateOfJoining ?? existingProfile?.dateOfJoining ?? '',
      };
      if (existingProfile) {
        await db.run(
          `UPDATE teacher_profiles SET qualification=?, experience=?, subjects=?, department=?, salaryType=?, salaryAmount=?, monthlySalary=?, salaryPerClass=?, gender=?, dob=?, address=?, employmentType=?, profilePhoto=?, dateOfJoining=?, updatedAt=? WHERE id=?`,
          merged.qualification, merged.experience, merged.subjects, merged.department, merged.salaryType, merged.salaryAmount, merged.monthlySalary, merged.salaryPerClass,
          merged.gender, merged.dob, merged.address, merged.employmentType, merged.profilePhoto, merged.dateOfJoining, now, req.params.id
        );
      } else {
        await db.run(
          `INSERT INTO teacher_profiles (id, qualification, experience, subjects, department, salaryType, salaryAmount, monthlySalary, salaryPerClass, gender, dob, address, employmentType, profilePhoto, dateOfJoining, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          req.params.id, merged.qualification, merged.experience, merged.subjects, merged.department, merged.salaryType, merged.salaryAmount, merged.monthlySalary, merged.salaryPerClass,
          merged.gender, merged.dob, merged.address, merged.employmentType, merged.profilePhoto, merged.dateOfJoining, now, now
        );
      }
      if (body.password) {
        const passwordHash = await bcrypt.hash(body.password, BCRYPT_ROUNDS);
        await db.run('UPDATE users SET passwordHash=?, mustChangePassword=0 WHERE id=?', passwordHash, req.params.id);
      }
      const row = await db.get(`${TEACHER_JOIN_SELECT} WHERE u.id = ?`, req.params.id);
      res.json(mapTeacherRow(row));
    } catch (err) {
      console.error('Update teacher error:', err);
      res.status(500).json({ error: 'Failed to update teacher' });
    }
  });

  app.delete('/api/teachers/:id', async (req, res) => {
    if (!req.user.roles.includes('super_admin') && !req.user.roles.includes('admin')) return res.status(403).json({ error: 'Forbidden' });
    try {
      await db.run(`UPDATE users SET status='Inactive', updatedAt=? WHERE id=?`, new Date().toISOString(), req.params.id);
      res.json({ success: true });
    } catch (err) {
      console.error('Deactivate teacher error:', err);
      res.status(500).json({ error: 'Failed to deactivate teacher' });
    }
  });

  app.post('/api/exams', upload.single('attachment'), async (req, res) => {
    if (!req.user.roles.some((r) => ['teacher', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const body = req.body;
      const attachment = req.file;
      const now = new Date().toISOString();
      const stmt = await db.prepare(`INSERT INTO exams (name, subject, className, batch, date, maxMarks, passingMarks, description, status, createdBy, createdAt, attachmentPath, attachmentName, attachmentSize) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      const result = await stmt.run(body.name, body.subject, body.className, body.batch || '', body.date, Number(body.maxMarks || 0), Number(body.passingMarks || 35), body.description || '', body.status || 'draft', body.createdBy || '', now, attachment ? attachment.path : null, attachment ? attachment.originalname : null, attachment ? attachment.size : null);
      await stmt.finalize();
      const exam = await db.get('SELECT * FROM exams WHERE id = ?', result.lastID);
      res.json(exam);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.get('/api/exams', async (req, res) => {
    const rows = await db.all('SELECT * FROM exams ORDER BY date ASC');
    res.json(rows);
  });

  app.put('/api/exams/:id', async (req, res) => {
    if (!req.user.roles.some((r) => ['teacher', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const existing = await db.get('SELECT * FROM exams WHERE id = ?', req.params.id);
      if (!existing) return res.status(404).json({ error: 'Exam not found' });
      const body = req.body || {};
      await db.run(
        `UPDATE exams SET name=?, subject=?, className=?, batch=?, date=?, maxMarks=?, passingMarks=?, description=?, status=? WHERE id=?`,
        body.name ?? existing.name, body.subject ?? existing.subject, body.className ?? existing.className, body.batch ?? existing.batch,
        body.date ?? existing.date, body.maxMarks !== undefined ? Number(body.maxMarks) : existing.maxMarks,
        body.passingMarks !== undefined ? Number(body.passingMarks) : existing.passingMarks,
        body.description ?? existing.description, body.status ?? existing.status, req.params.id
      );
      const row = await db.get('SELECT * FROM exams WHERE id = ?', req.params.id);
      res.json(row);
    } catch (err) {
      console.error('Update exam error:', err);
      res.status(500).json({ error: 'Failed to update exam' });
    }
  });

  // ─── Exam Marks ─────────────────────────────────────────────────────────────

  function gradeFromPercentage(p) {
    if (p >= 90) return 'A+';
    if (p >= 75) return 'A';
    if (p >= 60) return 'B';
    if (p >= 50) return 'C';
    if (p >= 40) return 'D';
    return 'F';
  }

  app.get('/api/exam-marks', async (req, res) => {
    try {
      let query = 'SELECT * FROM exam_marks WHERE 1=1';
      const params = [];
      if (req.query.examId) { query += ' AND examId = ?'; params.push(String(req.query.examId)); }
      const rows = await db.all(query, ...params);
      res.json(rows.map((r) => ({ ...r, pass: Boolean(r.pass) })));
    } catch (err) {
      console.error('List exam marks error:', err);
      res.status(500).json({ error: 'Failed to load marks' });
    }
  });

  app.post('/api/exam-marks/submit', async (req, res) => {
    if (!req.user.roles.some((r) => ['teacher', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const body = req.body || {};
      const examId = String(body.examId);
      const maxMarks = Number(body.maxMarks || 100);
      const passingMarks = Number(body.passingMarks ?? Math.round(maxMarks * 0.35));
      const records = Array.isArray(body.records) ? body.records : [];
      const now = new Date().toISOString();

      for (const r of records) {
        const percentage = (Number(r.marksObtained) / maxMarks) * 100;
        const grade = gradeFromPercentage(percentage);
        const pass = Number(r.marksObtained) >= passingMarks ? 1 : 0;
        await db.run(
          `INSERT INTO exam_marks (examId, studentId, studentName, rollNumber, marksObtained, percentage, grade, pass, createdAt, updatedAt)
           VALUES (?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(examId, studentId) DO UPDATE SET
             studentName=excluded.studentName, rollNumber=excluded.rollNumber, marksObtained=excluded.marksObtained,
             percentage=excluded.percentage, grade=excluded.grade, pass=excluded.pass, updatedAt=excluded.updatedAt`,
          examId, r.studentId, r.studentName || '', r.rollNumber || '', Number(r.marksObtained), percentage, grade, pass, now, now
        );
      }

      const rows = await db.all('SELECT * FROM exam_marks WHERE examId = ?', examId);
      res.json(rows.map((r) => ({ ...r, pass: Boolean(r.pass) })));
    } catch (err) {
      console.error('Submit exam marks error:', err);
      res.status(500).json({ error: 'Failed to submit marks' });
    }
  });

  // ─── Timetable ──────────────────────────────────────────────────────────────

  app.get('/api/timetable', async (req, res) => {
    try {
      const branchId = resolveBranchId(req, req.query.branchId);
      let query = 'SELECT * FROM timetable_entries WHERE 1=1';
      const params = [];
      if (req.query.className) { query += ' AND className = ?'; params.push(req.query.className); }
      if (branchId) { query += ' AND branchId = ?'; params.push(branchId); }
      const rows = await db.all(query, ...params);
      res.json(rows);
    } catch (err) {
      console.error('List timetable error:', err);
      res.status(500).json({ error: 'Failed to load timetable' });
    }
  });

  app.post('/api/timetable', async (req, res) => {
    if (!req.user.roles.some((r) => ['admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const body = req.body || {};
      if (!body.className || !body.dayOfWeek || !body.period) {
        return res.status(400).json({ error: 'className, dayOfWeek and period are required' });
      }
      const branchId = resolveBranchId(req, body.branchId) || req.user?.branchId || null;
      const now = new Date().toISOString();
      await db.run(
        `INSERT INTO timetable_entries (className, dayOfWeek, period, subject, teacherId, teacherName, room, branchId, createdAt, updatedAt)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(className, dayOfWeek, period) DO UPDATE SET
           subject=excluded.subject, teacherId=excluded.teacherId, teacherName=excluded.teacherName,
           room=excluded.room, branchId=excluded.branchId, updatedAt=excluded.updatedAt`,
        body.className, body.dayOfWeek, body.period, body.subject || '', body.teacherId || null, body.teacherName || null,
        body.room || '', branchId, now, now
      );
      const row = await db.get(
        'SELECT * FROM timetable_entries WHERE className = ? AND dayOfWeek = ? AND period = ?',
        body.className, body.dayOfWeek, body.period
      );
      res.status(201).json(row);
    } catch (err) {
      console.error('Save timetable entry error:', err);
      res.status(500).json({ error: 'Failed to save timetable entry' });
    }
  });

  app.delete('/api/timetable/:id', async (req, res) => {
    if (!req.user.roles.some((r) => ['admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      await db.run('DELETE FROM timetable_entries WHERE id = ?', req.params.id);
      res.json({ success: true });
    } catch (err) {
      console.error('Delete timetable entry error:', err);
      res.status(500).json({ error: 'Failed to delete timetable entry' });
    }
  });

  app.get('/api/allocations', async (req, res) => {
    const teacherId = String(req.query.teacherId || '');
    if (!teacherId) return res.json({ classes: [], allocations: {} });
    const rows = await db.all('SELECT * FROM allocations WHERE teacherId = ?', teacherId);
    const classes = Array.from(new Set(rows.map(r => r.className)));
    const allocations = {};
    for (const r of rows) {
      if (!allocations[r.className]) allocations[r.className] = { subjects: new Set(), batches: new Set() };
      if (r.subject) allocations[r.className].subjects.add(r.subject);
      if (r.batch) allocations[r.className].batches.add(r.batch);
    }
    const mapped = {};
    for (const k of Object.keys(allocations)) {
      mapped[k] = {
        subjects: Array.from(allocations[k].subjects),
        batches: Array.from(allocations[k].batches),
      };
    }
    res.json({ classes, allocations: mapped });
  });

  app.get('/api/allocations/all', async (req, res) => {
    if (!req.user.roles.some((r) => ['admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const branchId = resolveBranchId(req, req.query.branchId);
      let query = `SELECT a.*, u.name as resolvedTeacherName FROM allocations a LEFT JOIN users u ON u.id = a.teacherId WHERE 1=1`;
      const params = [];
      if (branchId) { query += ' AND a.branchId = ?'; params.push(branchId); }
      query += ' ORDER BY a.createdAt DESC';
      const rows = await db.all(query, ...params);
      res.json(rows.map(r => ({
        id: String(r.id),
        teacherId: r.teacherId,
        teacherName: r.resolvedTeacherName || r.teacherName || '',
        class: r.className,
        subject: r.subject,
        batch: r.batch,
        branchId: r.branchId,
        students: r.students || 0,
        weeklyHours: r.weeklyHours || 0,
        status: r.status || 'Assigned',
      })));
    } catch (err) {
      console.error('List allocations error:', err);
      res.status(500).json({ error: 'Failed to load allocations' });
    }
  });

  app.post('/api/allocations', async (req, res) => {
    if (!req.user.roles.some((r) => ['admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const body = req.body || {};
      if (!body.teacherId || !body.class || !body.subject) {
        return res.status(400).json({ error: 'teacherId, class and subject are required' });
      }
      const teacher = await db.get('SELECT name FROM users WHERE id = ?', body.teacherId);
      const branchId = resolveBranchId(req, body.branchId) || req.user?.branchId || null;
      const now = new Date().toISOString();
      const result = await db.run(
        `INSERT INTO allocations (teacherId, teacherName, className, subject, batch, branchId, students, weeklyHours, status, createdAt, updatedAt)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        body.teacherId, teacher?.name || '', body.class, body.subject, body.batch || '', branchId,
        Number(body.students || 0), Number(body.weeklyHours || 0), body.status || 'Assigned', now, now
      );
      const row = await db.get('SELECT * FROM allocations WHERE id = ?', result.lastID);
      res.status(201).json({
        id: String(row.id), teacherId: row.teacherId, teacherName: row.teacherName,
        class: row.className, subject: row.subject, batch: row.batch, branchId: row.branchId,
        students: row.students || 0, weeklyHours: row.weeklyHours || 0, status: row.status,
      });
    } catch (err) {
      console.error('Create allocation error:', err);
      res.status(500).json({ error: 'Failed to create allocation' });
    }
  });

  app.put('/api/allocations/:id', async (req, res) => {
    if (!req.user.roles.some((r) => ['admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const existing = await db.get('SELECT * FROM allocations WHERE id = ?', req.params.id);
      if (!existing) return res.status(404).json({ error: 'Allocation not found' });
      const body = req.body || {};
      const teacherId = body.teacherId ?? existing.teacherId;
      const teacher = teacherId !== existing.teacherId ? await db.get('SELECT name FROM users WHERE id = ?', teacherId) : null;
      const now = new Date().toISOString();
      await db.run(
        `UPDATE allocations SET teacherId=?, teacherName=?, className=?, subject=?, batch=?, students=?, weeklyHours=?, status=?, updatedAt=? WHERE id=?`,
        teacherId, teacher ? teacher.name : (body.teacherName ?? existing.teacherName),
        body.class ?? existing.className, body.subject ?? existing.subject, body.batch ?? existing.batch,
        body.students !== undefined ? Number(body.students) : existing.students,
        body.weeklyHours !== undefined ? Number(body.weeklyHours) : existing.weeklyHours,
        body.status ?? existing.status, now, req.params.id
      );
      const row = await db.get('SELECT * FROM allocations WHERE id = ?', req.params.id);
      res.json({
        id: String(row.id), teacherId: row.teacherId, teacherName: row.teacherName,
        class: row.className, subject: row.subject, batch: row.batch, branchId: row.branchId,
        students: row.students || 0, weeklyHours: row.weeklyHours || 0, status: row.status,
      });
    } catch (err) {
      console.error('Update allocation error:', err);
      res.status(500).json({ error: 'Failed to update allocation' });
    }
  });

  app.delete('/api/allocations/:id', async (req, res) => {
    if (!req.user.roles.some((r) => ['admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      await db.run(`UPDATE allocations SET status='Removed', updatedAt=? WHERE id=?`, new Date().toISOString(), req.params.id);
      res.json({ success: true });
    } catch (err) {
      console.error('Remove allocation error:', err);
      res.status(500).json({ error: 'Failed to remove allocation' });
    }
  });

  // ─── Admissions CRM ─────────────────────────────────────────────────────────

  const ADMISSION_WORKFLOW_NEXT = {
    submit: 'Application Submitted',
    verify: 'Document Verification',
    schedule: 'Interview Scheduled',
    complete: 'Interview Completed',
    approve: 'Approved',
    enroll: 'Enrolled',
    reject: 'Rejected',
  };

  app.get('/api/admissions', async (req, res) => {
    try {
      const branchId = resolveBranchId(req, req.query.branchId);
      let query = 'SELECT * FROM admissions WHERE 1=1';
      const params = [];
      if (branchId) { query += ' AND branchId = ?'; params.push(branchId); }
      query += ' ORDER BY createdAt DESC';
      const rows = await db.all(query, ...params);
      res.json(rows);
    } catch (err) {
      console.error('List admissions error:', err);
      res.status(500).json({ error: 'Failed to load admissions' });
    }
  });

  app.post('/api/admissions', async (req, res) => {
    try {
      const body = req.body || {};
      if (!body.applicantName) return res.status(400).json({ error: 'Applicant name is required' });
      const id = `ADM${Date.now()}`;
      const branchId = resolveBranchId(req, body.branchId) || req.user?.branchId || null;
      const now = new Date().toISOString();
      await db.run(
        `INSERT INTO admissions (id, applicantName, grade, appliedDate, contactNumber, email, branchId, status, createdAt, updatedAt)
         VALUES (?,?,?,?,?,?,?,'Enquiry',?,?)`,
        id, body.applicantName, body.grade || '', body.appliedDate || now.slice(0, 10), body.contactNumber || '', body.email || '', branchId, now, now
      );
      const row = await db.get('SELECT * FROM admissions WHERE id = ?', id);
      res.status(201).json(row);
    } catch (err) {
      console.error('Create admission error:', err);
      res.status(500).json({ error: 'Failed to create admission' });
    }
  });

  app.patch('/api/admissions/:id/action', async (req, res) => {
    if (!req.user.roles.some((r) => ['admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const action = String(req.body?.action || '');
      const nextStatus = ADMISSION_WORKFLOW_NEXT[action];
      if (!nextStatus) return res.status(400).json({ error: 'Unknown workflow action' });
      const existing = await db.get('SELECT * FROM admissions WHERE id = ?', req.params.id);
      if (!existing) return res.status(404).json({ error: 'Admission not found' });
      await db.run('UPDATE admissions SET status=?, updatedAt=? WHERE id=?', nextStatus, new Date().toISOString(), req.params.id);
      const row = await db.get('SELECT * FROM admissions WHERE id = ?', req.params.id);
      res.json(row);
    } catch (err) {
      console.error('Admission workflow error:', err);
      res.status(500).json({ error: 'Failed to update admission' });
    }
  });

  // ─── Teacher Tasks ──────────────────────────────────────────────────────────

  app.get('/api/teacher-tasks', async (req, res) => {
    try {
      const branchId = resolveBranchId(req, req.query.branchId);
      let query = 'SELECT * FROM teacher_tasks WHERE 1=1';
      const params = [];
      if (branchId) { query += ' AND branchId = ?'; params.push(branchId); }
      if (req.query.teacherId) { query += ' AND teacherId = ?'; params.push(req.query.teacherId); }
      query += ' ORDER BY createdAt DESC';
      const rows = await db.all(query, ...params);
      res.json(rows);
    } catch (err) {
      console.error('List teacher tasks error:', err);
      res.status(500).json({ error: 'Failed to load tasks' });
    }
  });

  app.post('/api/teacher-tasks', async (req, res) => {
    if (!req.user.roles.some((r) => ['admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const body = req.body || {};
      if (!body.title) return res.status(400).json({ error: 'Title is required' });
      const id = `T${Date.now()}`;
      const branchId = resolveBranchId(req, body.branchId) || req.user?.branchId || null;
      const now = new Date().toISOString();
      await db.run(
        `INSERT INTO teacher_tasks (id, title, description, teacherId, teacherName, branchId, priority, dueDate, dueTime, relatedClass, relatedSubject, attachmentUrl, status, progress, createdAt, updatedAt)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'pending',0,?,?)`,
        id, body.title, body.description || '', body.teacherId || null, body.teacherName || null, branchId,
        body.priority || 'medium', body.dueDate || null, body.dueTime || null, body.relatedClass || null, body.relatedSubject || null,
        body.attachmentUrl || null, now, now
      );
      const row = await db.get('SELECT * FROM teacher_tasks WHERE id = ?', id);
      res.status(201).json(row);
    } catch (err) {
      console.error('Create teacher task error:', err);
      res.status(500).json({ error: 'Failed to create task' });
    }
  });

  app.put('/api/teacher-tasks/:id', async (req, res) => {
    if (!req.user.roles.some((r) => ['admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const existing = await db.get('SELECT * FROM teacher_tasks WHERE id = ?', req.params.id);
      if (!existing) return res.status(404).json({ error: 'Task not found' });
      const body = req.body || {};
      const progress = body.progress !== undefined ? Number(body.progress) : existing.progress;
      const status = body.status ?? (progress >= 100 ? 'completed' : progress > 0 ? 'in-progress' : existing.status);
      const now = new Date().toISOString();
      await db.run(
        `UPDATE teacher_tasks SET title=?, description=?, teacherId=?, teacherName=?, priority=?, dueDate=?, dueTime=?, relatedClass=?, relatedSubject=?, attachmentUrl=?, status=?, progress=?, completionRemarks=?, updatedAt=? WHERE id=?`,
        body.title ?? existing.title, body.description ?? existing.description, body.teacherId ?? existing.teacherId, body.teacherName ?? existing.teacherName,
        body.priority ?? existing.priority, body.dueDate ?? existing.dueDate, body.dueTime ?? existing.dueTime,
        body.relatedClass ?? existing.relatedClass, body.relatedSubject ?? existing.relatedSubject, body.attachmentUrl ?? existing.attachmentUrl,
        status, progress, body.completionRemarks ?? existing.completionRemarks, now, req.params.id
      );
      const row = await db.get('SELECT * FROM teacher_tasks WHERE id = ?', req.params.id);
      res.json(row);
    } catch (err) {
      console.error('Update teacher task error:', err);
      res.status(500).json({ error: 'Failed to update task' });
    }
  });

  app.delete('/api/teacher-tasks/:id', async (req, res) => {
    if (!req.user.roles.some((r) => ['admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      await db.run('DELETE FROM teacher_tasks WHERE id = ?', req.params.id);
      res.json({ success: true });
    } catch (err) {
      console.error('Delete teacher task error:', err);
      res.status(500).json({ error: 'Failed to delete task' });
    }
  });

  app.get('/api/school-exam-schedules', async (req, res) => {
    try {
      const conditions = [];
      const params = [];
      const branchId = resolveBranchId(req, req.query.branchId);
      if (branchId) {
        conditions.push('branchId = ?');
        params.push(branchId);
      }
      if (req.query.className) {
        conditions.push('schoolClass = ?');
        params.push(req.query.className);
      }
      if (req.query.studentId) {
        conditions.push('studentId = ?');
        params.push(req.query.studentId);
      }
      if (req.query.schoolName) {
        conditions.push('schoolName LIKE ?');
        params.push(`%${req.query.schoolName}%`);
      }
      if (req.query.examName) {
        conditions.push('examName = ?');
        params.push(req.query.examName);
      }
      if (req.query.status) {
        conditions.push('status = ?');
        params.push(req.query.status);
      }
      if (req.query.startDate) {
        conditions.push('endDate >= ?');
        params.push(req.query.startDate);
      }
      if (req.query.endDate) {
        conditions.push('startDate <= ?');
        params.push(req.query.endDate);
      }
      const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const rows = await db.all(`SELECT * FROM school_exam_schedules ${whereClause} ORDER BY startDate ASC, endDate ASC`, ...params);
      res.json(rows.map(mapSchoolExamRowToSchedule));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.post('/api/school-exam-schedules', upload.single('attachment'), async (req, res) => {
    if (!req.user.roles.some((r) => ['teacher', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const body = req.body || {};
      const attachment = req.file;
      const now = new Date().toISOString();
      const status = computeSchoolExamStatus(body.startDate, body.endDate);
      const stmt = await db.prepare(`INSERT INTO school_exam_schedules (studentId, studentName, branchId, schoolName, schoolClass, examName, startDate, endDate, subject, description, attachmentPath, attachmentName, attachmentSize, status, createdBy, createdAt, updatedAt, teacherId, teacherName) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      const result = await stmt.run(body.studentId || '', body.studentName || '', body.branchId || '', body.schoolName || '', body.schoolClass || '', body.examName || '', body.startDate || '', body.endDate || '', body.subject || '', body.description || '', attachment ? `/uploads/${attachment.filename}` : null, attachment ? attachment.originalname : null, attachment ? attachment.size : null, status, body.createdBy || '', now, now, body.teacherId || '', body.teacherName || '');
      await stmt.finalize();
      const row = await db.get('SELECT * FROM school_exam_schedules WHERE id = ?', result.lastID);
      await upsertSchoolExamReminderNotifications(db, row);
      res.json(mapSchoolExamRowToSchedule(row));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.put('/api/school-exam-schedules/:id', upload.single('attachment'), async (req, res) => {
    if (!req.user.roles.some((r) => ['teacher', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const body = req.body || {};
      const attachment = req.file;
      const existing = await db.get('SELECT * FROM school_exam_schedules WHERE id = ?', req.params.id);
      if (!existing) return res.status(404).json({ error: 'not found' });
      const nextAttachmentPath = attachment ? `/uploads/${attachment.filename}` : (body.attachmentPath ?? existing.attachmentPath ?? null);
      const nextAttachmentName = attachment ? attachment.originalname : (body.attachmentName ?? existing.attachmentName ?? null);
      const nextAttachmentSize = attachment ? attachment.size : (body.attachmentSize ?? existing.attachmentSize ?? null);
      const status = computeSchoolExamStatus(body.startDate || existing.startDate, body.endDate || existing.endDate);
      const stmt = await db.prepare(`UPDATE school_exam_schedules SET studentId=?, studentName=?, branchId=?, schoolName=?, schoolClass=?, examName=?, startDate=?, endDate=?, subject=?, description=?, attachmentPath=?, attachmentName=?, attachmentSize=?, status=?, createdBy=?, updatedAt=?, teacherId=?, teacherName=? WHERE id=?`);
      await stmt.run(body.studentId || existing.studentId, body.studentName || existing.studentName, body.branchId || existing.branchId, body.schoolName || existing.schoolName, body.schoolClass || existing.schoolClass, body.examName || existing.examName, body.startDate || existing.startDate, body.endDate || existing.endDate, body.subject || existing.subject, body.description || existing.description, nextAttachmentPath, nextAttachmentName, nextAttachmentSize, status, body.createdBy || existing.createdBy, new Date().toISOString(), body.teacherId || existing.teacherId, body.teacherName || existing.teacherName, req.params.id);
      await stmt.finalize();
      const row = await db.get('SELECT * FROM school_exam_schedules WHERE id = ?', req.params.id);
      await upsertSchoolExamReminderNotifications(db, row);
      res.json(mapSchoolExamRowToSchedule(row));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.delete('/api/school-exam-schedules/:id', async (req, res) => {
    if (!req.user.roles.some((r) => ['teacher', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const existing = await db.get('SELECT * FROM school_exam_schedules WHERE id = ?', req.params.id);
      if (!existing) return res.status(404).json({ error: 'not found' });
      if (existing.attachmentPath) {
        const fullPath = path.resolve(process.cwd(), existing.attachmentPath.replace(/^\//, ''));
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      }
      await db.run('DELETE FROM school_exam_schedules WHERE id = ?', req.params.id);
      await db.run('DELETE FROM notifications WHERE notificationType = ? AND description = ?', 'school_exam_schedule_reminder', `schoolExamScheduleId:${req.params.id}`);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  // Identity (id/role/branchId) is always derived from the verified JWT, never from
  // client query/body params — a client could previously pass role=super_admin or an
  // arbitrary userId/branchId to read or mutate notifications outside their own scope.
  // classNames/studentIds stay client-supplied (parent's linked-children convenience,
  // matching the same established trust boundary used for homework/materials).
  function deriveNotificationUser(req) {
    const requestedRole = String(req.query.role || req.body?.role || '');
    const role = req.user.roles.includes(requestedRole) ? requestedRole : (req.user.roles[0] || '');
    return {
      id: req.user.sub,
      role,
      branchId: resolveBranchId(req, req.query.branchId || req.body?.branchId) || req.user.branchId || '',
      assignedClassIds: parseArrayParam(req.query.classNames || req.body?.classNames),
      linkedStudentIds: parseArrayParam(req.query.studentIds || req.body?.studentIds),
    };
  }

  function canMutateNotification(req, notif) {
    if (req.user.roles.includes('super_admin')) return true;
    return matchesUserScope(notif, deriveNotificationUser(req));
  }

  app.get('/api/notifications', async (req, res) => {
    try {
      const rows = await db.all('SELECT * FROM notifications ORDER BY createdAt DESC');
      const user = deriveNotificationUser(req);
      const mapped = rows.map(mapRowToNotification);
      const scoped = mapped.filter((notif) => matchesUserScope(notif, user));
      res.json(scoped);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.post('/api/notifications', async (req, res) => {
    try {
      const now = new Date().toISOString();
      const payload = req.body || {};
      const notification = {
        id: payload.id || `N${Date.now()}`,
        title: payload.title || 'Notification',
        message: payload.message || '',
        description: payload.description || '',
        type: payload.type || 'info',
        priority: payload.priority || 'medium',
        roles: serializeList(payload.roles || []),
        teacherIds: serializeList(payload.teacherIds || []),
        classNames: serializeList(payload.classNames || []),
        userIds: serializeList(payload.userIds || []),
        studentIds: serializeList(payload.studentIds || []),
        sender: payload.sender || 'System',
        notificationType: payload.notificationType || payload.type || 'info',
        recipient: payload.recipient || 'All',
        recipientRole: payload.recipientRole || '',
        branchId: payload.branchId || null,
        status: payload.status || 'unread',
        read: payload.status === 'read' ? 1 : 0,
        createdAt: payload.createdAt || now,
        readAt: payload.readAt || null,
        readBy: payload.readBy || null,
        readByRole: payload.readByRole || null,
        readByBranch: payload.readByBranch || null,
        deletedAt: payload.deletedAt || null,
        deletedBy: payload.deletedBy || null,
        deletedByBranch: payload.deletedByBranch || null,
        scheduledFor: payload.scheduledFor || null,
        expiresAt: payload.expiresAt || null,
      };
      const stmt = await db.prepare(`INSERT INTO notifications (id, title, message, description, type, priority, roles, teacherIds, classNames, userIds, studentIds, sender, notificationType, recipient, recipientRole, branchId, status, read, createdAt, readAt, readBy, readByRole, readByBranch, deletedAt, deletedBy, deletedByBranch, scheduledFor, expiresAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      await stmt.run(notification.id, notification.title, notification.message, notification.description, notification.type, notification.priority, notification.roles, notification.teacherIds, notification.classNames, notification.userIds, notification.studentIds, notification.sender, notification.notificationType, notification.recipient, notification.recipientRole, notification.branchId, notification.status, notification.read, notification.createdAt, notification.readAt, notification.readBy, notification.readByRole, notification.readByBranch, notification.deletedAt, notification.deletedBy, notification.deletedByBranch, notification.scheduledFor, notification.expiresAt);
      await stmt.finalize();
      const saved = await db.get('SELECT * FROM notifications WHERE id = ?', notification.id);
      res.json(mapRowToNotification(saved));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.put('/api/notifications/:id', async (req, res) => {
    try {
      const existingRow = await db.get('SELECT * FROM notifications WHERE id = ?', req.params.id);
      if (!existingRow) return res.status(404).json({ error: 'Notification not found' });
      if (!canMutateNotification(req, mapRowToNotification(existingRow))) return res.status(403).json({ error: 'Forbidden' });

      const payload = req.body || {};
      const now = new Date().toISOString();
      const stmt = await db.prepare(`UPDATE notifications SET title=?, message=?, description=?, type=?, priority=?, roles=?, teacherIds=?, classNames=?, userIds=?, studentIds=?, sender=?, notificationType=?, recipient=?, recipientRole=?, branchId=?, status=?, read=?, createdAt=?, readAt=?, readBy=?, readByRole=?, readByBranch=?, deletedAt=?, deletedBy=?, deletedByBranch=?, scheduledFor=?, expiresAt=? WHERE id=?`);
      await stmt.run(
        payload.title || 'Notification',
        payload.message || '',
        payload.description || '',
        payload.type || 'info',
        payload.priority || 'medium',
        serializeList(payload.roles || []),
        serializeList(payload.teacherIds || []),
        serializeList(payload.classNames || []),
        serializeList(payload.userIds || []),
        serializeList(payload.studentIds || []),
        payload.sender || 'System',
        payload.notificationType || payload.type || 'info',
        payload.recipient || 'All',
        payload.recipientRole || '',
        payload.branchId || null,
        payload.status || 'unread',
        payload.status === 'read' ? 1 : 0,
        payload.createdAt || now,
        payload.readAt || null,
        payload.readBy || null,
        payload.readByRole || null,
        payload.readByBranch || null,
        payload.deletedAt || null,
        payload.deletedBy || null,
        payload.deletedByBranch || null,
        payload.scheduledFor || null,
        payload.expiresAt || null,
        req.params.id
      );
      await stmt.finalize();
      const saved = await db.get('SELECT * FROM notifications WHERE id = ?', req.params.id);
      res.json(mapRowToNotification(saved));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.patch('/api/notifications/:id/read', async (req, res) => {
    try {
      const existingRow = await db.get('SELECT * FROM notifications WHERE id = ?', req.params.id);
      if (!existingRow) return res.status(404).json({ error: 'Notification not found' });
      if (!canMutateNotification(req, mapRowToNotification(existingRow))) return res.status(403).json({ error: 'Forbidden' });

      const now = new Date().toISOString();
      const body = req.body || {};
      const stmt = await db.prepare(`UPDATE notifications SET status='read', read=1, readAt=?, readBy=?, readByRole=?, readByBranch=? WHERE id=?`);
      await stmt.run(body.readAt || now, body.readBy || null, body.readByRole || null, body.readByBranch || null, req.params.id);
      await stmt.finalize();
      const saved = await db.get('SELECT * FROM notifications WHERE id = ?', req.params.id);
      res.json(mapRowToNotification(saved));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.patch('/api/notifications/:id/delete', async (req, res) => {
    try {
      const existingRow = await db.get('SELECT * FROM notifications WHERE id = ?', req.params.id);
      if (!existingRow) return res.status(404).json({ error: 'Notification not found' });
      if (!canMutateNotification(req, mapRowToNotification(existingRow))) return res.status(403).json({ error: 'Forbidden' });

      const now = new Date().toISOString();
      const body = req.body || {};
      const stmt = await db.prepare(`UPDATE notifications SET status='deleted', read=0, deletedAt=?, deletedBy=?, deletedByBranch=? WHERE id=?`);
      await stmt.run(body.deletedAt || now, body.deletedBy || null, body.deletedByBranch || null, req.params.id);
      await stmt.finalize();
      const saved = await db.get('SELECT * FROM notifications WHERE id = ?', req.params.id);
      res.json(mapRowToNotification(saved));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.patch('/api/notifications/:id/restore', async (req, res) => {
    try {
      const existingRow = await db.get('SELECT * FROM notifications WHERE id = ?', req.params.id);
      if (!existingRow) return res.status(404).json({ error: 'Notification not found' });
      if (!canMutateNotification(req, mapRowToNotification(existingRow))) return res.status(403).json({ error: 'Forbidden' });

      const stmt = await db.prepare(`UPDATE notifications SET status='unread', read=0, deletedAt=NULL, deletedBy=NULL, deletedByBranch=NULL WHERE id=?`);
      await stmt.run(req.params.id);
      await stmt.finalize();
      const saved = await db.get('SELECT * FROM notifications WHERE id = ?', req.params.id);
      res.json(mapRowToNotification(saved));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.patch('/api/notifications/bulk/read', async (req, res) => {
    try {
      const requestedIds = Array.isArray(req.body?.ids) ? req.body.ids : [];
      if (!requestedIds.length) return res.json([]);
      const candidatePlaceholders = requestedIds.map(() => '?').join(',');
      const candidateRows = await db.all(`SELECT * FROM notifications WHERE id IN (${candidatePlaceholders})`, ...requestedIds);
      const ids = candidateRows.filter((r) => canMutateNotification(req, mapRowToNotification(r))).map((r) => r.id);
      if (!ids.length) return res.json([]);
      const now = new Date().toISOString();
      const placeholders = ids.map(() => '?').join(',');
      const stmt = await db.prepare(`UPDATE notifications SET status='read', read=1, readAt=?, readBy=?, readByRole=?, readByBranch=? WHERE id IN (${placeholders})`);
      await stmt.run(req.body?.readAt || now, req.body?.readBy || null, req.body?.readByRole || null, req.body?.readByBranch || null, ...ids);
      await stmt.finalize();
      const rows = await db.all(`SELECT * FROM notifications WHERE id IN (${placeholders})`, ...ids);
      res.json(rows.map(mapRowToNotification));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.patch('/api/notifications/bulk/delete', async (req, res) => {
    try {
      const requestedIds = Array.isArray(req.body?.ids) ? req.body.ids : [];
      if (!requestedIds.length) return res.json([]);
      const candidatePlaceholders = requestedIds.map(() => '?').join(',');
      const candidateRows = await db.all(`SELECT * FROM notifications WHERE id IN (${candidatePlaceholders})`, ...requestedIds);
      const ids = candidateRows.filter((r) => canMutateNotification(req, mapRowToNotification(r))).map((r) => r.id);
      if (!ids.length) return res.json([]);
      const now = new Date().toISOString();
      const placeholders = ids.map(() => '?').join(',');
      const stmt = await db.prepare(`UPDATE notifications SET status='deleted', read=0, deletedAt=?, deletedBy=?, deletedByBranch=? WHERE id IN (${placeholders})`);
      await stmt.run(req.body?.deletedAt || now, req.body?.deletedBy || null, req.body?.deletedByBranch || null, ...ids);
      await stmt.finalize();
      const rows = await db.all(`SELECT * FROM notifications WHERE id IN (${placeholders})`, ...ids);
      res.json(rows.map(mapRowToNotification));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  // Fires automatically whenever a teacher updates a homework item — notifies every
  // parent in that class/batch via WhatsApp, naming the subject and teacher. Runs
  // fire-and-forget (never awaited by the route handler) so editing homework isn't
  // slowed down by N outbound API calls; all failures are caught and logged, never thrown.
  async function sendHomeworkWhatsAppAlerts(homeworkId) {
    try {
      const hw = await db.get('SELECT * FROM homework WHERE id = ?', homeworkId);
      if (!hw) return;

      const settingsRows = await db.all('SELECT * FROM whatsapp_settings');
      const settings = {};
      settingsRows.forEach((row) => { settings[row.key] = row.value; });
      if (settings['enable_whatsapp'] !== 'true') return;

      const teacherRow = await db.get('SELECT name FROM users WHERE id = ?', hw.teacherId);
      const teacherName = teacherRow?.name || 'the subject teacher';

      const students = await db.all(
        'SELECT * FROM students WHERE className = ? AND branchId = ? AND status = ?',
        hw.className, hw.branchId, 'Active'
      );

      const provider = settings['whatsapp_provider'] || 'WhatsApp Business Cloud API';
      const apiToken = settings['api_token'] || '';
      const phoneNumberId = settings['phone_number_id'] || '';
      const businessAccountId = settings['business_account_id'] || '';
      const officialContact = settings['official_contact'] || '6363099546';
      const templateName = settings['homework_template_name'] || 'homework_update_alert';
      const apiVersion = settings['api_version'] || 'v17.0';
      const businessName = settings['business_name'] || 'Guru Shishyaru Tutorials';

      for (const student of students) {
        const toMobile = student.primaryParentMobile;
        if (!toMobile) continue;

        const now = new Date().toISOString();
        const logResult = await db.run(`
          INSERT INTO whatsapp_logs (studentId, studentName, parentName, mobile, branchId, className, attendanceDate, sentTime, status, failureReason, teacher, type, homeworkId)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Queued', '', ?, 'homework', ?)
        `, student.id, student.fullName, student.primaryParentName || 'Parent', toMobile, hw.branchId, hw.className, now.slice(0, 10), now, teacherName, homeworkId);
        const logId = logResult.lastID;

        try {
          const config = { apiToken, phoneNumberId, businessAccountId, templateName, apiVersion };
          const messageData = {
            to: toMobile,
            studentName: student.fullName,
            className: hw.className,
            subject: hw.subject,
            teacherName,
            homeworkTitle: hw.title,
            dueDate: hw.dueDate,
            officialContact,
            businessName,
          };
          const sendRes = await WhatsAppService.sendMessage(provider, config, messageData);
          await db.run('UPDATE whatsapp_logs SET status = ?, failureReason = ? WHERE id = ?',
            sendRes.status, sendRes.success ? '' : (sendRes.error || 'Failed'), logId);
        } catch (sendErr) {
          await db.run('UPDATE whatsapp_logs SET status = ?, failureReason = ? WHERE id = ?', 'Failed', sendErr.message, logId);
        }
      }
    } catch (err) {
      console.error('Homework WhatsApp alert dispatch failed:', err);
    }
  }

  // --- Homework Module Endpoints ---

  app.get('/api/homework', async (req, res) => {
    try {
      // Role/userId/branchId are derived from the verified JWT, never trusted from
      // client query params — previously a parent could pass role=admin (or omit
      // role entirely) to fall through every branch below and receive the ENTIRE
      // homework table, unscoped, across every class and branch.
      const roles = req.user.roles || [];
      const userId = req.user.sub;
      const branchId = resolveBranchId(req, req.query.branchId) || req.user.branchId || '';
      const classNames = parseArrayParam(req.query.classNames);

      let query = 'SELECT * FROM homework';
      const params = [];
      const conditions = [];

      if (roles.includes('super_admin')) {
        if (branchId) {
          conditions.push('branchId = ?');
          params.push(branchId);
        }
      } else if (roles.includes('admin') || roles.includes('accountant')) {
        conditions.push('branchId = ?');
        params.push(branchId);
      } else if (roles.includes('teacher')) {
        conditions.push('branchId = ?');
        params.push(branchId);
        conditions.push('teacherId = ?');
        params.push(userId);
      } else if (roles.includes('parent')) {
        conditions.push('branchId = ?');
        params.push(branchId);
        if (classNames.length > 0) {
          const placeholders = classNames.map(() => '?').join(',');
          conditions.push(`className IN (${placeholders})`);
          params.push(...classNames);
        } else {
          conditions.push('1 = 0');
        }
      } else {
        conditions.push('1 = 0');
      }

      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }
      
      query += ' ORDER BY createdAt DESC';
      
      const rows = await db.all(query, ...params);
      
      for (const row of rows) {
        row.attachments = JSON.parse(row.attachments || '[]');
      }
      
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.post('/api/homework', upload.array('attachments'), async (req, res) => {
    if (!req.user.roles.some((r) => ['teacher', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const body = req.body;
      const files = req.files || [];
      const now = new Date().toISOString();

      // A teacher caller is always attributed to themselves — only admin/super_admin
      // may assign homework on behalf of a different teacherId.
      const isTeacherOnly = req.user.roles.includes('teacher') && !req.user.roles.includes('admin') && !req.user.roles.includes('super_admin');
      const teacherId = isTeacherOnly ? req.user.sub : (body.teacherId || req.user.sub);
      const branchId = resolveBranchId(req, body.branchId) || req.user.branchId || body.branchId;

      const fileList = files.map(file => ({
        filename: file.filename,
        originalname: file.originalname,
        path: `/uploads/${file.filename}`,
        size: file.size
      }));

      const stmt = await db.prepare(`
        INSERT INTO homework (className, batch, subject, title, description, dueDate, dueTime, teacherId, assignedBy, branchId, createdAt, attachments)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      `);

      const result = await stmt.run(
        body.className,
        body.batch || '',
        body.subject,
        body.title,
        body.description || '',
        body.dueDate,
        body.dueTime || '23:59',
        teacherId,
        body.assignedBy,
        branchId,
        now,
        JSON.stringify(fileList)
      );
      await stmt.finalize();
      
      const created = await db.get('SELECT * FROM homework WHERE id = ?', result.lastID);
      if (created) {
        created.attachments = JSON.parse(created.attachments || '[]');
      }
      res.json(created);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.put('/api/homework/:id', upload.array('attachments'), async (req, res) => {
    if (!req.user.roles.some((r) => ['teacher', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const id = req.params.id;
      const body = req.body;
      const newFiles = req.files || [];

      const current = await db.get('SELECT * FROM homework WHERE id = ?', id);
      if (!current) {
        return res.status(404).json({ error: 'Homework not found' });
      }
      const isTeacherOnly = req.user.roles.includes('teacher') && !req.user.roles.includes('admin') && !req.user.roles.includes('super_admin');
      if (isTeacherOnly && current.teacherId !== req.user.sub) {
        return res.status(403).json({ error: 'You can only edit your own homework assignments' });
      }
      const teacherId = isTeacherOnly ? req.user.sub : (body.teacherId || current.teacherId);

      let keepList = [];
      if (body.existingAttachments) {
        try {
          keepList = JSON.parse(body.existingAttachments);
        } catch (e) {
          keepList = [];
        }
      } else {
        keepList = JSON.parse(current.attachments || '[]');
      }
      
      const newFileList = newFiles.map(file => ({
        filename: file.filename,
        originalname: file.originalname,
        path: `/uploads/${file.filename}`,
        size: file.size
      }));
      
      const finalFileList = [...keepList, ...newFileList];
      
      const stmt = await db.prepare(`
        UPDATE homework 
        SET className=?, batch=?, subject=?, title=?, description=?, dueDate=?, dueTime=?, teacherId=?, assignedBy=?, branchId=?, attachments=?
        WHERE id=?
      `);
      
      await stmt.run(
        body.className,
        body.batch || '',
        body.subject,
        body.title,
        body.description || '',
        body.dueDate,
        body.dueTime || '23:59',
        teacherId,
        body.assignedBy,
        body.branchId,
        JSON.stringify(finalFileList),
        id
      );
      await stmt.finalize();

      const updated = await db.get('SELECT * FROM homework WHERE id = ?', id);
      if (updated) {
        updated.attachments = JSON.parse(updated.attachments || '[]');
      }
      res.json(updated);
      sendHomeworkWhatsAppAlerts(id);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.delete('/api/homework/:id', async (req, res) => {
    if (!req.user.roles.some((r) => ['teacher', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const id = req.params.id;
      const hw = await db.get('SELECT * FROM homework WHERE id = ?', id);
      const isTeacherOnly = req.user.roles.includes('teacher') && !req.user.roles.includes('admin') && !req.user.roles.includes('super_admin');
      if (hw && isTeacherOnly && hw.teacherId !== req.user.sub) {
        return res.status(403).json({ error: 'You can only delete your own homework assignments' });
      }
      if (hw) {
        try {
          const files = JSON.parse(hw.attachments || '[]');
          for (const f of files) {
            const fullPath = path.resolve(process.cwd(), 'server', 'uploads', f.filename);
            if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
          }
        } catch (e) {}
      }
      
      const subs = await db.all('SELECT * FROM homework_submissions WHERE homeworkId = ?', id);
      for (const sub of subs) {
        if (sub.filePath) {
          const oldFile = path.basename(sub.filePath);
          const fullPath = path.resolve(process.cwd(), 'server', 'uploads', oldFile);
          if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
        }
      }
      
      await db.run('DELETE FROM homework WHERE id = ?', id);
      await db.run('DELETE FROM homework_submissions WHERE homeworkId = ?', id);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.get('/api/homework/:id/submissions', async (req, res) => {
    try {
      const id = req.params.id;
      const rows = await db.all('SELECT * FROM homework_submissions WHERE homeworkId = ?', id);
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.post('/api/homework/:id/submissions', upload.single('submissionFile'), async (req, res) => {
    try {
      const homeworkId = req.params.id;
      const body = req.body;
      const file = req.file;

      if (!file) {
        return res.status(400).json({ error: 'Submission file is required' });
      }

      // A parent can only submit on behalf of a student actually linked to them —
      // otherwise one parent could mark homework "submitted" for someone else's child.
      if (req.user.roles.includes('parent')) {
        const linked = await db.get('SELECT 1 FROM parent_student WHERE parentId = ? AND studentId = ?', req.user.sub, body.studentId);
        if (!linked) return res.status(403).json({ error: 'Forbidden' });
      }

      const studentId = body.studentId;
      const studentName = body.studentName;
      const rollNumber = body.rollNumber;
      const now = new Date().toISOString();
      
      const existing = await db.get(
        'SELECT * FROM homework_submissions WHERE homeworkId = ? AND studentId = ?', 
        homeworkId, 
        studentId
      );
      
      if (existing) {
        if (existing.filePath) {
          const oldFile = path.basename(existing.filePath);
          const fullPath = path.resolve(process.cwd(), 'server', 'uploads', oldFile);
          if (fs.existsSync(fullPath)) {
            try {
              fs.unlinkSync(fullPath);
            } catch (e) {}
          }
        }
        
        const stmt = await db.prepare(`
          UPDATE homework_submissions
          SET studentName=?, rollNumber=?, submissionTime=?, submissionStatus='Submitted', filePath=?, fileName=?, fileSize=?, remarks=NULL, reviewedAt=NULL, reviewedBy=NULL
          WHERE id=?
        `);
        await stmt.run(
          studentName,
          rollNumber,
          now,
          `/uploads/${file.filename}`,
          file.originalname,
          file.size,
          existing.id
        );
        await stmt.finalize();
        
        const updated = await db.get('SELECT * FROM homework_submissions WHERE id = ?', existing.id);
        res.json(updated);
      } else {
        const stmt = await db.prepare(`
          INSERT INTO homework_submissions (homeworkId, studentId, studentName, rollNumber, submissionTime, submissionStatus, filePath, fileName, fileSize)
          VALUES (?,?,?,?,?,?,?,?,?)
        `);
        const result = await stmt.run(
          homeworkId,
          studentId,
          studentName,
          rollNumber,
          now,
          'Submitted',
          `/uploads/${file.filename}`,
          file.originalname,
          file.size
        );
        await stmt.finalize();
        
        const created = await db.get('SELECT * FROM homework_submissions WHERE id = ?', result.lastID);
        res.json(created);
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.delete('/api/homework/:id/submissions/:studentId', async (req, res) => {
    try {
      const homeworkId = req.params.id;
      const studentId = req.params.studentId;
      
      const existing = await db.get(
        'SELECT * FROM homework_submissions WHERE homeworkId = ? AND studentId = ?', 
        homeworkId, 
        studentId
      );
      
      if (existing) {
        if (existing.filePath) {
          const oldFile = path.basename(existing.filePath);
          const fullPath = path.resolve(process.cwd(), 'server', 'uploads', oldFile);
          if (fs.existsSync(fullPath)) {
            try {
              fs.unlinkSync(fullPath);
            } catch (e) {}
          }
        }
        await db.run('DELETE FROM homework_submissions WHERE id = ?', existing.id);
      }
      
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.patch('/api/homework/:id/submissions/:studentId/review', async (req, res) => {
    try {
      const homeworkId = req.params.id;
      const studentId = req.params.studentId;
      const body = req.body;
      const now = new Date().toISOString();
      
      const stmt = await db.prepare(`
        UPDATE homework_submissions
        SET submissionStatus='Reviewed', remarks=?, reviewedAt=?, reviewedBy=?
        WHERE homeworkId=? AND studentId=?
      `);
      await stmt.run(
        body.remarks || '',
        now,
        body.reviewedBy || 'Teacher',
        homeworkId,
        studentId
      );
      await stmt.finalize();
      
      const updated = await db.get(
        'SELECT * FROM homework_submissions WHERE homeworkId = ? AND studentId = ?', 
        homeworkId, 
        studentId
      );
      res.json(updated);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  // --- Parent Authentication Endpoint ---
  // Direct login by registered mobile number — no OTP/password step.
  app.post('/api/auth/parent-login', authLimiter, async (req, res) => {
    try {
      const mobile = String(req.body?.mobile || '').trim();
      if (!mobile) return res.status(400).json({ error: 'Mobile number is required' });

      const parent = await db.get('SELECT * FROM parents WHERE mobile = ?', mobile);
      if (!parent) {
        return res.status(400).json({ error: 'This mobile number is not registered with Guru Shishyaru Tutorials.' });
      }

      const studentRows = await db.all('SELECT studentId FROM parent_student WHERE parentId = ?', parent.id);
      const linkedStudentIds = studentRows.map(r => r.studentId);

      const token = signToken({ id: parent.id, name: `${parent.firstName} ${parent.lastName}`, email: parent.email, mobile: parent.mobile, roles: JSON.stringify(['parent']), branchId: parent.branchId }, false);

      res.json({
        success: true,
        token,
        user: {
          id: parent.id,
          name: `${parent.firstName} ${parent.lastName}`,
          email: parent.email,
          mobile: parent.mobile,
          role: 'parent',
          roles: ['parent'],
          branchId: parent.branchId,
          linkedStudentIds: linkedStudentIds,
          status: parent.status
        }
      });
    } catch (err) {
      console.error('Parent login error:', err);
      res.status(500).json({ error: 'Failed to log in' });
    }
  });

  // --- Students API ---
  app.get('/api/students', async (req, res) => {
    try {
      const roles = req.user.roles || [];

      // Parents only ever get their own linked children — resolved server-side via
      // parent_student, never from a client-supplied filter — regardless of any
      // className/branchId query params passed in. Every other role's students
      // list was previously returned to ANY authenticated user (including parents)
      // with zero scoping, leaking every family's contact info/address branch-wide.
      if (roles.includes('parent') && !roles.some((r) => ['teacher', 'admin', 'super_admin', 'accountant'].includes(r))) {
        const linkedRows = await db.all('SELECT studentId FROM parent_student WHERE parentId = ?', req.user.sub);
        const studentIds = linkedRows.map((r) => r.studentId);
        if (studentIds.length === 0) return res.json([]);
        const placeholders = studentIds.map(() => '?').join(',');
        const rows = await db.all(`SELECT * FROM students WHERE id IN (${placeholders})`, ...studentIds);
        return res.json(rows);
      }

      if (!roles.some((r) => ['teacher', 'admin', 'super_admin', 'accountant'].includes(r))) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const { className } = req.query;
      const branchId = resolveBranchId(req, req.query.branchId);
      let query = 'SELECT * FROM students';
      const params = [];
      const conditions = [];

      if (className) {
        conditions.push('className = ?');
        params.push(className);
      }
      if (branchId) {
        conditions.push('branchId = ?');
        params.push(branchId);
      }

      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }

      const rows = await db.all(query, ...params);
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  // Accepts the same free-text "STU001, STU002" format the UI already collects,
  // resolving each ID against real students so a typo doesn't silently create a
  // dangling link.
  async function syncParentStudentLinks(parentId, linkedStudentsText) {
    await db.run('DELETE FROM parent_student WHERE parentId = ?', parentId);
    const ids = String(linkedStudentsText || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const studentId of ids) {
      const student = await db.get('SELECT id FROM students WHERE id = ?', studentId);
      if (student) {
        await db.run('INSERT OR IGNORE INTO parent_student (parentId, studentId) VALUES (?, ?)', parentId, studentId);
      }
    }
  }

  app.post('/api/parents', async (req, res) => {
    if (!req.user.roles.includes('super_admin') && !req.user.roles.includes('admin')) return res.status(403).json({ error: 'Forbidden' });
    try {
      const body = req.body || {};
      if (!body.firstName || !body.lastName || !body.mobile) {
        return res.status(400).json({ error: 'First name, last name and mobile are required' });
      }
      const id = `PAR${Date.now()}`;
      const branchId = resolveBranchId(req, body.branchId) || req.user.branchId || null;
      const now = new Date().toISOString();
      await db.run(
        `INSERT INTO parents (id, firstName, lastName, mobile, email, occupation, address, branchId, status, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, body.firstName, body.lastName, body.mobile, body.email || null, body.occupation || '', body.address || '', branchId, body.status || 'Active', now
      );
      await syncParentStudentLinks(id, body.linkedStudents);
      const created = await db.get('SELECT * FROM parents WHERE id = ?', id);
      res.status(201).json(created);
    } catch (err) {
      console.error('Create parent error:', err);
      if (String(err.message || '').includes('UNIQUE')) {
        return res.status(409).json({ error: 'A parent with this mobile number already exists' });
      }
      res.status(500).json({ error: 'Failed to create parent' });
    }
  });

  app.put('/api/parents/:id', async (req, res) => {
    if (!req.user.roles.includes('super_admin') && !req.user.roles.includes('admin')) return res.status(403).json({ error: 'Forbidden' });
    try {
      const existing = await db.get('SELECT * FROM parents WHERE id = ?', req.params.id);
      if (!existing) return res.status(404).json({ error: 'Parent not found' });
      const body = req.body || {};
      await db.run(
        `UPDATE parents SET firstName=?, lastName=?, mobile=?, email=?, occupation=?, address=?, status=? WHERE id=?`,
        body.firstName ?? existing.firstName, body.lastName ?? existing.lastName, body.mobile ?? existing.mobile,
        body.email ?? existing.email, body.occupation ?? existing.occupation, body.address ?? existing.address,
        body.status ?? existing.status, req.params.id
      );
      if (body.linkedStudents !== undefined) {
        await syncParentStudentLinks(req.params.id, body.linkedStudents);
      }
      const updated = await db.get('SELECT * FROM parents WHERE id = ?', req.params.id);
      res.json(updated);
    } catch (err) {
      console.error('Update parent error:', err);
      res.status(500).json({ error: 'Failed to update parent' });
    }
  });

  app.post('/api/students', async (req, res) => {
    if (!req.user.roles.some((r) => ['teacher', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const s = req.body;
      if (!s.firstName || !s.lastName || !s.primaryParentMobile) {
        return res.status(400).json({ error: 'First name, last name, and primary parent mobile are required' });
      }

      const now = new Date().toISOString();
      const studentId = s.id || `STU${Date.now()}`;
      const branchId = resolveBranchId(req, s.branchId) || 'branch_main';

      // Save student
      const stmt = await db.prepare(`
        INSERT INTO students (
          id, firstName, lastName, fullName, gender, dob, className, batch, branchId,
          rollNumber, admissionNumber, admissionDate, status, fatherName, motherName,
          primaryParentName, relationship, fatherMobile, motherMobile, primaryParentMobile,
          parentEmail, guardianName, guardianMobile, address
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `);
      await stmt.run(
        studentId, s.firstName, s.lastName, `${s.firstName} ${s.lastName}`, s.gender || 'Male', s.dob || '',
        s.className || '', s.batch || '', branchId, s.rollNumber || '', s.admissionNumber || '',
        s.admissionDate || now.split('T')[0], s.status || 'Active', s.fatherName || '', s.motherName || '',
        s.primaryParentName || '', s.relationship || '', s.fatherMobile || '', s.motherMobile || '',
        s.primaryParentMobile, s.parentEmail || '', s.guardianName || '', s.guardianMobile || '', s.address || ''
      );
      await stmt.finalize();

      // Find or create parent account
      let parent = await db.get('SELECT * FROM parents WHERE mobile = ?', s.primaryParentMobile);
      let parentId;
      if (parent) {
        parentId = parent.id;
      } else {
        parentId = `PAR${Date.now()}`;
        const parts = (s.primaryParentName || 'Parent').split(' ');
        const fName = parts[0];
        const lName = parts.slice(1).join(' ') || 'User';
        const tempPassword = 'Password@123'; // Temporary password

        await db.run(`
          INSERT INTO parents (id, firstName, lastName, mobile, email, password, branchId, status, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'Active', ?)
        `, parentId, fName, lName, s.primaryParentMobile, s.parentEmail || '', tempPassword, branchId, now);
      }

      // Link parent to student
      await db.run(`
        INSERT OR IGNORE INTO parent_student (parentId, studentId)
        VALUES (?, ?)
      `, parentId, studentId);

      const saved = await db.get('SELECT * FROM students WHERE id = ?', studentId);
      res.json(saved);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.put('/api/students/:id', async (req, res) => {
    if (!req.user.roles.some((r) => ['teacher', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const studentId = req.params.id;
      const s = req.body;
      const branchId = resolveBranchId(req, s.branchId) || 'branch_main';

      const stmt = await db.prepare(`
        UPDATE students SET
          firstName=?, lastName=?, fullName=?, gender=?, dob=?, className=?, batch=?, branchId=?,
          rollNumber=?, admissionNumber=?, admissionDate=?, status=?, fatherName=?, motherName=?,
          primaryParentName=?, relationship=?, fatherMobile=?, motherMobile=?, primaryParentMobile=?,
          parentEmail=?, guardianName=?, guardianMobile=?, address=?
        WHERE id=?
      `);
      await stmt.run(
        s.firstName, s.lastName, `${s.firstName} ${s.lastName}`, s.gender, s.dob, s.className, s.batch, branchId,
        s.rollNumber, s.admissionNumber, s.admissionDate, s.status, s.fatherName, s.motherName,
        s.primaryParentName, s.relationship, s.fatherMobile, s.motherMobile, s.primaryParentMobile,
        s.parentEmail, s.guardianName, s.guardianMobile, s.address, studentId
      );
      await stmt.finalize();

      // Ensure parent account link is updated if primary parent mobile changed
      let parent = await db.get('SELECT * FROM parents WHERE mobile = ?', s.primaryParentMobile);
      let parentId;
      if (parent) {
        parentId = parent.id;
      } else {
        parentId = `PAR${Date.now()}`;
        const parts = (s.primaryParentName || 'Parent').split(' ');
        const fName = parts[0];
        const lName = parts.slice(1).join(' ') || 'User';
        await db.run(`
          INSERT INTO parents (id, firstName, lastName, mobile, email, password, branchId, status, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'Active', ?)
        `, parentId, fName, lName, s.primaryParentMobile, s.parentEmail || '', 'Password@123', branchId, new Date().toISOString());
      }

      // Re-link parent to student
      await db.run('DELETE FROM parent_student WHERE studentId = ?', studentId);
      await db.run(`
        INSERT OR IGNORE INTO parent_student (parentId, studentId)
        VALUES (?, ?)
      `, parentId, studentId);

      const saved = await db.get('SELECT * FROM students WHERE id = ?', studentId);
      res.json(saved);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  // --- Parents API ---
  app.get('/api/parents', async (req, res) => {
    if (!req.user.roles.includes('super_admin') && !req.user.roles.includes('admin')) return res.status(403).json({ error: 'Forbidden' });
    try {
      const branchId = resolveBranchId(req, req.query.branchId);
      const rows = branchId
        ? await db.all('SELECT * FROM parents WHERE branchId = ?', branchId)
        : await db.all('SELECT * FROM parents');
      for (const row of rows) {
        const studentRows = await db.all(`
          SELECT s.id, s.firstName, s.lastName, s.className 
          FROM students s
          JOIN parent_student ps ON s.id = ps.studentId
          WHERE ps.parentId = ?
        `, row.id);
        row.linkedStudentsList = studentRows;
        row.linkedStudents = studentRows.map(s => `${s.firstName} ${s.lastName} (${s.id})`).join(', ');
      }
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  // --- Attendance API with Automatic SMS ---
  app.get('/api/attendance', async (req, res) => {
    if (!req.user.roles.some((r) => ['teacher', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const { className, date } = req.query;
      let query = 'SELECT * FROM attendance';
      const params = [];
      const conditions = [];

      if (className) {
        conditions.push('className = ?');
        params.push(className);
      }
      if (date) {
        conditions.push('date = ?');
        params.push(date);
      }

      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }

      const rows = await db.all(query, ...params);
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.post('/api/attendance', async (req, res) => {
    if (!req.user.roles.some((r) => ['teacher', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const { className, date, attendanceRecords, markedBy } = req.body;
      if (!className || !date || !attendanceRecords) {
        return res.status(400).json({ error: 'Missing className, date, or attendanceRecords' });
      }

      const now = new Date().toISOString();
      const results = [];

      // Load SMS Settings
      const settingsRows = await db.all('SELECT * FROM sms_settings');
      const settings = {};
      settingsRows.forEach(row => { settings[row.key] = row.value; });

      const isSmsEnabled = settings['enable_sms'] === 'true';
      const smsProvider = settings['sms_provider'] || 'MSG91';
      const apiKey = settings['api_key'] || '';
      const senderId = settings['sender_id'] || 'GURUSH';
      const officialContact = settings['official_contact'] || '6363099546';
      const maxRetries = parseInt(settings['retry_attempts'] || '3', 10);

      for (const [studentId, status] of Object.entries(attendanceRecords)) {
        // Upsert attendance record
        await db.run(`
          INSERT INTO attendance (className, date, studentId, status, markedBy, createdAt)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(className, date, studentId) DO UPDATE SET
            status = excluded.status,
            markedBy = excluded.markedBy,
            createdAt = excluded.createdAt
        `, className, date, studentId, status, markedBy || 'Teacher', now);

        results.push({ studentId, status });
      }

      res.json({ success: true, results });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  // --- Study Materials Module Endpoints ---
  // Access is derived from the verified JWT (req.user.roles/sub), never from a
  // client-supplied role/teacherId param — a teacher can only ever see or fetch
  // their own uploads, with no exceptions, per the isolation requirement.
  function materialAccessAllowed(req, material) {
    const roles = req.user.roles || [];
    if (roles.includes('super_admin')) return true;
    if (roles.includes('teacher') && material.teacherId === req.user.sub) return true;
    if ((roles.includes('admin') || roles.includes('accountant')) && material.branchId === (req.user.branchId || null)) return true;
    if (roles.includes('parent')) {
      const classNames = parseArrayParam(req.query.classNames || req.body?.classNames);
      if (material.branchId === (req.user.branchId || null) && classNames.includes(material.className)) return true;
    }
    return false;
  }

  app.get('/api/materials', async (req, res) => {
    try {
      const roles = req.user.roles || [];
      let query = 'SELECT id, title, description, subject, className, batch, branchId, teacherId, teacherName, originalFileName, fileSize, mimeType, createdAt, updatedAt FROM materials';
      const params = [];
      const conditions = [];

      if (roles.includes('super_admin')) {
        const branchId = resolveBranchId(req, req.query.branchId);
        if (branchId) { conditions.push('branchId = ?'); params.push(branchId); }
      } else if (roles.includes('admin') || roles.includes('accountant')) {
        conditions.push('branchId = ?'); params.push(req.user.branchId || null);
      } else if (roles.includes('teacher')) {
        conditions.push('teacherId = ?'); params.push(req.user.sub);
      } else if (roles.includes('parent')) {
        const classNames = parseArrayParam(req.query.classNames);
        if (classNames.length > 0) {
          const placeholders = classNames.map(() => '?').join(',');
          conditions.push(`className IN (${placeholders})`);
          params.push(...classNames);
        } else {
          conditions.push('1 = 0');
        }
        conditions.push('branchId = ?'); params.push(req.user.branchId || null);
      } else {
        conditions.push('1 = 0');
      }

      if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
      query += ' ORDER BY createdAt DESC';

      const rows = await db.all(query, ...params);
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.post('/api/materials', materialsUpload.single('file'), async (req, res) => {
    try {
      if (!req.user.roles.includes('teacher')) {
        if (req.file) { try { fs.unlinkSync(req.file.path); } catch (e) {} }
        return res.status(403).json({ error: 'Only teachers can upload materials' });
      }
      const body = req.body;
      const file = req.file;
      if (!file) return res.status(400).json({ error: 'A file is required' });
      if (!body.title) {
        try { fs.unlinkSync(file.path); } catch (e) {}
        return res.status(400).json({ error: 'Title is required' });
      }

      const teacherRow = await db.get('SELECT name FROM users WHERE id = ?', req.user.sub);
      const teacherName = teacherRow?.name || req.user.name || 'Teacher';
      const branchId = req.user.branchId || null;
      const now = new Date().toISOString();

      const result = await db.run(`
        INSERT INTO materials (title, description, subject, className, batch, branchId, teacherId, teacherName, storedFileName, originalFileName, fileSize, mimeType, createdAt, updatedAt)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `, body.title, body.description || '', body.subject || '', body.className || '', body.batch || '', branchId, req.user.sub, teacherName, file.filename, file.originalname, file.size, file.mimetype, now, now);

      const created = await db.get('SELECT id, title, description, subject, className, batch, branchId, teacherId, teacherName, originalFileName, fileSize, mimeType, createdAt, updatedAt FROM materials WHERE id = ?', result.lastID);
      res.status(201).json(created);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.get('/api/materials/:id/file', async (req, res) => {
    try {
      const material = await db.get('SELECT * FROM materials WHERE id = ?', req.params.id);
      if (!material) return res.status(404).json({ error: 'Material not found' });
      if (!materialAccessAllowed(req, material)) return res.status(403).json({ error: 'Forbidden' });

      const filePath = path.join(PRIVATE_UPLOAD_DIR, material.storedFileName);
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
      res.download(filePath, material.originalFileName);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.put('/api/materials/:id', async (req, res) => {
    try {
      const material = await db.get('SELECT * FROM materials WHERE id = ?', req.params.id);
      if (!material) return res.status(404).json({ error: 'Material not found' });
      const roles = req.user.roles || [];
      const isOwner = roles.includes('teacher') && material.teacherId === req.user.sub;
      if (!isOwner && !roles.includes('super_admin')) return res.status(403).json({ error: 'Forbidden' });

      const body = req.body;
      const now = new Date().toISOString();
      await db.run(`
        UPDATE materials SET title=?, description=?, subject=?, className=?, batch=?, updatedAt=?
        WHERE id=?
      `, body.title ?? material.title, body.description ?? material.description, body.subject ?? material.subject, body.className ?? material.className, body.batch ?? material.batch, now, req.params.id);

      const updated = await db.get('SELECT id, title, description, subject, className, batch, branchId, teacherId, teacherName, originalFileName, fileSize, mimeType, createdAt, updatedAt FROM materials WHERE id = ?', req.params.id);
      res.json(updated);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.delete('/api/materials/:id', async (req, res) => {
    try {
      const material = await db.get('SELECT * FROM materials WHERE id = ?', req.params.id);
      if (!material) return res.status(404).json({ error: 'Material not found' });
      const roles = req.user.roles || [];
      const isOwner = roles.includes('teacher') && material.teacherId === req.user.sub;
      if (!isOwner && !roles.includes('super_admin')) return res.status(403).json({ error: 'Forbidden' });

      const filePath = path.join(PRIVATE_UPLOAD_DIR, material.storedFileName);
      if (fs.existsSync(filePath)) { try { fs.unlinkSync(filePath); } catch (e) {} }
      await db.run('DELETE FROM materials WHERE id = ?', req.params.id);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  // --- Lesson Plan Module Endpoints ---
  app.get('/api/lesson-plans', async (req, res) => {
    try {
      const roles = req.user.roles || [];
      let query = 'SELECT * FROM lesson_plans';
      const params = [];
      const conditions = [];

      if (roles.includes('teacher') && !roles.includes('admin') && !roles.includes('super_admin')) {
        conditions.push('teacherId = ?'); params.push(req.user.sub);
      } else {
        const branchId = resolveBranchId(req, req.query.branchId) || req.user.branchId;
        if (branchId) { conditions.push('branchId = ?'); params.push(branchId); }
      }
      if (req.query.className) { conditions.push('className = ?'); params.push(req.query.className); }

      if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
      query += ' ORDER BY plannedDate DESC, createdAt DESC';

      const rows = await db.all(query, ...params);
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.post('/api/lesson-plans', async (req, res) => {
    try {
      if (!req.user.roles.includes('teacher')) return res.status(403).json({ error: 'Only teachers can create lesson plans' });
      const body = req.body;
      const teacherRow = await db.get('SELECT name FROM users WHERE id = ?', req.user.sub);
      const teacherName = teacherRow?.name || req.user.name || 'Teacher';
      const branchId = req.user.branchId || null;
      const now = new Date().toISOString();
      const result = await db.run(`
        INSERT INTO lesson_plans (teacherId, teacherName, branchId, className, batch, subject, chapterTitle, topic, textbookReference, plannedDate, objectives, notes, status, createdAt, updatedAt)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `, req.user.sub, teacherName, branchId, body.className || '', body.batch || '', body.subject || '', body.chapterTitle || '', body.topic || '', body.textbookReference || '', body.plannedDate || '', body.objectives || '', body.notes || '', body.status || 'Planned', now, now);
      const created = await db.get('SELECT * FROM lesson_plans WHERE id = ?', result.lastID);
      res.status(201).json(created);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.put('/api/lesson-plans/:id', async (req, res) => {
    try {
      const plan = await db.get('SELECT * FROM lesson_plans WHERE id = ?', req.params.id);
      if (!plan) return res.status(404).json({ error: 'Lesson plan not found' });
      const roles = req.user.roles || [];
      const isOwner = roles.includes('teacher') && plan.teacherId === req.user.sub;
      if (!isOwner && !roles.includes('super_admin')) return res.status(403).json({ error: 'Forbidden' });

      const body = req.body;
      const now = new Date().toISOString();
      await db.run(`
        UPDATE lesson_plans SET className=?, batch=?, subject=?, chapterTitle=?, topic=?, textbookReference=?, plannedDate=?, objectives=?, notes=?, status=?, updatedAt=?
        WHERE id=?
      `, body.className ?? plan.className, body.batch ?? plan.batch, body.subject ?? plan.subject, body.chapterTitle ?? plan.chapterTitle, body.topic ?? plan.topic, body.textbookReference ?? plan.textbookReference, body.plannedDate ?? plan.plannedDate, body.objectives ?? plan.objectives, body.notes ?? plan.notes, body.status ?? plan.status, now, req.params.id);

      const updated = await db.get('SELECT * FROM lesson_plans WHERE id = ?', req.params.id);
      res.json(updated);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.delete('/api/lesson-plans/:id', async (req, res) => {
    try {
      const plan = await db.get('SELECT * FROM lesson_plans WHERE id = ?', req.params.id);
      if (!plan) return res.status(404).json({ error: 'Lesson plan not found' });
      const roles = req.user.roles || [];
      const isOwner = roles.includes('teacher') && plan.teacherId === req.user.sub;
      if (!isOwner && !roles.includes('super_admin')) return res.status(403).json({ error: 'Forbidden' });
      await db.run('DELETE FROM lesson_plans WHERE id = ?', req.params.id);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  // --- Backup & Restore Module Endpoints (super_admin only — most destructive
  // surface in the app; restore always snapshots current state first) ---
  // Builds the zip file only — does not touch backup_history. Split out from
  // recordBackupHistory() because the pre-restore safety snapshot is built against
  // the *old* database (about to be replaced) but must be recorded in the *new*
  // one after the swap, or its history row would vanish along with the old DB.
  async function buildBackupZipFile(type) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const zipFilename = `${type === 'manual' ? 'backup' : 'pre_restore'}_${timestamp}.zip`;
    const zipPath = path.join(BACKUP_DIR, zipFilename);
    const tmpDbPath = path.join(BACKUP_DIR, `._tmp_${timestamp}.db`);

    await db.exec(`VACUUM INTO '${tmpDbPath.replace(/'/g, "''")}'`);

    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });
      output.on('close', resolve);
      archive.on('error', reject);
      archive.pipe(output);
      archive.file(tmpDbPath, { name: 'data.db' });
      archive.directory(UPLOAD_DIR, 'uploads');
      if (fs.existsSync(PRIVATE_UPLOAD_DIR)) archive.directory(PRIVATE_UPLOAD_DIR, 'private_uploads/materials');
      archive.finalize();
    });

    fs.unlinkSync(tmpDbPath);

    const stats = fs.statSync(zipPath);
    return { filename: zipFilename, sizeBytes: stats.size };
  }

  async function recordBackupHistory(filename, sizeBytes, type, createdBy) {
    const now = new Date().toISOString();
    const result = await db.run(`
      INSERT INTO backup_history (filename, sizeBytes, createdAt, createdBy, type, status)
      VALUES (?, ?, ?, ?, ?, 'success')
    `, filename, sizeBytes, now, createdBy, type);
    return db.get('SELECT * FROM backup_history WHERE id = ?', result.lastID);
  }

  async function createBackupZip(type, createdBy) {
    const { filename, sizeBytes } = await buildBackupZipFile(type);
    return recordBackupHistory(filename, sizeBytes, type, createdBy);
  }

  app.post('/api/backup/create', async (req, res) => {
    if (!req.user.roles.includes('super_admin')) return res.status(403).json({ error: 'Forbidden' });
    try {
      const created = await createBackupZip('manual', req.user.name || req.user.sub);
      res.status(201).json(created);
    } catch (err) {
      console.error('Backup creation failed:', err);
      res.status(500).json({ error: 'Failed to create backup' });
    }
  });

  app.get('/api/backup/history', async (req, res) => {
    if (!req.user.roles.includes('super_admin')) return res.status(403).json({ error: 'Forbidden' });
    try {
      const rows = await db.all('SELECT * FROM backup_history ORDER BY createdAt DESC');
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.get('/api/backup/:id/download', async (req, res) => {
    if (!req.user.roles.includes('super_admin')) return res.status(403).json({ error: 'Forbidden' });
    try {
      const record = await db.get('SELECT * FROM backup_history WHERE id = ?', req.params.id);
      if (!record) return res.status(404).json({ error: 'Backup not found' });
      const filePath = path.join(BACKUP_DIR, record.filename);
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Backup file missing on disk' });
      res.download(filePath, record.filename);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.delete('/api/backup/:id', async (req, res) => {
    if (!req.user.roles.includes('super_admin')) return res.status(403).json({ error: 'Forbidden' });
    try {
      const record = await db.get('SELECT * FROM backup_history WHERE id = ?', req.params.id);
      if (!record) return res.status(404).json({ error: 'Backup not found' });
      const filePath = path.join(BACKUP_DIR, record.filename);
      if (fs.existsSync(filePath)) { try { fs.unlinkSync(filePath); } catch (e) {} }
      await db.run('DELETE FROM backup_history WHERE id = ?', req.params.id);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.post('/api/backup/restore', restoreUpload.single('file'), async (req, res) => {
    if (!req.user.roles.includes('super_admin')) {
      if (req.file) { try { fs.unlinkSync(req.file.path); } catch (e) {} }
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (req.body.confirm !== 'true') {
      if (req.file) { try { fs.unlinkSync(req.file.path); } catch (e) {} }
      return res.status(400).json({ error: 'Restore requires explicit confirm=true' });
    }
    if (restoreInProgress) {
      if (req.file) { try { fs.unlinkSync(req.file.path); } catch (e) {} }
      return res.status(409).json({ error: 'A restore is already in progress' });
    }
    if (!req.file) return res.status(400).json({ error: 'A backup file is required' });

    restoreInProgress = true;
    const uploadedZipPath = req.file.path;
    const extractDir = path.join(BACKUP_DIR, `._restore_extract_${Date.now()}`);
    let dbClosed = false;

    try {
      await extract(uploadedZipPath, { dir: extractDir });

      const extractedDbPath = path.join(extractDir, 'data.db');
      if (!fs.existsSync(extractedDbPath)) {
        throw new Error('Uploaded backup is missing data.db — not a valid backup file');
      }

      // Validate the extracted DB is a real, uncorrupted SQLite file before touching production data
      const testDb = await open({ filename: extractedDbPath, driver: sqlite3.Database });
      const integrity = await testDb.get('PRAGMA integrity_check');
      await testDb.close();
      if (!integrity || integrity.integrity_check !== 'ok') {
        throw new Error('Uploaded database failed integrity check — aborting restore');
      }

      // Safety net: snapshot current state before overwriting anything. Only the
      // zip is built here — its backup_history row is recorded after the restore
      // completes and reconnects (below), since that row would otherwise be
      // written to the database we're about to discard and vanish with it.
      const preRestoreBackup = await buildBackupZipFile('pre_restore_auto');

      await db.close();
      dbClosed = true;
      fs.copyFileSync(extractedDbPath, DB_PATH);

      const extractedUploads = path.join(extractDir, 'uploads');
      if (fs.existsSync(extractedUploads)) {
        fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
        fs.cpSync(extractedUploads, UPLOAD_DIR, { recursive: true });
      }
      const extractedMaterials = path.join(extractDir, 'private_uploads', 'materials');
      if (fs.existsSync(extractedMaterials)) {
        fs.rmSync(PRIVATE_UPLOAD_DIR, { recursive: true, force: true });
        fs.cpSync(extractedMaterials, PRIVATE_UPLOAD_DIR, { recursive: true });
      }

      db = await open({ filename: DB_PATH, driver: sqlite3.Database });
      dbClosed = false;

      // Record the pre-restore snapshot in the newly-restored database so it's
      // visible in Backup History (its file was already safely written to disk above).
      await recordBackupHistory(preRestoreBackup.filename, preRestoreBackup.sizeBytes, 'pre_restore_auto', req.user.name || req.user.sub);

      res.json({ success: true, message: 'Restore complete. A pre-restore snapshot was saved automatically.' });
    } catch (err) {
      console.error('Restore failed:', err);
      if (dbClosed) {
        // The live connection was closed before the failure occurred — reconnect
        // to whatever data.db currently is on disk so the server stays usable.
        try { db = await open({ filename: DB_PATH, driver: sqlite3.Database }); } catch (reopenErr) { console.error('Failed to reopen DB after failed restore:', reopenErr); }
      }
      res.status(500).json({ error: err.message || 'Restore failed' });
    } finally {
      restoreInProgress = false;
      try { fs.unlinkSync(uploadedZipPath); } catch (e) {}
      try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch (e) {}
    }
  });

  // --- WhatsApp Logs & Stats & System Settings API ---
  app.get('/api/whatsapp/logs', async (req, res) => {
    try {
      const { branchId, date, userRole, userBranchId, assignedClassIds } = req.query;
      let query = 'SELECT * FROM whatsapp_logs';
      const params = [];
      const conditions = [];

      if (branchId) {
        conditions.push('branchId = ?');
        params.push(branchId);
      }
      if (date) {
        conditions.push('attendanceDate = ?');
        params.push(date);
      }

      // Security filters
      if (userRole === 'admin' && userBranchId) {
        conditions.push('branchId = ?');
        params.push(userBranchId);
      } else if (userRole === 'teacher' && assignedClassIds) {
        const classes = assignedClassIds.split(',');
        conditions.push('className IN (' + classes.map(() => '?').join(',') + ')');
        params.push(...classes);
      }

      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }
      query += ' ORDER BY sentTime DESC';

      const rows = await db.all(query, ...params);
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.get('/api/whatsapp/stats', async (req, res) => {
    try {
      const { date, role, teacherId, classNames, branchId } = req.query;
      const today = date || new Date().toISOString().split('T')[0];

      if (role === 'teacher') {
        const classes = classNames ? classNames.split(',') : [];
        if (classes.length === 0) {
          return res.json({ todayAbsent: 0, todayWhatsappSent: 0, pendingNotifications: 0, failedMessages: 0 });
        }

        const placeholders = classes.map(() => '?').join(',');

        const todayAbsent = await db.get(
          `SELECT COUNT(1) as c FROM attendance WHERE date = ? AND status = 'absent' AND className IN (${placeholders})`,
          today, ...classes
        );

        const todayWhatsappSent = await db.get(
          `SELECT COUNT(1) as c FROM whatsapp_logs WHERE attendanceDate = ? AND status IN ('Sent', 'Delivered', 'Read', 'Simulated Sent') AND className IN (${placeholders})`,
          today, ...classes
        );

        const pendingNotifications = await db.get(
          `SELECT COUNT(DISTINCT studentId) as c FROM attendance a 
           WHERE a.date = ? AND a.status = 'absent' AND a.className IN (${placeholders})
           AND a.studentId NOT IN (
             SELECT studentId FROM whatsapp_logs 
             WHERE attendanceDate = ? AND status IN ('Sent', 'Delivered', 'Read', 'Simulated Sent')
           )`,
          today, ...classes, today
        );

        const failedMessages = await db.get(
          `SELECT COUNT(1) as c FROM whatsapp_logs WHERE attendanceDate = ? AND status = 'Failed' AND className IN (${placeholders})`,
          today, ...classes
        );

        return res.json({
          todayAbsent: todayAbsent.c,
          todayWhatsappSent: todayWhatsappSent.c,
          pendingNotifications: pendingNotifications.c,
          failedMessages: failedMessages.c
        });
      } else {
        let totalQuery = 'SELECT COUNT(1) as c FROM whatsapp_logs WHERE attendanceDate = ?';
        let sentQuery = "SELECT COUNT(1) as c FROM whatsapp_logs WHERE attendanceDate = ? AND status IN ('Sent', 'Delivered', 'Read', 'Simulated Sent')";
        let failedQuery = "SELECT COUNT(1) as c FROM whatsapp_logs WHERE attendanceDate = ? AND status = 'Failed'";
        const params = [today];

        if (branchId) {
          totalQuery += ' AND branchId = ?';
          sentQuery += ' AND branchId = ?';
          failedQuery += ' AND branchId = ?';
          params.push(branchId);
        }

        const totalToday = await db.get(totalQuery, ...params);
        const sentToday = await db.get(sentQuery, ...params);
        const failedToday = await db.get(failedQuery, ...params);

        let branchStatsQuery = `
          SELECT branchId, 
                 COUNT(1) as total,
                 SUM(CASE WHEN status IN ('Sent', 'Delivered', 'Read', 'Simulated Sent') THEN 1 ELSE 0 END) as delivered,
                 SUM(CASE WHEN status = 'Failed' THEN 1 ELSE 0 END) as failed
          FROM whatsapp_logs
          WHERE attendanceDate = ?
        `;
        const branchParams = [today];
        if (branchId) {
          branchStatsQuery += ' AND branchId = ?';
          branchParams.push(branchId);
        }
        branchStatsQuery += ' GROUP BY branchId';

        const branchStats = await db.all(branchStatsQuery, ...branchParams);

        return res.json({
          todayCount: totalToday.c,
          todaySent: sentToday.c,
          todayFailed: failedToday.c,
          deliveryRate: totalToday.c > 0 ? Math.round((sentToday.c / totalToday.c) * 100) : 100,
          failureRate: totalToday.c > 0 ? Math.round((failedToday.c / totalToday.c) * 100) : 0,
          branchStats
        });
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });


  // Non-super-admins (e.g. teachers on the Attendance page) only need official_contact/
  // business_name display fields — API credentials are stripped out for them so any
  // authenticated user can't read live WhatsApp/SMS secrets via this endpoint.
  const SETTINGS_SENSITIVE_KEYS = ['api_token', 'phone_number_id', 'business_account_id', 'webhook_url'];

  app.get('/api/settings', async (req, res) => {
    try {
      const rows = await db.all('SELECT * FROM whatsapp_settings');
      const settings = {};
      const isSuperAdmin = req.user.roles.includes('super_admin');
      rows.forEach(r => {
        if (!isSuperAdmin && SETTINGS_SENSITIVE_KEYS.includes(r.key)) return;
        settings[r.key] = r.value;
      });
      res.json(settings);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.post('/api/settings', async (req, res) => {
    if (!req.user.roles.includes('super_admin')) return res.status(403).json({ error: 'Forbidden' });
    try {
      const settings = req.body;
      const stmt = await db.prepare('INSERT OR REPLACE INTO whatsapp_settings (key, value) VALUES (?, ?)');
      for (const [key, value] of Object.entries(settings)) {
        await stmt.run(key, String(value));
      }
      await stmt.finalize();
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });


  app.post('/api/whatsapp/send-manual', async (req, res) => {
    if (!req.user.roles.some((r) => ['teacher', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const { studentId, date, markedBy } = req.body;
      if (!studentId || !date) {
        return res.status(400).json({ error: 'Missing studentId or date' });
      }

      const student = await db.get('SELECT * FROM students WHERE id = ?', studentId);
      if (!student) {
        return res.status(404).json({ error: 'Student not found' });
      }

      // Security check: teacher can only notify parents of students in their assigned
      // classes — role and class assignment are derived from the verified JWT/DB, never
      // trusted from the client (a client could previously omit userRole/assignedClassIds
      // entirely to bypass this check).
      const isTeacherOnly = req.user.roles.includes('teacher') && !req.user.roles.includes('admin') && !req.user.roles.includes('super_admin');
      if (isTeacherOnly) {
        const assignedRows = await db.all('SELECT DISTINCT className FROM allocations WHERE teacherId = ?', req.user.sub);
        const assignedClassNames = assignedRows.map((r) => r.className);
        if (!assignedClassNames.includes(student.className)) {
          return res.status(403).json({ error: 'Unauthorized to send alerts for this class.' });
        }
      }

      const parentName = student.primaryParentName || 'Parent';
      const toMobile = student.primaryParentMobile;
      const branchId = student.branchId || '';
      const teacher = req.user.name || markedBy || 'Teacher';

      if (!toMobile) {
        return res.status(400).json({ error: 'Parent mobile number not configured for this student' });
      }

      // Duplicate check: check if a message has already been sent successfully today
      const existingLog = await db.get(
        "SELECT status FROM whatsapp_logs WHERE studentId = ? AND attendanceDate = ? AND status IN ('Sent', 'Delivered', 'Read', 'Simulated Sent', 'Queued', 'Retrying')",
        studentId,
        date
      );
      if (existingLog) {
        return res.status(400).json({ error: `WhatsApp already sent or in progress for this student today (Status: ${existingLog.status})` });
      }

      // Load Settings
      const settingsRows = await db.all('SELECT * FROM whatsapp_settings');
      const settings = {};
      settingsRows.forEach(row => { settings[row.key] = row.value; });

      const isWhatsappEnabled = settings['enable_whatsapp'] === 'true';
      const provider = settings['whatsapp_provider'] || 'WhatsApp Business Cloud API';
      const apiToken = settings['api_token'] || '';
      const phoneNumberId = settings['phone_number_id'] || '';
      const businessAccountId = settings['business_account_id'] || '';
      const officialContact = settings['official_contact'] || '6363099546';
      const templateName = settings['template_name'] || 'attendance_absence_alert';
      const maxRetries = parseInt(settings['retry_attempts'] || '3', 10);
      const businessName = settings['business_name'] || 'Guru Shishyaru Tutorials';
      const apiVersion = settings['api_version'] || 'v17.0';

      // Query branch name for placeholder
      const branchNames = {
        'branch_rajajinagar': 'Rajajinagar Branch',
        'branch_jayanagar': 'Jayanagar Branch',
        'branch_vijayanagar': 'Vijayanagar Branch',
        'branch_hsr': 'HSR Layout Branch'
      };
      const branchName = branchNames[branchId] || branchId || '';

      const now = new Date().toISOString();

      // Create log
      const logResult = await db.run(`
        INSERT INTO whatsapp_logs (studentId, studentName, parentName, mobile, branchId, className, attendanceDate, sentTime, status, failureReason, teacher)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Queued', '', ?)
      `, studentId, student.fullName, parentName, toMobile, branchId, student.className, date, now, teacher);
      const logId = logResult.lastID;

      if (!isWhatsappEnabled) {
        await db.run(`
          UPDATE whatsapp_logs SET status = 'Failed', failureReason = 'WhatsApp sending is disabled in settings' WHERE id = ?
        `, logId);
        return res.status(400).json({ error: 'WhatsApp sending is disabled in settings' });
      }

      // Try sending
      let attempt = 0;
      let finalStatus = 'Failed';
      let failureReason = '';

      while (attempt < maxRetries) {
        attempt++;
        if (attempt > 1) {
          await db.run(`
             UPDATE whatsapp_logs 
             SET status = 'Retrying', failureReason = ?, retryCount = ?
             WHERE id = ?
           `, failureReason, attempt - 1, logId);
          await new Promise(r => setTimeout(r, 1000));
        }

        try {
          const config = { apiToken, phoneNumberId, businessAccountId, templateName, apiVersion };
          const messageData = { to: toMobile, studentName: student.fullName, className: student.className, attendanceDate: date, officialContact, parentName, branchName, businessName };
          const sendRes = await WhatsAppService.sendMessage(provider, config, messageData);
          finalStatus = sendRes.status;
          if (sendRes.success) {
            failureReason = '';
            break;
          } else {
            failureReason = sendRes.error;
          }
        } catch (e) {
          failureReason = e.message;
        }
      }

      // Update final log status
      await db.run(`
        UPDATE whatsapp_logs 
        SET status = ?, failureReason = ?, retryCount = ?
        WHERE id = ?
      `, finalStatus, failureReason, attempt - 1, logId);

      // Create internal notification
      const notifId = `NOTIF-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const isSuccessStatus = finalStatus === 'Delivered' || finalStatus === 'Sent' || finalStatus === 'Simulated Sent';
      const notifTitle = isSuccessStatus ? 'Attendance WhatsApp Sent' : 'Attendance WhatsApp Failed';
      const notifMessage = isSuccessStatus
        ? `Attendance WhatsApp sent successfully to Parent of ${student.fullName}.`
        : `Attendance WhatsApp failed for ${student.fullName}. Reason: ${failureReason || 'Simulated Failure'}`;
      const notifType = isSuccessStatus ? 'info' : 'warning';
      const notifPriority = isSuccessStatus ? 'medium' : 'high';

      await db.run(`
        INSERT INTO notifications (id, title, message, type, priority, roles, branchId, status, createdAt)
        VALUES (?, ?, ?, ?, ?, '["admin","super_admin"]', ?, 'unread', ?)
      `, notifId, notifTitle, notifMessage, notifType, notifPriority, branchId, now);

      if (isSuccessStatus) {
        res.json({ success: true, message: 'WhatsApp sent successfully', logId });
      } else {
        res.status(500).json({ error: failureReason || 'Failed to deliver WhatsApp', logId });
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });


  // --- Special Class & Bonus Attendance Endpoints ---
  app.get('/api/special-classes', async (req, res) => {
    try {
      const { className, teacherId } = req.query;
      const branchId = resolveBranchId(req, req.query.branchId);
      let query = 'SELECT * FROM special_classes WHERE 1=1';
      const params = [];

      if (branchId) {
        query += ' AND branchId = ?';
        params.push(branchId);
      }
      if (className) {
        query += ' AND className = ?';
        params.push(className);
      }
      if (teacherId) {
        query += ' AND teacherId = ?';
        params.push(teacherId);
      }

      query += ' ORDER BY date DESC, startTime DESC';
      const rows = await db.all(query, ...params);
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.post('/api/special-classes', upload.single('attachment'), async (req, res) => {
    if (!req.user.roles.some((r) => ['teacher', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const { title, subject, branchId, className, batch, date, startTime, endTime, venue, purpose, description, teacherId, teacherName } = req.body;
      const attachmentPath = req.file ? `/uploads/${req.file.filename}` : '';
      const now = new Date().toISOString();

      const result = await db.run(`
        INSERT INTO special_classes (
          title, subject, branchId, className, batch, date, startTime, endTime, venue, purpose, description, attachmentPath, status, teacherId, teacherName, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Published', ?, ?, ?)
      `, title, subject, branchId, className, batch, date, startTime, endTime, venue, purpose, description, attachmentPath, teacherId, teacherName, now);

      const classId = result.lastID;

      // Send real-time internal notifications
      const notifId = `NOTIF-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const notifTitle = `📢 Special Class Announcement`;
      const notifMsg = `${title}\nDate: ${date}\nTime: ${startTime} – ${endTime}\nTeacher: ${teacherName}\nVenue: ${venue}`;

      // 1. Super Admin notification
      await db.run(`
        INSERT INTO notifications (id, title, message, type, priority, roles, branchId, status, createdAt)
        VALUES (?, ?, ?, 'info', 'medium', '["super_admin"]', 'All', 'unread', ?)
      `, `${notifId}-sa`, notifTitle, notifMsg, now);

      // 2. Branch Admins notification
      await db.run(`
        INSERT INTO notifications (id, title, message, type, priority, roles, branchId, status, createdAt)
        VALUES (?, ?, ?, 'info', 'medium', '["admin"]', ?, 'unread', ?)
      `, `${notifId}-adm`, notifTitle, notifMsg, branchId, now);

      // 3. Parents of class notification
      await db.run(`
        INSERT INTO notifications (id, title, message, type, priority, roles, branchId, classNames, status, createdAt)
        VALUES (?, ?, ?, 'info', 'medium', '["parent"]', ?, ?, 'unread', ?)
      `, `${notifId}-par`, notifTitle, notifMsg, branchId, JSON.stringify([className]), now);

      // 4. Teachers/General notification
      await db.run(`
        INSERT INTO notifications (id, title, message, type, priority, roles, branchId, classNames, status, createdAt)
        VALUES (?, ?, ?, 'info', 'medium', '["teacher"]', ?, ?, 'unread', ?)
      `, `${notifId}-tchr`, notifTitle, notifMsg, branchId, JSON.stringify([className]), now);

      res.json({ success: true, classId });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.put('/api/special-classes/:id', upload.single('attachment'), async (req, res) => {
    if (!req.user.roles.some((r) => ['teacher', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const { id } = req.params;
      const { title, subject, branchId, className, batch, date, startTime, endTime, venue, purpose, description, teacherName, status } = req.body;
      const attachmentPath = req.file ? `/uploads/${req.file.filename}` : undefined;
      const now = new Date().toISOString();

      let query = `
        UPDATE special_classes SET
          title = ?, subject = ?, branchId = ?, className = ?, batch = ?, date = ?, startTime = ?, endTime = ?, venue = ?, purpose = ?, description = ?, status = ?
      `;
      const params = [title, subject, branchId, className, batch, date, startTime, endTime, venue, purpose, description, status || 'Rescheduled'];

      if (attachmentPath !== undefined) {
        query += ', attachmentPath = ?';
        params.push(attachmentPath);
      }

      query += ' WHERE id = ?';
      params.push(id);

      await db.run(query, ...params);

      // Trigger update notification
      const notifId = `NOTIF-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const notifTitle = `🔄 Special Class ${status || 'Rescheduled'}`;
      const notifMsg = `${subject} Class has been updated.\nNew Date: ${date}\nNew Time: ${startTime} – ${endTime}\nVenue: ${venue}`;

      await db.run(`
        INSERT INTO notifications (id, title, message, type, priority, roles, branchId, classNames, status, createdAt)
        VALUES (?, ?, ?, 'info', 'medium', '["parent","admin","super_admin","teacher"]', ?, ?, 'unread', ?)
      `, notifId, notifTitle, notifMsg, branchId, JSON.stringify([className]), now);

      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.delete('/api/special-classes/:id', async (req, res) => {
    if (!req.user.roles.some((r) => ['teacher', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const { id } = req.params;
      const cls = await db.get('SELECT * FROM special_classes WHERE id = ?', id);
      if (!cls) return res.status(404).json({ error: 'Class not found' });

      await db.run("UPDATE special_classes SET status = 'Cancelled' WHERE id = ?", id);

      const now = new Date().toISOString();
      const notifId = `NOTIF-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const notifTitle = `❌ Special Class Cancelled`;
      const notifMsg = `The ${cls.subject} Extra Class scheduled for ${cls.date} has been CANCELLED.`;

      await db.run(`
        INSERT INTO notifications (id, title, message, type, priority, roles, branchId, classNames, status, createdAt)
        VALUES (?, ?, ?, 'warning', 'high', '["parent","admin","super_admin","teacher"]', ?, ?, 'unread', ?)
      `, notifId, notifTitle, notifMsg, cls.branchId, JSON.stringify([cls.className]), now);

      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.get('/api/special-classes/:id/attendance', async (req, res) => {
    try {
      const { id } = req.params;
      const rows = await db.all('SELECT * FROM bonus_attendance WHERE specialClassId = ?', id);
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.post('/api/special-classes/:id/attendance', async (req, res) => {
    try {
      const { id } = req.params;
      const { attendanceRecords, markedBy, date, branchId } = req.body;
      const now = new Date().toISOString();
      
      for (const [studentId, status] of Object.entries(attendanceRecords)) {
        const student = await db.get('SELECT * FROM students WHERE id = ?', studentId);
        const studentName = student ? `${student.firstName} ${student.lastName}` : 'Student';

        await db.run(`
          INSERT INTO bonus_attendance (studentId, studentName, specialClassId, date, attendanceStatus, teacherName, branchId, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(studentId, specialClassId) DO UPDATE SET
            attendanceStatus = excluded.attendanceStatus,
            createdAt = excluded.createdAt
        `, studentId, studentName, id, date, status, markedBy || 'Teacher', branchId || '', now);
      }
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.post('/api/whatsapp/test', async (req, res) => {
    try {
      const { mobile, message } = req.body;
      if (!mobile) return res.status(400).json({ error: 'Mobile number required' });

      const settingsRows = await db.all('SELECT * FROM whatsapp_settings');
      const settings = {};
      settingsRows.forEach(row => { settings[row.key] = row.value; });

      const provider = settings['whatsapp_provider'] || 'WhatsApp Business Cloud API';
      console.log(`[WhatsApp Test] Sending Test Message using ${provider} to ${mobile}: ${message}`);
      
      const config = {
        apiToken: settings['api_token'] || '',
        phoneNumberId: settings['phone_number_id'] || '',
        businessAccountId: settings['business_account_id'] || '',
        templateName: settings['template_name'] || 'attendance_absence_alert'
      };
      
      const testRes = await WhatsAppService.sendMessage(provider, config, {
        to: mobile,
        studentName: 'Test Student',
        className: '10th A',
        attendanceDate: new Date().toISOString().split('T')[0],
        officialContact: settings['official_contact'] || '6363099546'
      });

      if (testRes.success) {
        res.json({ success: true, message: `Test WhatsApp sent successfully via ${provider} (Simulated)` });
      } else {
        res.status(500).json({ error: testRes.error || 'Failed to send test WhatsApp' });
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });


  // --- Accounts Ledger Endpoints ---
  app.get('/api/ledger', async (req, res) => {
    try {
      const { type, category, voucherNumber, date } = req.query;
      const branchId = resolveBranchId(req, req.query.branchId);
      let query = 'SELECT * FROM ledger_transactions WHERE 1=1';
      const params = [];
      if (branchId) {
        query += ' AND branchId = ?';
        params.push(branchId);
      }
      if (type) {
        query += ' AND type = ?';
        params.push(type);
      }
      if (category) {
        query += ' AND category = ?';
        params.push(category);
      }
      if (voucherNumber) {
        query += ' AND voucherNumber = ?';
        params.push(voucherNumber);
      }
      if (date) {
        query += ' AND date = ?';
        params.push(date);
      }
      query += ' ORDER BY date ASC, id ASC';
      const rows = await db.all(query, ...params);
      
      // Calculate running balance dynamically
      let currentBal = 0;
      const results = rows.map(r => {
        if (r.type === 'Income') {
          currentBal += r.amount;
        } else {
          currentBal -= r.amount;
        }
        r.runningBalance = currentBal;
        return r;
      });
      res.json(results);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.post('/api/ledger', upload.single('attachment'), async (req, res) => {
    if (!req.user.roles.some((r) => ['accountant', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const { date, type, category, description, amount, paymentMode, referenceNumber, enteredBy } = req.body;
      const branchId = resolveBranchId(req, req.body.branchId) || 'branch_main';
      const file = req.file;

      if (!date || !type || !category || !description || !amount || !paymentMode) {
        return res.status(400).json({ error: 'Date, type, category, description, amount, and paymentMode are required.' });
      }

      // Generate Voucher Number: VOU-YYYYMMDD-XXXX
      const datePart = date.replace(/-/g, '');
      const countRow = await db.get("SELECT COUNT(1) as c FROM ledger_transactions WHERE date = ?", date);
      const suffix = String(countRow.c + 1).padStart(3, '0');
      const voucherNumber = `VOU-${datePart}-${suffix}`;

      // Insert record
      const stmt = await db.prepare(`
        INSERT INTO ledger_transactions (voucherNumber, date, type, category, description, amount, paymentMode, referenceNumber, enteredBy, branchId, attachmentPath, attachmentName, attachmentSize)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const result = await stmt.run(
        voucherNumber, date, type, category, description, Number(amount), paymentMode, referenceNumber || '', enteredBy || '', branchId,
        file ? `/uploads/${file.filename}` : null, file ? file.originalname : null, file ? file.size : null
      );
      await stmt.finalize();

      const saved = await db.get('SELECT * FROM ledger_transactions WHERE id = ?', result.lastID);
      res.json(saved);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.delete('/api/ledger/:id/attachment', async (req, res) => {
    if (!req.user.roles.some((r) => ['accountant', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const id = req.params.id;
      const transaction = await db.get('SELECT * FROM ledger_transactions WHERE id = ?', id);
      if (!transaction) return res.status(404).json({ error: 'Transaction not found' });
      
      // Delete file physically if exists
      if (transaction.attachmentPath) {
        const filePath = path.join(process.cwd(), 'server', transaction.attachmentPath);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }

      await db.run('UPDATE ledger_transactions SET attachmentPath = NULL, attachmentName = NULL, attachmentSize = NULL WHERE id = ?', id);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  // --- Inventory Endpoints ---
  
  app.get('/api/inventory-categories', async (req, res) => {
    try {
      const rows = await db.all('SELECT * FROM inventory_categories');
      res.json(rows);
    } catch (error) { console.error('List inventory categories error:', error); res.status(500).json({ error: 'Failed to load inventory categories' }); }
  });
  app.post('/api/inventory-categories', async (req, res) => {
    if (!req.user.roles.some((r) => ['accountant', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const { name, status } = req.body;
      const stmt = await db.prepare('INSERT INTO inventory_categories (name, status) VALUES (?, ?)');
      const result = await stmt.run(name, status || 'Active');
      res.json({ id: result.lastID, name, status: status || 'Active' });
    } catch (error) { console.error('Create inventory category error:', error); res.status(500).json({ error: 'Failed to create inventory category' }); }
  });
  app.put('/api/inventory-categories/:id', async (req, res) => {
    if (!req.user.roles.some((r) => ['accountant', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const { name, status } = req.body;
      const stmt = await db.prepare('UPDATE inventory_categories SET name = ?, status = ? WHERE id = ?');
      await stmt.run(name, status, req.params.id);
      res.json({ success: true });
    } catch (error) { console.error('Update inventory category error:', error); res.status(500).json({ error: 'Failed to update inventory category' }); }
  });
  app.delete('/api/inventory-categories/:id', async (req, res) => {
    if (!req.user.roles.some((r) => ['accountant', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const stmt = await db.prepare('DELETE FROM inventory_categories WHERE id = ?');
      await stmt.run(req.params.id);
      res.json({ success: true });
    } catch (error) { console.error('Delete inventory category error:', error); res.status(500).json({ error: 'Failed to delete inventory category' }); }
  });

  app.get('/api/inventory', async (req, res) => {
    try {
      const branchId = resolveBranchId(req, req.query.branchId);
      let query = 'SELECT * FROM inventory_items';
      const params = [];
      if (branchId) {
        query += ' WHERE branchId = ?';
        params.push(branchId);
      }
      const rows = await db.all(query, ...params);
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.post('/api/inventory', async (req, res) => {
    if (!req.user.roles.some((r) => ['accountant', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const { itemName, category, description, quantity, minStock, unit, purchaseDate, supplier, purchaseCost, status } = req.body;
      const branchId = resolveBranchId(req, req.body.branchId) || 'branch_main';
      if (!itemName || !category || quantity === undefined || !unit || purchaseCost === undefined) {
        return res.status(400).json({ error: 'Item Name, category, quantity, unit, and purchaseCost are required.' });
      }

      // Generate Item Code: INV-XXX
      const maxIdRow = await db.get("SELECT MAX(id) as maxId FROM inventory_items");
      const suffix = String((maxIdRow.maxId || 0) + 1).padStart(3, '0');
      const itemCode = `INV-${suffix}`;

      const stmt = await db.prepare(`
        INSERT INTO inventory_items (itemName, category, itemCode, description, quantity, allocatedQuantity, availableQuantity, damagedQuantity, minStock, unit, purchaseDate, supplier, purchaseCost, branchId, status)
        VALUES (?, ?, ?, ?, ?, 0, ?, 0, ?, ?, ?, ?, ?, ?, ?)
      `);
      const result = await stmt.run(
        itemName, category, itemCode, description || '', Number(quantity), Number(quantity), Number(minStock || 0), unit, purchaseDate || '', supplier || '', Number(purchaseCost), branchId, status || 'Active'
      );
      await stmt.finalize();

      const saved = await db.get('SELECT * FROM inventory_items WHERE id = ?', result.lastID);
      res.json(saved);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.put('/api/inventory/:id', async (req, res) => {
    if (!req.user.roles.some((r) => ['accountant', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const id = req.params.id;
      const { itemName, category, description, quantity, minStock, unit, purchaseDate, supplier, purchaseCost, branchId, status, damagedQuantity } = req.body;
      
      const item = await db.get('SELECT * FROM inventory_items WHERE id = ?', id);
      if (!item) return res.status(404).json({ error: 'Item not found' });

      // Recalculate available: quantity - allocated - damaged
      const newQty = quantity !== undefined ? Number(quantity) : item.quantity;
      const newDmg = damagedQuantity !== undefined ? Number(damagedQuantity) : item.damagedQuantity;
      const newAlloc = item.allocatedQuantity;
      const newAvail = newQty - newAlloc - newDmg;

      const stmt = await db.prepare(`
        UPDATE inventory_items SET 
          itemName = ?, category = ?, description = ?, quantity = ?, availableQuantity = ?, damagedQuantity = ?, minStock = ?, unit = ?, purchaseDate = ?, supplier = ?, purchaseCost = ?, branchId = ?, status = ?
        WHERE id = ?
      `);
      await stmt.run(
        itemName || item.itemName, category || item.category, description !== undefined ? description : item.description,
        newQty, newAvail, newDmg, minStock !== undefined ? Number(minStock) : item.minStock, unit || item.unit,
        purchaseDate || item.purchaseDate, supplier || item.supplier, purchaseCost !== undefined ? Number(purchaseCost) : item.purchaseCost,
        branchId || item.branchId, status || item.status, id
      );
      await stmt.finalize();

      const saved = await db.get('SELECT * FROM inventory_items WHERE id = ?', id);
      res.json(saved);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.delete('/api/inventory/:id', async (req, res) => {
    if (!req.user.roles.some((r) => ['accountant', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const id = req.params.id;
      await db.run("UPDATE inventory_items SET status = 'Inactive' WHERE id = ?", id);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  // --- Inventory Allocations Endpoints ---
  app.get('/api/inventory/allocations', async (req, res) => {
    if (!req.user.roles.some((r) => ['accountant', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const branchId = resolveBranchId(req, req.query.branchId);
      let query = 'SELECT * FROM inventory_allocations';
      const params = [];
      if (branchId) {
        query += ' WHERE branchId = ?';
        params.push(branchId);
      }
      const rows = await db.all(query, ...params);
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.post('/api/inventory/allocate', async (req, res) => {
    if (!req.user.roles.some((r) => ['accountant', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const { studentId, studentName, admissionNumber, itemId, quantity, allocatedBy, remarks, uniformSize } = req.body;
      const branchId = resolveBranchId(req, req.body.branchId);
      if (!studentId || !studentName || !itemId || !quantity) {
        return res.status(400).json({ error: 'Student details, itemId, and quantity are required.' });
      }

      const item = await db.get('SELECT * FROM inventory_items WHERE id = ?', itemId);
      if (!item) return res.status(404).json({ error: 'Item not found' });

      const qty = Number(quantity);
      if (item.availableQuantity < qty) {
        return res.status(400).json({ error: `Insufficient stock. Only ${item.availableQuantity} available.` });
      }

      const newAllocated = item.allocatedQuantity + qty;
      const newAvailable = item.availableQuantity - qty;

      // Update inventory stock levels
      await db.run(`
        UPDATE inventory_items 
        SET allocatedQuantity = ?, availableQuantity = ?
        WHERE id = ?
      `, newAllocated, newAvailable, itemId);

      // Create allocation record
      const stmt = await db.prepare(`
        INSERT INTO inventory_allocations (studentId, studentName, admissionNumber, branchId, itemId, itemName, quantity, allocatedDate, allocatedBy, remarks)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const now = new Date().toISOString().split('T')[0];
      await stmt.run(studentId, studentName, admissionNumber || '', branchId || '', itemId, item.itemName, qty, now, allocatedBy || 'Accountant', remarks || '');
      await stmt.finalize();

      // Low Stock Notification Trigger
      if (newAvailable <= item.minStock) {
        const notifId = `NOTIF-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const notifTitle = `Low Stock Alert: ${item.itemName}`;
        const notifMessage = `${item.itemName} (Code: ${item.itemCode}) is below minimum stock level. Current available: ${newAvailable}, Min required: ${item.minStock}`;
        const notifDesc = `Inventory threshold alert for branch ${branchId || 'main'}`;
        await db.run(`
          INSERT INTO notifications (id, title, message, description, type, priority, roles, branchId, status, createdAt)
          VALUES (?, ?, ?, ?, 'warning', 'high', '["accountant","admin","super_admin"]', ?, 'unread', ?)
        `, notifId, notifTitle, notifMessage, notifDesc, branchId || null, new Date().toISOString());
      }

      res.json({ success: true, availableQuantity: newAvailable });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.post('/api/inventory/return', async (req, res) => {
    if (!req.user.roles.some((r) => ['accountant', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const { allocationId } = req.body;
      if (!allocationId) return res.status(400).json({ error: 'Allocation ID is required' });

      const allocation = await db.get('SELECT * FROM inventory_allocations WHERE id = ?', allocationId);
      if (!allocation) return res.status(404).json({ error: 'Allocation record not found' });

      const item = await db.get('SELECT * FROM inventory_items WHERE id = ?', allocation.itemId);
      if (item) {
        const newAllocated = Math.max(0, item.allocatedQuantity - allocation.quantity);
        const newAvailable = item.availableQuantity + allocation.quantity;
        
        await db.run(`
          UPDATE inventory_items 
          SET allocatedQuantity = ?, availableQuantity = ?
          WHERE id = ?
        `, newAllocated, newAvailable, allocation.itemId);
      }

      await db.run('DELETE FROM inventory_allocations WHERE id = ?', allocationId);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  // --- Monthly Reports Endpoints ---
  app.get('/api/financial-reports', async (req, res) => {
    if (!req.user.roles.some((r) => ['accountant', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const branchId = resolveBranchId(req, req.query.branchId);
      let query = 'SELECT * FROM monthly_reports';
      const params = [];
      if (branchId) {
        query += ' WHERE branchId = ?';
        params.push(branchId);
      }
      query += ' ORDER BY month DESC';
      const rows = await db.all(query, ...params);
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.post('/api/financial-reports', async (req, res) => {
    if (!req.user.roles.some((r) => ['accountant', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const { month, submittedBy, remarks, comments, totalIncome, totalExpense, netProfit, ledgerSummary, inventoryPurchased, inventoryAllocated, inventoryRemaining, lowStockItems, studentAdmissions, outstandingFees } = req.body;
      const branchId = resolveBranchId(req, req.body.branchId);
      if (!month || !branchId) return res.status(400).json({ error: 'Month and branchId are required' });

      // Check if report already exists for this branch & month
      const existing = await db.get('SELECT id FROM monthly_reports WHERE month = ? AND branchId = ?', month, branchId);
      if (existing) {
        await db.run(`
          UPDATE monthly_reports SET
            submittedBy = ?, submittedDate = ?, status = 'Submitted', remarks = ?, comments = ?,
            totalIncome = ?, totalExpense = ?, netProfit = ?, ledgerSummary = ?,
            inventoryPurchased = ?, inventoryAllocated = ?, inventoryRemaining = ?, lowStockItems = ?,
            studentAdmissions = ?, outstandingFees = ?
          WHERE id = ?
        `, submittedBy || 'Accountant', new Date().toISOString().split('T')[0], remarks || '', comments || '',
           Number(totalIncome || 0), Number(totalExpense || 0), Number(netProfit || 0), JSON.stringify(ledgerSummary || []),
           Number(inventoryPurchased || 0), Number(inventoryAllocated || 0), Number(inventoryRemaining || 0), JSON.stringify(lowStockItems || []),
           Number(studentAdmissions || 0), Number(outstandingFees || 0), existing.id);
        
        const updated = await db.get('SELECT * FROM monthly_reports WHERE id = ?', existing.id);
        return res.json(updated);
      }

      const stmt = await db.prepare(`
        INSERT INTO monthly_reports (month, branchId, submittedBy, submittedDate, status, remarks, comments, totalIncome, totalExpense, netProfit, ledgerSummary, inventoryPurchased, inventoryAllocated, inventoryRemaining, lowStockItems, studentAdmissions, outstandingFees)
        VALUES (?, ?, ?, ?, 'Submitted', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const result = await stmt.run(
        month, branchId, submittedBy || 'Accountant', new Date().toISOString().split('T')[0], remarks || '', comments || '',
        Number(totalIncome || 0), Number(totalExpense || 0), Number(netProfit || 0), JSON.stringify(ledgerSummary || []),
        Number(inventoryPurchased || 0), Number(inventoryAllocated || 0), Number(inventoryRemaining || 0), JSON.stringify(lowStockItems || []),
        Number(studentAdmissions || 0), Number(outstandingFees || 0)
      );
      await stmt.finalize();

      const saved = await db.get('SELECT * FROM monthly_reports WHERE id = ?', result.lastID);
      res.json(saved);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.post('/api/financial-reports/:id/action', async (req, res) => {
    if (!req.user.roles.includes('super_admin')) return res.status(403).json({ error: 'Forbidden' });
    try {
      const id = req.params.id;
      const { status, remarks } = req.body; // status: 'Approved' or 'Returned' (Returned for Correction)
      if (!status) return res.status(400).json({ error: 'Status is required' });

      const report = await db.get('SELECT * FROM monthly_reports WHERE id = ?', id);
      if (!report) return res.status(404).json({ error: 'Report not found' });

      await db.run('UPDATE monthly_reports SET status = ?, remarks = ? WHERE id = ?', status, remarks || '', id);
      const updated = await db.get('SELECT * FROM monthly_reports WHERE id = ?', id);

      // Trigger status notification to Accountant
      const notifId = `NOTIF-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const notifTitle = `Monthly Report Status Updated: ${status}`;
      const notifMessage = `Your Monthly Financial Report for ${report.month} has been ${status === 'Approved' ? 'Approved' : 'Returned for Correction'} by Super Admin.`;
      await db.run(`
        INSERT INTO notifications (id, title, message, type, priority, roles, branchId, status, createdAt)
        VALUES (?, ?, ?, 'info', 'medium', '["accountant"]', ?, 'unread', ?)
      `, notifId, notifTitle, notifMessage, report.branchId, new Date().toISOString());

      res.json(updated);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });


  // --- Fee Management Module Endpoints ---
  function feeRecordStatus(totalAmount, paidAmount, dueDate) {
    if (paidAmount >= totalAmount && totalAmount > 0) return 'Paid';
    if (paidAmount > 0) return 'Partially Paid';
    if (dueDate && dueDate < new Date().toISOString().slice(0, 10)) return 'Overdue';
    return 'Pending';
  }

  app.get('/api/fees/structures', async (req, res) => {
    if (!req.user.roles.some((r) => ['accountant', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const branchId = resolveBranchId(req, req.query.branchId);
      let query = 'SELECT * FROM fee_structures';
      const params = [];
      if (branchId) { query += ' WHERE branchId = ?'; params.push(branchId); }
      query += ' ORDER BY className ASC';
      const rows = await db.all(query, ...params);
      res.json(rows);
    } catch (err) { console.error(err); res.status(500).json({ error: 'failed' }); }
  });

  app.post('/api/fees/structures', async (req, res) => {
    if (!req.user.roles.some((r) => ['accountant', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const body = req.body || {};
      if (!body.className || !body.feeType || body.amount === undefined) {
        return res.status(400).json({ error: 'className, feeType and amount are required' });
      }
      const branchId = resolveBranchId(req, body.branchId) || req.user.branchId || null;
      const now = new Date().toISOString();
      const result = await db.run(`
        INSERT INTO fee_structures (className, branchId, academicYear, feeType, amount, dueDate, createdAt, updatedAt)
        VALUES (?,?,?,?,?,?,?,?)
      `, body.className, branchId, body.academicYear || '', body.feeType, Number(body.amount), body.dueDate || '', now, now);
      const created = await db.get('SELECT * FROM fee_structures WHERE id = ?', result.lastID);
      res.status(201).json(created);
    } catch (err) { console.error(err); res.status(500).json({ error: 'failed' }); }
  });

  app.put('/api/fees/structures/:id', async (req, res) => {
    if (!req.user.roles.some((r) => ['accountant', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const existing = await db.get('SELECT * FROM fee_structures WHERE id = ?', req.params.id);
      if (!existing) return res.status(404).json({ error: 'Fee structure not found' });
      const body = req.body || {};
      const now = new Date().toISOString();
      await db.run(`
        UPDATE fee_structures SET className=?, academicYear=?, feeType=?, amount=?, dueDate=?, updatedAt=?
        WHERE id=?
      `, body.className ?? existing.className, body.academicYear ?? existing.academicYear, body.feeType ?? existing.feeType,
         body.amount !== undefined ? Number(body.amount) : existing.amount, body.dueDate ?? existing.dueDate, now, req.params.id);
      const updated = await db.get('SELECT * FROM fee_structures WHERE id = ?', req.params.id);
      res.json(updated);
    } catch (err) { console.error(err); res.status(500).json({ error: 'failed' }); }
  });

  app.delete('/api/fees/structures/:id', async (req, res) => {
    if (!req.user.roles.some((r) => ['accountant', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      await db.run('DELETE FROM fee_structures WHERE id = ?', req.params.id);
      res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'failed' }); }
  });

  // Fee records: parents only ever see records for students linked to them via the
  // parent_student table — resolved server-side, never trusted from a client-supplied
  // studentId list.
  app.get('/api/fees/records', async (req, res) => {
    try {
      const roles = req.user.roles || [];
      let query = 'SELECT * FROM fee_records';
      const params = [];
      const conditions = [];

      if (roles.includes('parent')) {
        const linkedRows = await db.all('SELECT studentId FROM parent_student WHERE parentId = ?', req.user.sub);
        const studentIds = linkedRows.map((r) => r.studentId);
        if (studentIds.length === 0) return res.json([]);
        conditions.push(`studentId IN (${studentIds.map(() => '?').join(',')})`);
        params.push(...studentIds);
      } else if (roles.some((r) => ['accountant', 'admin', 'super_admin'].includes(r))) {
        const branchId = resolveBranchId(req, req.query.branchId);
        if (branchId) { conditions.push('branchId = ?'); params.push(branchId); }
        if (req.query.studentId) { conditions.push('studentId = ?'); params.push(req.query.studentId); }
        if (req.query.className) { conditions.push('className = ?'); params.push(req.query.className); }
      } else {
        return res.status(403).json({ error: 'Forbidden' });
      }

      if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
      query += ' ORDER BY dueDate ASC';
      const rows = await db.all(query, ...params);
      // Status is recomputed on every read (not just on write) so a record that has
      // simply aged past its due date shows as Overdue without needing a background job.
      const withStatus = rows.map((r) => ({ ...r, status: feeRecordStatus(r.totalAmount, r.paidAmount, r.dueDate) }));
      res.json(req.query.status ? withStatus.filter((r) => r.status === req.query.status) : withStatus);
    } catch (err) { console.error(err); res.status(500).json({ error: 'failed' }); }
  });

  app.post('/api/fees/records', async (req, res) => {
    if (!req.user.roles.some((r) => ['accountant', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const body = req.body || {};
      if (!body.studentId || !body.feeType || body.totalAmount === undefined) {
        return res.status(400).json({ error: 'studentId, feeType and totalAmount are required' });
      }
      const student = await db.get('SELECT * FROM students WHERE id = ?', body.studentId);
      if (!student) return res.status(404).json({ error: 'Student not found' });
      const branchId = resolveBranchId(req, student.branchId) || student.branchId;
      const now = new Date().toISOString();
      const status = feeRecordStatus(Number(body.totalAmount), 0, body.dueDate);
      const result = await db.run(`
        INSERT INTO fee_records (studentId, studentName, className, branchId, feeType, academicYear, totalAmount, paidAmount, dueDate, status, createdAt, updatedAt)
        VALUES (?,?,?,?,?,?,?,0,?,?,?,?)
      `, student.id, student.fullName, student.className, branchId, body.feeType, body.academicYear || '', Number(body.totalAmount), body.dueDate || '', status, now, now);
      const created = await db.get('SELECT * FROM fee_records WHERE id = ?', result.lastID);
      res.status(201).json(created);
    } catch (err) { console.error(err); res.status(500).json({ error: 'failed' }); }
  });

  // Bulk-generate fee records for every active student in a class from a fee structure,
  // skipping students who already have a record for that feeType+academicYear.
  app.post('/api/fees/records/generate', async (req, res) => {
    if (!req.user.roles.some((r) => ['accountant', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const { structureId } = req.body || {};
      const structure = await db.get('SELECT * FROM fee_structures WHERE id = ?', structureId);
      if (!structure) return res.status(404).json({ error: 'Fee structure not found' });

      const students = await db.all('SELECT * FROM students WHERE className = ? AND branchId = ? AND status = ?', structure.className, structure.branchId, 'Active');
      const now = new Date().toISOString();
      const createdIds = [];
      for (const student of students) {
        const existing = await db.get(
          'SELECT id FROM fee_records WHERE studentId = ? AND feeType = ? AND academicYear = ?',
          student.id, structure.feeType, structure.academicYear
        );
        if (existing) continue;
        const status = feeRecordStatus(structure.amount, 0, structure.dueDate);
        const result = await db.run(`
          INSERT INTO fee_records (studentId, studentName, className, branchId, feeType, academicYear, totalAmount, paidAmount, dueDate, status, createdAt, updatedAt)
          VALUES (?,?,?,?,?,?,?,0,?,?,?,?)
        `, student.id, student.fullName, student.className, structure.branchId, structure.feeType, structure.academicYear, structure.amount, structure.dueDate, status, now, now);
        createdIds.push(result.lastID);
      }
      const rows = createdIds.length ? await db.all(`SELECT * FROM fee_records WHERE id IN (${createdIds.map(() => '?').join(',')})`, ...createdIds) : [];
      res.status(201).json({ createdCount: rows.length, skippedCount: students.length - rows.length, records: rows });
    } catch (err) { console.error(err); res.status(500).json({ error: 'failed' }); }
  });

  app.get('/api/fees/stats', async (req, res) => {
    if (!req.user.roles.some((r) => ['accountant', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const branchId = resolveBranchId(req, req.query.branchId);
      let query = 'SELECT totalAmount, paidAmount, dueDate FROM fee_records';
      const params = [];
      if (branchId) { query += ' WHERE branchId = ?'; params.push(branchId); }
      const rows = await db.all(query, ...params);
      const statuses = rows.map((r) => feeRecordStatus(r.totalAmount, r.paidAmount, r.dueDate));
      const totalCollected = rows.reduce((sum, r) => sum + (r.paidAmount || 0), 0);
      const totalPending = rows.reduce((sum, r) => sum + Math.max(0, (r.totalAmount || 0) - (r.paidAmount || 0)), 0);
      res.json({
        totalCollected,
        totalPending,
        overdueCount: statuses.filter((s) => s === 'Overdue').length,
        paidCount: statuses.filter((s) => s === 'Paid').length,
        totalRecords: rows.length,
      });
    } catch (err) { console.error(err); res.status(500).json({ error: 'failed' }); }
  });

  app.post('/api/fees/records/:id/payments', async (req, res) => {
    if (!req.user.roles.some((r) => ['accountant', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const record = await db.get('SELECT * FROM fee_records WHERE id = ?', req.params.id);
      if (!record) return res.status(404).json({ error: 'Fee record not found' });
      const body = req.body || {};
      const amount = Number(body.amount);
      if (!amount || amount <= 0) return res.status(400).json({ error: 'A positive payment amount is required' });

      const now = new Date().toISOString();
      const receiptNumber = `RCPT-${Date.now()}`;
      await db.run(`
        INSERT INTO fee_payments (feeRecordId, studentId, amount, paymentMode, referenceNumber, receivedBy, paymentDate, receiptNumber, branchId, createdAt)
        VALUES (?,?,?,?,?,?,?,?,?,?)
      `, record.id, record.studentId, amount, body.paymentMode || 'Cash', body.referenceNumber || '', req.user.name || 'Accountant', now.slice(0, 10), receiptNumber, record.branchId, now);

      const newPaidAmount = (record.paidAmount || 0) + amount;
      const newStatus = feeRecordStatus(record.totalAmount, newPaidAmount, record.dueDate);
      await db.run('UPDATE fee_records SET paidAmount = ?, status = ?, updatedAt = ? WHERE id = ?', newPaidAmount, newStatus, now, record.id);

      const updated = await db.get('SELECT * FROM fee_records WHERE id = ?', record.id);
      res.status(201).json({ record: updated, receiptNumber });
    } catch (err) { console.error(err); res.status(500).json({ error: 'failed' }); }
  });

  app.get('/api/fees/records/:id/payments', async (req, res) => {
    try {
      const record = await db.get('SELECT * FROM fee_records WHERE id = ?', req.params.id);
      if (!record) return res.status(404).json({ error: 'Fee record not found' });
      const roles = req.user.roles || [];
      if (roles.includes('parent')) {
        const linked = await db.get('SELECT 1 FROM parent_student WHERE parentId = ? AND studentId = ?', req.user.sub, record.studentId);
        if (!linked) return res.status(403).json({ error: 'Forbidden' });
      } else if (!roles.some((r) => ['accountant', 'admin', 'super_admin'].includes(r))) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const rows = await db.all('SELECT * FROM fee_payments WHERE feeRecordId = ? ORDER BY createdAt DESC', req.params.id);
      res.json(rows);
    } catch (err) { console.error(err); res.status(500).json({ error: 'failed' }); }
  });

  // --- Event Management Module Endpoints ---
  app.get('/api/events', async (req, res) => {
    try {
      const branchId = resolveBranchId(req, req.query.branchId);
      let query = 'SELECT * FROM events';
      const params = [];
      if (branchId) { query += ' WHERE branchId = ?'; params.push(branchId); }
      query += ' ORDER BY date ASC';
      const rows = await db.all(query, ...params);
      res.json(rows);
    } catch (err) { console.error(err); res.status(500).json({ error: 'failed' }); }
  });

  app.post('/api/events', async (req, res) => {
    if (!req.user.roles.some((r) => ['admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const body = req.body || {};
      if (!body.title || !body.date) return res.status(400).json({ error: 'title and date are required' });
      const branchId = resolveBranchId(req, body.branchId) || req.user.branchId || null;
      const now = new Date().toISOString();
      const result = await db.run(`
        INSERT INTO events (title, description, eventType, date, time, venue, expectedAttendees, branchId, createdBy, createdByName, status, createdAt, updatedAt)
        VALUES (?,?,?,?,?,?,?,?,?,?,'Scheduled',?,?)
      `, body.title, body.description || '', body.eventType || 'Other', body.date, body.time || '', body.venue || '', Number(body.expectedAttendees || 0), branchId, req.user.sub, req.user.name || '', now, now);
      const created = await db.get('SELECT * FROM events WHERE id = ?', result.lastID);

      const notifId = `NOTIF-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      await db.run(`
        INSERT INTO notifications (id, title, message, type, priority, roles, branchId, status, createdAt)
        VALUES (?, ?, ?, 'info', 'medium', '["parent","teacher"]', ?, 'unread', ?)
      `, notifId, 'New Event', `${created.title} scheduled for ${created.date}`, branchId, now);

      res.status(201).json(created);
    } catch (err) { console.error(err); res.status(500).json({ error: 'failed' }); }
  });

  app.put('/api/events/:id', async (req, res) => {
    if (!req.user.roles.some((r) => ['admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const existing = await db.get('SELECT * FROM events WHERE id = ?', req.params.id);
      if (!existing) return res.status(404).json({ error: 'Event not found' });
      const body = req.body || {};
      const now = new Date().toISOString();
      await db.run(`
        UPDATE events SET title=?, description=?, eventType=?, date=?, time=?, venue=?, expectedAttendees=?, status=?, updatedAt=?
        WHERE id=?
      `, body.title ?? existing.title, body.description ?? existing.description, body.eventType ?? existing.eventType,
         body.date ?? existing.date, body.time ?? existing.time, body.venue ?? existing.venue,
         body.expectedAttendees !== undefined ? Number(body.expectedAttendees) : existing.expectedAttendees,
         body.status ?? existing.status, now, req.params.id);
      const updated = await db.get('SELECT * FROM events WHERE id = ?', req.params.id);
      res.json(updated);
    } catch (err) { console.error(err); res.status(500).json({ error: 'failed' }); }
  });

  app.delete('/api/events/:id', async (req, res) => {
    if (!req.user.roles.some((r) => ['admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      await db.run('DELETE FROM events WHERE id = ?', req.params.id);
      res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'failed' }); }
  });

  app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
}

main().catch((e) => { console.error(e); process.exit(1); });
