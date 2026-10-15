#!/usr/bin/env node
// clean-test-content.mjs — membersihkan konten UJI dari area kerja supaya yang tersisa hanya konten nyata.
// AMAN: tidak menghapus apa pun. Semua dipindah ke workspace/archive-testing/<waktu>/ (di luar yang dibaca TV, orkestrator, dan agent),
// jadi bisa dikembalikan dengan memindahkannya balik. Bawaan hanya MENAMPILKAN rencana; tambahkan --apply untuk memindahkan.
//
// Pemakaian: node scripts/clean-test-content.mjs --keep EDU-27,EDU-61,EDU-62 [--apply]
import { existsSync, mkdirSync, readdirSync, renameSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const a = process.argv.slice(2);
const arg = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const APPLY = a.includes('--apply');
const KEEP = new Set(String(arg('--keep', '')).split(',').map((s) => s.trim()).filter(Boolean));
if (!KEEP.size) { console.error('Sebutkan konten nyata yang dipertahankan: --keep EDU-27,EDU-61'); process.exit(64); }
const CONTENT = /^EDU-[0-9]+$/;
const W = (...p) => path.join(ROOT, 'workspace', ...p);
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const ARCH = W('archive-testing', stamp);

// Folder/berkas kerja yang SENGAJA tidak disentuh (dipakai sistem yang berjalan).
const AGENT_KEEP_DIRS = new Set(['briefs', 'chat', 'context', 'holds', 'orders', 'references', 'routing', 'runs']);
const WORKSPACE_JUNK = ['board-cache.json', 'canary', 'e2e', 'f18a', 'f19b', 'fin.txt', 'h33-1', 'h33-2', 'paperclip-fg.err.log', 'paperclip-fg.out.log', 'paperclip-sample.log', 'render', 'render-spike', 'scenarios-h31', 'shots', 'tests-qa-det', 'tests-render-tool', 'tmp-reference-render'];

const plan = []; // { from, to, why }
const add = (from, why) => { if (existsSync(from)) plan.push({ from, to: path.join(ARCH, path.relative(path.join(ROOT), from)), why }); };

// 1) run konten uji: semua folder bernama EDU-n yang tidak dipertahankan, plus TEST-*
for (const e of (existsSync(W('agent', 'runs')) ? readdirSync(W('agent', 'runs'), { withFileTypes: true }) : [])) {
  if (!e.isDirectory()) continue;
  if (CONTENT.test(e.name) ? !KEEP.has(e.name) : /^TEST-/i.test(e.name)) add(W('agent', 'runs', e.name), 'konten uji');
}
// 2) work order konten uji
for (const f of (existsSync(W('agent', 'orders')) ? readdirSync(W('agent', 'orders')) : [])) {
  const m = /^(EDU-[0-9]+)\.json$/.exec(f);
  if (m && !KEEP.has(m[1])) add(W('agent', 'orders', f), 'work order konten uji');
}
// 3) berkas lepas di workspace/agent (sisa uji tool plugin): semua berkas, bukan folder sistem
for (const e of (existsSync(W('agent')) ? readdirSync(W('agent'), { withFileTypes: true }) : [])) {
  if (e.isFile()) add(W('agent', e.name), 'berkas uji lepas');
  else if (e.isDirectory() && !AGENT_KEEP_DIRS.has(e.name) && !e.name.startsWith('.')) add(W('agent', e.name), 'folder uji');
}
// 4) sisa uji di workspace/ dan output/
for (const n of WORKSPACE_JUNK) add(W(n), 'sisa uji');
add(path.join(ROOT, 'output', '_probe'), 'sisa uji');

const sizeOf = (p) => { try { const s = statSync(p); if (!s.isDirectory()) return s.size; return readdirSync(p).reduce((t, n) => t + sizeOf(path.join(p, n)), 0); } catch { return 0; } };
const mb = (n) => (n / 1048576).toFixed(1) + ' MB';
console.log(`${APPLY ? 'MEMINDAHKAN' : 'RENCANA (dry-run)'}: ${plan.length} item ke ${path.relative(ROOT, ARCH)} | dipertahankan: ${[...KEEP].join(', ')}`);
let moved = 0; let failed = 0;
for (const p of plan) {
  const size = sizeOf(p.from);
  if (!APPLY) { console.log(`  - ${path.relative(ROOT, p.from)}  (${p.why}, ${mb(size)})`); continue; }
  try { mkdirSync(path.dirname(p.to), { recursive: true }); renameSync(p.from, p.to); moved++; }
  catch (e) { failed++; console.log(`  GAGAL ${path.relative(ROOT, p.from)}: ${e.code ?? e.message} (dilewati; coba lagi saat tidak dipakai)`); }
}

// 5) riwayat orkestrator: buang entri konten uji dari state.history (cadangan ke arsip); tidak menyentuh job aktif
const stateFile = W('orchestrator-state.json');
if (APPLY && existsSync(stateFile)) {
  try {
    const st = JSON.parse(readFileSync(stateFile, 'utf8'));
    const keepId = (x) => KEEP.has(x.identifier) || !CONTENT.test(String(x.identifier ?? ''));
    const before = (st.history ?? []).length;
    mkdirSync(ARCH, { recursive: true });
    writeFileSync(path.join(ARCH, 'orchestrator-state.sebelum.json'), JSON.stringify(st, null, 2));
    st.history = (st.history ?? []).filter(keepId);
    writeFileSync(stateFile, JSON.stringify(st, null, 2));
    console.log(`riwayat orkestrator: ${before} -> ${st.history.length} entri (cadangan di arsip)`);
  } catch (e) { console.log('riwayat orkestrator tidak diubah: ' + e.message); }
}
if (APPLY) console.log(`Selesai: ${moved} dipindah, ${failed} gagal. Kembalikan dengan memindahkan isi ${path.relative(ROOT, ARCH)} ke lokasi semula.`);
else console.log('Tidak ada yang berubah. Jalankan ulang dengan --apply untuk memindahkan.');
