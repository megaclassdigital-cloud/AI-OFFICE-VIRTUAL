#!/usr/bin/env node
// install-skills.mjs — memasang skill dari folder sumber ke SEMUA model agent (Claude, GPT/Codex, opencode/Gemini/gratis).
//
// Satu penyimpanan fisik: workspace/.agents/skills/<nama>/ (lokasi yang sudah ditetapkan README skill-sources). Agent berjalan di workspace/agent,
// jadi dua tautan direktori (junction, tanpa hak admin) membuat tiap CLI menemukannya:
//   workspace/agent/.claude/skills  -> Claude Code (dan opencode, yang membaca konvensi Claude)
//   workspace/agent/.agents/skills  -> Codex dan opencode
// Sebelum disalin, tiap skill DIAUDIT secara statis (tanpa menjalankan apa pun). Yang memuat pola berbahaya (unduh-lalu-jalankan, pencurian
// kredensial, injeksi instruksi) TIDAK dipasang. Skill berdampak keluar (ship/deploy/publish/push) juga dikarantina secara bawaan karena agent berjalan
// tanpa izin interaktif dan aturan proyek melarang git push dan posting otomatis; pasang dengan --include-risky bila owner memutuskan lain.
//
// Pemakaian: node scripts/install-skills.mjs [--src "D:\Documents-Backup\GPT-Local\skill-sources"] [--dry-run] [--include-risky] [--report reports/skills-install.md]
import { readdirSync, readFileSync, statSync, mkdirSync, copyFileSync, existsSync, rmSync, writeFileSync, symlinkSync, lstatSync, readlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_SRC = 'D:\\Documents-Backup\\GPT-Local\\skill-sources';
const SKIP_DIRS = new Set(['.git', 'node_modules', '__pycache__', '.venv', 'dist', 'build']);
const BINARY_EXT = new Set(['.exe', '.dll', '.so', '.dylib', '.bin', '.node', '.wasm', '.zip', '.tar', '.gz', '.7z', '.jar', '.pyc']);
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const TEXT_EXT = new Set(['.md', '.txt', '.sh', '.ps1', '.bat', '.cmd', '.py', '.js', '.mjs', '.cjs', '.ts', '.json', '.yaml', '.yml', '.toml']);

/** Temukan semua folder skill (berisi SKILL.md). Tidak masuk ke dalam folder skill lain agar sub-skill tidak ganda. */
export function findSkillDirs(src) {
  const out = [];
  const walk = (dir) => {
    let ents; try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (ents.some((e) => e.isFile() && e.name === 'SKILL.md')) out.push(dir);
    for (const e of ents) if (e.isDirectory() && !SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name));
  };
  walk(src);
  return out;
}

