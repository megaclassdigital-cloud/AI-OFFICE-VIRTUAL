#!/usr/bin/env node
// loop-task.mjs — ubah status satu task di loop/backlog.json tanpa salah ketik.
//
// Dibuat Claude Code untuk loop (LOOP.md bagian 3: SELECT dan RECORD). Tidak mengubah
// logika loop; hanya membaca dan menulis backlog.json dengan format yang sama.
//
// Pemakaian:
//   node scripts/loop-task.mjs L0.1 --status IN_PROGRESS
//   node scripts/loop-task.mjs L0.1 --status DONE --evidence reports/build/L0.1.md --notes "catatan"
//   node scripts/loop-task.mjs F1.0a --attempt "hipotesis yang gagal"     # attempts += 1, tambah notes
//   node scripts/loop-task.mjs --add FIX-G0-01 --title "..." --phase "..." --deps A,B
//
// Aturan yang ditegakkan: status DONE wajib punya evidence; evidence harus berupa berkas yang ada.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'loop', 'backlog.json');
const VALID = ['TODO', 'IN_PROGRESS', 'DONE', 'BLOCKED', 'OWNER', 'SKIPPED'];

const argv = process.argv.slice(2);
const opt = {};
const pos = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) {
    const k = argv[i].slice(2);
    opt[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  } else pos.push(argv[i]);
}

const die = (m) => {
  console.error('GAGAL: ' + m);
  process.exit(1);
};

const data = JSON.parse(readFileSync(file, 'utf8'));
const now = new Date().toISOString();
data.loop.updated_at = now;
if (!data.loop.started_at) data.loop.started_at = now;

if (opt.add) {
  if (data.tasks.some((t) => t.id === opt.add)) die(`task ${opt.add} sudah ada`);
  const deps = typeof opt.deps === 'string' && opt.deps ? opt.deps.split(',') : [];
  const task = {
    id: opt.add,
    phase: opt.phase ?? 'tambahan',
    title: opt.title ?? opt.add,
    deps,
    status: 'TODO',
    attempts: 0,
    max_attempts: 3,
    evidence: '',
    notes: opt.notes ?? '',
  };
  const before = typeof opt.before === 'string' ? data.tasks.findIndex((t) => t.id === opt.before) : -1;
  if (before >= 0) data.tasks.splice(before, 0, task);
  else data.tasks.push(task);
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`task ${opt.add} ditambahkan`);
  process.exit(0);
}

const id = pos[0];
if (!id) die('sebutkan ID task');
const t = data.tasks.find((x) => x.id === id);
if (!t) die(`task ${id} tidak ditemukan`);

if (opt.attempt) {
  t.attempts += 1;
  t.notes = (t.notes ? t.notes + ' | ' : '') + `percobaan ${t.attempts}: ${opt.attempt}`;
}

if (opt.status) {
  if (!VALID.includes(opt.status)) die(`status tidak valid: ${opt.status}`);
  if (opt.status === 'DONE') {
    const ev = opt.evidence ?? t.evidence;
    if (!ev) die('DONE wajib punya --evidence');
    if (!existsSync(path.join(root, ev))) die(`berkas evidence tidak ada: ${ev}`);
    t.evidence = ev;
  }
  t.status = opt.status;
  if (opt.status === 'IN_PROGRESS') data.loop.current_task = id;
  else if (data.loop.current_task === id) data.loop.current_task = '';
}

if (typeof opt.evidence === 'string' && !opt.status) t.evidence = opt.evidence;
if (typeof opt.notes === 'string') t.notes = opt.notes;

writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
console.log(`${id}: status=${t.status} attempts=${t.attempts}${t.evidence ? ' evidence=' + t.evidence : ''}`);
