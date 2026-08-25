import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
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
import { sendPasswordResetOtpEmail } from './emailService.js';

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

// `NOTIF-${Date.now()}-${random 0-999}` collides constantly when a single
// action fans out to many recipients in a tight loop (same millisecond,
// 1-in-1000 tiebreaker) — that was the cause of the recurring
// "UNIQUE constraint failed: notifications.id" 500s. UUIDs can't collide.
function newNotificationId() {
  return `NOTIF-${crypto.randomUUID()}`;
}

// Mirrors the frontend's ROLE_PRIORITY (src/app/auth/rbac.ts) — the array
// order of a multi-role user's `roles` matters because `roles[0]` is read
// throughout this file and the frontend as "the" primary role (mapUserRow,
// deriveNotificationUser's fallback, etc). Sorting here whenever roles are
// written keeps roles[0] deterministic instead of depending on whatever
// order checkboxes happened to be toggled in.
const ROLE_PRIORITY = ['super_admin', 'admin', 'accountant', 'teacher', 'parent'];
function sortRoles(roles) {
  return [...roles].sort((a, b) => ROLE_PRIORITY.indexOf(a) - ROLE_PRIORITY.indexOf(b));
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
    createdById: row.createdById,
    createdByRole: row.createdByRole,
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

// The assigned teacher of a student's batch — resolved the same way as the
// parent notification composer's "my_assigned_teacher" audience (className +
// branchId join against classes.assignedTeacherId). Used so a parent-uploaded
// school exam schedule is visible to that teacher via the *same* teacherId
// column and reminder/visibility logic a teacher's own upload already uses,
// with no new columns or parallel matching logic required.
async function resolveAssignedTeacherForClass(db, className, branchId) {
  if (!className || !branchId) return { teacherId: null, teacherName: null };
  const row = await db.get(
    'SELECT u.id AS teacherId, u.name AS teacherName FROM classes c JOIN users u ON u.id = c.assignedTeacherId WHERE c.className = ? AND c.branchId = ? AND c.assignedTeacherId IS NOT NULL LIMIT 1',
    className, branchId
  );
  return { teacherId: row?.teacherId || null, teacherName: row?.teacherName || null };
}

// Immediate "a school exam schedule was uploaded" notification to the
// branch's Admin (and, via matchesUserScope's super_admin bypass, to Super
// Admin too) — distinct from upsertSchoolExamReminderNotifications' -3day/
// -1day/start-date reminders above, which are scheduled for later and don't
// tell anyone a new schedule just landed. Fires for every upload (teacher or
// parent), so the teacher-upload path gains this too rather than diverging
// from what parent uploads now do.
async function sendSchoolExamUploadNotification(db, schedule, uploader) {
  if (!schedule?.id) return;
  const uploaderLabel = uploader.role === 'parent' ? `Parent ${uploader.name}` : `${uploader.name}`;
  const title = uploader.role === 'parent'
    ? `${uploader.name} uploaded a school exam schedule for ${schedule.studentName}`
    : `New school exam schedule uploaded for ${schedule.studentName}`;
  const message = `${uploaderLabel} uploaded a school exam schedule. Student: ${schedule.studentName}. Batch: ${schedule.schoolClass || '—'}. Exam: ${schedule.examName}. ${formatReminderDate(schedule.startDate)} to ${formatReminderDate(schedule.endDate)}.`;

  const branchRow = schedule.branchId ? await db.get('SELECT name FROM branches WHERE id = ?', schedule.branchId) : null;
  // Real, readable body instead of the old unresolved `schoolExamScheduleId:N`
  // pointer — nothing ever parsed that pointer back into content, so it just
  // rendered as literal text in the Notification Center.
  const descriptionLines = [
    `Teacher: ${schedule.teacherName || uploaderLabel}`,
    `Branch: ${branchRow?.name || schedule.branchId || '—'}`,
    `Batch: ${schedule.schoolClass || '—'}`,
    `Title: ${schedule.examName}`,
    `Start Date: ${formatReminderDate(schedule.startDate)}`,
    `End Date: ${formatReminderDate(schedule.endDate)}`,
  ];
  if (schedule.attachmentName) descriptionLines.push(`Attachment: ${schedule.attachmentName}`);

  // Also reaches the batch's assigned teacher (schedule.teacherId, already
  // resolved server-side for parent uploads — see resolveAssignedTeacherForClass)
  // via teacherIds, not roles: ['teacher'] — that would broadcast to every
  // teacher instead of just the one responsible for this student's batch.
  // matchesUserScope grants access on teacherIds regardless of the roles list.
  await db.run(
    `INSERT INTO notifications (id, title, message, description, type, priority, roles, teacherIds, classNames, userIds, studentIds, sender, senderId, senderRole, notificationType, recipient, recipientRole, branchId, status, read, createdAt, attachmentPath, attachmentName, attachmentSize)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    newNotificationId(), title, message, descriptionLines.join('\n'), 'info', 'high',
    JSON.stringify(['admin']), JSON.stringify(schedule.teacherId ? [schedule.teacherId] : []), JSON.stringify([]), JSON.stringify([]), JSON.stringify([]),
    uploader.name, uploader.id, uploader.role, 'school_exam_schedule_uploaded', 'Admin', 'admin',
    schedule.branchId || null, 'unread', 0, new Date().toISOString(),
    schedule.attachmentPath || null, schedule.attachmentName || null, schedule.attachmentSize || null
  );
}

// "Homework uploaded" notification to the branch's Admin (and, via
// matchesUserScope's super_admin bypass, Super Admin) — mirrors
// sendSchoolExamUploadNotification's shape above. Fires once per POST
// /api/homework, after the row is committed, so a failed notification insert
// never blocks or rolls back the homework upload itself (caller awaits this
// but the homework row is already saved by the time it runs).
async function sendHomeworkUploadNotification(db, homework, uploader, firstAttachment) {
  if (!homework?.id) return;
  const branchRow = homework.branchId ? await db.get('SELECT name FROM branches WHERE id = ?', homework.branchId) : null;
  const title = `Homework Uploaded — ${homework.className}`;
  const message = `${uploader.name} uploaded homework "${homework.title}" for ${homework.className}.`;
  const submittedAt = new Date();
  const descriptionLines = [
    `Teacher: ${uploader.name}`,
    `Branch: ${branchRow?.name || homework.branchId || '—'}`,
    `Batch: ${homework.className}`,
    `Title: ${homework.title}`,
    `Uploaded: ${formatAttendanceDate(submittedAt.toISOString())} ${formatTime12h(submittedAt)}`,
  ];
  if (firstAttachment) descriptionLines.push(`Attachment: ${firstAttachment.originalname}`);

  await db.run(
    `INSERT INTO notifications (id, title, message, description, type, priority, roles, teacherIds, classNames, userIds, studentIds, sender, senderId, senderRole, notificationType, recipient, recipientRole, branchId, status, read, createdAt, attachmentPath, attachmentName, attachmentSize)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    newNotificationId(), title, message, descriptionLines.join('\n'), 'info', 'medium',
    JSON.stringify(['admin']), JSON.stringify([]), JSON.stringify([]), JSON.stringify([]), JSON.stringify([]),
    uploader.name, uploader.id, uploader.role, 'homework_uploaded', 'Admin', 'admin',
    homework.branchId || null, 'unread', 0, submittedAt.toISOString(),
    firstAttachment ? `/uploads/${firstAttachment.filename}` : null,
    firstAttachment ? firstAttachment.originalname : null,
    firstAttachment ? firstAttachment.size : null
  );
}

// "Fee approval requested" (new fee assignment) / "Fee modified and sent for
// approval" (edit of an existing fee_records row) — same notification shape,
// distinguished only by whether the request already has a feeRecordId. Goes
// to Super Admin only; nothing is written to fee_records until they act.
async function sendFeeApprovalRequestedNotification(db, request, requester) {
  const branchRow = request.branchId ? await db.get('SELECT name FROM branches WHERE id = ?', request.branchId) : null;
  const requestedAt = new Date(request.requestedAt);
  const title = `Fee Approval Requested — ${request.studentName}`;
  const message = `${requester.name} requested a fee change for ${request.studentName} (${request.className}). Proposed: ₹${request.newAmount}.`;
  const descriptionLines = [
    `Admin: ${requester.name}`,
    `Branch: ${branchRow?.name || request.branchId || '—'}`,
    `Student: ${request.studentName}`,
    `Batch: ${request.className}`,
    `Current Fee: ${request.oldAmount != null ? `₹${request.oldAmount}` : 'Not set'}`,
    `Proposed Fee: ₹${request.newAmount}`,
    `Effective Date: ${request.dueDate || '—'}`,
    `Requested: ${formatAttendanceDate(request.requestedAt)} ${formatTime12h(requestedAt)}`,
  ];

  await db.run(
    `INSERT INTO notifications (id, title, message, description, type, priority, roles, teacherIds, classNames, userIds, studentIds, sender, senderId, senderRole, notificationType, recipient, recipientRole, branchId, status, read, createdAt, feeApprovalRequestId)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    newNotificationId(), title, message, descriptionLines.join('\n'), 'info', 'high',
    JSON.stringify(['super_admin']), JSON.stringify([]), JSON.stringify([]), JSON.stringify([]), JSON.stringify([]),
    requester.name, requester.id, requester.role,
    request.feeRecordId ? 'fee_modified_for_approval' : 'fee_approval_requested',
    'Super Admin', 'super_admin', request.branchId || null, 'unread', 0, request.requestedAt, request.id
  );
}

// Fires two rows on Approve — a confirmation back to the requesting admin,
// and a separate notice to the student's parent(s) — both share
// notificationType 'fee_approved' but are scoped to different recipients via
// userIds vs studentIds+roles, same targeting mechanism matchesUserScope
// already uses everywhere else (see line ~412-414).
async function sendFeeApprovedNotification(db, request, approver) {
  const branchRow = request.branchId ? await db.get('SELECT name FROM branches WHERE id = ?', request.branchId) : null;
  const branchName = branchRow?.name || request.branchId || '—';
  const now = new Date().toISOString();

  await db.run(
    `INSERT INTO notifications (id, title, message, description, type, priority, roles, teacherIds, classNames, userIds, studentIds, sender, senderId, senderRole, notificationType, recipient, recipientRole, branchId, status, read, createdAt, feeApprovalRequestId)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    newNotificationId(),
    `Fee Approved — ${request.studentName}`,
    `${approver.name} approved the fee change for ${request.studentName}. New fee: ₹${request.newAmount}.`,
    [`Student: ${request.studentName}`, `Batch: ${request.className}`, `Branch: ${branchName}`, `Approved Fee: ₹${request.newAmount}`, `Approved By: ${approver.name}`].join('\n'),
    'success', 'medium', JSON.stringify([]), JSON.stringify([]), JSON.stringify([]), JSON.stringify([request.requestedBy]), JSON.stringify([]),
    approver.name, approver.id, approver.role, 'fee_approved', 'Admin', 'admin', request.branchId || null, 'unread', 0, now, request.id
  );

  await db.run(
    `INSERT INTO notifications (id, title, message, description, type, priority, roles, teacherIds, classNames, userIds, studentIds, sender, senderId, senderRole, notificationType, recipient, recipientRole, branchId, status, read, createdAt, feeApprovalRequestId)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    newNotificationId(),
    'Fee Update',
    `The fee for ${request.studentName} has been fixed at ₹${request.newAmount}, effective ${request.dueDate || 'immediately'}.`,
    [`Student: ${request.studentName}`, `Batch: ${request.className}`, `Fee: ₹${request.newAmount}`, `Effective: ${request.dueDate || '—'}`].join('\n'),
    'info', 'medium', JSON.stringify(['parent']), JSON.stringify([]), JSON.stringify([]), JSON.stringify([]), JSON.stringify([request.studentId]),
    approver.name, approver.id, approver.role, 'fee_approved', 'Parent', 'parent', request.branchId || null, 'unread', 0, now, request.id
  );

  // "When a fee is assigned, notify Super Admin" — only for a brand-new
  // assignment (feeRecordId was null going in), not every subsequent edit of
  // an already-assigned fee; the two notifications above already cover the
  // admin-confirmation and parent-notice side of every approval regardless.
  if (!request.feeRecordId) {
    await db.run(
      `INSERT INTO notifications (id, title, message, description, type, priority, roles, teacherIds, classNames, userIds, studentIds, sender, senderId, senderRole, notificationType, recipient, recipientRole, branchId, status, read, createdAt, feeApprovalRequestId)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      newNotificationId(),
      `Fee Assigned — ${request.studentName}`,
      `A fee was assigned to ${request.studentName} (${request.className}, ${branchName}): ₹${request.newAmount}.`,
      [`Student: ${request.studentName}`, `Batch: ${request.className}`, `Branch: ${branchName}`, `Fee: ₹${request.newAmount}`, `Approved By: ${approver.name}`].join('\n'),
      'info', 'low', JSON.stringify(['super_admin']), JSON.stringify([]), JSON.stringify([]), JSON.stringify([]), JSON.stringify([]),
      approver.name, approver.id, approver.role, 'fee_assigned', 'Super Admin', 'super_admin', request.branchId || null, 'unread', 0, now, request.id
    );
  }
}

// Fires on Reject — confirms to the requesting admin only; fee_records is
// never touched by a rejection, so "no financial records are modified" holds
// by construction (the approve/reject handlers are the only writers, and
// reject never calls the INSERT/UPDATE branch).
async function sendFeeRejectedNotification(db, request, rejector) {
  const branchRow = request.branchId ? await db.get('SELECT name FROM branches WHERE id = ?', request.branchId) : null;
  const now = new Date().toISOString();
  const descriptionLines = [
    `Student: ${request.studentName}`,
    `Batch: ${request.className}`,
    `Branch: ${branchRow?.name || request.branchId || '—'}`,
    `Proposed Fee: ₹${request.newAmount}`,
    `Rejected By: ${rejector.name}`,
  ];
  if (request.rejectionReason) descriptionLines.push(`Reason: ${request.rejectionReason}`);

  await db.run(
    `INSERT INTO notifications (id, title, message, description, type, priority, roles, teacherIds, classNames, userIds, studentIds, sender, senderId, senderRole, notificationType, recipient, recipientRole, branchId, status, read, createdAt, feeApprovalRequestId)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    newNotificationId(),
    `Fee Request Rejected — ${request.studentName}`,
    `${rejector.name} rejected the proposed fee change for ${request.studentName}. Existing fee remains unchanged.`,
    descriptionLines.join('\n'),
    'warning', 'medium', JSON.stringify([]), JSON.stringify([]), JSON.stringify([]), JSON.stringify([request.requestedBy]), JSON.stringify([]),
    rejector.name, rejector.id, rejector.role, 'fee_rejected', 'Admin', 'admin', request.branchId || null, 'unread', 0, now, request.id
  );
}

// Notifies Super Admin that a branch admin wants to grant a teacher Admin
// access — nothing on the user's roles changes until Approve is clicked
// (see POST /api/role-change-requests/:id/approve).
async function sendRoleChangeRequestedNotification(db, request, requester) {
  const branchRow = request.branchId ? await db.get('SELECT name FROM branches WHERE id = ?', request.branchId) : null;
  const title = `Admin Access Requested — ${request.userName}`;
  const message = `${requester.name} requested Admin access for ${request.userName}.`;
  const descriptionLines = [
    `Requested By: ${requester.name}`,
    `Branch: ${branchRow?.name || request.branchId || '—'}`,
    `Teacher: ${request.userName}`,
    `Requested: ${formatAttendanceDate(request.requestedAt)} ${formatTime12h(new Date(request.requestedAt))}`,
  ];

  await db.run(
    `INSERT INTO notifications (id, title, message, description, type, priority, roles, teacherIds, classNames, userIds, studentIds, sender, senderId, senderRole, notificationType, recipient, recipientRole, branchId, status, read, createdAt, roleChangeRequestId)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    newNotificationId(), title, message, descriptionLines.join('\n'), 'info', 'high',
    JSON.stringify(['super_admin']), JSON.stringify([]), JSON.stringify([]), JSON.stringify([]), JSON.stringify([]),
    requester.name, requester.id, requester.role, 'role_change_requested',
    'Super Admin', 'super_admin', request.branchId || null, 'unread', 0, request.requestedAt, request.id
  );
}

// Fires on Approve — confirms back to the requesting admin. The promoted
// user only sees the effect next time their menu/permissions are evaluated
// (their existing session token still has the old roles until they log in
// again), same as any other role change.
async function sendRoleChangeApprovedNotification(db, request, approver) {
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO notifications (id, title, message, description, type, priority, roles, teacherIds, classNames, userIds, studentIds, sender, senderId, senderRole, notificationType, recipient, recipientRole, branchId, status, read, createdAt, roleChangeRequestId)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    newNotificationId(),
    `Admin Access Approved — ${request.userName}`,
    `${approver.name} approved Admin access for ${request.userName}.`,
    [`Teacher: ${request.userName}`, `Approved By: ${approver.name}`].join('\n'),
    'success', 'medium', JSON.stringify([]), JSON.stringify([]), JSON.stringify([]), JSON.stringify([request.requestedBy]), JSON.stringify([]),
    approver.name, approver.id, approver.role, 'role_change_approved', 'Admin', 'admin', request.branchId || null, 'unread', 0, now, request.id
  );
}

