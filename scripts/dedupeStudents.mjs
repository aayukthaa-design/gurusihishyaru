// Removes duplicate active students (same name + parent mobile + branch), e.g. the
// second import that stored class "4" next to "4th". Dry run unless --apply is passed.
// Keeps the copy with an admission number (else the oldest id). A duplicate that has
// ANY row in another table (attendance, fees, marks, ...) is reported and left alone.
//   node scripts/dedupeStudents.mjs [--db server/data.db] [--apply]
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const dbPath = args.includes('--db') ? args[args.indexOf('--db') + 1] : 'server/data.db';
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
  const key = `${s.branchId}|${s.primaryParentMobile}|${String(s.fullName).trim().toLowerCase()}`;
  groups.set(key, [...(groups.get(key) ?? []), s]);
}

let removed = 0;
for (const group of groups.values()) {
  if (group.length < 2) continue;
  group.sort((a, b) => (b.admissionNumber ? 1 : 0) - (a.admissionNumber ? 1 : 0) || a.id.localeCompare(b.id));
  const [keep, ...dups] = group;
  for (const dup of dups) {
    let blockedBy = null;
    for (const table of linked.filter((t) => !JOIN_TABLES.includes(t))) {
      const { c } = await db.get(`SELECT COUNT(*) c FROM "${table}" WHERE studentId = ?`, dup.id);
      if (c) { blockedBy = `${table} (${c})`; break; }
    }
    const label = `${dup.fullName} [${dup.id}, class ${dup.className}] duplicate of ${keep.id} (class ${keep.className})`;
    if (blockedBy) { console.log(`SKIP   ${label} - has data in ${blockedBy}`); continue; }
    console.log(`${apply ? 'DELETE' : 'WOULD DELETE'} ${label}`);
    if (apply) {
      for (const table of JOIN_TABLES) if (linked.includes(table)) await db.run(`DELETE FROM "${table}" WHERE studentId = ?`, dup.id);
      await db.run('DELETE FROM students WHERE id = ?', dup.id);
    }
    removed++;
  }
}
console.log(`${removed} duplicate(s) ${apply ? 'removed' : 'found (dry run, pass --apply to delete)'}.`);
await db.close();
