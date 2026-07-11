import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';

const API_BASE = process.env.API_BASE || 'http://localhost:4000';

function titleCase(str) {
  return String(str || '')
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join(' ');
}

function normalizeBranch(input) {
  const v = String(input || '').trim();
  if (!v) return { id: 'branch_main', name: 'Main Branch' };
  const low = v.toLowerCase();
  if (low.includes('raj')) return { id: 'branch_rajajinagar', name: 'Rajajinagar Branch' };
  if (low.includes('jayan')) return { id: 'branch_jayanagar', name: 'Jayanagar Branch' };
  if (low.includes('vijayan')) return { id: 'branch_vijayanagar', name: 'Vijayanagar Branch' };
  if (low.includes('hsr')) return { id: 'branch_hsr', name: 'HSR Layout Branch' };
  if (low.includes('main')) return { id: 'branch_main', name: 'Main Branch' };
  // Fallback: treat as Main Branch but preserve human readable name via id
  return { id: 'branch_main', name: titleCase(v) + ' Branch' };
}

function normalizeClass(c) {
  const v = String(c || '').trim();
  if (!v) return 'NA';
  if (/^\d+$/.test(v)) return `${v}th`;
  return v.replace(/Grade\s*/i, '').trim();
}

function normalizeBatch(b) {
  const v = String(b || '').trim();
  if (!v) return 'NA';
  // Title-case common words and keep numbers
  return titleCase(v.replace(/\s+/g, ' '));
}

function normalizeStatus(s) {
  const v = String(s || '').trim();
  if (!v) return 'Active';
  const lower = v.toLowerCase();
  if (lower === 'active' || lower === 'inactive') return titleCase(lower);
  return titleCase(v);
}

function parseDate(value) {
  if (!value && value !== 0) return 'NA';
  // If it's a date object
  if (value instanceof Date && !isNaN(value)) {
    return value.toISOString().slice(0, 10);
  }
  // If number (Excel date serial)
  if (typeof value === 'number') {
    // Excel stores days since 1899-12-31 (with some quirks)
    const jsDate = new Date((value - (25567 + 1)) * 86400 * 1000);
    if (!isNaN(jsDate)) return jsDate.toISOString().slice(0, 10);
  }
  // Try parseable string
  const d = new Date(String(value));
  if (!isNaN(d)) return d.toISOString().slice(0, 10);
  return 'NA';
}

async function fetchExistingStudents() {
  try {
    const res = await fetch(`${API_BASE}/api/students`);
    if (res.ok) return await res.json();
    console.error('Failed to fetch students from API, status', res.status);
  } catch (err) {
    console.error('Fetch existing students failed:', err.message || err);
  }
  // Fallback to DB read
  try {
    const dbPath = path.resolve(process.cwd(), 'server', 'data.db');
    if (!fs.existsSync(dbPath)) return [];
    const db = await open({ filename: dbPath, driver: sqlite3.Database });
    const rows = await db.all('SELECT * FROM students');
    await db.close();
    return rows;
  } catch (err) {
    console.error('DB fallback read failed:', err.message || err);
    return [];
  }
}