// Fires on Reject — confirms to the requesting admin only; the user's roles
// are never touched by a rejection.
async function sendRoleChangeRejectedNotification(db, request, rejector) {
  const now = new Date().toISOString();
  const descriptionLines = [`Teacher: ${request.userName}`, `Rejected By: ${rejector.name}`];
  if (request.rejectionReason) descriptionLines.push(`Reason: ${request.rejectionReason}`);

  await db.run(
    `INSERT INTO notifications (id, title, message, description, type, priority, roles, teacherIds, classNames, userIds, studentIds, sender, senderId, senderRole, notificationType, recipient, recipientRole, branchId, status, read, createdAt, roleChangeRequestId)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    newNotificationId(),
    `Admin Access Request Rejected — ${request.userName}`,
    `${rejector.name} rejected the Admin access request for ${request.userName}.`,
    descriptionLines.join('\n'),
    'warning', 'medium', JSON.stringify([]), JSON.stringify([]), JSON.stringify([]), JSON.stringify([request.requestedBy]), JSON.stringify([]),
    rejector.name, rejector.id, rejector.role, 'role_change_rejected', 'Admin', 'admin', request.branchId || null, 'unread', 0, now, request.id
  );
}

// Mirrors the "new assignment" half of sendFeeApprovedNotification above —
// used only by the Super Admin direct-write path in POST /api/fees/records
// (the one path where a first-time fee assignment doesn't already go through
// an approval, so nothing else would ever notify the parent about it).
async function sendFeeAssignedNotification(db, feeRecord, assignerName) {
  const branchRow = feeRecord.branchId ? await db.get('SELECT name FROM branches WHERE id = ?', feeRecord.branchId) : null;
  const branchName = branchRow?.name || feeRecord.branchId || '—';
  const now = new Date().toISOString();

  await db.run(
    `INSERT INTO notifications (id, title, message, description, type, priority, roles, teacherIds, classNames, userIds, studentIds, sender, senderId, senderRole, notificationType, recipient, recipientRole, branchId, status, read, createdAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    newNotificationId(),
    'Fee Update',
    `The fee for ${feeRecord.studentName} has been fixed at ₹${feeRecord.totalAmount}, effective ${feeRecord.dueDate || 'immediately'}.`,
    [`Student: ${feeRecord.studentName}`, `Batch: ${feeRecord.className}`, `Fee: ₹${feeRecord.totalAmount}`, `Effective: ${feeRecord.dueDate || '—'}`].join('\n'),
    'info', 'medium', JSON.stringify(['parent']), JSON.stringify([]), JSON.stringify([]), JSON.stringify([]), JSON.stringify([feeRecord.studentId]),
    assignerName, null, 'super_admin', 'fee_approved', 'Parent', 'parent', feeRecord.branchId || null, 'unread', 0, now
  );

  await db.run(
    `INSERT INTO notifications (id, title, message, description, type, priority, roles, teacherIds, classNames, userIds, studentIds, sender, senderId, senderRole, notificationType, recipient, recipientRole, branchId, status, read, createdAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    newNotificationId(),
    `Fee Assigned — ${feeRecord.studentName}`,
    `A fee was assigned to ${feeRecord.studentName} (${feeRecord.className}, ${branchName}): ₹${feeRecord.totalAmount}.`,
    [`Student: ${feeRecord.studentName}`, `Batch: ${feeRecord.className}`, `Branch: ${branchName}`, `Fee: ₹${feeRecord.totalAmount}`, `Assigned By: ${assignerName}`].join('\n'),
    'info', 'low', JSON.stringify(['super_admin']), JSON.stringify([]), JSON.stringify([]), JSON.stringify([]), JSON.stringify([]),
    assignerName, null, 'super_admin', 'fee_assigned', 'Super Admin', 'super_admin', feeRecord.branchId || null, 'unread', 0, now
  );
}

function formatAttendanceDate(dateString) {
  const date = new Date(dateString);
  const day = String(date.getDate()).padStart(2, '0');
  const month = date.toLocaleDateString('en-IN', { month: 'short' });
  return `${day}-${month}-${date.getFullYear()}`;
}

function formatTime12h(date) {
  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
}

// Detailed "attendance submitted" notification, fired once per Submit
// Attendance click from POST /api/attendance. A single row with roles:
// ['admin'] and branchId set to the batch's own branch is enough for both
// recipients: matchesUserScope keeps a branch Admin scoped to their own
// branchId, while its super_admin bypass (checked first, before any role/
// branch filtering) delivers the same row to Super Admin regardless of
// branch — so no duplicate rows or per-recipient fan-out are needed.
// Built entirely from the attendanceRecords just written by the caller;
// this never re-reads or duplicates the attendance table.
async function sendAttendanceSubmissionNotification(db, { className, date, attendanceRecords, submitter, branchId, branchName }) {
  const entries = Object.entries(attendanceRecords);
  const totalStudents = entries.length;
  const presentCount = entries.filter(([, status]) => status === 'present').length;
  const absentCount = entries.filter(([, status]) => status === 'absent').length;
  const absentStudentIds = entries.filter(([, status]) => status === 'absent').map(([studentId]) => studentId);

  let absentNames = [];
  if (absentStudentIds.length > 0) {
    const placeholders = absentStudentIds.map(() => '?').join(',');
    const rows = await db.all(`SELECT id, firstName, lastName, fullName FROM students WHERE id IN (${placeholders})`, ...absentStudentIds);
    const nameById = new Map(rows.map((r) => [r.id, r.fullName || `${r.firstName || ''} ${r.lastName || ''}`.trim()]));
    absentNames = absentStudentIds.map((id) => nameById.get(id) || id);
  }

  const submittedAt = new Date();
  const dateLabel = formatAttendanceDate(date);
  const timeLabel = formatTime12h(submittedAt);

  const title = `Attendance Submitted — ${className}`;
  const message = `${submitter.name} submitted attendance for ${className} (${branchName}) on ${dateLabel}: ${presentCount} present, ${absentCount} absent of ${totalStudents}.`;

  const descriptionLines = [
    `Teacher: ${submitter.name}`,
    `Branch: ${branchName}`,
    `Batch: ${className}`,
    `Date: ${dateLabel}`,
    `Total Students: ${totalStudents}`,
    `Present: ${presentCount}`,
    `Absent: ${absentCount}`,
  ];
  if (absentNames.length > 0) {
    descriptionLines.push('Absent Students:');
    absentNames.forEach((name) => descriptionLines.push(`- ${name}`));
  }
  descriptionLines.push(`Submitted at: ${timeLabel}`);

  await db.run(
    `INSERT INTO notifications (id, title, message, description, type, priority, roles, teacherIds, classNames, userIds, studentIds, sender, senderId, senderRole, notificationType, recipient, recipientRole, branchId, status, read, createdAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    newNotificationId(), title, message, descriptionLines.join('\n'), 'info', 'medium',
    JSON.stringify(['admin']), JSON.stringify([]), JSON.stringify([]), JSON.stringify([]), JSON.stringify([]),
    submitter.name, submitter.id, submitter.role, 'attendance_submitted', 'Admin', 'admin',
    branchId || null, 'unread', 0, submittedAt.toISOString()
  );
}

function matchesUserScope(notification, user) {
  if (!user) return true;
  if (user.role === 'super_admin') return true;

  // notification.roles is already a parsed array by the time this is called
  // (mapRowToNotification parses it) — re-running parseJsonList (which expects
  // a raw JSON string) on an array silently returned [] every time, which
  // meant parent/teacher role-broadcast notifications never matched anyone.
  const roles = Array.isArray(notification.roles) ? notification.roles : parseJsonList(notification.roles);
  if (roles.length > 0 && !roles.includes(user.role) && !roles.includes('all') && !roles.includes('everyone')) {
    return false;
  }

  if (notification.userIds?.includes(user.id)) return true;
  if (notification.teacherIds?.includes(user.id)) return true;
  if (notification.studentIds?.some((studentId) => user.linkedStudentIds?.includes(studentId))) return true;

  if (user.role === 'teacher') {
    const assignedClasses = user.assignedClassIds ?? [];
    if (notification.classNames?.some((className) => assignedClasses.includes(className))) return true;
    // Role-broadcast to 'teacher' still needs to respect the notification's own
    // branch — otherwise a broadcast sent from one branch reaches every teacher
    // in every branch (mirrors the admin/accountant branch check below).
    if (roles.includes('teacher') && (!notification.branchId || notification.branchId === user.branchId)) return true;
    return false;
  }

  if (user.role === 'parent') {
    if (notification.classNames?.length && (user.linkedStudentIds?.length ?? 0) > 0) return true;
    if (roles.includes('parent') && (!notification.branchId || notification.branchId === user.branchId)) return true;
    return false;
  }

  if (user.role === 'admin' || user.role === 'accountant') {
    // A notification aimed only at specific teacherIds/userIds/studentIds
    // (e.g. a parent's message to their child's assigned teacher, or a
    // teacher's message to their branch admin sent with an empty `roles`)
    // must stay private to those exact recipients — it must not also leak
    // into every admin/accountant's inbox just because it happens to carry
    // the same branchId. Only fall through to "visible to my branch" for
    // actual role-broadcasts (roles explicitly includes admin/accountant)
    // or genuinely unscoped notifications (no roles AND no specific target).
    const isTargetedAtSomeoneElse = roles.length === 0
      && ((notification.teacherIds?.length ?? 0) > 0 || (notification.userIds?.length ?? 0) > 0 || (notification.studentIds?.length ?? 0) > 0);
    if (isTargetedAtSomeoneElse) return false;
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
    senderId: row.senderId,
    senderRole: row.senderRole,
    audience: row.audience,
    attachmentPath: row.attachmentPath,
    attachmentName: row.attachmentName,
    attachmentSize: row.attachmentSize,
    feeApprovalRequestId: row.feeApprovalRequestId,
    roleChangeRequestId: row.roleChangeRequestId,
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
  // "Primary Exam" — created for individually-selected students instead of a
  // whole batch. JSON array of studentIds; NULL/empty for every ordinary
  // batch exam (className/batch stay how they've always worked for those).
  try { await db.exec(`ALTER TABLE exams ADD COLUMN studentIds TEXT`); } catch (err) {}
  // Branch the exam belongs to — previously exams had no branch concept at
  // all, so GET /api/exams returned every exam to every branch's users (the
  // client-side filterByBranch() helper is a no-op on a falsy branchId, so it
  // silently let everything through). Backfilled below once `classes` exists.
  try { await db.exec(`ALTER TABLE exams ADD COLUMN branchId TEXT`); } catch (err) {}

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
  // Additive migration: reliable "who actually sent this" identity for the
  // Notification Center's Sent tab and read-receipt access — the existing
  // `sender` column is just a display name (not unique, editable by any
  // caller), so it can't be used to query "notifications I sent".
  try { await db.exec("ALTER TABLE notifications ADD COLUMN senderId TEXT;"); } catch (e) {}
  try { await db.exec("ALTER TABLE notifications ADD COLUMN senderRole TEXT;"); } catch (e) {}
  // The literal composer audience key (e.g. "branch_teachers"), so the Sent
  // tab can show "Sent to: All Teachers in My Branch" instead of guessing a
  // label back from the resolved roles/branchId/teacherIds/classNames. Null
  // for system-generated notifications, which don't go through the composer.
  try { await db.exec("ALTER TABLE notifications ADD COLUMN audience TEXT;"); } catch (e) {}
  // Additive: lets a homework/exam-schedule upload notification carry a real,
  // directly-downloadable file reference instead of just describing the
  // upload in text. Same /uploads path convention as every other attachment
  // in this app (homework.attachments, exams/events/school_exam_schedules'
  // attachmentPath) — the Notification Center reuses the existing
  // getFileUrl() download helper against this path, no new file storage or
  // download route needed.
  try { await db.exec("ALTER TABLE notifications ADD COLUMN attachmentPath TEXT;"); } catch (e) {}
  try { await db.exec("ALTER TABLE notifications ADD COLUMN attachmentName TEXT;"); } catch (e) {}
  try { await db.exec("ALTER TABLE notifications ADD COLUMN attachmentSize INTEGER;"); } catch (e) {}
  // Links a "fee approval requested" notification back to the pending row in
  // fee_approval_requests, so the Notification Center's Approve/Reject
  // buttons know which request they're acting on without parsing anything
  // out of the description text.
  try { await db.exec("ALTER TABLE notifications ADD COLUMN feeApprovalRequestId TEXT;"); } catch (e) {}
  // Same linkage, for the Notification Center's Approve/Reject on a
  // teacher->admin role-change request (see role_change_requests).
  try { await db.exec("ALTER TABLE notifications ADD COLUMN roleChangeRequestId TEXT;"); } catch (e) {}

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
  // Links a student row back to the admissions enquiry it came from, so
  // marking an admission "Admitted" can check "does a student for this
  // enquiry already exist" before creating one — without this, re-running
  // the transition (or a second admin clicking it) would create a duplicate
  // student every time. Null for every student added directly via Student
  // Management (no admissions record involved) or created before this column
  // existed — those are unaffected, this is purely additive.
  try { await db.exec("ALTER TABLE students ADD COLUMN admissionId TEXT;"); } catch (e) {}

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

  // branchId NULL = applies to every branch (e.g. a national holiday); set =
  // applies only to that branch.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS holidays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      title TEXT NOT NULL,
      branchId TEXT,
      createdBy TEXT,
      createdAt TEXT
    );
  `);

  // A date-range leave for one student — distinct from a daily attendance
  // mark: set once, it should keep applying every day it covers without the
  // teacher having to remember to re-mark it.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS student_leaves (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studentId TEXT NOT NULL,
      studentName TEXT,
      startDate TEXT NOT NULL,
      endDate TEXT NOT NULL,
      reason TEXT,
      branchId TEXT,
      createdBy TEXT,
      createdAt TEXT
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

  // Additive columns for the accounting-grade edit workflow — existing rows
  // simply get NULL/'' defaults, no historical data is touched.
  try { await db.exec("ALTER TABLE ledger_transactions ADD COLUMN vendorName TEXT DEFAULT '';"); } catch (e) {}
  try { await db.exec("ALTER TABLE ledger_transactions ADD COLUMN notes TEXT DEFAULT '';"); } catch (e) {}
  try { await db.exec("ALTER TABLE ledger_transactions ADD COLUMN updatedAt TEXT;"); } catch (e) {}
  try { await db.exec("ALTER TABLE ledger_transactions ADD COLUMN updatedBy TEXT;"); } catch (e) {}
  // Soft-delete markers — a deleted voucher is never actually removed from
  // the table (financial history must stay intact); it is just excluded
  // from every read (ledger list, dashboard, reports) once deletedAt is set.
  try { await db.exec("ALTER TABLE ledger_transactions ADD COLUMN deletedAt TEXT;"); } catch (e) {}
  try { await db.exec("ALTER TABLE ledger_transactions ADD COLUMN deletedBy TEXT;"); } catch (e) {}

  // Append-only audit trail for every income/expense edit — never updated or
  // pruned by the edit endpoint, so history survives regardless of how many
  // times a record is subsequently edited again.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS ledger_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ledgerId INTEGER NOT NULL,
      editedByUserId TEXT,
      editedByName TEXT,
      editedByRole TEXT,
      branchId TEXT,
      editedAt TEXT,
      previousValues TEXT,
      updatedValues TEXT
    );
  `);
  // action distinguishes an edit ('UPDATE') from a delete ('DELETE') row in
  // the same append-only log, so the audit trail covers both in one place.
  try { await db.exec("ALTER TABLE ledger_audit_log ADD COLUMN action TEXT DEFAULT 'UPDATE';"); } catch (e) {}

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
  // Additive migration: who actually created this row and in what role — lets
  // Admin/Super Admin distinguish a parent's own upload from a teacher's, and
  // lets a parent-uploaded schedule reliably attribute "uploaded by <parent>"
  // without trusting the free-text createdBy field alone.
  try { await db.exec("ALTER TABLE school_exam_schedules ADD COLUMN createdById TEXT;"); } catch (e) {}
  try { await db.exec("ALTER TABLE school_exam_schedules ADD COLUMN createdByRole TEXT;"); } catch (e) {}

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

    CREATE TABLE IF NOT EXISTS branches (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT,
      address TEXT,
      city TEXT,
      state TEXT,
      pincode TEXT,
      contactNumber TEXT,
      email TEXT,
      branchHead TEXT,
      openingDate TEXT,
      status TEXT DEFAULT 'Active',
      createdAt TEXT,
      updatedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS daily_submissions (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      className TEXT NOT NULL,
      subject TEXT,
      topic TEXT,
      homework TEXT,
      attendanceStatus TEXT,
      notes TEXT,
      teacherId TEXT,
      teacherName TEXT,
      branchId TEXT,
      createdAt TEXT
    );

    CREATE TABLE IF NOT EXISTS exam_attendance (
      id TEXT PRIMARY KEY,
      examId TEXT NOT NULL,
      studentId TEXT NOT NULL,
      studentName TEXT,
      rollNumber TEXT,
      admissionNumber TEXT,
      className TEXT,
      branchId TEXT,
      branchName TEXT,
      status TEXT,
      date TEXT,
      time TEXT,
      teacherId TEXT,
      teacherName TEXT,
      subjectId TEXT,
      subjectName TEXT,
      classId TEXT,
      recordedBy TEXT,
      isLocked INTEGER DEFAULT 0,
      lockedBy TEXT,
      lockedAt TEXT,
      createdAt TEXT,
      updatedAt TEXT,
      UNIQUE(examId, studentId)
    );

    CREATE TABLE IF NOT EXISTS classes (
      id TEXT PRIMARY KEY,
      className TEXT NOT NULL,
      batchName TEXT,
      course TEXT,
      subject TEXT,
      assignedTeacherId TEXT,
      branchId TEXT,
      roomNumber TEXT,
      maxStudents INTEGER,
      startDate TEXT,
      endDate TEXT,
      classTiming TEXT,
      daysOfWeek TEXT,
      status TEXT DEFAULT 'Active',
      createdAt TEXT
    );
  `);

  // Batch-based class restructuring — additive columns only (existing className/
  // batchName/etc. rows are untouched; classes.className now doubles as the batch
  // name for newly-created batches, while historical standards-based rows keep
  // working unmodified since nothing validates className against a fixed list).
  try { await db.exec("ALTER TABLE classes ADD COLUMN board TEXT DEFAULT '';"); } catch (e) {}
  try { await db.exec("ALTER TABLE classes ADD COLUMN description TEXT DEFAULT '';"); } catch (e) {}
  try { await db.exec("ALTER TABLE classes ADD COLUMN updatedAt TEXT;"); } catch (e) {}

  // Free start/end time + notes for timetable entries — `period` is kept (it's
  // part of the UNIQUE(className,dayOfWeek,period) index) and is now derived as
  // "start-end" server-side when start/end times are supplied, so old fixed-slot
  // rows remain valid and the uniqueness guarantee is unaffected.
  try { await db.exec("ALTER TABLE timetable_entries ADD COLUMN startTime TEXT DEFAULT '';"); } catch (e) {}
  try { await db.exec("ALTER TABLE timetable_entries ADD COLUMN endTime TEXT DEFAULT '';"); } catch (e) {}
  try { await db.exec("ALTER TABLE timetable_entries ADD COLUMN notes TEXT DEFAULT '';"); } catch (e) {}

  // Two batches (classes rows) can share the same className across different
  // boards (e.g. "10th" under CBSE and under State board) — the old
  // UNIQUE(className, dayOfWeek, period) constraint meant saving a period for
  // one silently overwrote the other's. Rebuild onto a classId-keyed
  // constraint, same "detect old shape, rebuild" approach used for the users
  // table above. Existing rows are best-effort backfilled to the one classes
  // row matching their className+branchId; a row left with classId NULL
  // (ambiguous historical data, or a batch since deleted) just won't collide
  // with anything until it's re-saved from the UI, which fills classId in.
  try {
    const ttSchema = await db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='timetable_entries'");
    if (ttSchema && !/classId/i.test(ttSchema.sql)) {
      await db.exec(`
        CREATE TABLE timetable_entries_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          classId TEXT,
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
          startTime TEXT DEFAULT '',
          endTime TEXT DEFAULT '',
          notes TEXT DEFAULT '',
          UNIQUE(classId, dayOfWeek, period)
        );
        INSERT INTO timetable_entries_new (id, className, dayOfWeek, period, subject, teacherId, teacherName, room, branchId, createdAt, updatedAt, startTime, endTime, notes)
          SELECT id, className, dayOfWeek, period, subject, teacherId, teacherName, room, branchId, createdAt, updatedAt, startTime, endTime, notes FROM timetable_entries;
        DROP TABLE timetable_entries;
        ALTER TABLE timetable_entries_new RENAME TO timetable_entries;
      `);
      const orphans = await db.all('SELECT id, className, branchId FROM timetable_entries WHERE classId IS NULL');
      for (const row of orphans) {
        const matches = await db.all('SELECT id FROM classes WHERE className = ? AND (branchId = ? OR ? IS NULL)', row.className, row.branchId, row.branchId);
        if (matches.length === 1) {
          await db.run('UPDATE timetable_entries SET classId = ? WHERE id = ?', matches[0].id, row.id);
        }
      }
      console.log(`Migrated timetable_entries: added classId (backfilled ${orphans.length - (await db.get("SELECT COUNT(*) c FROM timetable_entries WHERE classId IS NULL")).c}/${orphans.length} rows unambiguously).`);
    }
  } catch (e) { console.error('timetable_entries classId migration failed:', e); }

  // Student <-> Batch, many-to-many. A student keeps exactly one profile row
  // (students.className/batch/branchId, unchanged — still "their primary
  // batch", used everywhere as the default) plus zero or more additional rows
  // here for every other batch they're also enrolled in. Same junction-table
  // shape as parent_student above. Every roster query that used to match a
  // student by className+batch(+branchId) alone now also matches via this
  // table, so a student assigned to a second batch shows up for THAT batch's
  // attendance/exams/homework/fees too, without duplicating their profile.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS student_batches (
      studentId TEXT NOT NULL,
      classId TEXT NOT NULL,
      createdAt TEXT,
      PRIMARY KEY (studentId, classId)
    );
  `);
  // One-time backfill for students who existed before this table did: link
  // each to the classes row matching their own className/batch(board)/branchId
  // (best-effort — same "no unambiguous match, skip it" approach as the
  // timetable_entries migration above). Safe to run only once (INSERT OR
  // IGNORE below is idempotent anyway) — gated on table-empty so it doesn't
  // re-scan every student on every boot once it's done.
  try {
    const sbCount = await db.get('SELECT COUNT(1) as c FROM student_batches');
    if (sbCount.c === 0) {
      const students = await db.all("SELECT id, className, batch, branchId FROM students WHERE className != ''");
      const insertSb = await db.prepare('INSERT OR IGNORE INTO student_batches (studentId, classId, createdAt) VALUES (?, ?, ?)');
      const now = new Date().toISOString();
      let linked = 0;
      for (const s of students) {
        const classRow = await db.get(
          "SELECT id FROM classes WHERE className = ? AND COALESCE(board,'') = COALESCE(?,'') AND (branchId = ? OR branchId IS NULL) LIMIT 1",
          s.className, s.batch, s.branchId
        );
        if (classRow) {
          await insertSb.run(s.id, classRow.id, now);
          linked++;
        }
      }
      await insertSb.finalize();
      console.log(`Backfilled student_batches: linked ${linked}/${students.length} students to their primary batch.`);
    }
  } catch (e) { console.error('student_batches backfill failed:', e); }

  // Seed the one real branch that predates this table — its id must stay
  // 'branch_main' since it's already hardcoded onto existing users/students.
  try {
    await db.exec(`
      INSERT OR IGNORE INTO branches (id, name, code, address, city, state, pincode, contactNumber, email, branchHead, openingDate, status, createdAt, updatedAt)
      VALUES ('branch_main', 'Main', 'MAIN', '', '', '', '', '', '', '', '', 'Active', '${new Date().toISOString()}', '${new Date().toISOString()}');
    `);
  } catch (e) {}

  // One-time backfill for exams created before exams.branchId existed —
  // best-effort match to the classes row their className/batch(board) names,
  // same as the student_batches backfill above; anything left unmatched
  // (free-text className with no corresponding classes row, or a Primary
  // Exam with no className at all) defaults to 'branch_main', the one branch
  // that predates multi-branch support, rather than staying invisible to
  // every non-super-admin account. Gated on branchId IS NULL so it only ever
  // touches rows this hasn't already run for.
  try {
    const unbranched = await db.all("SELECT id, className, batch FROM exams WHERE branchId IS NULL");
    for (const exam of unbranched) {
      let branchId = 'branch_main';
      if (exam.className) {
        const classRow = await db.get(
          "SELECT branchId FROM classes WHERE className = ? AND COALESCE(board,'') = COALESCE(?,'') LIMIT 1",
          exam.className, exam.batch
        );
        if (classRow?.branchId) branchId = classRow.branchId;
      }
      await db.run('UPDATE exams SET branchId = ? WHERE id = ?', branchId, exam.id);
    }
    if (unbranched.length) console.log(`Backfilled branchId for ${unbranched.length} exam(s).`);
  } catch (e) { console.error('exams branchId backfill failed:', e); }

  try { await db.exec("ALTER TABLE allocations ADD COLUMN branchId TEXT;"); } catch(e) {}
  try { await db.exec("ALTER TABLE allocations ADD COLUMN status TEXT DEFAULT 'Assigned';"); } catch(e) {}
  try { await db.exec("ALTER TABLE allocations ADD COLUMN students INTEGER DEFAULT 0;"); } catch(e) {}
  try { await db.exec("ALTER TABLE allocations ADD COLUMN weeklyHours INTEGER DEFAULT 0;"); } catch(e) {}
  try { await db.exec("ALTER TABLE allocations ADD COLUMN teacherName TEXT;"); } catch(e) {}
  try { await db.exec("ALTER TABLE allocations ADD COLUMN createdAt TEXT;"); } catch(e) {}
  try { await db.exec("ALTER TABLE allocations ADD COLUMN updatedAt TEXT;"); } catch(e) {}
  try { await db.exec("ALTER TABLE allocations ADD COLUMN batchName TEXT;"); } catch(e) {}

  // Duplicate attendance entries: on a database whose `attendance` table was
  // created before the UNIQUE constraint existed in the schema below,
  // `CREATE TABLE IF NOT EXISTS` is a no-op and the constraint never gets applied,
  // so the same student+date can silently get more than one row instead of the
  // upsert in POST /api/attendance updating one. Collapse any existing duplicates
  // (keep the most recent row) then backfill the constraint via a unique index —
  // harmless if the inline UNIQUE already covers it.
  try {
    await db.exec(`DELETE FROM attendance WHERE id NOT IN (SELECT MAX(id) FROM attendance GROUP BY className, date, studentId);`);
    await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_unique ON attendance(className, date, studentId);`);
  } catch (e) { console.error('attendance de-dup migration failed:', e); }
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

  // Seed default General / Security / Data Retention settings — reuses the same
  // generic key-value whatsapp_settings table (already a general settings store,
  // not WhatsApp-specific despite the name) rather than adding new tables.
  const generalSettingsDefaults = [
    { key: 'institute_name', value: 'Guru Shishyaru Tutorials' },
    { key: 'institute_timezone', value: 'Asia/Kolkata' },
    { key: 'institute_language', value: 'English' },
    { key: 'institute_date_format', value: 'DD/MM/YYYY' },
    { key: 'session_timeout_minutes', value: '1440' },
    { key: 'remember_me_days', value: '7' },
    { key: 'min_password_length', value: '8' },
    { key: 'require_uppercase', value: 'false' },
    { key: 'require_number', value: 'false' },
    { key: 'require_symbol', value: 'false' },
    { key: 'data_retention_days', value: '365' },
  ];
  for (const k of generalSettingsDefaults) {
    await db.run('INSERT OR IGNORE INTO whatsapp_settings (key, value) VALUES (?, ?)', k.key, k.value);
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS notification_preferences (
      userId TEXT PRIMARY KEY,
      muteAll INTEGER DEFAULT 0,
      highPriorityOnly INTEGER DEFAULT 0,
      updatedAt TEXT
    );
  `);

  // Per-recipient read tracking for broadcast notifications. The notifications
  // table itself only has ONE shared read/readBy column, so previously the
  // first person to read a broadcast notification (e.g. sent to all parents)
  // silently marked it "read" for everyone else too, and there was no way for
  // an admin to see how many recipients had actually seen it.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS notification_reads (
      notificationId TEXT NOT NULL,
      userId TEXT NOT NULL,
      userName TEXT,
      userRole TEXT,
      readAt TEXT,
      PRIMARY KEY (notificationId, userId)
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS password_reset_otps (
      email TEXT PRIMARY KEY,
      code TEXT,
      userId TEXT,
      expiresAt TEXT,
      attempts INTEGER DEFAULT 0,
      createdAt TEXT
    );
  `);


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

  // Dual-role support: the same person can hold separate accounts (e.g. Admin
  // + Teacher) with different passwords under the same email/mobile, so those
  // columns can no longer be globally UNIQUE. SQLite can't drop a column
  // constraint in place, so rebuild the table without it when an older schema
  // is detected; the narrower "no duplicate (identifier, role)" rule is now
  // enforced in application code via hasConflictingAccount() below instead.
  try {
    const usersSchema = await db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'");
    if (usersSchema && /UNIQUE/i.test(usersSchema.sql)) {
      await db.exec(`
        CREATE TABLE users_new (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT,
          mobile TEXT,
          passwordHash TEXT NOT NULL,
          roles TEXT NOT NULL,
          branchId TEXT,
          status TEXT DEFAULT 'Active',
          mustChangePassword INTEGER DEFAULT 0,
          createdAt TEXT,
          updatedAt TEXT,
          failedLoginAttempts INTEGER DEFAULT 0,
          lockedUntil TEXT
        );
        INSERT INTO users_new (id, name, email, mobile, passwordHash, roles, branchId, status, mustChangePassword, createdAt, updatedAt, failedLoginAttempts, lockedUntil)
          SELECT id, name, email, mobile, passwordHash, roles, branchId, status, mustChangePassword, createdAt, updatedAt, failedLoginAttempts, lockedUntil FROM users;
        DROP TABLE users;
        ALTER TABLE users_new RENAME TO users;
      `);
      console.log('Migrated users table: removed UNIQUE(email)/UNIQUE(mobile) to support dual-role accounts.');
    }
  } catch (e) { console.error('users UNIQUE-removal migration failed:', e); }
  // Populated only for recurring monthly fee records (e.g. '2026-07'), so each
  // month stays its own trackable/payable fee_records row instead of one lump sum.
  try { await db.exec("ALTER TABLE fee_records ADD COLUMN month TEXT;"); } catch (e) {}

  // Discount + duration + category — purely additive. totalAmount/amount/
  // newAmount keep meaning exactly what they always have (the Final Amount),
  // so every existing reader (status calc, ledger, receipts, dashboard,
  // reports, Parent Portal) keeps working untouched. originalAmount is
  // backfilled from that same column for pre-existing rows below, so old
  // records read as "0% discount on their existing amount" rather than blank.
  for (const col of ['originalAmount REAL', 'discountPercent REAL DEFAULT 0', 'discountAmount REAL DEFAULT 0', 'category TEXT DEFAULT \'\'', 'startDate TEXT DEFAULT \'\'', 'endDate TEXT DEFAULT \'\'']) {
    try { await db.exec(`ALTER TABLE fee_records ADD COLUMN ${col};`); } catch (e) {}
    try { await db.exec(`ALTER TABLE fee_structures ADD COLUMN ${col};`); } catch (e) {}
    try { await db.exec(`ALTER TABLE fee_approval_requests ADD COLUMN ${col};`); } catch (e) {}
  }
  try { await db.run('UPDATE fee_records SET originalAmount = totalAmount WHERE originalAmount IS NULL'); } catch (e) {}
  try { await db.run('UPDATE fee_structures SET originalAmount = amount WHERE originalAmount IS NULL'); } catch (e) {}
  try { await db.run('UPDATE fee_approval_requests SET originalAmount = newAmount WHERE originalAmount IS NULL'); } catch (e) {}

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

    -- Mandatory Super Admin sign-off on any admin/accountant-initiated fee
    -- amount (new assignment or edit of an existing fee_records row).
    -- Purely additive: fee_records/fee_structures are never written by an
    -- admin or accountant directly anymore (see POST/PUT /api/fees/records
    -- below) — they only get touched once a request here is Approved, which
    -- is what keeps "reports reflect the approved amount" true without
    -- reports needing any changes of their own.
    CREATE TABLE IF NOT EXISTS fee_approval_requests (
      id TEXT PRIMARY KEY,
      studentId TEXT,
      studentName TEXT,
      className TEXT,
      branchId TEXT,
      feeRecordId INTEGER,
      feeType TEXT,
      academicYear TEXT,
      month TEXT,
      oldAmount REAL,
      newAmount REAL,
      dueDate TEXT,
      status TEXT DEFAULT 'Pending',
      requestedBy TEXT,
      requestedByName TEXT,
      requestedAt TEXT,
      approvedBy TEXT,
      approvedByName TEXT,
      approvedAt TEXT,
      rejectedBy TEXT,
      rejectedByName TEXT,
      rejectedAt TEXT,
      rejectionReason TEXT
    );

    -- A branch admin has no direct way to change any user's roles (PUT
    -- /api/users/:id is super_admin-only) — this is the request half of a
    -- teacher->admin promotion, mirroring fee_approval_requests above:
    -- nothing on the users table changes until a super_admin approves.
    CREATE TABLE IF NOT EXISTS role_change_requests (
      id TEXT PRIMARY KEY,
      userId TEXT,
      userName TEXT,
      branchId TEXT,
      addRole TEXT,
      status TEXT DEFAULT 'Pending',
      requestedBy TEXT,
      requestedByName TEXT,
      requestedAt TEXT,
      approvedBy TEXT,
      approvedByName TEXT,
      approvedAt TEXT,
      rejectedBy TEXT,
      rejectedByName TEXT,
      rejectedAt TEXT,
      rejectionReason TEXT
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

  // --- Teacher Attendance & Salary/Payroll tables ---
  // Previously these lived entirely in browser localStorage (per-device, not
  // shared, and lost on cache clear) — moved to the real database so
  // attendance and payroll are consistent across users/devices.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS teacher_attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacherId TEXT NOT NULL,
      date TEXT NOT NULL,
      status TEXT NOT NULL,
      branchId TEXT,
      department TEXT,
      markedBy TEXT,
      createdAt TEXT,
      updatedAt TEXT,
      UNIQUE(teacherId, date)
    );

    CREATE TABLE IF NOT EXISTS salary_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacherId TEXT NOT NULL,
      teacherName TEXT,
      employeeId TEXT,
      branchId TEXT,
      department TEXT,
      designation TEXT,
      month TEXT NOT NULL,
      salaryType TEXT,
      salaryAmount REAL,
      salaryPerClass REAL DEFAULT 0,
      classesConducted INTEGER DEFAULT 0,
      presentDays INTEGER DEFAULT 0,
      halfDays INTEGER DEFAULT 0,
      calculatedSalary REAL DEFAULT 0,
      status TEXT DEFAULT 'Draft',
      paidDate TEXT,
      paidBy TEXT,
      remarks TEXT,
      isLocked INTEGER DEFAULT 0,
      lockedDate TEXT,
      lockedBy TEXT,
      createdAt TEXT,
      updatedAt TEXT,
      UNIQUE(teacherId, month)
    );

    CREATE TABLE IF NOT EXISTS salary_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacherId TEXT,
      teacherName TEXT,
      month TEXT,
      action TEXT,
      previousValue REAL,
      newValue REAL,
      changedBy TEXT,
      userRole TEXT,
      branchId TEXT,
      timestamp TEXT
    );
  `);

  // Duplicate teacher-attendance entries: same reasoning as the `attendance`
  // de-dup above — guard against a pre-existing table created without the
  // UNIQUE(teacherId, date) constraint.
  try {
    await db.exec(`DELETE FROM teacher_attendance WHERE id NOT IN (SELECT MAX(id) FROM teacher_attendance GROUP BY teacherId, date);`);
    await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_teacher_attendance_unique ON teacher_attendance(teacherId, date);`);
  } catch (e) { console.error('teacher_attendance de-dup migration failed:', e); }

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
  // Every download link in the app is a plain <a href>/window.open, though,
  // and browsers don't attach custom headers to those — only fetch() calls
  // can send the Authorization bearer header. So this accepts the same JWT
  // as a ?token= query param too, which is the only thing a plain link can
  // carry; without it every attachment download in the app 401s.
  app.use('/uploads', (req, res, next) => {
    if (!req.headers.authorization && typeof req.query.token === 'string') {
      req.headers.authorization = `Bearer ${req.query.token}`;
    }
    next();
  }, authMiddleware, (req, res, next) => {
    // Content-Disposition set server-side (not left to the HTML `download`
    // attribute alone) — that attribute is silently ignored by browsers for
    // cross-origin URLs, and whether /uploads ends up same-origin as the app
    // depends on deployment-specific proxying this repo doesn't control.
    // Setting the header here forces a real "Save As" with the original
    // filename regardless of origin, instead of the file just opening/
    // previewing in a new tab under its random stored filename.
    if (typeof req.query.download === 'string' && req.query.download) {
      const safeName = req.query.download.replace(/[\r\n"]/g, '');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    }
    next();
  }, express.static(UPLOAD_DIR));

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

  async function getSetting(key, fallback) {
    const row = await db.get('SELECT value FROM whatsapp_settings WHERE key = ?', key);
    return row?.value ?? fallback;
  }

  // Reads the Security settings (System Settings > Security) so session length
  // is configurable instead of hardcoded — falls back to the original 24h/7d
  // defaults if the settings row is missing or invalid.
  async function signToken(userRow, rememberMe) {
    const roles = parseJsonList(userRow.roles);
    let expiresIn = rememberMe ? REMEMBER_ME_EXPIRY : TOKEN_EXPIRY;
    try {
      if (rememberMe) {
        const days = Number(await getSetting('remember_me_days', '7'));
        if (days > 0) expiresIn = `${days}d`;
      } else {
        const minutes = Number(await getSetting('session_timeout_minutes', '1440'));
        if (minutes > 0) expiresIn = `${minutes}m`;
      }
    } catch {
      // fall through to the hardcoded defaults above
    }
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
      { expiresIn }
    );
  }

  // Enforces the Security > Password Policy settings. Only applied where a
  // human explicitly chooses a password (login change-password, admin-set
  // custom password) — not to system-generated temporary passwords (e.g. a
  // new account's initial password defaulting to their mobile number), which
  // are forced through change-password on first login anyway.
  async function validatePasswordPolicy(password) {
    const minLength = Number(await getSetting('min_password_length', '8')) || 8;
    const requireUppercase = (await getSetting('require_uppercase', 'false')) === 'true';
    const requireNumber = (await getSetting('require_number', 'false')) === 'true';
    const requireSymbol = (await getSetting('require_symbol', 'false')) === 'true';

    if (String(password).length < minLength) return `Password must be at least ${minLength} characters`;
    if (requireUppercase && !/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter';
    if (requireNumber && !/[0-9]/.test(password)) return 'Password must contain at least one number';
    if (requireSymbol && !/[^A-Za-z0-9]/.test(password)) return 'Password must contain at least one symbol';
    return null;
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

  // Applied to every route registered below except /api/auth/* and
  // /api/client-errors (/uploads/* has its own dedicated authMiddleware
  // attached directly to that mount, above) — a client error can happen
  // before login (e.g. on the login page itself), so this can't require auth.
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/auth/') || req.path === '/api/client-errors') return next();
    return authMiddleware(req, res, next);
  });

  // Fail-closed guard against every branch-scoping bug below being an
  // "if (branchId) { query += ' AND branchId = ?' }" pattern (~50 call sites
  // built on resolveBranchId): if a scoped staff account's token has no
  // branchId — a stale token issued before the account had one, a manually
  // crafted request, or any future account-creation bug that leaves branchId
  // unset — that `if` silently evaluates false and the query runs with NO
  // branch filter at all, returning every branch's data instead of none.
  // Rejecting here, once, before any handler runs, closes that whole class
  // of leak in one place instead of depending on every handler doing it
  // right. super_admin is exempt (branchId legitimately null = "all
  // branches"); parent is exempt (scoped via parent_student, not branchId).
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/auth/') || req.path === '/api/client-errors') return next();
    const roles = req.user?.roles || [];
    const isStaffScopedRole = roles.some((r) => ['admin', 'teacher', 'accountant'].includes(r));
    const isSuperAdmin = roles.includes('super_admin');
    if (isStaffScopedRole && !isSuperAdmin && !req.user?.branchId) {
      return res.status(403).json({ error: 'Your account has no branch assigned. Contact your Super Admin to assign one before you can access branch data.' });
    }
    next();
  });

  // Authenticated API responses must never be reused across sessions by a
  // shared HTTP cache (browser back/forward cache, an intermediary proxy) —
  // without this, two different users hitting the exact same GET URL
  // (e.g. /api/teachers with no query string) in the same browser profile
  // risk one seeing a cached response fetched under the other's token,
  // independent of anything the branch-scoping logic above gets right.
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, private');
    next();
  });

  // Browser-side JS errors and unhandled promise rejections land here so a
  // "the button does nothing" report can be diagnosed from server logs
  // instead of needing the reporter's DevTools console — several bugs this
  // session (a click that silently never fired a request) had no other trace.
  app.post('/api/client-errors', async (req, res) => {
    try {
      const { message, stack, url, userId } = req.body || {};
      console.error('[client-error]', JSON.stringify({
        message: String(message || '').slice(0, 500),
        stack: String(stack || '').slice(0, 2000),
        url: String(url || '').slice(0, 300),
        userId: userId ? String(userId).slice(0, 100) : undefined,
      }));
    } catch (err) {
      console.error('Failed to log client error:', err);
    }
    res.json({ success: true });
  });

  // Non-super_admin requests are pinned to their own branch: query/body branchId
  // is ignored and overwritten server-side, so a scoped user can never read or
  // write another branch's data by tampering with the client.
  function resolveBranchId(req, requestedBranchId) {
    const roles = req.user?.roles || [];
    if (roles.includes('super_admin')) return requestedBranchId || undefined;
    return req.user?.branchId || undefined;
  }

  // Student visibility must follow Student -> Batch -> Teacher Assignment:
  // a teacher-only account (no admin/super_admin/accountant role — those
  // keep their existing branch/global scope, matching the rest of this file's
  // "server-side auth always checks the full role set" convention) may only
  // ever act on batches (classes.className) they are currently assigned to
  // via classes.assignedTeacherId. Returns null when no batch restriction
  // applies (admin/super_admin/accountant, or a dual-role teacher+admin
  // account), or the (possibly empty) array of className values a
  // teacher-only account is scoped to. A student with no batch (className
  // '') can never appear in this list, so unallocated students are excluded
  // by construction — not by any extra filtering.
  async function getTeacherAssignedClassNames(req) {
    const roles = req.user?.roles || [];
    const isTeacherOnly = roles.includes('teacher') && !roles.some((r) => ['admin', 'super_admin', 'accountant'].includes(r));
    if (!isTeacherOnly) return null;
    const rows = await db.all(
      "SELECT DISTINCT className FROM classes WHERE assignedTeacherId = ? AND status != 'Archived'",
      req.user.sub
    );
    return rows.map((r) => r.className).filter(Boolean);
  }

  // classId-scoped counterpart of getTeacherAssignedClassNames, used only by
  // the timetable routes below — className alone can't disambiguate two
  // batches on different boards that happen to share a name, so timetable
  // scoping needs the actual classes.id, not just the className string.
  async function getTeacherAssignedClassIds(req) {
    const roles = req.user?.roles || [];
    const isTeacherOnly = roles.includes('teacher') && !roles.some((r) => ['admin', 'super_admin', 'accountant'].includes(r));
    if (!isTeacherOnly) return null;
    const rows = await db.all(
      "SELECT id FROM classes WHERE assignedTeacherId = ? AND status != 'Archived'",
      req.user.sub
    );
    return rows.map((r) => r.id);
  }

  // Resolves a (className, board, branchId) triple to the one classes row it
  // names — reused everywhere a caller supplies className/batch strings and
  // needs the actual classId for a student_batches join (multi-batch-aware
  // attendance/exam/fee/homework rosters below).
  async function resolveClassId(className, board, branchId) {
    if (!className) return null;
    branchId = branchId ?? null; // the sqlite driver rejects `undefined` binds
    const row = await db.get(
      "SELECT id FROM classes WHERE className = ? AND COALESCE(board,'') = COALESCE(?,'') AND (branchId = ? OR ? IS NULL) LIMIT 1",
      className, board || '', branchId, branchId
    );
    return row?.id || null;
  }

  // Every active student in a batch by className(+branchId) — the batch's
  // primary members (students.className match) plus anyone additionally
  // enrolled via student_batches in any classes row with that className
  // (multi-batch aware; ignores board since batch-level fee generation is
  // className+branch scoped today, not board-scoped — same granularity as
  // fee_structures always had).
  async function getActiveStudentsForBatchClassName(className, branchId) {
    branchId = branchId ?? null; // the sqlite driver rejects `undefined` binds
    const classRows = await db.all(
      'SELECT id FROM classes WHERE className = ? AND (? IS NULL OR branchId = ?)',
      className, branchId, branchId
    );
    const classIds = classRows.map((r) => r.id);
    const primary = branchId ? 'className = ? AND branchId = ?' : 'className = ?';
    const primaryParams = branchId ? [className, branchId] : [className];
    if (classIds.length === 0) {
      return db.all(`SELECT * FROM students WHERE ${primary} AND status = 'Active'`, ...primaryParams);
    }
    const placeholders = classIds.map(() => '?').join(',');
    return db.all(
      `SELECT * FROM students WHERE status = 'Active' AND ((${primary}) OR id IN (SELECT studentId FROM student_batches WHERE classId IN (${placeholders})))`,
      ...primaryParams, ...classIds
    );
  }

  // Keeps a student's student_batches membership in sync with their primary
  // className/batch/branchId whenever that primary is set or changed (create
  // or edit) — so the primary batch is always also present in the multi-batch
  // set, and every roster query only ever needs to consult one place
  // (student_batches) to find "every batch this student is in" including the
  // primary. Never removes any OTHER batch membership — this only adds.
  async function syncPrimaryBatchLink(studentId, className, board, branchId) {
    const classId = await resolveClassId(className, board, branchId);
    if (classId) {
      await db.run('INSERT OR IGNORE INTO student_batches (studentId, classId, createdAt) VALUES (?, ?, ?)', studentId, classId, new Date().toISOString());
    }
  }

  // Attaches each student's full batch-membership list — their primary
  // className/batch/branchId (already on the row) plus any extra
  // student_batches rows — as `batches: [{classId, className, batch, branchId}]`.
  // Every existing consumer of a students row is unaffected (nothing removed);
  // only the Batches page's multi-batch UI and the frontend's multi-batch-aware
  // getStudentsForClass read this new field.
  async function attachStudentBatches(rows) {
    if (!rows.length) return rows;
    const ids = rows.map((r) => r.id);
    const placeholders = ids.map(() => '?').join(',');
    const links = await db.all(
      `SELECT sb.studentId, c.id as classId, c.className, c.board as batch, c.branchId
       FROM student_batches sb JOIN classes c ON c.id = sb.classId
       WHERE sb.studentId IN (${placeholders})`,
      ...ids
    );
    const byStudent = new Map();
    for (const link of links) {
      if (!byStudent.has(link.studentId)) byStudent.set(link.studentId, []);
      byStudent.get(link.studentId).push({ classId: link.classId, className: link.className, batch: link.batch, branchId: link.branchId });
    }
    return rows.map((r) => ({ ...r, batches: byStudent.get(r.id) || [] }));
  }

  // email/mobile are no longer globally UNIQUE (dual-role accounts share an
  // identifier with a different password per role) — this enforces the
  // narrower rule that still applies: no two accounts may share both an
  // identifier AND a role. excludeId lets an update ignore the row being edited.
  async function hasConflictingAccount(email, mobile, roles, excludeId) {
    const rows = await db.all(
      `SELECT id, roles FROM users WHERE (LOWER(email) = LOWER(?) OR mobile = ?)${excludeId ? ' AND id != ?' : ''}`,
      ...(excludeId ? [email || '', mobile || '', excludeId] : [email || '', mobile || ''])
    );
    return rows.some((row) => parseJsonList(row.roles).some((r) => roles.includes(r)));
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
      // Same email/mobile can belong to more than one account (dual-role
      // logins, e.g. Admin + Teacher, each with their own password) — fetch
      // every matching account and let the supplied password pick which one
      // the user means. Single-account users hit the same path with exactly
      // one candidate, so behavior for them is unchanged.
      const candidates = await db.all(
        'SELECT * FROM users WHERE (LOWER(email) = LOWER(?) OR mobile = ?) AND status = ?',
        identifier, identifier, 'Active'
      );
      if (candidates.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

      // Per-account lockout — the IP-based authLimiter above stops a single
      // attacker from brute-forcing, but not a distributed attempt against one
      // specific account from many IPs. This closes that gap independently.
      const now = new Date();
      const lockedCandidates = candidates.filter((c) => c.lockedUntil && new Date(c.lockedUntil) > now);
      const availableCandidates = candidates.filter((c) => !c.lockedUntil || new Date(c.lockedUntil) <= now);

      if (availableCandidates.length === 0) {
        const soonest = lockedCandidates.reduce((a, b) => (new Date(a.lockedUntil) < new Date(b.lockedUntil) ? a : b));
        const minutesLeft = Math.ceil((new Date(soonest.lockedUntil) - now) / 60000);
        return res.status(423).json({ error: `Too many failed attempts. Try again in ${minutesLeft} minute(s).` });
      }

      let matched = null;
      for (const candidate of availableCandidates) {
        if (await bcrypt.compare(password, candidate.passwordHash)) { matched = candidate; break; }
      }

      if (!matched) {
        let justLocked = false;
        for (const candidate of availableCandidates) {
          const attempts = (candidate.failedLoginAttempts || 0) + 1;
          const lockedUntil = attempts >= MAX_FAILED_LOGIN_ATTEMPTS
            ? new Date(Date.now() + LOCKOUT_DURATION_MS).toISOString()
            : null;
          await db.run('UPDATE users SET failedLoginAttempts=?, lockedUntil=? WHERE id=?', attempts, lockedUntil, candidate.id);
          if (lockedUntil) justLocked = true;
        }
        if (justLocked && availableCandidates.length === 1) {
          return res.status(423).json({ error: `Too many failed attempts. Account locked for 15 minutes.` });
        }
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      if (matched.failedLoginAttempts || matched.lockedUntil) {
        await db.run('UPDATE users SET failedLoginAttempts=0, lockedUntil=NULL WHERE id=?', matched.id);
      }

      const rememberMe = Boolean(req.body?.rememberMe);
      const token = await signToken(matched, rememberMe);
      res.json({ token, user: mapUserRow(matched) });
    } catch (err) {
      console.error('Login error:', err);
      res.status(500).json({ error: 'Login failed' });
    }
  });

  // --- Forgot Password (staff/teacher/admin — email OTP via Brevo) ---
  // Two-step, matching the parent-login OTP pattern: request a code, then use
  // it to set a new password directly (no email "reset link", since a real
  // outbound email channel now exists via Brevo but a working reset LINK would
  // still need a hosted frontend page to land on — the code-based flow avoids
  // that entirely and proves email ownership just as well).
  app.post('/api/auth/forgot-password/request-otp', authLimiter, async (req, res) => {
    try {
      const identifier = String(req.body?.identifier || '').trim();
      if (!identifier) return res.status(400).json({ error: 'Email or mobile number is required' });

      const genericResponse = { success: true, message: 'If an account with that email/mobile exists and has an email on file, a reset code has been sent.' };

      const user = await db.get(
        'SELECT * FROM users WHERE (LOWER(email) = LOWER(?) OR mobile = ?) AND status = ?',
        identifier, identifier, 'Active'
      );
      if (!user || !user.email) return res.json(genericResponse);

      const code = String(Math.floor(100000 + Math.random() * 900000));
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const now = new Date().toISOString();
      await db.run(
        `INSERT INTO password_reset_otps (email, code, userId, expiresAt, attempts, createdAt) VALUES (?, ?, ?, ?, 0, ?)
         ON CONFLICT(email) DO UPDATE SET code=excluded.code, userId=excluded.userId, expiresAt=excluded.expiresAt, attempts=0, createdAt=excluded.createdAt`,
        user.email, code, user.id, expiresAt, now
      );

      sendPasswordResetOtpEmail(user.email, user.name, code).catch((e) => console.error('Failed to send password reset email:', e));

      res.json(genericResponse);
    } catch (err) {
      console.error('Request password reset OTP error:', err);
      res.status(500).json({ error: 'Failed to send reset code' });
    }
  });

  app.post('/api/auth/forgot-password/verify-otp', authLimiter, async (req, res) => {
    try {
      const identifier = String(req.body?.identifier || '').trim();
      const code = String(req.body?.code || '').trim();
      const newPassword = String(req.body?.newPassword || '');
      if (!identifier || !code || !newPassword) return res.status(400).json({ error: 'Email/mobile, code, and new password are required' });

      const genericError = { error: 'Invalid or expired code. Please request a new one.' };

      const user = await db.get(
        'SELECT * FROM users WHERE (LOWER(email) = LOWER(?) OR mobile = ?) AND status = ?',
        identifier, identifier, 'Active'
      );
      if (!user || !user.email) return res.status(400).json(genericError);

      const otpRow = await db.get('SELECT * FROM password_reset_otps WHERE email = ?', user.email);
      if (!otpRow) return res.status(400).json(genericError);
      if (new Date(otpRow.expiresAt) < new Date()) {
        await db.run('DELETE FROM password_reset_otps WHERE email = ?', user.email);
        return res.status(400).json(genericError);
      }
      if (otpRow.attempts >= 5) {
        await db.run('DELETE FROM password_reset_otps WHERE email = ?', user.email);
        return res.status(429).json({ error: 'Too many incorrect attempts. Please request a new code.' });
      }
      if (otpRow.code !== code) {
        await db.run('UPDATE password_reset_otps SET attempts = attempts + 1 WHERE email = ?', user.email);
        return res.status(400).json(genericError);
      }

      const policyError = await validatePasswordPolicy(newPassword);
      if (policyError) return res.status(400).json({ error: policyError });

      const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
      await db.run(
        'UPDATE users SET passwordHash=?, mustChangePassword=0, failedLoginAttempts=0, lockedUntil=NULL, updatedAt=? WHERE id=?',
        newHash, new Date().toISOString(), user.id
      );
      await db.run('DELETE FROM password_reset_otps WHERE email = ?', user.email);

      res.json({ success: true });
    } catch (err) {
      console.error('Verify password reset OTP error:', err);
      res.status(500).json({ error: 'Failed to reset password' });
    }
  });

  app.post('/api/account/change-password', async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body || {};
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'Current and new password are required' });
      }
      const policyError = await validatePasswordPolicy(newPassword);
      if (policyError) {
        return res.status(400).json({ error: policyError });
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
      if (body.password) {
        const policyError = await validatePasswordPolicy(body.password);
        if (policyError) return res.status(400).json({ error: policyError });
      }
      const passwordHash = await bcrypt.hash(initialPassword, BCRYPT_ROUNDS);
      const now = new Date().toISOString();
      const branchId = body.roles.includes('super_admin') ? null : (body.branchId || null);
      await db.run(
        `INSERT INTO users (id, name, email, mobile, passwordHash, roles, branchId, status, mustChangePassword, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'Active', 1, ?, ?)`,
        id, body.name, body.email || null, body.mobile, passwordHash, JSON.stringify(sortRoles(body.roles)), branchId, now, now
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
      const roles = sortRoles(Array.isArray(body.roles) ? body.roles : parseJsonList(existing.roles));
      const branchId = roles.includes('super_admin') ? null : (body.branchId ?? existing.branchId);
      const status = body.status ?? existing.status;
      await db.run(
        `UPDATE users SET name=?, email=?, mobile=?, roles=?, branchId=?, status=?, updatedAt=? WHERE id=?`,
        name, email, mobile, JSON.stringify(roles), branchId, status, new Date().toISOString(), req.params.id
      );
      if (body.password) {
        const policyError = await validatePasswordPolicy(body.password);
        if (policyError) return res.status(400).json({ error: policyError });
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
      if (await hasConflictingAccount(body.email, mobile, ['teacher'])) {
        return res.status(409).json({ error: 'A teacher account with this email or mobile already exists' });
      }
      const name = body.fullName || `${body.firstName} ${body.lastName || ''}`.trim();
      const id = `USR${Date.now()}`;
      const initialPassword = body.password || mobile;
      if (body.password) {
        const policyError = await validatePasswordPolicy(body.password);
        if (policyError) return res.status(400).json({ error: policyError });
      }
      const passwordHash = await bcrypt.hash(initialPassword, BCRYPT_ROUNDS);
      const now = new Date().toISOString();
      const branchId = resolveBranchId(req, body.branchId) || req.user?.branchId || null;
      // A teacher added by a branch admin needs super_admin sign-off before the
      // account can log in — only super_admin can create one pre-approved.
      const isSuperAdminCreator = req.user.roles.includes('super_admin');
      const status = isSuperAdminCreator ? (body.status || 'Active') : 'Pending Approval';
      await db.run(
        `INSERT INTO users (id, name, email, mobile, passwordHash, roles, branchId, status, mustChangePassword, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        id, name, body.email || null, mobile, passwordHash, JSON.stringify(['teacher']), branchId, status, now, now
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
      if (!isSuperAdminCreator) {
        await db.run(
          `INSERT INTO notifications (id, title, message, type, priority, roles, branchId, status, createdAt)
           VALUES (?, ?, ?, 'info', 'high', '["super_admin"]', ?, 'unread', ?)`,
          newNotificationId(),
          'New teacher awaiting approval',
          `${req.user.name || 'An admin'} added ${name} as a teacher. Approve their account before they can log in.`,
          branchId,
          now
        );
      }
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
        const policyError = await validatePasswordPolicy(body.password);
        if (policyError) return res.status(400).json({ error: policyError });
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
      // "Primary Exam" support: studentIds arrives as a real array (plain
      // JSON POST) or a JSON string (multipart, when an attachment is sent).
      let studentIds = [];
      if (Array.isArray(body.studentIds)) studentIds = body.studentIds;
      else if (typeof body.studentIds === 'string' && body.studentIds) {
        try { studentIds = JSON.parse(body.studentIds); } catch { studentIds = []; }
      }
      // Pinned to the creator's own branch (ignored/overridden for non-super-admin,
      // same as every other create endpoint) — this is what GET /api/exams below
      // actually restricts on, not just className text.
      const branchId = resolveBranchId(req, body.branchId) || req.user.branchId || 'branch_main';
      const stmt = await db.prepare(`INSERT INTO exams (name, subject, className, batch, date, maxMarks, passingMarks, description, status, createdBy, createdAt, attachmentPath, attachmentName, attachmentSize, studentIds, branchId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      const result = await stmt.run(body.name, body.subject, body.className || '', body.batch || '', body.date, Number(body.maxMarks || 0), Number(body.passingMarks || 35), body.description || '', body.status || 'draft', body.createdBy || '', now, attachment ? attachment.path : null, attachment ? attachment.originalname : null, attachment ? attachment.size : null, studentIds.length ? JSON.stringify(studentIds) : null, branchId);
      await stmt.finalize();
      const exam = await db.get('SELECT * FROM exams WHERE id = ?', result.lastID);
      res.json(exam);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  // Branch-scoped at the query level, not just filtered client-side — this
  // endpoint previously had no restriction at all, so every branch's exams
  // were visible to every user (the frontend's filterByBranch() helper is a
  // no-op when branchId is falsy, and exams never carried one before now).
  app.get('/api/exams', async (req, res) => {
    try {
      const roles = req.user.roles || [];
      const isSuperAdmin = roles.includes('super_admin');
      const isTeacherOnly = roles.includes('teacher') && !roles.some((r) => ['admin', 'super_admin', 'accountant'].includes(r));
      const isParentOnly = roles.includes('parent') && !roles.some((r) => ['teacher', 'admin', 'super_admin', 'accountant'].includes(r));

      if (isParentOnly) {
        const linkedRows = await db.all('SELECT studentId FROM parent_student WHERE parentId = ?', req.user.sub);
        const linkedIds = linkedRows.map((r) => r.studentId);
        if (!linkedIds.length) return res.json([]);
        const placeholders = linkedIds.map(() => '?').join(',');
        const children = await attachStudentBatches(await db.all(`SELECT * FROM students WHERE id IN (${placeholders})`, ...linkedIds));
        // Every (className, batch) pair any linked child belongs to — their
        // primary batch plus any additional ones (multi-batch aware, same as
        // every other roster query in this file).
        const pairs = new Set();
        for (const c of children) {
          pairs.add(`${c.className} ${c.batch || ''}`);
          for (const b of c.batches || []) pairs.add(`${b.className} ${b.batch || ''}`);
        }
        const rows = await db.all('SELECT * FROM exams ORDER BY date ASC');
        const visible = rows.filter((e) => {
          if (e.studentIds) {
            try {
              const ids = JSON.parse(e.studentIds);
              if (Array.isArray(ids) && ids.some((id) => linkedIds.includes(id))) return true;
            } catch { /* fall through to batch match */ }
          }
          return pairs.has(`${e.className} ${e.batch || ''}`);
        });
        return res.json(visible);
      }

      let query = 'SELECT * FROM exams';
      const conditions = [];
      const params = [];

      if (isTeacherOnly) {
        const teacherClassNames = await getTeacherAssignedClassNames(req);
        if (teacherClassNames.length > 0) {
          conditions.push(`(className IN (${teacherClassNames.map(() => '?').join(',')}) OR createdBy = ?)`);
          params.push(...teacherClassNames, req.user.sub);
        } else {
          conditions.push('createdBy = ?');
          params.push(req.user.sub);
        }
        // Still branch-pinned even within that OR — otherwise a className that
        // happens to match another branch's batch of the same name would leak
        // that branch's exam in too.
        if (req.user.branchId) { conditions.push('branchId = ?'); params.push(req.user.branchId); }
      } else {
        const branchId = resolveBranchId(req, req.query.branchId);
        if (branchId) { conditions.push('branchId = ?'); params.push(branchId); }
      }

      if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
      query += ' ORDER BY date ASC';
      const rows = await db.all(query, ...params);
      res.json(rows);
    } catch (err) {
      console.error('List exams error:', err);
      res.status(500).json({ error: 'failed' });
    }
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

  app.delete('/api/exams/:id', async (req, res) => {
    if (!req.user.roles.some((r) => ['teacher', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const exam = await db.get('SELECT * FROM exams WHERE id = ?', req.params.id);
      if (!exam) return res.status(404).json({ error: 'Exam not found' });

      if (exam.attachmentPath && fs.existsSync(exam.attachmentPath)) {
        try { fs.unlinkSync(exam.attachmentPath); } catch (e) {}
      }
      await db.run('DELETE FROM exam_marks WHERE examId = ?', req.params.id);
      await db.run('DELETE FROM exam_attendance WHERE examId = ?', req.params.id);
      await db.run('DELETE FROM exams WHERE id = ?', req.params.id);
      res.json({ success: true });
    } catch (err) {
      console.error('Delete exam error:', err);
      res.status(500).json({ error: 'Failed to delete exam' });
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

  // Role-scoped so every exam's marks (batch exams and individually-scoped
  // "Primary Exams" alike) reach only who's supposed to see them: Super Admin
  // sees everything; Admin/Accountant are scoped to their own branch (via the
  // student's own branchId, since exam_marks/exams carry no branchId of their
  // own); a teacher-only account sees marks for their assigned batches PLUS
  // any Primary Exam they personally created; a parent sees only their own
  // linked children's marks. Parent was previously not in the allowed-roles
  // list at all (a 403), which meant the Parent Portal's marks view silently
  // never loaded anything for a parent-only account.
  app.get('/api/exam-marks', async (req, res) => {
    if (!req.user.roles.some((r) => ['teacher', 'admin', 'super_admin', 'accountant', 'parent'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const roles = req.user.roles || [];
      const isSuperAdmin = roles.includes('super_admin');
      const isTeacherOnly = roles.includes('teacher') && !roles.some((r) => ['admin', 'super_admin', 'accountant'].includes(r));
      const isParentOnly = roles.includes('parent') && !roles.some((r) => ['teacher', 'admin', 'super_admin', 'accountant'].includes(r));

      let query = 'SELECT em.* FROM exam_marks em JOIN exams e ON e.id = em.examId';
      const conditions = [];
      const params = [];
      if (req.query.examId) { conditions.push('em.examId = ?'); params.push(String(req.query.examId)); }

      if (isTeacherOnly) {
        const teacherClassNames = await getTeacherAssignedClassNames(req);
        if (teacherClassNames.length > 0) {
          conditions.push(`(e.className IN (${teacherClassNames.map(() => '?').join(',')}) OR e.createdBy = ?)`);
          params.push(...teacherClassNames, req.user.sub);
        } else {
          conditions.push('e.createdBy = ?');
          params.push(req.user.sub);
        }
        // className alone can't disambiguate two branches that happen to share
        // a batch name — pin to the teacher's own branch too, now that exams
        // actually carry one.
        if (req.user.branchId) { conditions.push('e.branchId = ?'); params.push(req.user.branchId); }
      } else if (isParentOnly) {
        const linkedRows = await db.all('SELECT studentId FROM parent_student WHERE parentId = ?', req.user.sub);
        const linkedIds = linkedRows.map((r) => r.studentId);
        if (!linkedIds.length) return res.json([]);
        conditions.push(`em.studentId IN (${linkedIds.map(() => '?').join(',')})`);
        params.push(...linkedIds);
      } else if (!isSuperAdmin) {
        const branchId = resolveBranchId(req, req.query.branchId);
        if (branchId) {
          query += ' JOIN students s ON s.id = em.studentId';
          conditions.push('s.branchId = ?');
          params.push(branchId);
        }
      }

      if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');

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

      // A teacher-only account may only submit marks for an exam belonging to
      // a batch actually assigned to them — or, for a Primary Exam (no batch
      // at all), one they personally created.
      const teacherClassNames = await getTeacherAssignedClassNames(req);
      if (teacherClassNames) {
        const exam = await db.get('SELECT className, createdBy FROM exams WHERE id = ?', examId);
        const allowed = exam && (teacherClassNames.includes(exam.className) || exam.createdBy === req.user.sub);
        if (!allowed) {
          return res.status(403).json({ error: 'You can only submit marks for a batch assigned to you.' });
        }
      }

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
      // classId is the real scoping key (two batches on different boards can
      // share a className) — className is accepted too for any older caller
      // that still queries by it, but classId always wins when both are sent.
      if (req.query.classId) { query += ' AND classId = ?'; params.push(req.query.classId); }
      else if (req.query.className) { query += ' AND className = ?'; params.push(req.query.className); }
      if (branchId) { query += ' AND branchId = ?'; params.push(branchId); }

      // A teacher-only account only ever sees the timetable of batches
      // assigned to them.
      const teacherClassIds = await getTeacherAssignedClassIds(req);
      if (teacherClassIds) {
        if (teacherClassIds.length === 0) return res.json([]);
        if (req.query.classId && !teacherClassIds.includes(req.query.classId)) return res.json([]);
        query += ` AND classId IN (${teacherClassIds.map(() => '?').join(',')})`;
        params.push(...teacherClassIds);
      }

      const rows = await db.all(query, ...params);
      res.json(rows);
    } catch (err) {
      console.error('List timetable error:', err);
      res.status(500).json({ error: 'Failed to load timetable' });
    }
  });

  // A teacher may only write timetable entries for a batch they're assigned to
  // (classes.assignedTeacherId); admin/super_admin remain unrestricted within
  // their existing branch scope.
  async function isTeacherAssignedToClass(teacherId, classId) {
    const row = await db.get('SELECT assignedTeacherId FROM classes WHERE id = ?', classId);
    return Boolean(row && row.assignedTeacherId === teacherId);
  }

  app.post('/api/timetable', async (req, res) => {
    const roles = req.user.roles || [];
    const isStaffAdmin = roles.some((r) => ['admin', 'super_admin'].includes(r));
    const isTeacher = roles.includes('teacher');
    if (!isStaffAdmin && !isTeacher) return res.status(403).json({ error: 'Forbidden' });
    try {
      const body = req.body || {};
      const startTime = body.startTime || '';
      const endTime = body.endTime || '';
      const period = startTime && endTime ? `${startTime}-${endTime}` : body.period;
      if (!body.classId || !body.className || !body.dayOfWeek || !period) {
        return res.status(400).json({ error: 'classId, className, dayOfWeek and a time range (period, or startTime+endTime) are required' });
      }
      if (isTeacher && !isStaffAdmin) {
        const owns = await isTeacherAssignedToClass(req.user.sub, body.classId);
        if (!owns) return res.status(403).json({ error: 'You are not assigned to this batch.' });
      }
      const notes = body.notes || '';
      const branchId = resolveBranchId(req, body.branchId) || req.user?.branchId || null;
      const now = new Date().toISOString();
      await db.run(
        `INSERT INTO timetable_entries (classId, className, dayOfWeek, period, subject, teacherId, teacherName, room, branchId, createdAt, updatedAt, startTime, endTime, notes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(classId, dayOfWeek, period) DO UPDATE SET
           subject=excluded.subject, teacherId=excluded.teacherId, teacherName=excluded.teacherName,
           room=excluded.room, branchId=excluded.branchId, updatedAt=excluded.updatedAt,
           startTime=excluded.startTime, endTime=excluded.endTime, notes=excluded.notes`,
        body.classId, body.className, body.dayOfWeek, period, body.subject || '', body.teacherId || null, body.teacherName || null,
        body.room || '', branchId, now, now, startTime, endTime, notes
      );
      const row = await db.get(
        'SELECT * FROM timetable_entries WHERE classId = ? AND dayOfWeek = ? AND period = ?',
        body.classId, body.dayOfWeek, period
      );
      res.status(201).json(row);
    } catch (err) {
      console.error('Save timetable entry error:', err);
      res.status(500).json({ error: 'Failed to save timetable entry' });
    }
  });

  app.delete('/api/timetable/:id', async (req, res) => {
    const roles = req.user.roles || [];
    const isStaffAdmin = roles.some((r) => ['admin', 'super_admin'].includes(r));
    const isTeacher = roles.includes('teacher');
    if (!isStaffAdmin && !isTeacher) return res.status(403).json({ error: 'Forbidden' });
    try {
      if (isTeacher && !isStaffAdmin) {
        const entry = await db.get('SELECT classId FROM timetable_entries WHERE id = ?', req.params.id);
        if (!entry) return res.status(404).json({ error: 'Timetable entry not found.' });
        const owns = await isTeacherAssignedToClass(req.user.sub, entry.classId);
        if (!owns) return res.status(403).json({ error: 'You are not assigned to this batch.' });
      }
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
        batchName: r.batchName || '',
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
        `INSERT INTO allocations (teacherId, teacherName, className, subject, batch, batchName, branchId, students, weeklyHours, status, createdAt, updatedAt)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        body.teacherId, teacher?.name || '', body.class, body.subject, body.batch || '', body.batchName || '', branchId,
        Number(body.students || 0), Number(body.weeklyHours || 0), body.status || 'Assigned', now, now
      );
      const row = await db.get('SELECT * FROM allocations WHERE id = ?', result.lastID);
      res.status(201).json({
        id: String(row.id), teacherId: row.teacherId, teacherName: row.teacherName,
        class: row.className, subject: row.subject, batch: row.batch, batchName: row.batchName || '', branchId: row.branchId,
        students: row.students || 0, weeklyHours: row.weeklyHours || 0, status: row.status,
      });
    } catch (err) {
      console.error('Create allocation error:', err);
      res.status(500).json({ error: 'Failed to create allocation' });
    }
  });

  app.put('/api/allocations/:id', async (req, res) => {
    // Branch admins may only create new allocations (batch + assign); editing
    // an existing allocation is reserved for super_admin.
    if (!req.user.roles.includes('super_admin')) return res.status(403).json({ error: 'Forbidden' });
    try {
      const existing = await db.get('SELECT * FROM allocations WHERE id = ?', req.params.id);
      if (!existing) return res.status(404).json({ error: 'Allocation not found' });
      const body = req.body || {};
      const teacherId = body.teacherId ?? existing.teacherId;
      const teacher = teacherId !== existing.teacherId ? await db.get('SELECT name FROM users WHERE id = ?', teacherId) : null;
      const now = new Date().toISOString();
      await db.run(
        `UPDATE allocations SET teacherId=?, teacherName=?, className=?, subject=?, batch=?, batchName=?, students=?, weeklyHours=?, status=?, updatedAt=? WHERE id=?`,
        teacherId, teacher ? teacher.name : (body.teacherName ?? existing.teacherName),
        body.class ?? existing.className, body.subject ?? existing.subject, body.batch ?? existing.batch,
        body.batchName ?? existing.batchName,
        body.students !== undefined ? Number(body.students) : existing.students,
        body.weeklyHours !== undefined ? Number(body.weeklyHours) : existing.weeklyHours,
        body.status ?? existing.status, now, req.params.id
      );
      const row = await db.get('SELECT * FROM allocations WHERE id = ?', req.params.id);
      res.json({
        id: String(row.id), teacherId: row.teacherId, teacherName: row.teacherName,
        class: row.className, subject: row.subject, batch: row.batch, batchName: row.batchName || '', branchId: row.branchId,
        students: row.students || 0, weeklyHours: row.weeklyHours || 0, status: row.status,
      });
    } catch (err) {
      console.error('Update allocation error:', err);
      res.status(500).json({ error: 'Failed to update allocation' });
    }
  });

  app.delete('/api/allocations/:id', async (req, res) => {
    // Same restriction as PUT above: removing an allocation is a super_admin action.
    if (!req.user.roles.includes('super_admin')) return res.status(403).json({ error: 'Forbidden' });
    try {
      await db.run(`UPDATE allocations SET status='Removed', updatedAt=? WHERE id=?`, new Date().toISOString(), req.params.id);
      res.json({ success: true });
    } catch (err) {
      console.error('Remove allocation error:', err);
      res.status(500).json({ error: 'Failed to remove allocation' });
    }
  });

  // ─── Admissions CRM ─────────────────────────────────────────────────────────

  // Simplified from the old 7-stage chain (submit/verify/schedule/complete/
  // approve/enroll/reject) down to the 3 statuses the CRM now exposes.
  // Existing admissions already sitting in one of the old intermediate
  // stages (e.g. "Interview Scheduled") are never rewritten — that text
  // stays exactly as historical record — but the workflow only ever offers
  // 'update'/'admit'/'reject' as actions going forward, and any status that
  // isn't literally 'Enquiry' is treated as being at the "Updated" stage for
  // the purpose of deciding what action to offer next (see
  // getAdmissionWorkflowActions in admissionService.ts).
  const ADMISSION_WORKFLOW_NEXT = {
    update: 'Updated',
    admit: 'Admitted',
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

  app.put('/api/admissions/:id', async (req, res) => {
    if (!req.user.roles.some((r) => ['admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const existing = await db.get('SELECT * FROM admissions WHERE id = ?', req.params.id);
      if (!existing) return res.status(404).json({ error: 'Admission not found' });
      const body = req.body || {};
      if (!body.applicantName) return res.status(400).json({ error: 'Applicant name is required' });
      await db.run(
        `UPDATE admissions SET applicantName=?, grade=?, appliedDate=?, contactNumber=?, email=?, updatedAt=? WHERE id=?`,
        body.applicantName, body.grade ?? existing.grade, body.appliedDate ?? existing.appliedDate,
        body.contactNumber ?? existing.contactNumber, body.email ?? existing.email, new Date().toISOString(), req.params.id
      );
      const row = await db.get('SELECT * FROM admissions WHERE id = ?', req.params.id);
      res.json(row);
    } catch (err) {
      console.error('Update admission error:', err);
      res.status(500).json({ error: 'Failed to update admission' });
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
      // An admin may only act on admissions in their own branch — the GET
      // list already filters to this, but nothing previously stopped a
      // direct PATCH call from reaching another branch's record.
      if (!req.user.roles.includes('super_admin') && existing.branchId && existing.branchId !== req.user.branchId) {
        return res.status(403).json({ error: 'You can only manage admissions in your own branch.' });
      }

      // Admitted is the entry point into the Fees module: reuse an existing
      // student record if one already links to this admission (covers a
      // second click, or the reverse StudentManagement.tsx path that already
      // flips an admission to Admitted after manually adding a student —
      // see enrollAdmissionByApplicantName) or matches this applicant by
      // name within the same branch (same convention that reverse path
      // already used); only create a new one if neither is found. Resolved
      // — and validated — before the status UPDATE commits, so a rejected
      // "Admitted" attempt (e.g. missing contact number) never leaves the
      // admission stuck in a status with no student behind it.
      let student = null;
      if (nextStatus === 'Admitted') {
        student = await db.get('SELECT * FROM students WHERE admissionId = ?', existing.id);
        if (!student) {
          student = await db.get(
            'SELECT * FROM students WHERE branchId = ? AND LOWER(fullName) = LOWER(?)',
            existing.branchId, existing.applicantName
          );
        }
        if (!student && !existing.contactNumber) {
          return res.status(400).json({ error: 'This enquiry has no contact number on file — add one before marking it Admitted (a primary parent mobile is required to create the student record).' });
        }
      }

      await db.run('UPDATE admissions SET status=?, updatedAt=? WHERE id=?', nextStatus, new Date().toISOString(), req.params.id);

      if (nextStatus === 'Admitted') {
        if (student) {
          if (!student.admissionId) await db.run('UPDATE students SET admissionId = ? WHERE id = ?', existing.id, student.id);
        } else {
          const nameParts = existing.applicantName.trim().split(/\s+/);
          const firstName = nameParts[0] || existing.applicantName;
          const lastName = nameParts.slice(1).join(' ') || '-';
          await createStudentRecord(db, {
            firstName, lastName,
            className: existing.grade || '',
            admissionDate: new Date().toISOString().slice(0, 10),
            primaryParentMobile: existing.contactNumber,
            parentEmail: existing.email || '',
          }, existing.branchId, { skipAutoFeeGeneration: true, admissionId: existing.id });
        }
      }

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

  // Task completion is a 3-stage sign-off: the assigned teacher marks their
  // work done (-> awaiting_admin_review), an admin reviews and confirms
  // (-> awaiting_super_admin_review), and a super_admin gives the final
  // confirmation (-> completed). Each role can only push the status forward
  // one stage — nobody can jump straight to "completed".
  app.put('/api/teacher-tasks/:id', async (req, res) => {
    const roles = req.user.roles || [];
    const isAdmin = roles.some((r) => ['admin', 'super_admin'].includes(r));
    const existing = await db.get('SELECT * FROM teacher_tasks WHERE id = ?', req.params.id).catch(() => null);
    if (!existing) return res.status(404).json({ error: 'Task not found' });
    const isOwnTask = roles.includes('teacher') && existing.teacherId === req.user.sub;
    if (!isAdmin && !isOwnTask) return res.status(403).json({ error: 'Forbidden' });

    try {
      const body = req.body || {};
      const now = new Date().toISOString();

      if (!isAdmin) {
        // Teacher, own task: only progress + remarks. Reaching 100% hands the
        // task off for admin review instead of marking it complete outright.
        const progress = body.progress !== undefined ? Math.max(0, Math.min(100, Number(body.progress))) : existing.progress;
        const status = progress >= 100 ? 'awaiting_admin_review' : progress > 0 ? 'in-progress' : 'pending';
        await db.run(
          `UPDATE teacher_tasks SET status=?, progress=?, completionRemarks=?, updatedAt=? WHERE id=?`,
          status, progress, body.completionRemarks ?? existing.completionRemarks, now, req.params.id
        );
      } else if (body.status === 'awaiting_super_admin_review' && existing.status === 'awaiting_admin_review') {
        // Admin sign-off step.
        await db.run(`UPDATE teacher_tasks SET status=?, updatedAt=? WHERE id=?`, 'awaiting_super_admin_review', now, req.params.id);
      } else if (body.status === 'completed' && existing.status === 'awaiting_super_admin_review' && roles.includes('super_admin')) {
        // Super admin final sign-off step.
        await db.run(`UPDATE teacher_tasks SET status=?, updatedAt=? WHERE id=?`, 'completed', now, req.params.id);
      } else {
        // Regular admin/super_admin edit of task details (not a sign-off action).
        const progress = body.progress !== undefined ? Number(body.progress) : existing.progress;
        const status = body.status ?? existing.status;
        await db.run(
          `UPDATE teacher_tasks SET title=?, description=?, teacherId=?, teacherName=?, priority=?, dueDate=?, dueTime=?, relatedClass=?, relatedSubject=?, attachmentUrl=?, status=?, progress=?, completionRemarks=?, updatedAt=? WHERE id=?`,
          body.title ?? existing.title, body.description ?? existing.description, body.teacherId ?? existing.teacherId, body.teacherName ?? existing.teacherName,
          body.priority ?? existing.priority, body.dueDate ?? existing.dueDate, body.dueTime ?? existing.dueTime,
          body.relatedClass ?? existing.relatedClass, body.relatedSubject ?? existing.relatedSubject, body.attachmentUrl ?? existing.attachmentUrl,
          status, progress, body.completionRemarks ?? existing.completionRemarks, now, req.params.id
        );
      }
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
      let mapped = rows.map(mapSchoolExamRowToSchedule);

      // Server-side narrowing to match what the client already filters down
      // to (previously enforced only in SchoolExamSchedulesPage's UI code) —
      // a raw API call must not be able to read another teacher's batches or
      // another parent's children just because they share a branch.
      const roles = req.user.roles || [];
      if (!roles.some((r) => ['admin', 'super_admin'].includes(r))) {
        if (roles.includes('teacher')) {
          mapped = mapped.filter((s) => !s.teacherId || s.teacherId === req.user.sub);
        } else if (roles.includes('parent')) {
          const linkedRows = await db.all('SELECT studentId FROM parent_student WHERE parentId = ?', req.user.sub);
          const linkedIds = new Set(linkedRows.map((r) => r.studentId));
          mapped = mapped.filter((s) => s.studentId && linkedIds.has(s.studentId));
        }
      }

      res.json(mapped);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.post('/api/school-exam-schedules', upload.single('attachment'), async (req, res) => {
    const roles = req.user.roles;
    if (!roles.some((r) => ['teacher', 'admin', 'super_admin', 'parent'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const body = req.body || {};
      const attachment = req.file;
      const now = new Date().toISOString();
      const isParentUpload = roles.includes('parent') && !roles.some((r) => ['teacher', 'admin', 'super_admin'].includes(r));

      let studentId = body.studentId || '';
      let studentName = body.studentName || '';
      let branchId = body.branchId || '';
      let schoolClass = body.schoolClass || '';
      let teacherId = body.teacherId || '';
      let teacherName = body.teacherName || '';

      if (isParentUpload) {
        // Never trust student/branch/batch/teacher from a parent's request —
        // resolve every one of them server-side from the verified parent-
        // child link and the student's own record, the same trust boundary
        // used throughout this file for branch-scoped writes.
        const link = await db.get('SELECT 1 FROM parent_student WHERE parentId = ? AND studentId = ?', req.user.sub, studentId);
        if (!link) return res.status(403).json({ error: 'You can only upload a schedule for your own child.' });
        const student = await db.get('SELECT * FROM students WHERE id = ?', studentId);
        if (!student) return res.status(404).json({ error: 'Student not found.' });
        studentName = student.fullName || `${student.firstName || ''} ${student.lastName || ''}`.trim();
        branchId = student.branchId || '';
        schoolClass = student.className || '';
        const resolvedTeacher = await resolveAssignedTeacherForClass(db, schoolClass, branchId);
        teacherId = resolvedTeacher.teacherId || '';
        teacherName = resolvedTeacher.teacherName || '';
      }

      const status = computeSchoolExamStatus(body.startDate, body.endDate);
      const createdBy = req.user.name || body.createdBy || '';
      const stmt = await db.prepare(`INSERT INTO school_exam_schedules (studentId, studentName, branchId, schoolName, schoolClass, examName, startDate, endDate, subject, description, attachmentPath, attachmentName, attachmentSize, status, createdBy, createdById, createdByRole, createdAt, updatedAt, teacherId, teacherName) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      const result = await stmt.run(studentId, studentName, branchId, body.schoolName || '', schoolClass, body.examName || '', body.startDate || '', body.endDate || '', body.subject || '', body.description || '', attachment ? `/uploads/${attachment.filename}` : null, attachment ? attachment.originalname : null, attachment ? attachment.size : null, status, createdBy, req.user.sub, roles[0] || '', now, now, teacherId, teacherName);
      await stmt.finalize();
      const row = await db.get('SELECT * FROM school_exam_schedules WHERE id = ?', result.lastID);
      const schedule = mapSchoolExamRowToSchedule(row);
      await upsertSchoolExamReminderNotifications(db, row);
      await sendSchoolExamUploadNotification(db, schedule, { id: req.user.sub, name: req.user.name, role: isParentUpload ? 'parent' : (roles[0] || 'teacher') });
      res.json(schedule);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.put('/api/school-exam-schedules/:id', upload.single('attachment'), async (req, res) => {
    if (!req.user.roles.some((r) => ['teacher', 'admin', 'super_admin', 'parent'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const body = req.body || {};
      const attachment = req.file;
      const existing = await db.get('SELECT * FROM school_exam_schedules WHERE id = ?', req.params.id);
      if (!existing) return res.status(404).json({ error: 'not found' });

      // Parents may only touch their own child's schedule — verified via
      // parent_student, never trusted from the client.
      if (req.user.roles.includes('parent') && !req.user.roles.some((r) => ['teacher', 'admin', 'super_admin'].includes(r))) {
        const link = await db.get('SELECT 1 FROM parent_student WHERE parentId = ? AND studentId = ?', req.user.sub, existing.studentId);
        if (!link) return res.status(403).json({ error: 'Forbidden' });
      }

      const nextAttachmentPath = attachment ? `/uploads/${attachment.filename}` : (body.attachmentPath ?? existing.attachmentPath ?? null);
      const nextAttachmentName = attachment ? attachment.originalname : (body.attachmentName ?? existing.attachmentName ?? null);
      const nextAttachmentSize = attachment ? attachment.size : (body.attachmentSize ?? existing.attachmentSize ?? null);
      const status = computeSchoolExamStatus(body.startDate || existing.startDate, body.endDate || existing.endDate);
      // Teachers and parents may only update the timetable file and its start/end
      // dates on an existing schedule — every other field (student, school, exam
      // name, etc.) stays whatever it already was, regardless of what the request
      // body sends. Admins/super_admins can still edit every field.
      const isTeacherOnly = !req.user.roles.some((r) => ['admin', 'super_admin'].includes(r));
      const nextFields = isTeacherOnly
        ? { studentId: existing.studentId, studentName: existing.studentName, branchId: existing.branchId, schoolName: existing.schoolName, schoolClass: existing.schoolClass, examName: existing.examName, subject: existing.subject, description: existing.description }
        : { studentId: body.studentId || existing.studentId, studentName: body.studentName || existing.studentName, branchId: body.branchId || existing.branchId, schoolName: body.schoolName || existing.schoolName, schoolClass: body.schoolClass || existing.schoolClass, examName: body.examName || existing.examName, subject: body.subject || existing.subject, description: body.description || existing.description };
      const stmt = await db.prepare(`UPDATE school_exam_schedules SET studentId=?, studentName=?, branchId=?, schoolName=?, schoolClass=?, examName=?, startDate=?, endDate=?, subject=?, description=?, attachmentPath=?, attachmentName=?, attachmentSize=?, status=?, createdBy=?, updatedAt=?, teacherId=?, teacherName=? WHERE id=?`);
      await stmt.run(nextFields.studentId, nextFields.studentName, nextFields.branchId, nextFields.schoolName, nextFields.schoolClass, nextFields.examName, body.startDate || existing.startDate, body.endDate || existing.endDate, nextFields.subject, nextFields.description, nextAttachmentPath, nextAttachmentName, nextAttachmentSize, status, body.createdBy || existing.createdBy, new Date().toISOString(), body.teacherId || existing.teacherId, body.teacherName || existing.teacherName, req.params.id);
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

  // Approximates how many accounts a broadcast notification was actually sent
  // to, so admins can see "5 of 12 parents have read this" — not a byte-for-byte
  // mirror of matchesUserScope's every edge case (e.g. a teacher's specific
  // assigned classes), but covers the common targeting shapes: specific
  // userIds/studentIds, or a broadcast to one or more roles.
  async function resolveRecipientCount(notification) {
    if (notification.userIds?.length) return notification.userIds.length;
    if (notification.teacherIds?.length) return notification.teacherIds.length;

    if (notification.studentIds?.length) {
      const placeholders = notification.studentIds.map(() => '?').join(',');
      const rows = await db.all(
        `SELECT DISTINCT parentId FROM parent_student WHERE studentId IN (${placeholders})`,
        ...notification.studentIds
      );
      return rows.length;
    }

    const roles = notification.roles || [];
    if (!roles.length) return 0;

    let count = 0;
    if (roles.includes('parent')) {
      if (notification.classNames?.length) {
        // Class-scoped parent notifications (materials, special classes) only
        // actually reach parents of students in those specific classes — not
        // every parent in the branch, so count against that narrower set.
        const placeholders = notification.classNames.map(() => '?').join(',');
        const params = notification.branchId ? [...notification.classNames, notification.branchId] : notification.classNames;
        const query = notification.branchId
          ? `SELECT DISTINCT ps.parentId FROM parent_student ps JOIN students s ON s.id = ps.studentId WHERE s.className IN (${placeholders}) AND s.branchId = ?`
          : `SELECT DISTINCT ps.parentId FROM parent_student ps JOIN students s ON s.id = ps.studentId WHERE s.className IN (${placeholders})`;
        const rows = await db.all(query, ...params);
        count += rows.length;
      } else {
        const parents = await db.all(
          notification.branchId ? 'SELECT id FROM parents WHERE status = ? AND branchId = ?' : 'SELECT id FROM parents WHERE status = ?',
          ...(notification.branchId ? ['Active', notification.branchId] : ['Active'])
        );
        count += parents.length;
      }
    }
    const staffRoles = roles.filter((r) => r !== 'parent');
    if (staffRoles.length) {
      const users = await db.all(
        notification.branchId ? 'SELECT roles FROM users WHERE status = ? AND (branchId = ? OR branchId IS NULL)' : 'SELECT roles FROM users WHERE status = ?',
        ...(notification.branchId ? ['Active', notification.branchId] : ['Active'])
      );
      count += users.filter((u) => parseJsonList(u.roles).some((r) => staffRoles.includes(r))).length;
    }
    return count;
  }

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

  // ─── Compose audience resolution (server-authoritative) ───────────────────
  // The Notification Center composer sends a short `audience` key instead of
  // raw roles/branchId/teacherIds/classNames — those targeting fields are
  // always computed HERE from the verified sender's own role/branch/id, the
  // same trust boundary resolveBranchId() enforces elsewhere in this file.
  // A client can request an audience it isn't allowed to use, but it can
  // never make the server target roles/branches/people it didn't resolve
  // itself. Only applies to payload.audience-driven sends from the composer;
  // internal system notifications (batch created, admission, etc.) keep
  // passing roles/branchId/teacherIds/classNames directly and are untouched.
  const AUDIENCE_ALLOWED_ROLES = {
    all_users: ['super_admin'],
    all_admins: ['super_admin'],
    all_teachers: ['super_admin'],
    all_parents: ['super_admin'],
    all_accountants: ['super_admin'],
    branch_teachers: ['admin'],
    branch_parents: ['admin'],
    branch_accountants: ['admin'],
    branch_admin: ['teacher', 'parent', 'accountant'],
    to_super_admin: ['admin', 'teacher', 'parent', 'accountant'],
    my_batch_parents: ['teacher'],
    my_assigned_teacher: ['parent'],
  };

  async function resolveComposedAudience(req, audience) {
    const senderRoles = req.user.roles || [];
    const senderBranchId = req.user.branchId || null;
    const senderId = req.user.sub;

    const allowedRoles = AUDIENCE_ALLOWED_ROLES[audience];
    if (!allowedRoles) return { error: 'Unknown audience.' };
    if (!allowedRoles.some((r) => senderRoles.includes(r))) {
      return { error: 'You are not allowed to send to this audience.' };
    }

    switch (audience) {
      case 'all_users':
        return { roles: ['admin', 'teacher', 'parent', 'accountant'], branchId: null };
      case 'all_admins':
        return { roles: ['admin'], branchId: null };
      case 'all_teachers':
        return { roles: ['teacher'], branchId: null };
      case 'all_parents':
        return { roles: ['parent'], branchId: null };
      case 'all_accountants':
        return { roles: ['accountant'], branchId: null };
      case 'branch_teachers':
        if (!senderBranchId) return { error: 'Your account has no branch assigned. Contact your Super Admin.' };
        return { roles: ['teacher'], branchId: senderBranchId };
      case 'branch_parents':
        if (!senderBranchId) return { error: 'Your account has no branch assigned. Contact your Super Admin.' };
        return { roles: ['parent'], branchId: senderBranchId };
      case 'branch_accountants':
        if (!senderBranchId) return { error: 'Your account has no branch assigned. Contact your Super Admin.' };
        return { roles: ['accountant'], branchId: senderBranchId };
      case 'branch_admin':
        if (!senderBranchId) return { error: 'Your account has no branch assigned. Contact your Super Admin.' };
        return { roles: ['admin'], branchId: senderBranchId };
      case 'to_super_admin':
        return { roles: ['super_admin'], branchId: null };
      case 'my_batch_parents': {
        if (!senderBranchId) return { error: 'Your account has no branch assigned. Contact your Super Admin.' };
        const rows = await db.all('SELECT DISTINCT className FROM classes WHERE assignedTeacherId = ? AND branchId = ?', senderId, senderBranchId);
        const classNames = rows.map((r) => r.className).filter(Boolean);
        if (!classNames.length) return { error: 'You have no assigned batches yet — nothing to notify parents about.' };
        return { roles: [], classNames, branchId: senderBranchId };
      }
      case 'my_assigned_teacher': {
        const rows = await db.all(
          `SELECT DISTINCT c.assignedTeacherId AS teacherId FROM parent_student ps
           JOIN students s ON s.id = ps.studentId
           JOIN classes c ON c.className = s.className AND c.branchId = s.branchId
           WHERE ps.parentId = ? AND c.assignedTeacherId IS NOT NULL`,
          senderId
        );
        const teacherIds = rows.map((r) => r.teacherId).filter(Boolean);
        if (!teacherIds.length) return { error: 'No assigned teacher found for your child yet.' };
        return { roles: [], teacherIds, branchId: senderBranchId };
      }
      default:
        return { error: 'Unknown audience.' };
    }
  }

  app.get('/api/notifications', async (req, res) => {
    try {
      // "Sent" mailbox: what I actually sent, regardless of whether I'd also
      // be a recipient — a completely different query from the inbox filter
      // below, so it's handled and returned before any scope/mute filtering.
      if (req.query.mailbox === 'sent') {
        const sentRows = await db.all('SELECT * FROM notifications WHERE senderId = ? ORDER BY createdAt DESC', req.user.sub);
        const sentMapped = sentRows.map(mapRowToNotification);
        const withCounts = await Promise.all(sentMapped.map(async (notif) => ({
          ...notif,
          readCount: (await db.get('SELECT COUNT(*) as c FROM notification_reads WHERE notificationId = ?', notif.id))?.c || 0,
          totalRecipients: await resolveRecipientCount(notif),
        })));
        return res.json(withCounts);
      }

      const rows = await db.all('SELECT * FROM notifications ORDER BY createdAt DESC');
      const user = deriveNotificationUser(req);
      const mapped = rows.map(mapRowToNotification);
      let scoped = mapped.filter((notif) => matchesUserScope(notif, user));

      const prefs = await db.get('SELECT * FROM notification_preferences WHERE userId = ?', req.user.sub);
      if (prefs?.muteAll) {
        scoped = [];
      } else if (prefs?.highPriorityOnly) {
        scoped = scoped.filter((notif) => notif.priority === 'high');
      }

      // Per-recipient read state/count, so one parent reading a broadcast
      // notification no longer marks it read for every other parent too.
      const readCountRows = await db.all('SELECT notificationId, COUNT(*) as cnt FROM notification_reads GROUP BY notificationId');
      const readCountMap = new Map(readCountRows.map((r) => [r.notificationId, r.cnt]));
      const myReadRows = await db.all('SELECT notificationId FROM notification_reads WHERE userId = ?', req.user.sub);
      const myReadSet = new Set(myReadRows.map((r) => r.notificationId));
      scoped = scoped.map((notif) => ({
        ...notif,
        isReadByMe: myReadSet.has(notif.id),
        readCount: readCountMap.get(notif.id) || 0,
      }));

      res.json(scoped);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  // Full read-by list for one notification — who has actually seen it and when.
  // Staff (admin/accountant/super_admin) can audit any notification in their
  // scope; anyone else can only audit a notification they themselves sent
  // (the composer's own "delivery count" for their sent items) — with one
  // narrower legacy allowance for teachers viewing Materials read-receipts,
  // since there's no per-post authorship for those older notifications.
  app.get('/api/notifications/:id/reads', async (req, res) => {
    const roles = req.user.roles;
    const isStaff = roles.some((r) => ['admin', 'super_admin', 'accountant'].includes(r));
    const isTeacherViewingMaterials = roles.includes('teacher');
    try {
      const row = await db.get('SELECT * FROM notifications WHERE id = ?', req.params.id);
      if (!row) return res.status(404).json({ error: 'Notification not found' });
      const isOwnSentNotification = row.senderId && row.senderId === req.user.sub;
      const allowed = isStaff || isOwnSentNotification || (isTeacherViewingMaterials && row.notificationType === 'Materials');
      if (!allowed) return res.status(403).json({ error: 'Forbidden' });
      const notif = mapRowToNotification(row);

      const [reads, totalRecipients] = await Promise.all([
        db.all('SELECT userId, userName, userRole, readAt FROM notification_reads WHERE notificationId = ? ORDER BY readAt ASC', req.params.id),
        resolveRecipientCount(notif),
      ]);

      res.json({ readCount: reads.length, totalRecipients, reads });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  // --- Notification Preferences (per-user) ---
  app.get('/api/notification-preferences', async (req, res) => {
    try {
      const row = await db.get('SELECT * FROM notification_preferences WHERE userId = ?', req.user.sub);
      res.json({ muteAll: Boolean(row?.muteAll), highPriorityOnly: Boolean(row?.highPriorityOnly) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.post('/api/notification-preferences', async (req, res) => {
    try {
      const muteAll = req.body?.muteAll ? 1 : 0;
      const highPriorityOnly = req.body?.highPriorityOnly ? 1 : 0;
      await db.run(
        `INSERT INTO notification_preferences (userId, muteAll, highPriorityOnly, updatedAt) VALUES (?, ?, ?, ?)
         ON CONFLICT(userId) DO UPDATE SET muteAll=excluded.muteAll, highPriorityOnly=excluded.highPriorityOnly, updatedAt=excluded.updatedAt`,
        req.user.sub, muteAll, highPriorityOnly, new Date().toISOString()
      );
      res.json({ muteAll: Boolean(muteAll), highPriorityOnly: Boolean(highPriorityOnly) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  // --- Data Retention (System Settings > Data Retention) ---
  // There's no background job runner in this app, so retention is enforced
  // on-demand rather than on a schedule — Super Admin triggers a cleanup pass
  // that purges rows older than the configured retention window.
  app.post('/api/data-retention/cleanup', async (req, res) => {
    if (!req.user.roles.includes('super_admin')) return res.status(403).json({ error: 'Forbidden' });
    try {
      const retentionDays = Number(await getSetting('data_retention_days', '365')) || 365;
      const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

      const notifResult = await db.run("DELETE FROM notifications WHERE createdAt < ? AND status != 'unread'", cutoff);
      const auditResult = await db.run('DELETE FROM salary_audit_log WHERE timestamp < ?', cutoff);
      const whatsappLogResult = await db.run('DELETE FROM whatsapp_logs WHERE sentTime < ?', cutoff);

      res.json({
        success: true,
        retentionDays,
        deleted: {
          notifications: notifResult.changes || 0,
          salaryAuditLog: auditResult.changes || 0,
          whatsappLogs: whatsappLogResult.changes || 0,
        },
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.post('/api/notifications', async (req, res) => {
    try {
      const now = new Date().toISOString();
      const payload = req.body || {};

      // Composer-driven sends: audience is resolved server-side from the
      // verified sender's own role/branch/id — the client cannot request
      // roles/branchId/teacherIds/classNames/userIds/studentIds directly.
      // Everything else (system-generated notifications from admissions,
      // batch creation, timetable edits, etc.) keeps passing those fields
      // directly, unchanged.
      let roles = payload.roles || [];
      let branchId = payload.branchId || null;
      let teacherIds = payload.teacherIds || [];
      let classNames = payload.classNames || [];
      let userIds = payload.userIds || [];
      const studentIds = payload.studentIds || [];

      if (payload.audience) {
        const resolved = await resolveComposedAudience(req, payload.audience);
        if (resolved.error) return res.status(403).json({ error: resolved.error });
        roles = resolved.roles || [];
        branchId = resolved.branchId ?? null;
        teacherIds = resolved.teacherIds || [];
        classNames = resolved.classNames || [];
        userIds = []; // audience-driven sends never target arbitrary userIds
      }

      const notification = {
        // Never trust a client-supplied id as the primary key — the composer's
        // locally-incrementing counter isn't synced across browsers/sessions
        // and routinely collided with ids other users had already saved,
        // which silently failed every "Compose Notification" send.
        id: newNotificationId(),
        title: payload.title || 'Notification',
        message: payload.message || '',
        description: payload.description || '',
        type: payload.type || 'info',
        priority: payload.priority || 'medium',
        roles: serializeList(roles),
        teacherIds: serializeList(teacherIds),
        classNames: serializeList(classNames),
        userIds: serializeList(userIds),
        studentIds: serializeList(studentIds),
        // The display name always reflects who's actually authenticated —
        // a client could otherwise set `sender` to impersonate anyone.
        sender: req.user?.name || payload.sender || 'System',
        senderId: req.user?.sub || null,
        senderRole: req.user?.roles?.[0] || null,
        audience: payload.audience || null,
        notificationType: payload.notificationType || payload.type || 'info',
        recipient: payload.recipient || 'All',
        recipientRole: payload.recipientRole || '',
        branchId,
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
      const stmt = await db.prepare(`INSERT INTO notifications (id, title, message, description, type, priority, roles, teacherIds, classNames, userIds, studentIds, sender, senderId, senderRole, audience, notificationType, recipient, recipientRole, branchId, status, read, createdAt, readAt, readBy, readByRole, readByBranch, deletedAt, deletedBy, deletedByBranch, scheduledFor, expiresAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      await stmt.run(notification.id, notification.title, notification.message, notification.description, notification.type, notification.priority, notification.roles, notification.teacherIds, notification.classNames, notification.userIds, notification.studentIds, notification.sender, notification.senderId, notification.senderRole, notification.audience, notification.notificationType, notification.recipient, notification.recipientRole, notification.branchId, notification.status, notification.read, notification.createdAt, notification.readAt, notification.readBy, notification.readByRole, notification.readByBranch, notification.deletedAt, notification.deletedBy, notification.deletedByBranch, notification.scheduledFor, notification.expiresAt);
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
      // The shared status/read columns still reflect the most recent reader
      // (kept for anything still relying on the old single-reader model), but
      // the real per-user source of truth is notification_reads below.
      const stmt = await db.prepare(`UPDATE notifications SET status='read', read=1, readAt=?, readBy=?, readByRole=?, readByBranch=? WHERE id=?`);
      await stmt.run(body.readAt || now, body.readBy || req.user.name, body.readByRole || req.user.roles[0], body.readByBranch || req.user.branchId || null, req.params.id);
      await stmt.finalize();
      await db.run(
        `INSERT INTO notification_reads (notificationId, userId, userName, userRole, readAt) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(notificationId, userId) DO UPDATE SET readAt=excluded.readAt`,
        req.params.id, req.user.sub, req.user.name, req.user.roles[0], body.readAt || now
      );
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
      await stmt.run(req.body?.readAt || now, req.body?.readBy || req.user.name, req.body?.readByRole || req.user.roles[0], req.body?.readByBranch || req.user.branchId || null, ...ids);
      await stmt.finalize();

      const readStmt = await db.prepare(
        `INSERT INTO notification_reads (notificationId, userId, userName, userRole, readAt) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(notificationId, userId) DO UPDATE SET readAt=excluded.readAt`
      );
      for (const id of ids) {
        await readStmt.run(id, req.user.sub, req.user.name, req.user.roles[0], req.body?.readAt || now);
      }
      await readStmt.finalize();

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

      // Multi-batch aware: also reaches a student whose primary batch is
      // elsewhere but who's additionally enrolled (student_batches) in this
      // homework's own batch (className+board+branch).
      const hwClassId = await resolveClassId(hw.className, hw.batch, hw.branchId);
      const students = hwClassId
        ? await db.all(
            `SELECT * FROM students WHERE status = ? AND (
               (className = ? AND branchId = ?) OR id IN (SELECT studentId FROM student_batches WHERE classId = ?)
             )`,
            'Active', hw.className, hw.branchId, hwClassId
          )
        : await db.all('SELECT * FROM students WHERE className = ? AND branchId = ? AND status = ?', hw.className, hw.branchId, 'Active');

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

      // A teacher-only account may only assign homework to a batch actually
      // assigned to them — otherwise they could later pull the submissions
      // (names + uploaded files) for a batch that isn't theirs.
      const teacherClassNames = await getTeacherAssignedClassNames(req);
      if (teacherClassNames && !teacherClassNames.includes(body.className)) {
        return res.status(403).json({ error: 'You can only assign homework to a batch assigned to you.' });
      }

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
      await sendHomeworkUploadNotification(db, created, { id: req.user.sub, name: req.user.name, role: req.user.roles?.[0] || 'teacher' }, fileList[0] || null);
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
      const homework = await db.get('SELECT * FROM homework WHERE id = ?', id);
      if (!homework) return res.status(404).json({ error: 'Homework not found' });

      const roles = req.user.roles || [];

      // A parent only ever gets their own linked children's submissions —
      // same pattern as GET /api/students — never the whole class's.
      if (roles.includes('parent') && !roles.some((r) => ['teacher', 'admin', 'super_admin'].includes(r))) {
        const linkedRows = await db.all('SELECT studentId FROM parent_student WHERE parentId = ?', req.user.sub);
        const linkedIds = linkedRows.map((r) => r.studentId);
        if (linkedIds.length === 0) return res.json([]);
        const placeholders = linkedIds.map(() => '?').join(',');
        const rows = await db.all(`SELECT * FROM homework_submissions WHERE homeworkId = ? AND studentId IN (${placeholders})`, id, ...linkedIds);
        return res.json(rows);
      }

      if (!roles.some((r) => ['teacher', 'admin', 'super_admin'].includes(r))) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      // A teacher-only account may only view submissions for homework they
      // themselves assigned (which, per POST /api/homework above, is always
      // for a batch actually assigned to them).
      const isTeacherOnly = roles.includes('teacher') && !roles.some((r) => ['admin', 'super_admin'].includes(r));
      if (isTeacherOnly && homework.teacherId !== req.user.sub) {
        return res.status(403).json({ error: 'You can only view submissions for your own homework assignments.' });
      }

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

      const token = await signToken({ id: parent.id, name: `${parent.firstName} ${parent.lastName}`, email: parent.email, mobile: parent.mobile, roles: JSON.stringify(['parent']), branchId: parent.branchId }, false);

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
        return res.json(await attachStudentBatches(rows));
      }

      if (!roles.some((r) => ['teacher', 'admin', 'super_admin', 'accountant'].includes(r))) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const { className, batch } = req.query;
      const branchId = resolveBranchId(req, req.query.branchId);
      let query = 'SELECT * FROM students';
      const params = [];
      const conditions = [];

      // Multi-batch aware: a student matches a requested className/batch either
      // via their own primary className/batch, or via an additional
      // student_batches membership in the classes row those two name — so a
      // student assigned to a second batch shows up for that batch's roster
      // too (attendance, exams, homework, ...), without ever showing up for a
      // batch they don't belong to.
      if (className || batch) {
        const targetClassId = await resolveClassId(className, batch, branchId);
        const primary = [];
        if (className) { primary.push('className = ?'); params.push(className); }
        if (batch) { primary.push('batch = ?'); params.push(batch); }
        if (targetClassId) {
          conditions.push(`((${primary.join(' AND ')}) OR id IN (SELECT studentId FROM student_batches WHERE classId = ?))`);
          params.push(targetClassId);
        } else {
          conditions.push(`(${primary.join(' AND ')})`);
        }
      }
      if (branchId) {
        conditions.push('branchId = ?');
        params.push(branchId);
      }

      // Student -> Batch -> Teacher Assignment: a teacher-only account only ever
      // sees students in batches actually assigned to them — by primary
      // className match, or (multi-batch) via student_batches for any of this
      // teacher's assigned classIds, so a student whose primary batch is
      // elsewhere but who's also enrolled in one of THIS teacher's batches
      // still shows up. An unallocated student (className '') is never
      // returned to a teacher either way.
      const teacherClassNames = await getTeacherAssignedClassNames(req);
      if (teacherClassNames) {
        if (teacherClassNames.length === 0) return res.json([]);
        if (className && !teacherClassNames.includes(className)) return res.json([]);
        const teacherClassIds = await getTeacherAssignedClassIds(req);
        const namePlaceholders = teacherClassNames.map(() => '?').join(',');
        if (teacherClassIds.length > 0) {
          const idPlaceholders = teacherClassIds.map(() => '?').join(',');
          conditions.push(`(className IN (${namePlaceholders}) OR id IN (SELECT studentId FROM student_batches WHERE classId IN (${idPlaceholders})))`);
          params.push(...teacherClassNames, ...teacherClassIds);
        } else {
          conditions.push(`className IN (${namePlaceholders})`);
          params.push(...teacherClassNames);
        }
      }

      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }

      const rows = await db.all(query, ...params);
      res.json(await attachStudentBatches(rows));
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

  // Shared by POST /api/students (manual "Add Student") and the Admission
  // CRM's Admitted transition below — same insert, same parent find-or-link,
  // same "New Student Admitted" notification either way, so the two entry
  // points can never silently diverge in behavior. `skipAutoFeeGeneration`
  // exists only for the Admitted path: the brief for that flow requires the
  // student to start as "Fee Not Assigned" even when a fee_structures
  // template already exists for their class/branch, whereas the original
  // manual-add behavior (auto-apply a matching structure immediately) stays
  // exactly as it was for every other caller.
  async function createStudentRecord(db, s, branchId, { skipAutoFeeGeneration = false, admissionId = null } = {}) {
    const now = new Date().toISOString();
    const studentId = s.id || `STU${Date.now()}`;

    const stmt = await db.prepare(`
      INSERT INTO students (
        id, firstName, lastName, fullName, gender, dob, className, batch, branchId,
        rollNumber, admissionNumber, admissionDate, status, fatherName, motherName,
        primaryParentName, relationship, fatherMobile, motherMobile, primaryParentMobile,
        parentEmail, guardianName, guardianMobile, address, admissionId
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    await stmt.run(
      studentId, s.firstName, s.lastName, `${s.firstName} ${s.lastName}`, s.gender || 'Male', s.dob || '',
      s.className || '', s.batch || '', branchId, s.rollNumber || '', s.admissionNumber || '',
      s.admissionDate || now.split('T')[0], s.status || 'Active', s.fatherName || '', s.motherName || '',
      s.primaryParentName || '', s.relationship || '', s.fatherMobile || '', s.motherMobile || '',
      s.primaryParentMobile, s.parentEmail || '', s.guardianName || '', s.guardianMobile || '', s.address || '', admissionId
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

    if (s.className) await syncPrimaryBatchLink(studentId, s.className, s.batch, branchId);

    const saved = await db.get('SELECT * FROM students WHERE id = ?', studentId);

    // Auto-generate fee records for the new student from any fee structure(s)
    // already configured for their class/branch — previously a student only
    // ever got a fee record if someone remembered to run "Generate for class"
    // again after they were admitted, so newly admitted students were
    // invisible on the Fees page until then.
    if (saved.className && !skipAutoFeeGeneration) {
      const matchingStructures = await db.all(
        'SELECT * FROM fee_structures WHERE className = ? AND branchId = ?',
        saved.className, branchId
      );
      for (const structure of matchingStructures) {
        const status = feeRecordStatus(structure.amount, 0, structure.dueDate);
        await db.run(`
          INSERT INTO fee_records (studentId, studentName, className, branchId, feeType, academicYear, totalAmount, paidAmount, dueDate, status, createdAt, updatedAt)
          VALUES (?,?,?,?,?,?,?,0,?,?,?,?)
        `, saved.id, saved.fullName, saved.className, branchId, structure.feeType, structure.academicYear, structure.amount, structure.dueDate, status, now, now);
      }
    }

    // Notify accountants (and admins) so a newly admitted student's uniform/
    // materials allocation doesn't get missed — surfaces in their Notifications
    // and in the Accountant Portal's pending-allocations list. Also the exact
    // mechanism that satisfies "notify the branch Accountant and Super Admin
    // when a student becomes Admitted" for the Admission CRM path below —
    // roles already covers both, branchId already scopes it correctly.
    const notifId = newNotificationId();
    await db.run(`
      INSERT INTO notifications (id, title, message, description, type, priority, roles, branchId, status, createdAt)
      VALUES (?, ?, ?, ?, 'info', 'medium', '["accountant","admin","super_admin"]', ?, 'unread', ?)
    `, notifId, 'New Student Admitted', `${saved.fullName} was admitted to ${saved.className || 'a class'} — inventory allocation pending.`, `Admission notification for branch ${branchId}`, branchId, now);

    return saved;
  }

  app.post('/api/students', async (req, res) => {
    if (!req.user.roles.some((r) => ['teacher', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const s = req.body;
      if (!s.firstName || !s.lastName || !s.primaryParentMobile) {
        return res.status(400).json({ error: 'First name, last name, and primary parent mobile are required' });
      }

      // A teacher-only account may only place a new student into a batch
      // actually assigned to them (an empty className still leaves the
      // student unallocated, visible only to admin/super_admin — just not
      // silently placed into a batch that isn't theirs).
      const teacherClassNames = await getTeacherAssignedClassNames(req);
      if (teacherClassNames && s.className && !teacherClassNames.includes(s.className)) {
        return res.status(403).json({ error: 'You can only add a student to a batch assigned to you.' });
      }

      // A mobile number sent as a JSON number (rather than a string) exceeds the
      // sqlite3 driver's 32-bit int-bind range, gets bound as a float, and lands
      // in these TEXT columns as e.g. "9535755739.0" — silently breaking that
      // family's parent login. Force to plain strings regardless of caller.
      s.fatherMobile = s.fatherMobile != null ? String(s.fatherMobile) : s.fatherMobile;
      s.motherMobile = s.motherMobile != null ? String(s.motherMobile) : s.motherMobile;
      s.primaryParentMobile = String(s.primaryParentMobile);
      s.guardianMobile = s.guardianMobile != null ? String(s.guardianMobile) : s.guardianMobile;

      const branchId = resolveBranchId(req, s.branchId) || 'branch_main';
      const saved = await createStudentRecord(db, s, branchId);
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

      // A teacher-only account may only edit a student who is currently in a
      // batch assigned to them (closes an IDOR: student ids are guessable,
      // and without this check GET's batch scoping could be bypassed by
      // editing/reading back an arbitrary student via this endpoint), and
      // may only move them into another batch that is also assigned to them
      // (an empty className is still allowed — that unassigns the student,
      // it doesn't move them into someone else's batch).
      const teacherClassNames = await getTeacherAssignedClassNames(req);
      if (teacherClassNames) {
        const existing = await db.get('SELECT className FROM students WHERE id = ?', studentId);
        if (!existing || !teacherClassNames.includes(existing.className)) {
          return res.status(403).json({ error: 'You can only edit students in a batch assigned to you.' });
        }
        if (s.className && !teacherClassNames.includes(s.className)) {
          return res.status(403).json({ error: 'You can only move a student into a batch assigned to you.' });
        }
      }

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

      // Editing the primary className/batch here only ever ADDS a
      // student_batches membership for the new primary — it never removes
      // whatever other batches the student was separately added to (that's
      // what POST/DELETE /api/students/:id/batches below are for).
      if (s.className) await syncPrimaryBatchLink(studentId, s.className, s.batch, branchId);

      const saved = await db.get('SELECT * FROM students WHERE id = ?', studentId);
      res.json((await attachStudentBatches([saved]))[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.delete('/api/students/:id', async (req, res) => {
    if (!req.user.roles.includes('super_admin') && !req.user.roles.includes('admin')) return res.status(403).json({ error: 'Forbidden' });
    try {
      const existing = await db.get('SELECT id FROM students WHERE id = ?', req.params.id);
      if (!existing) return res.status(404).json({ error: 'Student not found' });
      // Soft delete: keeps fee/attendance/homework history intact, mirrors teacher deactivation
      await db.run(`UPDATE students SET status='Inactive' WHERE id=?`, req.params.id);
      res.json({ success: true });
    } catch (err) {
      console.error('Delete student error:', err);
      res.status(500).json({ error: 'Failed to delete student' });
    }
  });

  // Adds the student to ANOTHER batch alongside whatever they're already in
  // (their primary batch and any others) — never overwrites students.className/
  // batch, never touches any other membership row. This is the "same student,
  // multiple batches, one profile" operation; Batches.tsx's existing "move to
  // this batch" (PUT /api/students/:id) remains how the PRIMARY batch changes.
  app.post('/api/students/:id/batches', async (req, res) => {
    if (!req.user.roles.some((r) => ['teacher', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const student = await db.get('SELECT * FROM students WHERE id = ?', req.params.id);
      if (!student) return res.status(404).json({ error: 'Student not found' });
      const classId = req.body?.classId;
      if (!classId) return res.status(400).json({ error: 'classId is required' });
      const classRow = await db.get('SELECT * FROM classes WHERE id = ?', classId);
      if (!classRow) return res.status(404).json({ error: 'Batch not found' });

      const teacherClassIds = await getTeacherAssignedClassIds(req);
      if (teacherClassIds && !teacherClassIds.includes(classId)) {
        return res.status(403).json({ error: 'You can only add a student to a batch assigned to you.' });
      }

      await db.run('INSERT OR IGNORE INTO student_batches (studentId, classId, createdAt) VALUES (?, ?, ?)', student.id, classId, new Date().toISOString());
      const updated = await db.get('SELECT * FROM students WHERE id = ?', student.id);
      res.json((await attachStudentBatches([updated]))[0]);
    } catch (err) {
      console.error('Add student batch error:', err);
      res.status(500).json({ error: 'Failed to add batch' });
    }
  });

  // Removes the student from one batch. If that batch happens to be their
  // current primary (students.className/batch), the primary is reassigned to
  // one of their remaining batches (or cleared to unassigned if this was
  // their only one) — a student is never left pointing at a batch they're no
  // longer actually in.
  app.delete('/api/students/:id/batches/:classId', async (req, res) => {
    if (!req.user.roles.some((r) => ['teacher', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const student = await db.get('SELECT * FROM students WHERE id = ?', req.params.id);
      if (!student) return res.status(404).json({ error: 'Student not found' });

      const teacherClassIds = await getTeacherAssignedClassIds(req);
      if (teacherClassIds && !teacherClassIds.includes(req.params.classId)) {
        return res.status(403).json({ error: 'You can only remove a student from a batch assigned to you.' });
      }

      await db.run('DELETE FROM student_batches WHERE studentId = ? AND classId = ?', student.id, req.params.classId);

      const primaryClassId = await resolveClassId(student.className, student.batch, student.branchId);
      if (primaryClassId === req.params.classId) {
        const remaining = await db.get(
          `SELECT c.className, c.board, c.branchId FROM student_batches sb JOIN classes c ON c.id = sb.classId WHERE sb.studentId = ? LIMIT 1`,
          student.id
        );
        await db.run(
          'UPDATE students SET className = ?, batch = ? WHERE id = ?',
          remaining?.className || '', remaining?.board || '', student.id
        );
      }

      const updated = await db.get('SELECT * FROM students WHERE id = ?', student.id);
      res.json((await attachStudentBatches([updated]))[0]);
    } catch (err) {
      console.error('Remove student batch error:', err);
      res.status(500).json({ error: 'Failed to remove batch' });
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
      const { className, date, branchId, board } = req.query;
      // branchId/board filters need a join to classes (attendance has neither
      // column); only join when actually requested so the plain className+date
      // path used by every existing caller is untouched.
      const needsClassJoin = Boolean(branchId || board);
      let query = needsClassJoin
        ? 'SELECT a.* FROM attendance a JOIN classes c ON c.className = a.className'
        : 'SELECT * FROM attendance';
      const classCol = needsClassJoin ? 'a.className' : 'className';
      const dateCol = needsClassJoin ? 'a.date' : 'date';
      const params = [];
      const conditions = [];

      if (className) {
        conditions.push(`${classCol} = ?`);
        params.push(className);
      }
      if (date) {
        conditions.push(`${dateCol} = ?`);
        params.push(date);
      }
      if (branchId) {
        conditions.push('c.branchId = ?');
        params.push(branchId);
      }
      if (board) {
        conditions.push('c.board = ?');
        params.push(board);
      }

      // Same batch-assignment scoping as GET /api/students — a teacher-only
      // account only ever sees attendance for batches assigned to them.
      const teacherClassNames = await getTeacherAssignedClassNames(req);
      if (teacherClassNames) {
        if (teacherClassNames.length === 0) return res.json([]);
        if (className && !teacherClassNames.includes(className)) return res.json([]);
        conditions.push(`${classCol} IN (${teacherClassNames.map(() => '?').join(',')})`);
        params.push(...teacherClassNames);
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

      // A teacher-only account may only mark attendance for a batch they are
      // actually assigned to — mirrors the read-side scoping on GET above.
      const teacherClassNames = await getTeacherAssignedClassNames(req);
      if (teacherClassNames && !teacherClassNames.includes(className)) {
        return res.status(403).json({ error: 'You can only mark attendance for a batch assigned to you.' });
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

      // Detailed attendance notification to the batch's branch Admin + Super
      // Admin (see sendAttendanceSubmissionNotification). Resolved from the
      // batch's own classes.branchId — not the submitter's req.user.branchId —
      // since an admin/super_admin can submit on behalf of a batch outside
      // their own branch. Failure here must never fail the attendance save
      // itself: the records above are already committed.
      try {
        const classRow = await db.get('SELECT branchId FROM classes WHERE className = ? LIMIT 1', className);
        const resolvedBranchId = classRow?.branchId || req.user.branchId || null;
        const branchRow = resolvedBranchId ? await db.get('SELECT name FROM branches WHERE id = ?', resolvedBranchId) : null;
        const branchName = branchRow?.name || resolvedBranchId || 'Unknown Branch';

        await sendAttendanceSubmissionNotification(db, {
          className,
          date,
          attendanceRecords,
          submitter: { id: req.user.sub, name: req.user.name, role: req.user.roles?.[0] || 'teacher' },
          branchId: resolvedBranchId,
          branchName,
        });
      } catch (notifyErr) {
        console.error('sendAttendanceSubmissionNotification failed:', notifyErr);
      }

      res.json({ success: true, results });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  // --- Holiday Calendar ---
  app.get('/api/holidays', async (req, res) => {
    try {
      const branchId = resolveBranchId(req, req.query.branchId);
      const conditions = [];
      const params = [];
      // A branch-scoped viewer sees their branch's holidays plus every
      // institute-wide one (branchId IS NULL); super_admin with no branch
      // filter sees everything.
      if (branchId) {
        conditions.push('(branchId = ? OR branchId IS NULL)');
        params.push(branchId);
      }
      if (req.query.from) { conditions.push('date >= ?'); params.push(req.query.from); }
      if (req.query.to) { conditions.push('date <= ?'); params.push(req.query.to); }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const rows = await db.all(`SELECT * FROM holidays ${where} ORDER BY date ASC`, ...params);
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.post('/api/holidays', async (req, res) => {
    if (!req.user.roles.some((r) => ['admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const { date, title } = req.body || {};
      if (!date || !title) return res.status(400).json({ error: 'date and title are required' });
      // Only super_admin may declare an institute-wide (branchId NULL) holiday;
      // an admin's holiday is always pinned to their own branch.
      const branchId = req.user.roles.includes('super_admin')
        ? (req.body.branchId || null)
        : (req.user.branchId || null);
      const now = new Date().toISOString();
      const result = await db.run(
        `INSERT INTO holidays (date, title, branchId, createdBy, createdAt) VALUES (?, ?, ?, ?, ?)`,
        date, title, branchId, req.user.name || '', now
      );
      const row = await db.get('SELECT * FROM holidays WHERE id = ?', result.lastID);
      res.status(201).json(row);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.delete('/api/holidays/:id', async (req, res) => {
    if (!req.user.roles.some((r) => ['admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const existing = await db.get('SELECT * FROM holidays WHERE id = ?', req.params.id);
      if (!existing) return res.status(404).json({ error: 'not found' });
      if (!req.user.roles.includes('super_admin') && existing.branchId !== (req.user.branchId || null)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      await db.run('DELETE FROM holidays WHERE id = ?', req.params.id);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  // --- Student Leaves ---
  app.get('/api/student-leaves', async (req, res) => {
    if (!req.user.roles.some((r) => ['teacher', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const branchId = resolveBranchId(req, req.query.branchId);
      const conditions = [];
      const params = [];
      if (branchId) { conditions.push('branchId = ?'); params.push(branchId); }
      if (req.query.studentId) { conditions.push('studentId = ?'); params.push(req.query.studentId); }
      // Leaves active "on" a given date: the date falls within [startDate, endDate].
      if (req.query.date) { conditions.push('startDate <= ? AND endDate >= ?'); params.push(req.query.date, req.query.date); }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const rows = await db.all(`SELECT * FROM student_leaves ${where} ORDER BY startDate DESC`, ...params);
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.post('/api/student-leaves', async (req, res) => {
    if (!req.user.roles.some((r) => ['teacher', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const { studentId, studentName, startDate, endDate, reason } = req.body || {};
      if (!studentId || !startDate || !endDate) return res.status(400).json({ error: 'studentId, startDate and endDate are required' });
      if (startDate > endDate) return res.status(400).json({ error: 'startDate cannot be after endDate' });
      const branchId = resolveBranchId(req, req.body.branchId) || req.user.branchId || null;
      const now = new Date().toISOString();
      const result = await db.run(
        `INSERT INTO student_leaves (studentId, studentName, startDate, endDate, reason, branchId, createdBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        studentId, studentName || '', startDate, endDate, reason || '', branchId, req.user.name || '', now
      );
      const row = await db.get('SELECT * FROM student_leaves WHERE id = ?', result.lastID);
      res.status(201).json(row);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.delete('/api/student-leaves/:id', async (req, res) => {
    if (!req.user.roles.some((r) => ['teacher', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      await db.run('DELETE FROM student_leaves WHERE id = ?', req.params.id);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  // --- Study Materials Module Endpoints ---
  // Access is derived from the verified JWT (req.user.roles/sub), never from a
  // client-supplied role/teacherId param — a teacher can only ever see or fetch
  // their own uploads, with no exceptions, per the isolation requirement.
  async function materialAccessAllowed(req, material) {
    const roles = req.user.roles || [];
    if (roles.includes('super_admin')) return true;
    if (roles.includes('teacher') && material.teacherId === req.user.sub) return true;
    if ((roles.includes('admin') || roles.includes('accountant')) && material.branchId === (req.user.branchId || null)) return true;
    if (roles.includes('parent')) {
      if (material.branchId !== (req.user.branchId || null)) return false;
      // Derived server-side from the parent's own linked students, never from a
      // client-supplied classNames param — a parent could otherwise pass any
      // className and download materials outside their own children's classes.
      const row = await db.get(
        `SELECT 1 FROM parent_student ps JOIN students s ON s.id = ps.studentId
         WHERE ps.parentId = ? AND s.className = ? LIMIT 1`,
        req.user.sub, material.className
      );
      if (row) return true;
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
      if (!(await materialAccessAllowed(req, material))) return res.status(403).json({ error: 'Forbidden' });

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
      const notifId = newNotificationId();
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
      const notifId = newNotificationId();
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
      const notifId = newNotificationId();
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
      const notifId = newNotificationId();
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

  // Permanent removal — distinct from the DELETE route above, which only ever
  // soft-cancels (keeps history + notifies parents). Only allowed once a class
  // is already Cancelled, so this can't be used to skip that notification step.
  app.delete('/api/special-classes/:id/permanent', async (req, res) => {
    if (!req.user.roles.some((r) => ['teacher', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const { id } = req.params;
      const cls = await db.get('SELECT * FROM special_classes WHERE id = ?', id);
      if (!cls) return res.status(404).json({ error: 'Class not found' });
      if (cls.status !== 'Cancelled') return res.status(400).json({ error: 'Only cancelled classes can be permanently deleted' });

      if (cls.attachmentPath && fs.existsSync(cls.attachmentPath)) {
        try { fs.unlinkSync(cls.attachmentPath); } catch (e) {}
      }
      await db.run('DELETE FROM bonus_attendance WHERE specialClassId = ?', id);
      await db.run('DELETE FROM special_classes WHERE id = ?', id);

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
      let query = 'SELECT * FROM ledger_transactions WHERE deletedAt IS NULL';
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
      const { date, type, category, description, amount, paymentMode, referenceNumber, enteredBy, vendorName, notes } = req.body;
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
        INSERT INTO ledger_transactions (voucherNumber, date, type, category, description, amount, paymentMode, referenceNumber, enteredBy, branchId, vendorName, notes, attachmentPath, attachmentName, attachmentSize)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const result = await stmt.run(
        voucherNumber, date, type, category, description, Number(amount), paymentMode, referenceNumber || '', enteredBy || '', branchId,
        vendorName || '', notes || '',
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

  const LEDGER_ATTACHMENT_MIME_ALLOWLIST = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];

  function deleteUploadedFileIfAny(file) {
    if (!file) return;
    try { fs.unlinkSync(file.path); } catch (e) { /* best-effort cleanup */ }
  }

  function deleteLedgerAttachmentFile(attachmentPath) {
    if (!attachmentPath) return;
    try {
      const filePath = path.join(process.cwd(), 'server', attachmentPath);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (e) { console.error('Failed to delete ledger attachment file:', e); }
  }

  // Accounting-grade edit: enforces branch ownership (super_admin: any branch;
  // admin/accountant: only their own), validates every field, supports
  // keep/replace/remove for the attachment in one atomic save, guards against
  // a stale-data overwrite via expectedUpdatedAt, and always appends an
  // immutable audit_log row capturing the full before/after snapshot. Never
  // deletes or truncates anything — this only ever UPDATEs the one row named
  // by :id and INSERTs one audit row.
  app.put('/api/ledger/:id', upload.single('attachment'), async (req, res) => {
    const roles = req.user.roles || [];
    if (!roles.some((r) => ['accountant', 'admin', 'super_admin'].includes(r))) {
      deleteUploadedFileIfAny(req.file);
      return res.status(403).json({ error: 'Forbidden' });
    }
    try {
      const existing = await db.get('SELECT * FROM ledger_transactions WHERE id = ?', req.params.id);
      if (!existing || existing.deletedAt) {
        deleteUploadedFileIfAny(req.file);
        return res.status(404).json({ error: 'Transaction not found' });
      }

      const isSuperAdmin = roles.includes('super_admin');
      if (!isSuperAdmin && existing.branchId !== (req.user.branchId || null)) {
        deleteUploadedFileIfAny(req.file);
        return res.status(403).json({ error: 'You can only edit records belonging to your own branch.' });
      }

      const { date, type, category, description, amount, paymentMode, referenceNumber, vendorName, notes, removeAttachment, expectedUpdatedAt } = req.body;

      if (!date || !type || !category || !description || !amount || !paymentMode) {
        deleteUploadedFileIfAny(req.file);
        return res.status(400).json({ error: 'Date, type, category, description, amount, and paymentMode are required.' });
      }
      if (!['Income', 'Expense'].includes(type)) {
        deleteUploadedFileIfAny(req.file);
        return res.status(400).json({ error: 'Type must be Income or Expense.' });
      }
      if (isNaN(Number(amount)) || Number(amount) <= 0) {
        deleteUploadedFileIfAny(req.file);
        return res.status(400).json({ error: 'Amount must be a positive number.' });
      }
      if (isNaN(new Date(date).getTime())) {
        deleteUploadedFileIfAny(req.file);
        return res.status(400).json({ error: 'Date is invalid.' });
      }
      if (req.file && !LEDGER_ATTACHMENT_MIME_ALLOWLIST.includes(req.file.mimetype)) {
        deleteUploadedFileIfAny(req.file);
        return res.status(400).json({ error: 'Attachment must be a PDF, JPG, JPEG, or PNG file.' });
      }

      // Optimistic concurrency: if the client fetched the record before
      // someone else already saved a change, reject rather than silently
      // overwriting their edit.
      if (expectedUpdatedAt && existing.updatedAt && expectedUpdatedAt !== existing.updatedAt) {
        deleteUploadedFileIfAny(req.file);
        return res.status(409).json({ error: 'This record was modified by someone else since you opened it. Please refresh and try again.' });
      }

      // Only super_admin may move a record to a different branch; admin/
      // accountant edits always keep the record's existing branch, and any
      // branchId they send is ignored rather than trusted.
      let targetBranchId = existing.branchId;
      if (isSuperAdmin && req.body.branchId && req.body.branchId !== existing.branchId) {
        const branchRow = await db.get('SELECT id FROM branches WHERE id = ?', req.body.branchId);
        if (!branchRow) {
          deleteUploadedFileIfAny(req.file);
          return res.status(400).json({ error: 'Selected branch does not exist.' });
        }
        targetBranchId = req.body.branchId;
      }

      const file = req.file;
      const shouldRemoveAttachment = !file && (removeAttachment === 'true' || removeAttachment === true);

      let attachmentPath = existing.attachmentPath;
      let attachmentName = existing.attachmentName;
      let attachmentSize = existing.attachmentSize;

      if (file) {
        deleteLedgerAttachmentFile(existing.attachmentPath);
        attachmentPath = `/uploads/${file.filename}`;
        attachmentName = file.originalname;
        attachmentSize = file.size;
      } else if (shouldRemoveAttachment) {
        deleteLedgerAttachmentFile(existing.attachmentPath);
        attachmentPath = null;
        attachmentName = null;
        attachmentSize = null;
      }

      const now = new Date().toISOString();
      await db.run(
        `UPDATE ledger_transactions SET date=?, type=?, category=?, description=?, amount=?, paymentMode=?, referenceNumber=?, vendorName=?, notes=?, branchId=?, attachmentPath=?, attachmentName=?, attachmentSize=?, updatedAt=?, updatedBy=? WHERE id=?`,
        date, type, category, description, Number(amount), paymentMode, referenceNumber || '',
        vendorName || '', notes || '', targetBranchId,
        attachmentPath, attachmentName, attachmentSize,
        now, req.user.name || 'Unknown',
        req.params.id
      );

      const saved = await db.get('SELECT * FROM ledger_transactions WHERE id = ?', req.params.id);

      await db.run(
        `INSERT INTO ledger_audit_log (ledgerId, editedByUserId, editedByName, editedByRole, branchId, editedAt, previousValues, updatedValues) VALUES (?,?,?,?,?,?,?,?)`,
        Number(req.params.id), req.user.sub, req.user.name || 'Unknown', roles[0] || '', targetBranchId, now,
        JSON.stringify(existing), JSON.stringify(saved)
      );

      res.json(saved);
    } catch (err) {
      console.error(err);
      deleteUploadedFileIfAny(req.file);
      res.status(500).json({ error: 'failed' });
    }
  });

  // Soft-delete a ledger record (income or expense). Same auth/branch rules
  // as the edit endpoint above. Never physically removes the row — every
  // read (GET /api/ledger, dashboard, reports) already filters on
  // deletedAt IS NULL, so a deleted voucher disappears from all totals
  // immediately while the row and its full history stay in the database.
  app.delete('/api/ledger/:id', async (req, res) => {
    const roles = req.user.roles || [];
    if (!roles.some((r) => ['accountant', 'admin', 'super_admin'].includes(r))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    try {
      const existing = await db.get('SELECT * FROM ledger_transactions WHERE id = ?', req.params.id);
      if (!existing || existing.deletedAt) {
        return res.status(404).json({ error: 'Transaction not found' });
      }

      const isSuperAdmin = roles.includes('super_admin');
      if (!isSuperAdmin && existing.branchId !== (req.user.branchId || null)) {
        return res.status(403).json({ error: 'You can only delete records belonging to your own branch.' });
      }

      const now = new Date().toISOString();
      await db.run(
        'UPDATE ledger_transactions SET deletedAt=?, deletedBy=? WHERE id=?',
        now, req.user.name || 'Unknown', req.params.id
      );

      await db.run(
        `INSERT INTO ledger_audit_log (ledgerId, editedByUserId, editedByName, editedByRole, branchId, editedAt, previousValues, updatedValues, action) VALUES (?,?,?,?,?,?,?,?,?)`,
        Number(req.params.id), req.user.sub, req.user.name || 'Unknown', roles[0] || '', existing.branchId, now,
        JSON.stringify(existing), null, 'DELETE'
      );

      res.json({ success: true, id: Number(req.params.id) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  // Staff-only audit trail for one ledger record — branch-scoped the same way
  // as the edit endpoint above (admin/accountant limited to their own branch).
  app.get('/api/ledger/:id/audit-log', async (req, res) => {
    const roles = req.user.roles || [];
    if (!roles.some((r) => ['accountant', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const existing = await db.get('SELECT branchId FROM ledger_transactions WHERE id = ?', req.params.id);
      if (!existing) return res.status(404).json({ error: 'Transaction not found' });
      if (!roles.includes('super_admin') && existing.branchId !== (req.user.branchId || null)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const rows = await db.all('SELECT * FROM ledger_audit_log WHERE ledgerId = ? ORDER BY editedAt DESC', req.params.id);
      const mapped = rows.map((r) => ({
        ...r,
        previousValues: (() => { try { return JSON.parse(r.previousValues); } catch { return null; } })(),
        updatedValues: (() => { try { return JSON.parse(r.updatedValues); } catch { return null; } })(),
      }));
      res.json(mapped);
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

  // --- Branch Endpoints ---

  app.get('/api/branches', async (req, res) => {
    try {
      const rows = await db.all('SELECT * FROM branches ORDER BY createdAt ASC');
      res.json(rows);
    } catch (error) { console.error('List branches error:', error); res.status(500).json({ error: 'Failed to load branches' }); }
  });
  app.post('/api/branches', async (req, res) => {
    if (!req.user.roles.includes('super_admin')) return res.status(403).json({ error: 'Forbidden' });
    try {
      const { name, code, address, city, state, pincode, contactNumber, email, branchHead, openingDate, status } = req.body;
      if (!name || !code) return res.status(400).json({ error: 'Branch name and code are required' });
      const id = `branch_${Date.now()}`;
      const now = new Date().toISOString();
      await db.run(
        `INSERT INTO branches (id, name, code, address, city, state, pincode, contactNumber, email, branchHead, openingDate, status, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, name, code, address || '', city || '', state || '', pincode || '', contactNumber || '', email || '', branchHead || '', openingDate || '', status || 'Active', now, now
      );
      const branch = await db.get('SELECT * FROM branches WHERE id = ?', id);
      res.json(branch);
    } catch (error) { console.error('Create branch error:', error); res.status(500).json({ error: 'Failed to create branch' }); }
  });
  app.put('/api/branches/:id', async (req, res) => {
    if (!req.user.roles.includes('super_admin')) return res.status(403).json({ error: 'Forbidden' });
    try {
      const existing = await db.get('SELECT * FROM branches WHERE id = ?', req.params.id);
      if (!existing) return res.status(404).json({ error: 'Branch not found' });
      const { name, code, address, city, state, pincode, contactNumber, email, branchHead, openingDate, status } = req.body;
      await db.run(
        `UPDATE branches SET name=?, code=?, address=?, city=?, state=?, pincode=?, contactNumber=?, email=?, branchHead=?, openingDate=?, status=?, updatedAt=? WHERE id=?`,
        name ?? existing.name, code ?? existing.code, address ?? existing.address, city ?? existing.city, state ?? existing.state,
        pincode ?? existing.pincode, contactNumber ?? existing.contactNumber, email ?? existing.email, branchHead ?? existing.branchHead,
        openingDate ?? existing.openingDate, status ?? existing.status, new Date().toISOString(), req.params.id
      );
      const branch = await db.get('SELECT * FROM branches WHERE id = ?', req.params.id);
      res.json(branch);
    } catch (error) { console.error('Update branch error:', error); res.status(500).json({ error: 'Failed to update branch' }); }
  });
  app.delete('/api/branches/:id', async (req, res) => {
    if (!req.user.roles.includes('super_admin')) return res.status(403).json({ error: 'Forbidden' });
    if (req.params.id === 'branch_main') return res.status(400).json({ error: 'The Main branch cannot be deleted' });
    try {
      // Users keep a plain branchId FK with no cascade — deleting a branch that
      // still has staff/students on it silently orphans their branchId, which
      // then never matches any branch-filter dropdown (those only list rows
      // still in this table). They stop appearing in filtered views without
      // any error, which is exactly how one such orphaned admin account went
      // undetected. Block the delete instead of letting that happen again.
      const { userCount } = await db.get('SELECT COUNT(*) as userCount FROM users WHERE branchId = ?', req.params.id);
      const { studentCount } = await db.get('SELECT COUNT(*) as studentCount FROM students WHERE branchId = ?', req.params.id);
      if (userCount > 0 || studentCount > 0) {
        return res.status(400).json({ error: `Cannot delete: ${userCount} user(s) and ${studentCount} student(s) are still assigned to this branch. Reassign them first.` });
      }
      await db.run('DELETE FROM branches WHERE id = ?', req.params.id);
      res.json({ success: true });
    } catch (error) { console.error('Delete branch error:', error); res.status(500).json({ error: 'Failed to delete branch' }); }
  });

  // --- Daily Teacher Submission Endpoints ---

  app.get('/api/daily-submissions', async (req, res) => {
    if (!req.user.roles.some((r) => ['teacher', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const branchId = resolveBranchId(req, req.query.branchId);
      const rows = branchId
        ? await db.all('SELECT * FROM daily_submissions WHERE branchId = ? ORDER BY createdAt DESC', branchId)
        : await db.all('SELECT * FROM daily_submissions ORDER BY createdAt DESC');
      res.json(rows);
    } catch (error) { console.error('List daily submissions error:', error); res.status(500).json({ error: 'Failed to load daily submissions' }); }
  });
  app.post('/api/daily-submissions', async (req, res) => {
    if (!req.user.roles.some((r) => ['teacher', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const { date, className, subject, topic, homework, attendanceStatus, notes } = req.body;
      if (!date || !className) return res.status(400).json({ error: 'Date and class are required' });
      const id = `SUB${Date.now()}`;
      const now = new Date().toISOString();
      const branchId = resolveBranchId(req, req.body.branchId);
      await db.run(
        `INSERT INTO daily_submissions (id, date, className, subject, topic, homework, attendanceStatus, notes, teacherId, teacherName, branchId, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, date, className, subject || '', topic || '', homework || '', attendanceStatus || '', notes || '', req.user.sub, req.user.name, branchId || null, now
      );
      const submission = await db.get('SELECT * FROM daily_submissions WHERE id = ?', id);
      res.json(submission);
    } catch (error) { console.error('Create daily submission error:', error); res.status(500).json({ error: 'Failed to save daily submission' }); }
  });

  // --- Exam Attendance Endpoints ---

  app.get('/api/exam-attendance', async (req, res) => {
    if (!req.user.roles.some((r) => ['teacher', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const branchId = resolveBranchId(req, req.query.branchId);
      const conditions = [];
      const params = [];
      if (req.query.examId) { conditions.push('ea.examId = ?'); params.push(req.query.examId); }
      if (branchId) { conditions.push('ea.branchId = ?'); params.push(branchId); }

      // Same batch-assignment scoping as GET /api/students — plus a Primary
      // Exam (no batch) a teacher-only account personally created, via the
      // owning exam's createdBy.
      let fromClause = 'exam_attendance ea';
      const teacherClassNames = await getTeacherAssignedClassNames(req);
      if (teacherClassNames) {
        fromClause += ' JOIN exams e ON e.id = ea.examId';
        if (teacherClassNames.length > 0) {
          conditions.push(`(ea.className IN (${teacherClassNames.map(() => '?').join(',')}) OR e.createdBy = ?)`);
          params.push(...teacherClassNames, req.user.sub);
        } else {
          conditions.push('e.createdBy = ?');
          params.push(req.user.sub);
        }
      }

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const rows = await db.all(`SELECT ea.* FROM ${fromClause} ${where} ORDER BY ea.createdAt ASC`, ...params);
      res.json(rows.map((row) => ({ ...row, isLocked: Boolean(row.isLocked) })));
    } catch (error) { console.error('List exam attendance error:', error); res.status(500).json({ error: 'Failed to load exam attendance' }); }
  });
  app.post('/api/exam-attendance/bulk', async (req, res) => {
    if (!req.user.roles.some((r) => ['teacher', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const submissions = Array.isArray(req.body?.submissions) ? req.body.submissions : [];
      if (!submissions.length) return res.status(400).json({ error: 'No attendance records provided' });

      // A teacher-only account may only submit exam attendance for a batch
      // actually assigned to them — or, for a Primary Exam (no batch at all),
      // one they personally created. Checked against every record in the
      // batch up front, same all-or-nothing behaviour as the lock check below.
      const teacherClassNames = await getTeacherAssignedClassNames(req);
      if (teacherClassNames) {
        const examIds = [...new Set(submissions.map((s) => String(s.examId)))];
        const exams = await db.all(`SELECT id, className, createdBy FROM exams WHERE id IN (${examIds.map(() => '?').join(',')})`, ...examIds);
        const examById = new Map(exams.map((e) => [String(e.id), e]));
        const disallowed = submissions.some((s) => {
          const exam = examById.get(String(s.examId));
          return !exam || (!teacherClassNames.includes(s.className) && exam.createdBy !== req.user.sub);
        });
        if (disallowed) return res.status(403).json({ error: 'You can only record exam attendance for a batch assigned to you.' });
      }

      // Reject the whole batch up front if any targeted record is already locked —
      // matches the original all-or-nothing behaviour of the in-memory version.
      for (const submission of submissions) {
        const existing = await db.get('SELECT isLocked FROM exam_attendance WHERE examId = ? AND studentId = ?', submission.examId, submission.studentId);
        if (existing?.isLocked) return res.status(400).json({ error: 'Attendance for this exam has been finalized.' });
      }

      const now = new Date().toISOString();
      const saved = [];
      for (const submission of submissions) {
        const id = `EAT${Date.now()}${Math.floor(Math.random() * 1000)}`;
        await db.run(
          `INSERT INTO exam_attendance (id, examId, studentId, studentName, rollNumber, admissionNumber, className, branchId, branchName, status, date, time, teacherId, teacherName, subjectId, subjectName, classId, recordedBy, isLocked, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
           ON CONFLICT(examId, studentId) DO UPDATE SET
             studentName=excluded.studentName, rollNumber=excluded.rollNumber, admissionNumber=excluded.admissionNumber,
             className=excluded.className, branchId=excluded.branchId, branchName=excluded.branchName, status=excluded.status,
             date=excluded.date, time=excluded.time, teacherId=excluded.teacherId, teacherName=excluded.teacherName,
             subjectId=excluded.subjectId, subjectName=excluded.subjectName, classId=excluded.classId, recordedBy=excluded.recordedBy,
             updatedAt=excluded.updatedAt`,
          id, submission.examId, submission.studentId, submission.studentName, submission.rollNumber, submission.admissionNumber,
          submission.className, submission.branchId, submission.branchName, submission.status, submission.date, submission.time,
          submission.teacherId, submission.teacherName, submission.subjectId, submission.subjectName, submission.classId,
          submission.recordedBy, now, now
        );
        const row = await db.get('SELECT * FROM exam_attendance WHERE examId = ? AND studentId = ?', submission.examId, submission.studentId);
        saved.push({ ...row, isLocked: Boolean(row.isLocked) });
      }
      res.json(saved);
    } catch (error) { console.error('Submit exam attendance error:', error); res.status(500).json({ error: 'Failed to save exam attendance' }); }
  });
  app.patch('/api/exam-attendance/lock', async (req, res) => {
    if (!req.user.roles.some((r) => ['teacher', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const { examId, locked } = req.body;
      if (!examId) return res.status(400).json({ error: 'examId is required' });
      const now = new Date().toISOString();
      await db.run(
        'UPDATE exam_attendance SET isLocked=?, lockedBy=?, lockedAt=?, updatedAt=? WHERE examId=?',
        locked ? 1 : 0, locked ? req.user.name : null, locked ? now : null, now, examId
      );
      const rows = await db.all('SELECT * FROM exam_attendance WHERE examId = ?', examId);
      res.json(rows.map((row) => ({ ...row, isLocked: Boolean(row.isLocked) })));
    } catch (error) { console.error('Lock exam attendance error:', error); res.status(500).json({ error: 'Failed to update exam attendance lock' }); }
  });

  // --- Classes Endpoints ---
  // "classes" rows are batch records (requirement: batch-based class management).
  // className now doubles as the free-text batch name for newly-created rows;
  // historical standards-based rows ("10th" etc.) are untouched and keep working
  // since nothing validates className against a fixed list.

  // Teacher must belong to the batch's branch and hold the 'teacher' role.
  // branchId may be null/undefined (super_admin creating a branch-less batch),
  // in which case only the role is checked.
  async function validateTeacherAssignment(teacherId, branchId) {
    const teacher = await db.get('SELECT id, roles, branchId FROM users WHERE id = ? AND status = ?', teacherId, 'Active');
    if (!teacher) return 'Assigned teacher not found.';
    const roles = parseJsonList(teacher.roles);
    if (!roles.includes('teacher')) return 'Assigned user is not a teacher.';
    if (branchId && teacher.branchId !== branchId) return 'Assigned teacher does not belong to the selected branch.';
    return null;
  }

  app.get('/api/classes', async (req, res) => {
    try {
      const branchId = resolveBranchId(req, req.query.branchId);
      const includeArchived = String(req.query.includeArchived || '') === 'true';
      const clauses = [];
      const params = [];
      if (branchId) { clauses.push('branchId = ?'); params.push(branchId); }
      if (!includeArchived) { clauses.push("status != 'Archived'"); }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const rows = await db.all(`SELECT * FROM classes ${where} ORDER BY createdAt DESC`, ...params);
      res.json(rows.map((row) => ({ ...row, daysOfWeek: JSON.parse(row.daysOfWeek || '[]') })));
    } catch (error) { console.error('List classes error:', error); res.status(500).json({ error: 'Failed to load classes' }); }
  });
  app.post('/api/classes', async (req, res) => {
    if (!req.user.roles.some((r) => ['admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const { className, batchName, course, subject, assignedTeacherId, board, description, roomNumber, maxStudents, startDate, endDate, classTiming, daysOfWeek, status } = req.body;
      if (!className || !String(className).trim()) return res.status(400).json({ error: 'Class name is required.' });
      if (!assignedTeacherId) return res.status(400).json({ error: 'Assigned teacher is required.' });
      const branchId = resolveBranchId(req, req.body.branchId);
      const teacherError = await validateTeacherAssignment(assignedTeacherId, branchId);
      if (teacherError) return res.status(400).json({ error: teacherError });
      const id = `CLS${Date.now()}`;
      const now = new Date().toISOString();
      await db.run(
        `INSERT INTO classes (id, className, batchName, course, subject, assignedTeacherId, branchId, roomNumber, maxStudents, startDate, endDate, classTiming, daysOfWeek, status, createdAt, board, description, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, String(className).trim(), batchName || '', course || '', subject || '', assignedTeacherId, branchId || null,
        roomNumber || '', Number(maxStudents || 0), startDate || '', endDate || '', classTiming || '', JSON.stringify(daysOfWeek || []),
        status || 'Active', now, board || '', description || '', now
      );
      const row = await db.get('SELECT * FROM classes WHERE id = ?', id);
      res.json({ ...row, daysOfWeek: JSON.parse(row.daysOfWeek || '[]') });
    } catch (error) { console.error('Create class error:', error); res.status(500).json({ error: 'Failed to create class' }); }
  });
  app.put('/api/classes/:id', async (req, res) => {
    if (!req.user.roles.some((r) => ['admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const existing = await db.get('SELECT * FROM classes WHERE id = ?', req.params.id);
      if (!existing) return res.status(404).json({ error: 'Class not found.' });
      const isSuperAdmin = req.user.roles.includes('super_admin');
      if (!isSuperAdmin && existing.branchId !== req.user.branchId) return res.status(404).json({ error: 'Class not found.' });

      const { className, batchName, course, subject, assignedTeacherId, board, description, roomNumber, maxStudents, startDate, endDate, classTiming, daysOfWeek, status, branchId: requestedBranchId } = req.body;
      if (className !== undefined && !String(className).trim()) return res.status(400).json({ error: 'Class name is required.' });

      // Only super_admin may move a batch to a different branch; admins are
      // confined to their own branch (mirrors resolveBranchId's rule elsewhere).
      const nextBranchId = isSuperAdmin && requestedBranchId !== undefined ? (requestedBranchId || null) : existing.branchId;
      const nextTeacherId = assignedTeacherId !== undefined ? assignedTeacherId : existing.assignedTeacherId;
      if (!nextTeacherId) return res.status(400).json({ error: 'Assigned teacher is required.' });
      if (assignedTeacherId !== undefined || nextBranchId !== existing.branchId) {
        const teacherError = await validateTeacherAssignment(nextTeacherId, nextBranchId);
        if (teacherError) return res.status(400).json({ error: teacherError });
      }

      const now = new Date().toISOString();
      await db.run(
        `UPDATE classes SET className=?, batchName=?, course=?, subject=?, assignedTeacherId=?, branchId=?, roomNumber=?, maxStudents=?, startDate=?, endDate=?, classTiming=?, daysOfWeek=?, status=?, board=?, description=?, updatedAt=? WHERE id=?`,
        className !== undefined ? String(className).trim() : existing.className,
        batchName !== undefined ? batchName : existing.batchName,
        course !== undefined ? course : existing.course,
        subject !== undefined ? subject : existing.subject,
        nextTeacherId,
        nextBranchId,
        roomNumber !== undefined ? roomNumber : existing.roomNumber,
        maxStudents !== undefined ? Number(maxStudents || 0) : existing.maxStudents,
        startDate !== undefined ? startDate : existing.startDate,
        endDate !== undefined ? endDate : existing.endDate,
        classTiming !== undefined ? classTiming : existing.classTiming,
        daysOfWeek !== undefined ? JSON.stringify(daysOfWeek || []) : existing.daysOfWeek,
        status !== undefined ? status : existing.status,
        board !== undefined ? board : existing.board,
        description !== undefined ? description : existing.description,
        now,
        req.params.id
      );
      const row = await db.get('SELECT * FROM classes WHERE id = ?', req.params.id);
      res.json({ ...row, daysOfWeek: JSON.parse(row.daysOfWeek || '[]') });
    } catch (error) { console.error('Update class error:', error); res.status(500).json({ error: 'Failed to update class' }); }
  });
  app.delete('/api/classes/:id', async (req, res) => {
    if (!req.user.roles.some((r) => ['admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const existing = await db.get('SELECT * FROM classes WHERE id = ?', req.params.id);
      if (!existing) return res.status(404).json({ error: 'Class not found.' });
      const isSuperAdmin = req.user.roles.includes('super_admin');
      if (!isSuperAdmin && existing.branchId !== req.user.branchId) return res.status(404).json({ error: 'Class not found.' });
      // Soft delete only: the batch's own metadata and every student/attendance/
      // timetable row that references it by className string are preserved.
      // Archived batches are simply excluded from GET /api/classes by default
      // (fetch with ?includeArchived=true to see them for history/reporting).
      const now = new Date().toISOString();
      await db.run("UPDATE classes SET status = 'Archived', updatedAt = ? WHERE id = ?", now, req.params.id);
      res.json({ success: true });
    } catch (error) { console.error('Delete class error:', error); res.status(500).json({ error: 'Failed to delete class' }); }
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
      const includeInactive = String(req.query.includeInactive || '') === 'true';
      const clauses = [];
      const params = [];
      if (branchId) { clauses.push('branchId = ?'); params.push(branchId); }
      if (!includeInactive) { clauses.push("status != 'Inactive'"); }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const rows = await db.all(`SELECT * FROM inventory_items ${where}`, ...params);
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
        const notifId = newNotificationId();
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
      const notifId = newNotificationId();
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


  // --- Teacher Attendance Endpoints ---
  app.get('/api/teacher-attendance', async (req, res) => {
    try {
      const { date, month, teacherId } = req.query;
      const branchId = resolveBranchId(req, req.query.branchId);
      let query = 'SELECT * FROM teacher_attendance WHERE 1=1';
      const params = [];
      if (branchId) { query += ' AND branchId = ?'; params.push(branchId); }
      if (date) { query += ' AND date = ?'; params.push(date); }
      if (month) { query += ' AND date LIKE ?'; params.push(`${month}%`); }
      if (teacherId) { query += ' AND teacherId = ?'; params.push(teacherId); }
      query += ' ORDER BY date DESC';
      const rows = await db.all(query, ...params);
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  // Marking teacher attendance is an Admin/Super Admin action — accountants and
  // teachers get read-only access via the GET route above.
  app.post('/api/teacher-attendance/bulk', async (req, res) => {
    if (!req.user.roles.some((r) => ['admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
      if (!entries.length) return res.status(400).json({ error: 'entries array is required' });

      const now = new Date().toISOString();
      const stmt = await db.prepare(`
        INSERT INTO teacher_attendance (teacherId, date, status, branchId, department, markedBy, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(teacherId, date) DO UPDATE SET status=excluded.status, markedBy=excluded.markedBy, updatedAt=excluded.updatedAt
      `);
      for (const entry of entries) {
        const branchId = resolveBranchId(req, entry.branchId);
        await stmt.run(entry.teacherId, entry.date, entry.status, branchId, entry.department || null, req.user.name || 'Admin', now, now);
      }
      await stmt.finalize();

      const date = entries[0].date;
      const branchId = resolveBranchId(req, entries[0].branchId);
      let query = 'SELECT * FROM teacher_attendance WHERE date = ?';
      const params = [date];
      if (branchId) { query += ' AND branchId = ?'; params.push(branchId); }
      const rows = await db.all(query, ...params);
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  // --- Salary / Payroll Endpoints ---
  app.get('/api/salary-records', async (req, res) => {
    try {
      const { month, teacherId, status } = req.query;
      const branchId = resolveBranchId(req, req.query.branchId);
      let query = 'SELECT * FROM salary_records WHERE 1=1';
      const params = [];
      if (branchId) { query += ' AND branchId = ?'; params.push(branchId); }
      if (month) { query += ' AND month = ?'; params.push(month); }
      if (teacherId) { query += ' AND teacherId = ?'; params.push(teacherId); }
      if (status) { query += ' AND status = ?'; params.push(status); }
      query += ' ORDER BY month DESC, teacherName ASC';
      const rows = await db.all(query, ...params);
      res.json(rows.map((r) => ({ ...r, isLocked: !!r.isLocked })));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.get('/api/salary-audit-log', async (req, res) => {
    try {
      const { teacherId, month } = req.query;
      let query = 'SELECT * FROM salary_audit_log WHERE 1=1';
      const params = [];
      if (teacherId) { query += ' AND teacherId = ?'; params.push(teacherId); }
      if (month) { query += ' AND month = ?'; params.push(month); }
      query += ' ORDER BY timestamp DESC';
      const rows = await db.all(query, ...params);
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  async function writeSalaryAuditLog({ teacherId, teacherName, month, action, previousValue, newValue, changedBy, userRole, branchId }) {
    await db.run(
      `INSERT INTO salary_audit_log (teacherId, teacherName, month, action, previousValue, newValue, changedBy, userRole, branchId, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      teacherId, teacherName, month, action, previousValue ?? null, newValue ?? null, changedBy, userRole, branchId || null, new Date().toISOString()
    );
  }

  // Creates or updates a Draft salary record — used by both the Teacher Attendance
  // page (saving classes/salary-per-class) and the Accountant Portal (Create Draft).
  app.post('/api/salary-records', async (req, res) => {
    if (!req.user.roles.some((r) => ['admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const b = req.body || {};
      if (!b.teacherId || !b.month) return res.status(400).json({ error: 'teacherId and month are required' });
      const branchId = resolveBranchId(req, b.branchId);

      const existing = await db.get('SELECT * FROM salary_records WHERE teacherId = ? AND month = ?', b.teacherId, b.month);
      if (existing && existing.isLocked) return res.status(409).json({ error: 'Salary is locked for this teacher and month.' });

      const now = new Date().toISOString();
      const calculatedSalary = b.salaryType === 'Monthly Fixed'
        ? Number(b.salaryAmount || 0)
        : Number(b.classesConducted || 0) * Number(b.salaryPerClass || 0);

      await db.run(
        `INSERT INTO salary_records (teacherId, teacherName, employeeId, branchId, department, designation, month, salaryType, salaryAmount, salaryPerClass, classesConducted, presentDays, halfDays, calculatedSalary, status, remarks, isLocked, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Draft', ?, 0, ?, ?)
         ON CONFLICT(teacherId, month) DO UPDATE SET
           teacherName=excluded.teacherName, employeeId=excluded.employeeId, branchId=excluded.branchId,
           department=excluded.department, designation=excluded.designation, salaryType=excluded.salaryType,
           salaryAmount=excluded.salaryAmount, salaryPerClass=excluded.salaryPerClass, classesConducted=excluded.classesConducted,
           presentDays=excluded.presentDays, halfDays=excluded.halfDays, calculatedSalary=excluded.calculatedSalary,
           remarks=excluded.remarks, updatedAt=excluded.updatedAt`,
        b.teacherId, b.teacherName || '', b.employeeId || b.teacherId, branchId, b.department || null, b.designation || null,
        b.month, b.salaryType || null, Number(b.salaryAmount || 0), Number(b.salaryPerClass || 0), Number(b.classesConducted || 0),
        Number(b.presentDays || 0), Number(b.halfDays || 0), calculatedSalary, b.remarks || '', now, now
      );

      const saved = await db.get('SELECT * FROM salary_records WHERE teacherId = ? AND month = ?', b.teacherId, b.month);

      await writeSalaryAuditLog({
        teacherId: b.teacherId, teacherName: b.teacherName, month: b.month,
        action: existing ? 'Updated' : 'Created',
        previousValue: existing?.calculatedSalary, newValue: calculatedSalary,
        changedBy: req.user.name, userRole: req.user.roles[0], branchId,
      });

      res.json({ ...saved, isLocked: !!saved.isLocked });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  app.post('/api/salary-records/:id/mark-paid', async (req, res) => {
    if (!req.user.roles.some((r) => ['accountant', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const record = await db.get('SELECT * FROM salary_records WHERE id = ?', req.params.id);
      if (!record) return res.status(404).json({ error: 'Salary record not found' });
      if (record.status === 'Paid') return res.status(409).json({ error: 'Salary already marked as paid.' });

      const now = new Date().toISOString();
      await db.run(
        `UPDATE salary_records SET status = 'Paid', paidDate = ?, paidBy = ?, isLocked = 1, lockedDate = ?, lockedBy = ?, updatedAt = ? WHERE id = ?`,
        now, req.user.name, now, req.user.name, now, req.params.id
      );
      const updated = await db.get('SELECT * FROM salary_records WHERE id = ?', req.params.id);

      await writeSalaryAuditLog({
        teacherId: record.teacherId, teacherName: record.teacherName, month: record.month,
        action: 'Marked_Paid', newValue: record.calculatedSalary,
        changedBy: req.user.name, userRole: req.user.roles[0], branchId: record.branchId,
      });

      res.json({ ...updated, isLocked: !!updated.isLocked });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed' });
    }
  });

  // Unlocking a paid/locked salary record is Super Admin only — it reverses a
  // payroll decision that accountants shouldn't be able to undo unilaterally.
  app.post('/api/salary-records/:id/unlock', async (req, res) => {
    if (!req.user.roles.includes('super_admin')) return res.status(403).json({ error: 'Forbidden' });
    try {
      const record = await db.get('SELECT * FROM salary_records WHERE id = ?', req.params.id);
      if (!record) return res.status(404).json({ error: 'Salary record not found' });

      const now = new Date().toISOString();
      const nextStatus = record.status === 'Paid' ? 'Draft' : record.status;
      await db.run(
        `UPDATE salary_records SET isLocked = 0, status = ?, updatedAt = ? WHERE id = ?`,
        nextStatus, now, req.params.id
      );
      const updated = await db.get('SELECT * FROM salary_records WHERE id = ?', req.params.id);

      await writeSalaryAuditLog({
        teacherId: record.teacherId, teacherName: record.teacherName, month: record.month,
        action: 'Unlocked', changedBy: req.user.name, userRole: req.user.roles[0], branchId: record.branchId,
      });

      res.json({ ...updated, isLocked: !!updated.isLocked });
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

  // originalAmount/discountPercent are the two values staff actually enter;
  // discountAmount and the Final Amount (still called totalAmount/amount/
  // newAmount everywhere downstream) are always derived server-side so a
  // tampered or stale client-computed number can never land in the DB.
  function computeDiscount(originalAmount, discountPercent) {
    const original = Number(originalAmount) || 0;
    const percent = Math.max(0, Math.min(100, Number(discountPercent) || 0));
    const discountAmount = Math.round((original * percent) / 100 * 100) / 100;
    const finalAmount = Math.round((original - discountAmount) * 100) / 100;
    return { originalAmount: original, discountPercent: percent, discountAmount, finalAmount };
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
      // originalAmount is the field the form now collects; `amount` is still
      // accepted as a fallback so nothing else calling this endpoint breaks.
      const originalAmountInput = body.originalAmount !== undefined ? body.originalAmount : body.amount;
      if (!body.className || !body.feeType || originalAmountInput === undefined) {
        return res.status(400).json({ error: 'className, feeType and originalAmount are required' });
      }
      const { originalAmount, discountPercent, discountAmount, finalAmount } = computeDiscount(originalAmountInput, body.discountPercent);
      const branchId = resolveBranchId(req, body.branchId) || req.user.branchId || null;
      const now = new Date().toISOString();
      const result = await db.run(`
        INSERT INTO fee_structures (className, branchId, academicYear, feeType, amount, dueDate, createdAt, updatedAt, originalAmount, discountPercent, discountAmount, category, startDate, endDate)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `, body.className, branchId, body.academicYear || '', body.feeType, finalAmount, body.dueDate || '', now, now,
         originalAmount, discountPercent, discountAmount, body.category || '', body.startDate || '', body.endDate || '');
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
      const originalAmountInput = body.originalAmount !== undefined ? body.originalAmount : (body.amount !== undefined ? body.amount : existing.originalAmount);
      const discountPercentInput = body.discountPercent !== undefined ? body.discountPercent : existing.discountPercent;
      const { originalAmount, discountPercent, discountAmount, finalAmount } = computeDiscount(originalAmountInput, discountPercentInput);
      const now = new Date().toISOString();
      await db.run(`
        UPDATE fee_structures SET className=?, academicYear=?, feeType=?, amount=?, dueDate=?, updatedAt=?,
          originalAmount=?, discountPercent=?, discountAmount=?, category=?, startDate=?, endDate=?
        WHERE id=?
      `, body.className ?? existing.className, body.academicYear ?? existing.academicYear, body.feeType ?? existing.feeType,
         finalAmount, body.dueDate ?? existing.dueDate, now,
         originalAmount, discountPercent, discountAmount, body.category ?? existing.category, body.startDate ?? existing.startDate, body.endDate ?? existing.endDate,
         req.params.id);
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

  // Creates a new Pending request, or — per the "don't create multiple active
  // requests for the same student" requirement — refreshes the one already
  // pending for this exact target (same feeRecordId when editing, same
  // studentId+feeType+month "new assignment" slot otherwise) instead of
  // inserting a second one. Returns the row either way.
  // Returns { request, isNew } — isNew tells the caller whether to notify
  // Super Admin. Editing an already-pending request must NOT fire another
  // notification each time (that would leave a trail of stale duplicate
  // cards, one per edit, all pointing at the same request); Super Admin
  // sees the current numbers regardless of how many times it was refined
  // before they act, since the Approve/Reject buttons always act on the
  // request's live current state, not on whatever the notification text said.
  async function upsertPendingFeeApprovalRequest(db, input) {
    const existing = input.feeRecordId
      ? await db.get(`SELECT * FROM fee_approval_requests WHERE feeRecordId = ? AND status = 'Pending'`, input.feeRecordId)
      : await db.get(
          `SELECT * FROM fee_approval_requests WHERE studentId = ? AND feeType = ? AND IFNULL(month,'') = IFNULL(?,'') AND feeRecordId IS NULL AND status = 'Pending'`,
          input.studentId, input.feeType, input.month || null
        );
    const now = new Date().toISOString();
    if (existing) {
      await db.run(
        `UPDATE fee_approval_requests SET newAmount=?, dueDate=?, requestedBy=?, requestedByName=?, requestedAt=?,
           originalAmount=?, discountPercent=?, discountAmount=?, category=?, startDate=?, endDate=? WHERE id=?`,
        input.newAmount, input.dueDate, input.requestedBy, input.requestedByName, now,
        input.originalAmount ?? input.newAmount, input.discountPercent ?? 0, input.discountAmount ?? 0,
        input.category || '', input.startDate || '', input.endDate || '', existing.id
      );
      return { request: await db.get('SELECT * FROM fee_approval_requests WHERE id = ?', existing.id), isNew: false };
    }
    const id = `FEEREQ-${crypto.randomUUID()}`;
    await db.run(
      `INSERT INTO fee_approval_requests (id, studentId, studentName, className, branchId, feeRecordId, feeType, academicYear, month, oldAmount, newAmount, dueDate, status, requestedBy, requestedByName, requestedAt, originalAmount, discountPercent, discountAmount, category, startDate, endDate)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, input.studentId, input.studentName, input.className, input.branchId, input.feeRecordId || null,
      input.feeType, input.academicYear || '', input.month || null, input.oldAmount ?? null, input.newAmount,
      input.dueDate || '', 'Pending', input.requestedBy, input.requestedByName, now,
      input.originalAmount ?? input.newAmount, input.discountPercent ?? 0, input.discountAmount ?? 0,
      input.category || '', input.startDate || '', input.endDate || ''
    );
    return { request: await db.get('SELECT * FROM fee_approval_requests WHERE id = ?', id), isNew: true };
  }

  // Assigning a fee to a student no longer writes fee_records directly for an
  // admin/accountant caller — it opens a Pending fee_approval_requests row
  // and notifies Super Admin instead; fee_records only gains a row once that
  // request is Approved (see POST /api/fee-approval-requests/:id/approve).
  // Super Admin is exempt (they're the approver — nobody sits above them to
  // sign off on their own change), so their calls keep the original
  // immediate-write behavior unchanged.
  app.post('/api/fees/records', async (req, res) => {
    if (!req.user.roles.some((r) => ['accountant', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const body = req.body || {};
      const originalAmountInput = body.originalAmount !== undefined ? body.originalAmount : body.totalAmount;
      if (!body.studentId || !body.feeType || originalAmountInput === undefined) {
        return res.status(400).json({ error: 'studentId, feeType and originalAmount are required' });
      }
      const student = await db.get('SELECT * FROM students WHERE id = ?', body.studentId);
      if (!student) return res.status(404).json({ error: 'Student not found' });
      const branchId = resolveBranchId(req, student.branchId) || student.branchId;
      const { originalAmount, discountPercent, discountAmount, finalAmount } = computeDiscount(originalAmountInput, body.discountPercent);
      const category = body.category || '';
      const startDate = body.startDate || '';
      const endDate = body.endDate || '';

      if (!req.user.roles.includes('super_admin')) {
        const { request, isNew } = await upsertPendingFeeApprovalRequest(db, {
          studentId: student.id, studentName: student.fullName, className: student.className, branchId,
          feeRecordId: null, feeType: body.feeType, academicYear: body.academicYear || '', month: body.month || null,
          oldAmount: null, newAmount: finalAmount, dueDate: body.dueDate || '',
          originalAmount, discountPercent, discountAmount, category, startDate, endDate,
          requestedBy: req.user.sub, requestedByName: req.user.name,
        });
        if (isNew) await sendFeeApprovalRequestedNotification(db, request, { id: req.user.sub, name: req.user.name, role: req.user.roles[0] || 'admin' });
        return res.status(202).json({ pendingApproval: true, request });
      }

      // "Fee assigned" notifications only fire for a genuinely first-time
      // assignment, not every subsequent fee added for a student who already
      // has one — checked before the insert below so it reflects the state
      // that existed the moment this request landed.
      const priorRecord = await db.get('SELECT 1 FROM fee_records WHERE studentId = ?', student.id);

      const now = new Date().toISOString();
      const status = feeRecordStatus(finalAmount, 0, body.dueDate);
      const result = await db.run(`
        INSERT INTO fee_records (studentId, studentName, className, branchId, feeType, academicYear, totalAmount, paidAmount, dueDate, status, month, createdAt, updatedAt, originalAmount, discountPercent, discountAmount, category, startDate, endDate)
        VALUES (?,?,?,?,?,?,?,0,?,?,?,?,?,?,?,?,?,?,?)
      `, student.id, student.fullName, student.className, branchId, body.feeType, body.academicYear || '', finalAmount, body.dueDate || '', status, body.month || null, now, now,
         originalAmount, discountPercent, discountAmount, category, startDate, endDate);
      const created = await db.get('SELECT * FROM fee_records WHERE id = ?', result.lastID);
      if (!priorRecord) await sendFeeAssignedNotification(db, created, req.user.name);
      res.status(201).json({ pendingApproval: false, record: created });
    } catch (err) { console.error(err); res.status(500).json({ error: 'failed' }); }
  });

  // Edit a single student's fee record — an individual student's fee (or one month
  // of a recurring monthly fee) is very often not the same as the rest of their
  // class, so this lets staff override just totalAmount/dueDate for that one record
  // without touching the class-wide fee_structures template everyone else uses.
  // Same approval gate as the create path above: a non-super_admin edit opens a
  // Pending request against this exact record and the existing amount stays
  // active in fee_records — "keep ₹20,000 active" — until Super Admin approves.
  app.put('/api/fees/records/:id', async (req, res) => {
    if (!req.user.roles.some((r) => ['accountant', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const existing = await db.get('SELECT * FROM fee_records WHERE id = ?', req.params.id);
      if (!existing) return res.status(404).json({ error: 'Fee record not found' });
      const body = req.body || {};
      const originalAmountInput = body.originalAmount !== undefined ? body.originalAmount : (body.totalAmount !== undefined ? body.totalAmount : existing.originalAmount);
      const discountPercentInput = body.discountPercent !== undefined ? body.discountPercent : existing.discountPercent;
      const { originalAmount, discountPercent, discountAmount, finalAmount: totalAmount } = computeDiscount(originalAmountInput, discountPercentInput);
      if (totalAmount < existing.paidAmount) {
        return res.status(400).json({ error: `Amount can't be less than the ${existing.paidAmount} already paid.` });
      }
      const dueDate = body.dueDate ?? existing.dueDate;
      const category = body.category ?? existing.category;
      const startDate = body.startDate ?? existing.startDate;
      const endDate = body.endDate ?? existing.endDate;

      if (!req.user.roles.includes('super_admin')) {
        const branchId = resolveBranchId(req, existing.branchId) || existing.branchId;
        const { request, isNew } = await upsertPendingFeeApprovalRequest(db, {
          studentId: existing.studentId, studentName: existing.studentName, className: existing.className, branchId,
          feeRecordId: existing.id, feeType: existing.feeType, academicYear: existing.academicYear, month: existing.month,
          oldAmount: existing.totalAmount, newAmount: totalAmount, dueDate,
          originalAmount, discountPercent, discountAmount, category, startDate, endDate,
          requestedBy: req.user.sub, requestedByName: req.user.name,
        });
        if (isNew) await sendFeeApprovalRequestedNotification(db, request, { id: req.user.sub, name: req.user.name, role: req.user.roles[0] || 'admin' });
        return res.status(202).json({ pendingApproval: true, request });
      }

      const feeType = body.feeType ?? existing.feeType;
      const now = new Date().toISOString();
      const status = feeRecordStatus(totalAmount, existing.paidAmount, dueDate);
      await db.run(
        `UPDATE fee_records SET totalAmount=?, dueDate=?, feeType=?, status=?, updatedAt=?,
           originalAmount=?, discountPercent=?, discountAmount=?, category=?, startDate=?, endDate=? WHERE id=?`,
        totalAmount, dueDate, feeType, status, now,
        originalAmount, discountPercent, discountAmount, category, startDate, endDate, req.params.id
      );
      const updated = await db.get('SELECT * FROM fee_records WHERE id = ?', req.params.id);
      res.json({ pendingApproval: false, record: updated });
    } catch (err) { console.error(err); res.status(500).json({ error: 'failed' }); }
  });

  // Branch-scoped list of fee approval requests — Admin/accountant see only
  // their own branch's requests, Super Admin sees every branch (matches
  // resolveBranchId's existing super_admin passthrough used everywhere else).
  app.get('/api/fee-approval-requests', async (req, res) => {
    if (!req.user.roles.some((r) => ['accountant', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const branchId = resolveBranchId(req, req.query.branchId);
      const conditions = [];
      const params = [];
      if (branchId) { conditions.push('branchId = ?'); params.push(branchId); }
      if (req.query.status) { conditions.push('status = ?'); params.push(req.query.status); }
      const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const rows = await db.all(`SELECT * FROM fee_approval_requests ${whereClause} ORDER BY requestedAt DESC`, ...params);
      res.json(rows);
    } catch (err) { console.error(err); res.status(500).json({ error: 'failed' }); }
  });

  // Approve: only now does the proposed amount actually reach fee_records —
  // insert for a brand-new assignment (feeRecordId was null), update for an
  // edit of an existing record. Whichever branch runs, it reuses the exact
  // same write shape as the original (pre-approval-gate) POST/PUT handlers
  // above, so collection/reports keep reading fee_records exactly as before.
  app.post('/api/fee-approval-requests/:id/approve', async (req, res) => {
    if (!req.user.roles.includes('super_admin')) return res.status(403).json({ error: 'Forbidden' });
    try {
      const request = await db.get('SELECT * FROM fee_approval_requests WHERE id = ?', req.params.id);
      if (!request) return res.status(404).json({ error: 'Fee approval request not found' });
      if (request.status !== 'Pending') return res.status(409).json({ error: `This request was already ${request.status.toLowerCase()}.` });

      const now = new Date().toISOString();
      if (request.feeRecordId) {
        const existing = await db.get('SELECT * FROM fee_records WHERE id = ?', request.feeRecordId);
        if (existing) {
          const status = feeRecordStatus(request.newAmount, existing.paidAmount, request.dueDate || existing.dueDate);
          await db.run(
            `UPDATE fee_records SET totalAmount=?, dueDate=?, status=?, updatedAt=?,
               originalAmount=?, discountPercent=?, discountAmount=?, category=?, startDate=?, endDate=? WHERE id=?`,
            request.newAmount, request.dueDate || existing.dueDate, status, now,
            request.originalAmount ?? request.newAmount, request.discountPercent ?? 0, request.discountAmount ?? 0,
            request.category || '', request.startDate || '', request.endDate || '', request.feeRecordId
          );
        }
      } else {
        const status = feeRecordStatus(request.newAmount, 0, request.dueDate);
        await db.run(`
          INSERT INTO fee_records (studentId, studentName, className, branchId, feeType, academicYear, totalAmount, paidAmount, dueDate, status, month, createdAt, updatedAt, originalAmount, discountPercent, discountAmount, category, startDate, endDate)
          VALUES (?,?,?,?,?,?,?,0,?,?,?,?,?,?,?,?,?,?,?)
        `, request.studentId, request.studentName, request.className, request.branchId, request.feeType, request.academicYear, request.newAmount, request.dueDate, status, request.month, now, now,
           request.originalAmount ?? request.newAmount, request.discountPercent ?? 0, request.discountAmount ?? 0,
           request.category || '', request.startDate || '', request.endDate || '');
      }

      await db.run(
        'UPDATE fee_approval_requests SET status=?, approvedBy=?, approvedByName=?, approvedAt=? WHERE id=?',
        'Approved', req.user.sub, req.user.name, now, request.id
      );
      const updatedRequest = await db.get('SELECT * FROM fee_approval_requests WHERE id = ?', request.id);
      await sendFeeApprovedNotification(db, updatedRequest, { id: req.user.sub, name: req.user.name, role: 'super_admin' });
      res.json(updatedRequest);
    } catch (err) { console.error(err); res.status(500).json({ error: 'failed' }); }
  });

  // Reject: fee_records is never touched here — the existing amount (or "no
  // record yet" for a new assignment) simply stays exactly as it was.
  app.post('/api/fee-approval-requests/:id/reject', async (req, res) => {
    if (!req.user.roles.includes('super_admin')) return res.status(403).json({ error: 'Forbidden' });
    try {
      const request = await db.get('SELECT * FROM fee_approval_requests WHERE id = ?', req.params.id);
      if (!request) return res.status(404).json({ error: 'Fee approval request not found' });
      if (request.status !== 'Pending') return res.status(409).json({ error: `This request was already ${request.status.toLowerCase()}.` });

      const now = new Date().toISOString();
      const reason = (req.body?.reason || '').toString().slice(0, 500);
      await db.run(
        'UPDATE fee_approval_requests SET status=?, rejectedBy=?, rejectedByName=?, rejectedAt=?, rejectionReason=? WHERE id=?',
        'Rejected', req.user.sub, req.user.name, now, reason, request.id
      );
      const updatedRequest = await db.get('SELECT * FROM fee_approval_requests WHERE id = ?', request.id);
      await sendFeeRejectedNotification(db, updatedRequest, { id: req.user.sub, name: req.user.name, role: 'super_admin' });
      res.json(updatedRequest);
    } catch (err) { console.error(err); res.status(500).json({ error: 'failed' }); }
  });

  // A branch admin has no direct way to change a user's roles — this opens a
  // Pending request and notifies Super Admin instead of touching the users
  // table. Only ever proposes adding 'admin' to an existing teacher, mirroring
  // the one workflow the UI actually exposes (Request Admin Access on
  // Teacher Management); reuses any request already Pending for this teacher
  // instead of stacking duplicates, same as upsertPendingFeeApprovalRequest.
  app.post('/api/role-change-requests', async (req, res) => {
    if (!req.user.roles.includes('admin')) return res.status(403).json({ error: 'Forbidden' });
    try {
      const userId = req.body?.userId;
      if (!userId) return res.status(400).json({ error: 'userId is required' });
      const target = await db.get('SELECT * FROM users WHERE id = ?', userId);
      if (!target) return res.status(404).json({ error: 'User not found' });
      if (target.branchId !== req.user.branchId) return res.status(403).json({ error: 'You can only request this for a teacher in your own branch.' });
      const targetRoles = parseJsonList(target.roles);
      if (!targetRoles.includes('teacher')) return res.status(400).json({ error: 'Only teachers can be proposed for Admin access.' });
      if (targetRoles.includes('admin')) return res.status(409).json({ error: `${target.name} already has Admin access.` });

      const existing = await db.get(`SELECT * FROM role_change_requests WHERE userId = ? AND addRole = 'admin' AND status = 'Pending'`, userId);
      const now = new Date().toISOString();
      let request;
      if (existing) {
        request = existing;
      } else {
        const id = `ROLEREQ-${crypto.randomUUID()}`;
        await db.run(
          `INSERT INTO role_change_requests (id, userId, userName, branchId, addRole, status, requestedBy, requestedByName, requestedAt)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          id, target.id, target.name, target.branchId || null, 'admin', 'Pending', req.user.sub, req.user.name, now
        );
        request = await db.get('SELECT * FROM role_change_requests WHERE id = ?', id);
        await sendRoleChangeRequestedNotification(db, request, { id: req.user.sub, name: req.user.name, role: 'admin' });
      }
      res.status(202).json({ pendingApproval: true, request });
    } catch (err) { console.error(err); res.status(500).json({ error: 'failed' }); }
  });

  // Branch-scoped list — Admin sees only their own branch's requests, Super
  // Admin sees every branch (matches resolveBranchId's existing super_admin
  // passthrough used everywhere else).
  app.get('/api/role-change-requests', async (req, res) => {
    if (!req.user.roles.some((r) => ['admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const branchId = resolveBranchId(req, req.query.branchId);
      const conditions = [];
      const params = [];
      if (branchId) { conditions.push('branchId = ?'); params.push(branchId); }
      if (req.query.status) { conditions.push('status = ?'); params.push(req.query.status); }
      const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const rows = await db.all(`SELECT * FROM role_change_requests ${whereClause} ORDER BY requestedAt DESC`, ...params);
      res.json(rows);
    } catch (err) { console.error(err); res.status(500).json({ error: 'failed' }); }
  });

  // Approve: only now does the target user's roles actually change. Roles
  // are re-sorted by ROLE_PRIORITY on write so roles[0] (read as "the"
  // primary role throughout this file and the frontend) is always the
  // highest-priority role the user holds, not just whichever one happened
  // to be first before this request.
  app.post('/api/role-change-requests/:id/approve', async (req, res) => {
    if (!req.user.roles.includes('super_admin')) return res.status(403).json({ error: 'Forbidden' });
    try {
      const request = await db.get('SELECT * FROM role_change_requests WHERE id = ?', req.params.id);
      if (!request) return res.status(404).json({ error: 'Role change request not found' });
      if (request.status !== 'Pending') return res.status(409).json({ error: `This request was already ${request.status.toLowerCase()}.` });

      const target = await db.get('SELECT * FROM users WHERE id = ?', request.userId);
      if (!target) return res.status(404).json({ error: 'User not found' });
      const targetRoles = parseJsonList(target.roles);
      if (!targetRoles.includes(request.addRole)) {
        const nextRoles = sortRoles([...targetRoles, request.addRole]);
        await db.run('UPDATE users SET roles=?, updatedAt=? WHERE id=?', JSON.stringify(nextRoles), new Date().toISOString(), target.id);
      }

      const now = new Date().toISOString();
      await db.run(
        'UPDATE role_change_requests SET status=?, approvedBy=?, approvedByName=?, approvedAt=? WHERE id=?',
        'Approved', req.user.sub, req.user.name, now, request.id
      );
      const updatedRequest = await db.get('SELECT * FROM role_change_requests WHERE id = ?', request.id);
      await sendRoleChangeApprovedNotification(db, updatedRequest, { id: req.user.sub, name: req.user.name, role: 'super_admin' });
      res.json(updatedRequest);
    } catch (err) { console.error(err); res.status(500).json({ error: 'failed' }); }
  });

  // Reject: the user's roles are never touched here.
  app.post('/api/role-change-requests/:id/reject', async (req, res) => {
    if (!req.user.roles.includes('super_admin')) return res.status(403).json({ error: 'Forbidden' });
    try {
      const request = await db.get('SELECT * FROM role_change_requests WHERE id = ?', req.params.id);
      if (!request) return res.status(404).json({ error: 'Role change request not found' });
      if (request.status !== 'Pending') return res.status(409).json({ error: `This request was already ${request.status.toLowerCase()}.` });

      const now = new Date().toISOString();
      const reason = (req.body?.reason || '').toString().slice(0, 500);
      await db.run(
        'UPDATE role_change_requests SET status=?, rejectedBy=?, rejectedByName=?, rejectedAt=?, rejectionReason=? WHERE id=?',
        'Rejected', req.user.sub, req.user.name, now, reason, request.id
      );
      const updatedRequest = await db.get('SELECT * FROM role_change_requests WHERE id = ?', request.id);
      await sendRoleChangeRejectedNotification(db, updatedRequest, { id: req.user.sub, name: req.user.name, role: 'super_admin' });
      res.json(updatedRequest);
    } catch (err) { console.error(err); res.status(500).json({ error: 'failed' }); }
  });

  // Bulk-generate one fee record per month (independently trackable/payable).
  // Two modes: pass studentId to generate for just that one student (no batch
  // required at all — the whole point of the individual-student flow), or
  // pass className to generate for every active student in that batch, same
  // as before. Both skip months a student already has a record for.
  app.post('/api/fees/records/generate-monthly', async (req, res) => {
    if (!req.user.roles.some((r) => ['accountant', 'admin', 'super_admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const body = req.body || {};
      const { studentId, className, academicYear, startMonth } = body;
      // Trimmed once and reused for both the insert and the duplicate check
      // below — an admin typing "Tuition " one time and "Tuition" the next
      // (or the browser autofilling different casing) must still count as
      // the same fee, or the duplicate check silently lets a second, visually
      // identical row through.
      const feeType = String(body.feeType || '').trim();
      const originalAmountInput = body.originalAmount !== undefined ? body.originalAmount : body.amount;
      const months = Math.max(1, Math.min(24, Number(body.months) || 12));
      const dueDay = Math.max(1, Math.min(28, Number(body.dueDay) || 5));
      if ((!studentId && !className) || !feeType || !originalAmountInput || !startMonth || !/^\d{4}-\d{2}$/.test(startMonth)) {
        return res.status(400).json({ error: 'studentId (or className), feeType, originalAmount and startMonth (YYYY-MM) are required' });
      }
      const { originalAmount, discountPercent, discountAmount, finalAmount: amount } = computeDiscount(originalAmountInput, body.discountPercent);
      const category = body.category || '';
      const startDate = body.startDate || '';
      const endDate = body.endDate || '';
      const branchId = resolveBranchId(req, body.branchId) || req.user.branchId || null;
      let students;
      if (studentId) {
        const student = await db.get('SELECT * FROM students WHERE id = ?', studentId);
        if (!student) return res.status(404).json({ error: 'Student not found' });
        students = [student];
      } else {
        students = await getActiveStudentsForBatchClassName(className, branchId);
      }

      const [startYear, startMon] = startMonth.split('-').map(Number);
      const now = new Date().toISOString();
      const createdIds = [];
      let skipped = 0;
      for (const student of students) {
        for (let i = 0; i < months; i++) {
          const totalMonthIndex = (startMon - 1) + i;
          const year = startYear + Math.floor(totalMonthIndex / 12);
          const mon = (totalMonthIndex % 12) + 1;
          const month = `${year}-${String(mon).padStart(2, '0')}`;
          const existing = await db.get(
            "SELECT id FROM fee_records WHERE studentId = ? AND LOWER(TRIM(feeType)) = LOWER(?) AND month = ?",
            student.id, feeType, month
          );
          if (existing) { skipped++; continue; }
          const dueDate = `${month}-${String(dueDay).padStart(2, '0')}`;
          const status = feeRecordStatus(amount, 0, dueDate);
          const result = await db.run(`
            INSERT INTO fee_records (studentId, studentName, className, branchId, feeType, academicYear, totalAmount, paidAmount, dueDate, status, month, createdAt, updatedAt, originalAmount, discountPercent, discountAmount, category, startDate, endDate)
            VALUES (?,?,?,?,?,?,?,0,?,?,?,?,?,?,?,?,?,?,?)
          `, student.id, student.fullName, student.className, student.branchId || branchId, feeType, academicYear || '', amount, dueDate, status, month, now, now,
             originalAmount, discountPercent, discountAmount, category, startDate, endDate);
          createdIds.push(result.lastID);
        }
      }
      const rows = createdIds.length ? await db.all(`SELECT * FROM fee_records WHERE id IN (${createdIds.map(() => '?').join(',')})`, ...createdIds) : [];
      res.status(201).json({ createdCount: rows.length, skippedCount: skipped, studentCount: students.length, records: rows });
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

      const students = await getActiveStudentsForBatchClassName(structure.className, structure.branchId);
      const now = new Date().toISOString();
      const createdIds = [];
      for (const student of students) {
        const existing = await db.get(
          "SELECT id FROM fee_records WHERE studentId = ? AND LOWER(TRIM(feeType)) = LOWER(TRIM(?)) AND COALESCE(academicYear,'') = COALESCE(?,'')",
          student.id, structure.feeType, structure.academicYear
        );
        if (existing) continue;
        const status = feeRecordStatus(structure.amount, 0, structure.dueDate);
        const result = await db.run(`
          INSERT INTO fee_records (studentId, studentName, className, branchId, feeType, academicYear, totalAmount, paidAmount, dueDate, status, createdAt, updatedAt, originalAmount, discountPercent, discountAmount, category, startDate, endDate)
          VALUES (?,?,?,?,?,?,?,0,?,?,?,?,?,?,?,?,?,?)
        `, student.id, student.fullName, student.className, structure.branchId, structure.feeType, structure.academicYear, structure.amount, structure.dueDate, status, now, now,
           structure.originalAmount ?? structure.amount, structure.discountPercent ?? 0, structure.discountAmount ?? 0,
           structure.category || '', structure.startDate || '', structure.endDate || '');
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
      const paymentDate = now.slice(0, 10);
      const receiptNumber = `RCPT-${Date.now()}`;
      await db.run(`
        INSERT INTO fee_payments (feeRecordId, studentId, amount, paymentMode, referenceNumber, receivedBy, paymentDate, receiptNumber, branchId, createdAt)
        VALUES (?,?,?,?,?,?,?,?,?,?)
      `, record.id, record.studentId, amount, body.paymentMode || 'Cash', body.referenceNumber || '', req.user.name || 'Accountant', paymentDate, receiptNumber, record.branchId, now);

      const newPaidAmount = (record.paidAmount || 0) + amount;
      const newStatus = feeRecordStatus(record.totalAmount, newPaidAmount, record.dueDate);
      await db.run('UPDATE fee_records SET paidAmount = ?, status = ?, updatedAt = ? WHERE id = ?', newPaidAmount, newStatus, now, record.id);

      // Every fee payment is also an Income ledger entry — otherwise it never
      // shows up in the Accountant/Super Admin "Income Summary by Category"
      // (sourced entirely from ledger_transactions), even though the payment
      // was genuinely recorded here. Same voucher-numbering scheme as the
      // manual POST /api/ledger entry point above.
      const datePart = paymentDate.replace(/-/g, '');
      const countRow = await db.get('SELECT COUNT(1) as c FROM ledger_transactions WHERE date = ?', paymentDate);
      const voucherNumber = `VOU-${datePart}-${String(countRow.c + 1).padStart(3, '0')}`;
      await db.run(`
        INSERT INTO ledger_transactions (voucherNumber, date, type, category, description, amount, paymentMode, referenceNumber, enteredBy, branchId, notes)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
      `, voucherNumber, paymentDate, 'Income', record.feeType, `${record.feeType} payment received from ${record.studentName}`, amount,
         body.paymentMode || 'Cash', body.referenceNumber || receiptNumber, req.user.name || 'Accountant', record.branchId, `Fee record #${record.id}, receipt ${receiptNumber}`);

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

      const notifId = newNotificationId();
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
