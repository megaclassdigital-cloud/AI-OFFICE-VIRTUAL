#!/usr/bin/env node
// smoke-test.mjs — verifikasi menyeluruh keadaan Fase 0.
//
// Menjalankan ulang cek-cek penting dari F0.1 sampai F0.7 dalam satu perintah,
// supaya regresi ketahuan cepat. Tidak membuat run agent (tidak membakar kuota).
//
// Pemakaian:
//   node scripts/smoke-test.mjs

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const BASE = process.env.PAPERCLIP_BASE ?? 'http://127.0.0.1:3177';

const EDU = 'e9986c83-2835-4f59-bd0f-d6d1b053f08d';
const ISO = '4c991285-6d83-4a7f-b783-11e105e46793';

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}${detail ? ' :: ' + detail : ''}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ' :: ' + detail : ''}`);
  }
}

async function api(p, init = {}) {
  try {
    const res = await fetch(BASE + p, init);
    const text = await res.text();
    return { status: res.status, text, json: safeJson(text) };
  } catch (e) {
    return { status: 0, text: String(e.message), json: null };
  }
}

function safeJson(t) {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

function asList(j, key) {
  if (Array.isArray(j)) return j;
  if (j && Array.isArray(j[key])) return j[key];
  return [];
}

console.log(`\n=== SMOKE TEST AI AGENT OFFICE — ${new Date().toISOString()} ===`);
console.log(`Target: ${BASE}\n`);

// ── F0.1: server hidup ────────────────────────────────────────────────────────
console.log('F0.1 — server');
const health = await api('/api/health');
check('server menjawab /api/health', health.status === 200);
check('status ok', health.json?.status === 'ok', health.json?.status ?? '-');
check('versi dipin 2026.1001.0', health.json?.version === '2026.1001.0', health.json?.version ?? '-');
check('bootstrap ready', health.json?.bootstrapStatus === 'ready');

// ── Struktur office ───────────────────────────────────────────────────────────
console.log('\nF0.3 — struktur office');
const companies = asList((await api('/api/companies')).json, 'companies');
const edu = companies.find((c) => c.id === EDU);
const iso = companies.find((c) => c.id === ISO);
check('company EdukasiAI ada', !!edu, edu?.name);
check('company IsolationTest ada', !!iso, iso?.name);

const agents = asList((await api(`/api/companies/${EDU}/agents`)).json, 'agents');
check('EdukasiAI punya tepat 5 agent', agents.length === 5, `${agents.length} agent`);

const manifest = JSON.parse(await readFile(path.join(repoRoot, 'divisions/edukasiai/division.json'), 'utf8'));
const expected = manifest.agents.map((a) => a.name).sort();
const actual = agents.map((a) => a.name).sort();
check('nama agent cocok dengan manifest', JSON.stringify(expected) === JSON.stringify(actual), actual.join(', '));

// ── F0.2-fix: guard anti-loop ────────────────────────────────────────────────
console.log('\nF0.2-fix — guard anti-loop');
let timeoutOk = true;
let protocolOk = true;
for (const a of agents) {
  const cfg = (await api(`/api/agents/${a.id}/configuration`)).json;
  const ac = cfg?.adapterConfig ?? cfg?.configuration?.adapterConfig ?? {};
  const raw = JSON.stringify(cfg ?? {});
  if (!raw.includes('"timeoutSec":600')) timeoutOk = false;
  const bundle = (await api(`/api/agents/${a.id}/instructions-bundle`)).json;
  const entry = bundle?.files?.find?.((f) => f.path === 'AGENTS.md');
  if (!entry || entry.size < 4000) protocolOk = false;
}
check('semua agent punya timeoutSec 600', timeoutOk);
check('semua agent punya instruksi + protokol (>4KB)', protocolOk);

// ── F0.3: isolasi ─────────────────────────────────────────────────────────────
console.log('\nF0.3 — isolasi (perlu token agent IsolationTest)');
const isoAgents = asList((await api(`/api/companies/${ISO}/agents`)).json, 'agents');
if (isoAgents.length === 0) {
  check('agent IsolationTest ada untuk uji isolasi', false, 'tidak ada agent — uji dilewati');
} else {
  const keyRes = await api(`/api/agents/${isoAgents[0].id}/keys`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  const token = keyRes.json?.token;
  if (!token) {
    check('bisa membuat API key agent', false, keyRes.text.slice(0, 80));
  } else {
    const h = { Authorization: `Bearer ${token}` };
    const own = await api(`/api/companies/${ISO}/issues`, { headers: h });
    check('KONTROL: token baca company sendiri = 200', own.status === 200, `HTTP ${own.status}`);
    const cross = await api(`/api/companies/${EDU}/issues`, { headers: h });
    check('ISOLASI: baca company lain ditolak 403', cross.status === 403, `HTTP ${cross.status}`);
    const write = await api(`/api/companies/${EDU}/issues`, {
      method: 'POST',
      headers: { ...h, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'smoke-test penyusupan' }),
    });
    check('ISOLASI: tulis ke company lain ditolak 403', write.status === 403, `HTTP ${write.status}`);
  }
}

// ── F0.4: plugin + tool ───────────────────────────────────────────────────────
console.log('\nF0.4 — plugin dan tool');
const plugins = asList((await api('/api/plugins')).json, 'plugins');
const gate = plugins.find((p) => p.key === 'aao-approval-gate' || p.pluginKey === 'aao-approval-gate');
check('plugin aao-approval-gate terpasang', !!gate, gate?.status ?? '-');
check('plugin status ready', gate?.status === 'ready', gate?.status ?? '-');

const tools = asList((await api(`/api/plugins/tools?companyId=${EDU}`)).json, 'tools');
const hello = tools.find((t) => t.name === 'aao-approval-gate:aao_hello');
check('tool aao_hello terdaftar', !!hello);

// ── F0.7: render ──────────────────────────────────────────────────────────────
console.log('\nF0.7 — render');
const pngPath = path.join(repoRoot, 'docs/spike/evidence/F0.7-render-1080x1350.png');
if (!existsSync(pngPath)) {
  check('PNG bukti render ada', false, pngPath);
} else {
  const buf = await readFile(pngPath);
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  check('PNG bukti berdimensi 1080x1350', w === 1080 && h === 1350, `${w}x${h}`);
  const rep = JSON.parse(await readFile(path.join(repoRoot, 'docs/spike/evidence/F0.7-render-report.json'), 'utf8'));
  check('laporan render menyatakan dua render identik', rep.duaRenderIdentik === true);
  check(
    'hash PNG bukti cocok dengan laporan',
    createHash('sha256').update(buf).digest('hex') === rep.sha256Render1
  );
}

// ── Integritas repo ───────────────────────────────────────────────────────────
console.log('\nIntegritas repo');
for (const f of [
  'CLAUDE.md',
  'STATUS.md',
  'docs/PRD.md',
  'docs/versions.md',
  'docs/spike/report.md',
  'divisions/edukasiai/division.json',
  'divisions/edukasiai/sop/agent-protocol.md',
  'plugins/aao-approval-gate/manifest.js',
  'scripts/install-division.mjs',
  'scripts/start-paperclip.ps1',
]) {
  check(`ada: ${f}`, existsSync(path.join(repoRoot, f)));
}

// ── Ringkasan ─────────────────────────────────────────────────────────────────
console.log(`\n=== RINGKASAN: ${pass} PASS, ${fail} FAIL ===`);
if (fail > 0) {
  console.log('Gagal:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('Semua cek lolos.');