function mapRow(row) {
  // Column mapping per user specification
  const firstName = row['First Name'] || row['FirstName'] || row['First'] || '';
  const lastName = row['Last Name'] || row['LastName'] || row['Last'] || '';
  const gender = row['Gender'] || 'NA';
  const dob = parseDate(row['Date of Birth'] || row['DOB'] || row['Birth Date']);
  const className = normalizeClass(row['Class']);
  const batch = normalizeBatch(row['Batch']);
  const admissionDate = parseDate(row['Admission Date']);
  const branch = normalizeBranch(row['Assigned Branch'] || row['Branch']);
  const status = normalizeStatus(row['Status']);
  const address = row['Address'] || 'NA';
  const fatherName = row['Father Name'] || 'NA';
  const motherName = row['Mother Name'] || 'NA';
  const primaryParentName = row['Primary Parent / Guardian Name'] || 'NA';
  const relationship = row['Relationship'] || 'NA';
  const fatherMobile = row['Father Mobile Number'] || 'NA';
  const motherMobile = row['Mother Mobile Number'] || 'NA';
  const primaryParentMobile = row['Primary Parent Login Mobile'] || row['Parent Login Mobile'] || 'NA';
  const parentEmail = row['Parent Email'] || 'NA';
  const guardianName = row['Guardian Name (Optional)'] || row['Guardian Name'] || 'NA';
  const guardianMobile = row['Guardian Mobile (Optional)'] || row['Guardian Mobile'] || 'NA';

  const filledNAFields = [];
  // Collect fields that were empty and set to NA
  for (const [k, v] of Object.entries({ gender, dob, className, batch, admissionDate, address, fatherName, motherName, primaryParentName, relationship, fatherMobile, motherMobile, primaryParentMobile, parentEmail, guardianName, guardianMobile })) {
    if (!v || v === '' || (typeof v === 'string' && v.trim() === '')) filledNAFields.push(k);
  }

  return {
    firstName: firstName || 'NA',
    lastName: lastName || 'NA',
    gender: gender || 'NA',
    dob: dob || 'NA',
    className: className || 'NA',
    batch: batch || 'NA',
    admissionDate: admissionDate || 'NA',
    branchId: branch.id,
    branchName: branch.name,
    status: status || 'Active',
    address: address || 'NA',
    fatherName: fatherName || 'NA',
    motherName: motherName || 'NA',
    primaryParentName: primaryParentName || 'NA',
    relationship: relationship || 'NA',
    fatherMobile: fatherMobile || 'NA',
    motherMobile: motherMobile || 'NA',
    primaryParentMobile: primaryParentMobile || 'NA',
    parentEmail: parentEmail || 'NA',
    guardianName: guardianName || 'NA',
    guardianMobile: guardianMobile || 'NA',
    addressRaw: address,
    filledNAFields,
  };
}

async function postStudentAPI(student) {
  try {
    const res = await fetch(`${API_BASE}/api/students`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(student)
    });
    if (res.ok) return await res.json();
    const txt = await res.text();
    console.error('API error creating student', res.status, txt);
    return null;
  } catch (err) {
    console.error('API call failed:', err.message || err);
    return null;
  }
}

