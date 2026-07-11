import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import cors from 'cors';
import { WhatsAppService } from './whatsappService.js';


const PORT = process.env.PORT || 4000;
const UPLOAD_DIR = path.resolve(process.cwd(), 'server', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

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

  return db;
}

async function main() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const db = await initDb();

  app.use('/uploads', express.static(UPLOAD_DIR));

  app.post('/api/exams', upload.single('attachment'), async (req, res) => {
    try {
      const body = req.body;
      const attachment = req.file;
      const now = new Date().toISOString();
      const stmt = await db.prepare(`INSERT INTO exams (name, subject, className, batch, date, maxMarks, passingMarks, description, status, createdBy, createdAt, attachmentPath, attachmentName, attachmentSize) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
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

  app.get('/api/school-exam-schedules', async (req, res) => {
    try {
      const conditions = [];
      const params = [];
      if (req.query.branchId) {
        conditions.push('branchId = ?');
        params.push(req.query.branchId);
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

  app.get('/api/notifications', async (req, res) => {
    try {
      const rows = await db.all('SELECT * FROM notifications ORDER BY createdAt DESC');
      const user = {
        id: String(req.query.userId || ''),
        role: String(req.query.role || ''),
        branchId: String(req.query.branchId || ''),
        assignedClassIds: parseArrayParam(req.query.classNames),
        linkedStudentIds: parseArrayParam(req.query.studentIds),
      };
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
      const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
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
      const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
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

  // --- Homework Module Endpoints ---

  app.get('/api/homework', async (req, res) => {
    try {
      const role = String(req.query.role || '');
      const userId = String(req.query.userId || '');
      const branchId = String(req.query.branchId || '');
      const classNames = parseArrayParam(req.query.classNames);
      
      let query = 'SELECT * FROM homework';
      const params = [];
      const conditions = [];
      
      if (role === 'teacher') {
        if (branchId) {
          conditions.push('branchId = ?');
          params.push(branchId);
        }
        if (userId) {
          conditions.push('teacherId = ?');
          params.push(userId);
        }
      } else if (role === 'parent') {
        if (branchId) {
          conditions.push('branchId = ?');
          params.push(branchId);
        }
        if (classNames.length > 0) {
          const placeholders = classNames.map(() => '?').join(',');
          conditions.push(`className IN (${placeholders})`);
          params.push(...classNames);
        } else {
          conditions.push('1 = 0');
        }
      } else if (role === 'admin' || role === 'accountant') {
        if (branchId) {
          conditions.push('branchId = ?');
          params.push(branchId);
        }
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
    try {
      const body = req.body;
      const files = req.files || [];
      const now = new Date().toISOString();
      
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
        body.teacherId,
        body.assignedBy,
        body.branchId,
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
    try {
      const id = req.params.id;
      const body = req.body;
      const newFiles = req.files || [];
      
      const current = await db.get('SELECT * FROM homework WHERE id = ?', id);
      if (!current) {
        return res.status(404).json({ error: 'Homework not found' });
      }
      
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
        body.teacherId,
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
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.delete('/api/homework/:id', async (req, res) => {
    try {
      const id = req.params.id;
      const hw = await db.get('SELECT * FROM homework WHERE id = ?', id);
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
  app.post('/api/auth/parent-login', async (req, res) => {
    try {
      const { mobile } = req.body;
      if (!mobile) {
        return res.status(400).json({ error: 'Mobile number is required' });
      }
      const parent = await db.get('SELECT * FROM parents WHERE mobile = ?', mobile);
      if (!parent) {
        return res.status(400).json({ error: 'This mobile number is not registered with Guru Shishyaru Tutorials.' });
      }
      
      const studentRows = await db.all('SELECT studentId FROM parent_student WHERE parentId = ?', parent.id);
      const linkedStudentIds = studentRows.map(r => r.studentId);
      
      res.json({
        success: true,
        user: {
          id: parent.id,
          name: `${parent.firstName} ${parent.lastName}`,
          email: parent.email,
          mobile: parent.mobile,
          role: 'parent',
          branchId: parent.branchId,
          linkedStudentIds: linkedStudentIds,
          status: parent.status
        }
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  // --- Students API ---
  app.get('/api/students', async (req, res) => {
    try {
      const { className, branchId } = req.query;
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

  app.post('/api/students', async (req, res) => {
    try {
      const s = req.body;
      if (!s.firstName || !s.lastName || !s.primaryParentMobile) {
        return res.status(400).json({ error: 'First name, last name, and primary parent mobile are required' });
      }

      const now = new Date().toISOString();
      const studentId = s.id || `STU${Date.now()}`;
      
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
        s.className || '', s.batch || '', s.branchId || '', s.rollNumber || '', s.admissionNumber || '',
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
        `, parentId, fName, lName, s.primaryParentMobile, s.parentEmail || '', tempPassword, s.branchId || '', now);
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
    try {
      const studentId = req.params.id;
      const s = req.body;
      
      const stmt = await db.prepare(`
        UPDATE students SET 
          firstName=?, lastName=?, fullName=?, gender=?, dob=?, className=?, batch=?, branchId=?,
          rollNumber=?, admissionNumber=?, admissionDate=?, status=?, fatherName=?, motherName=?,
          primaryParentName=?, relationship=?, fatherMobile=?, motherMobile=?, primaryParentMobile=?,
          parentEmail=?, guardianName=?, guardianMobile=?, address=?
        WHERE id=?
      `);
      await stmt.run(
        s.firstName, s.lastName, `${s.firstName} ${s.lastName}`, s.gender, s.dob, s.className, s.batch, s.branchId,
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
        `, parentId, fName, lName, s.primaryParentMobile, s.parentEmail || '', 'Password@123', s.branchId || '', new Date().toISOString());
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
    try {
      const rows = await db.all('SELECT * FROM parents');
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


  app.get('/api/settings', async (req, res) => {
    try {
      const rows = await db.all('SELECT * FROM whatsapp_settings');
      const settings = {};
      rows.forEach(r => { settings[r.key] = r.value; });
      res.json(settings);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.post('/api/settings', async (req, res) => {
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
    try {
      const { studentId, date, markedBy, userRole, assignedClassIds } = req.body;
      if (!studentId || !date) {
        return res.status(400).json({ error: 'Missing studentId or date' });
      }

      const student = await db.get('SELECT * FROM students WHERE id = ?', studentId);
      if (!student) {
        return res.status(404).json({ error: 'Student not found' });
      }

      // Security check: teacher can only notify parents of students in their assigned classes
      if (userRole === 'teacher' && assignedClassIds) {
        const assignedList = Array.isArray(assignedClassIds) ? assignedClassIds : String(assignedClassIds).split(',');
        if (!assignedList.includes(student.className)) {
          return res.status(403).json({ error: 'Unauthorized to send alerts for this class.' });
        }
      }

      const parentName = student.primaryParentName || 'Parent';
      const toMobile = student.primaryParentMobile;
      const branchId = student.branchId || '';
      const teacher = markedBy || 'Teacher';

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
      const { branchId, className, teacherId } = req.query;
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
      const { branchId, type, category, voucherNumber, date } = req.query;
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
    try {
      const { date, type, category, description, amount, paymentMode, referenceNumber, enteredBy, branchId } = req.body;
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const result = await stmt.run(
        voucherNumber, date, type, category, description, Number(amount), paymentMode, referenceNumber || '', enteredBy || '', branchId || '',
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
    } catch (error) { res.status(500).json({ error: error.message }); }
  });
  app.post('/api/inventory-categories', async (req, res) => {
    try {
      const { name, status } = req.body;
      const stmt = await db.prepare('INSERT INTO inventory_categories (name, status) VALUES (?, ?)');
      const result = await stmt.run(name, status || 'Active');
      res.json({ id: result.lastID, name, status: status || 'Active' });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });
  app.put('/api/inventory-categories/:id', async (req, res) => {
    try {
      const { name, status } = req.body;
      const stmt = await db.prepare('UPDATE inventory_categories SET name = ?, status = ? WHERE id = ?');
      await stmt.run(name, status, req.params.id);
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });
  app.delete('/api/inventory-categories/:id', async (req, res) => {
    try {
      const stmt = await db.prepare('DELETE FROM inventory_categories WHERE id = ?');
      await stmt.run(req.params.id);
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  app.get('/api/inventory', async (req, res) => {
    try {
      const { branchId } = req.query;
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
    try {
      const { itemName, category, description, quantity, minStock, unit, purchaseDate, supplier, purchaseCost, branchId, status } = req.body;
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
        itemName, category, itemCode, description || '', Number(quantity), Number(quantity), Number(minStock || 0), unit, purchaseDate || '', supplier || '', Number(purchaseCost), branchId || '', status || 'Active'
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
    try {
      const { branchId } = req.query;
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
    try {
      const { studentId, studentName, admissionNumber, branchId, itemId, quantity, allocatedBy, remarks, uniformSize } = req.body;
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
    try {
      const { branchId } = req.query;
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
    try {
      const { month, branchId, submittedBy, remarks, comments, totalIncome, totalExpense, netProfit, ledgerSummary, inventoryPurchased, inventoryAllocated, inventoryRemaining, lowStockItems, studentAdmissions, outstandingFees } = req.body;
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


  // serve uploaded files
  app.use('/uploads', express.static(UPLOAD_DIR));

  app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
}

main().catch((e) => { console.error(e); process.exit(1); });
