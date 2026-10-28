// Merges duplicate active students (same name + parent mobile + branch + class, class
// spellings normalised so "4" == "4th"), e.g. the second import that stored class "4" next
// to "4th". The same child in a different class/course is a separate enrolment and is kept.
// Dry run unless --apply is passed; --apply copies the DB file first.
// Keeps the copy with an admission number (else the oldest id). Attendance, fees, marks etc.
// on the duplicate are moved onto the kept student (a row that would collide with one the
// kept student already has is dropped), then the duplicate is deleted.
//   node scripts/dedupeStudents.mjs [--db server/data.db] [--apply]
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import fs from 'fs';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const dbPath = args.includes('--db') ? args[args.indexOf('--db') + 1] : 'server/data.db';
if (apply) {
  const backup = `${dbPath}.before-dedupe-${Date.now()}`;
  fs.copyFileSync(dbPath, backup);
  console.log(`Backup written: ${backup}`);
}
const normClass = (v) => String(v || '').toLowerCase().replace(/(\d+)\s*(st|nd|rd|th)\b/g, '$1').replace(/\s+/g, ' ').trim();
const db = await open({ filename: dbPath, driver: sqlite3.Database });

const tables = (await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name != 'students'")).map((t) => t.name);
const linked = [];
for (const name of tables) {
  const cols = await db.all(`PRAGMA table_info("${name}")`);
  if (cols.some((c) => c.name === 'studentId')) linked.push(name);
}
// Join tables that only point at the student: safe to clean when the student is removed.
const JOIN_TABLES = ['parent_student', 'student_batches'];

const students = await db.all(`SELECT id, fullName, className, batch, branchId, admissionNumber, primaryParentMobile FROM students WHERE status = 'Active'`);
const groups = new Map();
for (const s of students) {
  const key = `${s.branchId}|${s.primaryParentMobile}|${String(s.fullName).trim().toLowerCase()}|${normClass(s.className)}`;
  groups.set(key, [...(groups.get(key) ?? []), s]);
}

let removed = 0;
for (const group of groups.values()) {
  if (group.length < 2) continue;
  group.sort((a, b) => (b.admissionNumber ? 1 : 0) - (a.admissionNumber ? 1 : 0) || a.id.localeCompare(b.id));
  const [keep, ...dups] = group;
  for (const dup of dups) {
    const label = `${dup.fullName} [${dup.id}, class ${dup.className}] duplicate of ${keep.id} (class ${keep.className})`;
    console.log(`${apply ? 'MERGE' : 'WOULD MERGE'} ${label}`);
    for (const table of linked.filter((t) => !JOIN_TABLES.includes(t))) {
      const { c } = await db.get(`SELECT COUNT(*) c FROM "${table}" WHERE studentId = ?`, dup.id);
      if (!c) continue;
      console.log(`         ${table}: ${c} row(s) -> ${keep.id}`);
      if (apply) {
        await db.run(`UPDATE OR IGNORE "${table}" SET studentId = ? WHERE studentId = ?`, keep.id, dup.id);
        await db.run(`DELETE FROM "${table}" WHERE studentId = ?`, dup.id);
      }
    }
    if (apply) {
      for (const table of JOIN_TABLES) if (linked.includes(table)) await db.run(`DELETE FROM "${table}" WHERE studentId = ?`, dup.id);
      await db.run('DELETE FROM students WHERE id = ?', dup.id);
    }
    removed++;
  }
}
console.log(`${removed} duplicate(s) ${apply ? 'merged' : 'found (dry run, pass --apply to merge)'}.`);
await db.close();