async function insertStudentDB(db, s) {
  try {
    const now = new Date().toISOString();
    const studentId = s.id || `STU${Date.now()}${Math.floor(Math.random()*1000)}`;
    const stmt = await db.prepare(`INSERT INTO students (id, firstName, lastName, fullName, gender, dob, className, batch, branchId, rollNumber, admissionNumber, admissionDate, status, fatherName, motherName, primaryParentName, relationship, fatherMobile, motherMobile, primaryParentMobile, parentEmail, guardianName, guardianMobile, address) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    await stmt.run(studentId, s.firstName, s.lastName, `${s.firstName} ${s.lastName}`, s.gender || 'Male', s.dob || '', s.className || '', s.batch || '', s.branchId || '', s.rollNumber || '', s.admissionNumber || '', s.admissionDate || now.split('T')[0], s.status || 'Active', s.fatherName || '', s.motherName || '', s.primaryParentName || '', s.relationship || '', s.fatherMobile || '', s.motherMobile || '', s.primaryParentMobile || '', s.parentEmail || '', s.guardianName || '', s.guardianMobile || '', s.address || '');
    await stmt.finalize();

    // parent
    let parent = await db.get('SELECT * FROM parents WHERE mobile = ?', s.primaryParentMobile);
    let parentId;
    if (parent) parentId = parent.id; else {
      parentId = `PAR${Date.now()}${Math.floor(Math.random()*1000)}`;
      const parts = (s.primaryParentName || 'Parent').split(' ');
      const fName = parts[0];
      const lName = parts.slice(1).join(' ') || 'User';
      const tempPassword = 'Password@123';
      await db.run(`INSERT INTO parents (id, firstName, lastName, mobile, email, password, branchId, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, 'Active', ?)`, parentId, fName, lName, s.primaryParentMobile, s.parentEmail || '', tempPassword, s.branchId || '', now);
    }
    await db.run(`INSERT OR IGNORE INTO parent_student (parentId, studentId) VALUES (?, ?)`, parentId, studentId);
    return await db.get('SELECT * FROM students WHERE id = ?', studentId);
  } catch (err) {
    console.error('DB insert student failed:', err.message || err);
    return null;
  }
}

async function runImport(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error('File not found:', filePath);
    process.exit(1);
  }

  const wb = XLSX.readFile(filePath, { cellDates: true });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  const existing = await fetchExistingStudents();
  const duplicates = new Set();
  const existingKeySet = new Set(existing.map(s => `${(s.firstName||'').toLowerCase()}|${(s.lastName||'').toLowerCase()}|${(s.dob||'').toString()}|${(s.primaryParentMobile||'').toString()}`));

  let processed = 0; let imported = 0; let skipped = 0; let invalid = 0;
  const branchCounts = {};
  const naFieldsCounter = {};

  // Try to open DB for fallback writes
  let db = null;
  const dbPath = path.resolve(process.cwd(), 'server', 'data.db');
  if (fs.existsSync(dbPath)) {
    db = await open({ filename: dbPath, driver: sqlite3.Database });
  }

  for (const r of rows) {
    processed++;
    const mapped = mapRow(r);

    // Count NA fields
    for (const f of mapped.filledNAFields) naFieldsCounter[f] = (naFieldsCounter[f] || 0) + 1;

    const key = `${(mapped.firstName||'').toLowerCase()}|${(mapped.lastName||'').toLowerCase()}|${(mapped.dob||'').toString()}|${(mapped.primaryParentMobile||'').toString()}`;
    if (existingKeySet.has(key) || duplicates.has(key)) {
      skipped++; duplicates.add(key); continue;
    }

    // Prepare payload matching server expectation
    const payload = {
      firstName: mapped.firstName,
      lastName: mapped.lastName,
      gender: mapped.gender === 'NA' ? 'Male' : mapped.gender,
      dob: mapped.dob === 'NA' ? '' : mapped.dob,
      className: mapped.className === 'NA' ? '' : mapped.className,
      batch: mapped.batch === 'NA' ? '' : mapped.batch,
      branchId: mapped.branchId || '',
      rollNumber: '',
      admissionNumber: '',
      admissionDate: mapped.admissionDate === 'NA' ? '' : mapped.admissionDate,
      status: mapped.status || 'Active',
      fatherName: mapped.fatherName === 'NA' ? '' : mapped.fatherName,
      motherName: mapped.motherName === 'NA' ? '' : mapped.motherName,
      primaryParentName: mapped.primaryParentName === 'NA' ? '' : mapped.primaryParentName,
      relationship: mapped.relationship === 'NA' ? '' : mapped.relationship,
      fatherMobile: mapped.fatherMobile === 'NA' ? '' : mapped.fatherMobile,
      motherMobile: mapped.motherMobile === 'NA' ? '' : mapped.motherMobile,
      primaryParentMobile: mapped.primaryParentMobile === 'NA' ? 'NA' : mapped.primaryParentMobile,
      parentEmail: mapped.parentEmail === 'NA' ? '' : mapped.parentEmail,
      guardianName: mapped.guardianName === 'NA' ? '' : mapped.guardianName,
      guardianMobile: mapped.guardianMobile === 'NA' ? '' : mapped.guardianMobile,
      address: mapped.address === 'NA' ? '' : mapped.address,
    };

    // Try API
    let saved = await postStudentAPI(payload);
    if (!saved && db) {
      saved = await insertStudentDB(db, payload);
    }
    if (saved) {
      imported++;
      existingKeySet.add(key);
      branchCounts[mapped.branchName] = (branchCounts[mapped.branchName] || 0) + 1;
    } else {
      invalid++;
    }
  }

  if (db) await db.close();

  // Final verification read
  const finalList = await fetchExistingStudents();

  const report = {
    processed,
    imported,
    skipped,
    invalid,
    branchCounts,
    naFieldsCounter,
    totalAfterImport: finalList.length
  };

  console.log('\nImport Report:');
  console.log(JSON.stringify(report, null, 2));
}

// CLI
const argPath = process.argv[2] || path.resolve(process.cwd(), 'imports', 'students.xlsx');
await runImport(argPath);