export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text).replace(/^\uFEFF/, ''));
  const get = (k) => { const r = m && new RegExp(`^${k}:\\s*(.+)$`, 'm').exec(m[1]); return r ? r[1].trim().replace(/^["']|["']$/g, '') : ''; };
  return { name: get('name'), description: get('description') };
}

export const safeName = (n) => String(n ?? '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);

const BLOCK = [
  ['unduh-lalu-jalankan', /(curl|wget|iwr|invoke-webrequest)[^\n|]{0,200}\|\s*(sudo\s+)?(sh|bash|zsh|iex|powershell|pwsh)\b/i],
  ['eval-jarak-jauh', /\binvoke-expression\b|\biex\s*\(\s*(iwr|invoke-webrequest|\(new-object)/i],
  ['base64-eksekusi', /base64\s+(-d|--decode)[^\n]{0,120}\|\s*(sh|bash)\b|eval\(\s*atob\(/i],
  ['baca-kredensial', /(cat|type|get-content|copy)\s+[^\n]{0,40}(\.ssh[\\/]id_|\.aws[\\/]credentials|\.netrc|\.npmrc|\.git-credentials)/i],
  ['injeksi-instruksi', /ignore\s+(all\s+|any\s+)?(previous|prior|above)\s+(instructions|rules|prompts)|do not (tell|inform) the user|hide (this|these) from the user|abaikan (semua )?instruksi sebelumnya/i],
];
const SIDE_EFFECT_TEXT = /\bgit push\b|\bgh pr (create|merge)\b|\bgh release create\b|\bnpm publish\b|\bvercel\s+(deploy|--prod)\b|\bkubectl (apply|delete)\b|\bterraform (apply|destroy)\b|\bdocker push\b/i;
const SIDE_EFFECT_NAME = /^(ship|deploy|land|land-and-deploy|setup-deploy|release|publish|push|canary|rollback|post-|tweet|send-|sync-upstream)/i;

/** Audit statis satu teks. Mengembalikan { block:[id], side:[id] }. */
export function auditText(text, name = '') {
  const block = BLOCK.filter(([, re]) => re.test(text)).map(([id]) => id);
  const side = [];
  if (SIDE_EFFECT_NAME.test(name)) side.push('nama-berdampak-keluar');
  if (SIDE_EFFECT_TEXT.test(text)) side.push('perintah-berdampak-keluar');
  return { block, side };
}

function readTextFiles(dir, limit = 400) {
  const files = []; let n = 0;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (n >= limit) return;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !existsSync(path.join(p, 'SKILL.md'))) walk(p); continue; }
      if (!TEXT_EXT.has(path.extname(e.name).toLowerCase())) continue;
      try { if (statSync(p).size > MAX_FILE_BYTES) continue; files.push([p, readFileSync(p, 'utf8')]); n++; } catch { /* abaikan */ }
    }
  };
  walk(dir);
  return files;
}

function copyDir(from, to) {
  mkdirSync(to, { recursive: true });
  for (const e of readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name); const b = path.join(to, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !existsSync(path.join(a, 'SKILL.md'))) copyDir(a, b); continue; } // sub-skill dipasang sendiri-sendiri
    if (BINARY_EXT.has(path.extname(e.name).toLowerCase())) continue;
    try { if (statSync(a).size > MAX_FILE_BYTES) continue; copyFileSync(a, b); } catch { /* lewati berkas yang tidak terbaca */ }
  }
}

export function planInstall(src, { includeRisky = false, allow = [] } = {}) {
  const allowed = new Set(allow.map(safeName));
  const seen = new Map(); const installs = []; const skipped = []; const dupes = [];
  for (const dir of findSkillDirs(src)) {
    let text = '';
    try { text = readFileSync(path.join(dir, 'SKILL.md'), 'utf8'); } catch { skipped.push({ dir, reason: 'SKILL.md tidak terbaca' }); continue; }
    const fm = parseFrontmatter(text);
    const name = safeName(fm.name || path.basename(dir));
    if (!name) { skipped.push({ dir, reason: 'nama kosong' }); continue; }
    if (seen.has(name)) { dupes.push({ name, dir, keptFrom: seen.get(name) }); continue; }
    seen.set(name, dir);
    const all = readTextFiles(dir);
    const block = new Set(); const side = new Set();
    for (const [p, t] of [[path.join(dir, 'SKILL.md'), text], ...all.filter(([p]) => path.basename(p) !== 'SKILL.md')]) {
      const r = auditText(t, p === path.join(dir, 'SKILL.md') ? name : '');
      r.block.forEach((x) => block.add(x)); r.side.forEach((x) => side.add(x));
    }
    if (allowed.has(name)) { installs.push({ name, dir, description: fm.description, side: [...side], allowed: true }); continue; }
    if (block.size) { skipped.push({ name, dir, reason: 'DIBLOKIR audit: ' + [...block].join(', ') }); continue; }
    if (side.size && !includeRisky) { skipped.push({ name, dir, reason: 'dikarantina (berdampak keluar): ' + [...side].join(', ') }); continue; }
    installs.push({ name, dir, description: fm.description, side: [...side] });
  }
  return { installs, skipped, dupes };
}

function link(target, linkPath) {
  mkdirSync(path.dirname(linkPath), { recursive: true });
  if (existsSync(linkPath) || (() => { try { lstatSync(linkPath); return true; } catch { return false; } })()) {
    try { if (lstatSync(linkPath).isSymbolicLink() && path.resolve(path.dirname(linkPath), readlinkSync(linkPath)) === path.resolve(target)) return 'sudah'; } catch { /* lanjut */ }
    return 'bentrok (sudah ada isi lain; tidak ditimpa)';
  }
  symlinkSync(target, linkPath, 'junction');
  return 'dibuat';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2); const arg = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
  const src = arg('--src', DEFAULT_SRC); const dry = a.includes('--dry-run'); const includeRisky = a.includes('--include-risky');
  if (!existsSync(src)) { console.error('Folder sumber tidak ada: ' + src); process.exit(1); }
  const store = path.join(ROOT, 'workspace', '.agents', 'skills');
  const plan = planInstall(src, { includeRisky, allow: (arg('--allow', '') || '').split(',').filter(Boolean) });
  console.log(`Ditemukan skill unik: ${plan.installs.length + plan.skipped.filter((s) => s.name).length} | dipasang: ${plan.installs.length} | dilewati: ${plan.skipped.length} | duplikat nama: ${plan.dupes.length}`);
  if (!dry) {
    mkdirSync(store, { recursive: true });
    for (const s of plan.installs) { const to = path.join(store, s.name); rmSync(to, { recursive: true, force: true }); copyDir(s.dir, to); }
    const links = [['workspace/agent/.claude/skills', 'Claude Code + opencode'], ['workspace/agent/.agents/skills', 'Codex + opencode']].map(([rel, who]) => `${rel}: ${link(store, path.join(ROOT, rel))} (${who})`);
    writeFileSync(path.join(store, '_manifest.json'), JSON.stringify({ installedAt: new Date().toISOString(), src, includeRisky, installed: plan.installs.map((s) => s.name), skipped: plan.skipped.map((s) => ({ name: s.name ?? path.basename(s.dir), reason: s.reason })), duplicates: plan.dupes.map((d) => d.name) }, null, 2));
    const rep = arg('--report', 'reports/skills-install.md');
    mkdirSync(path.dirname(path.join(ROOT, rep)), { recursive: true });
    writeFileSync(path.join(ROOT, rep), [
      '# Laporan pemasangan skill', '', `Sumber: ${src}`, `Waktu: ${new Date().toISOString()}`, '',
      `- Dipasang: **${plan.installs.length}**`, `- Dilewati: **${plan.skipped.length}** (audit/karantina)`, `- Duplikat nama (dipakai yang pertama): ${plan.dupes.length}`, '',
      '## Tautan ke agent', ...links.map((l) => '- ' + l), '', '## Dilewati', ...plan.skipped.map((s) => `- ${s.name ?? path.basename(s.dir)} — ${s.reason}`), '',
    ].join('\n'));
    for (const l of links) console.log(l);
    console.log('Laporan: ' + rep);
  } else {
    for (const s of plan.skipped.slice(0, 60)) console.log(`  lewati: ${s.name ?? path.basename(s.dir)} — ${s.reason}`);
  }
}
