#!/usr/bin/env node
// watch-events.mjs — pemantau latar belakang HEMAT TOKEN: hanya membaca berkas lokal (tanpa memanggil Paperclip/agen/LLM) dan mencetak SATU baris
// hanya saat ada PERUBAHAN yang perlu perhatian (picu tepi, bukan denyut berkala). Dijalankan lewat Monitor; tiap baris = satu notifikasi.
// Pemakaian: node scripts/watch-events.mjs [--every 30]
// Picu: STACK (komponen bermasalah >3 mnt / pulih), RAM (<400 MB berturut-turut / pulih), JOB (selesai/terblokir/macet), POST (hasil posting),
//       OTONOM (brief otomatis dibuat / pemutus aktif), GALAT (baris log orkestrator yang butuh perhatian). Pembatas laju: picu sama minimal 5 menit.
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const f = (...p) => path.join(ROOT, ...p);
const readJson = (file, d = null) => { try { return JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return d; } };
const MIN = 60_000;

export const ATTENTION_RE = /DIBLOKIR|finalisasi GAGAL|PEMUTUS|galat saat maju|tidak lolos setelah|TERPOSTING|TIDAK PASTI|tak kunjung tersedia|dirutekan/i;

/** Murni: dari keadaan sebelumnya + cuplikan sekarang -> { events:[string], next }. Dites. */
export function evaluate(prev, snap, nowMs) {
  const ev = []; const n = { ...prev, stackBadSince: prev.stackBadSince ?? null, ramLow: prev.ramLow ?? 0, sent: { ...(prev.sent ?? {}) } };
  const emit = (key, text) => { if (nowMs - (n.sent[key] ?? 0) >= 5 * MIN) { n.sent[key] = nowMs; ev.push(text); } };

  // STACK
  const stackOk = snap.launcher?.overall === 'ok' || /Semua terhubung/i.test(snap.launcher?.summary ?? '');
  if (!snap.launcher) { /* berkas belum ada: abaikan */ } else if (!stackOk) {
    n.stackBadSince ??= nowMs;
    if (nowMs - n.stackBadSince >= 3 * MIN && !n.stackAlerted) { n.stackAlerted = true; ev.push(`STACK bermasalah >3 mnt: ${String(snap.launcher.summary).slice(0, 140)}`); n.sent.stack = nowMs; }
  } else { if (n.stackAlerted) ev.push('STACK pulih: semua terhubung'); n.stackBadSince = null; n.stackAlerted = false; }

  // RAM
  const ram = snap.launcher?.memoryFreeMB;
  if (Number.isFinite(ram)) {
    n.ramLow = ram < 400 ? n.ramLow + 1 : 0;
    if (n.ramLow >= 3 && !n.ramAlerted) { n.ramAlerted = true; ev.push(`RAM menipis: ${ram} MB bebas (3 cuplikan berturut-turut)`); }
    if (ram >= 600 && n.ramAlerted) { n.ramAlerted = false; ev.push(`RAM pulih: ${ram} MB bebas`); }
  }

  // JOB: selesai/terblokir (riwayat bertambah), job berganti, macet pada tahap yang sama terlalu lama
  const st = snap.orch;
  if (st) {
    const hist = st.history ?? [];
    const key = (j) => `${j.identifier}:${j.phase}`;
    const seen = new Set(n.histSeen ?? []);
    if (n.histSeen) for (const j of hist) if (!seen.has(key(j))) ev.push(`JOB ${j.identifier} ${j.phase === 'done' ? 'SELESAI' : 'TERBLOKIR'}${j.blockReason ? `: ${String(j.blockReason).slice(0, 110)}` : ''}`);
    n.histSeen = hist.map(key);
    const jid = st.job ? `${st.job.identifier}@${st.job.stageIndex}:${st.job.phase}` : null;
    if (jid !== n.jobKey) { n.jobKey = jid; n.jobSince = nowMs; n.stuckAlerted = false; if (jid && n.jobSeen) ev.push(`JOB ${st.job.identifier} tahap ${st.job.stageIndex} (${st.job.phase})`); }
    n.jobSeen = true;
    if (jid && n.jobSince && nowMs - n.jobSince >= 40 * MIN && !n.stuckAlerted && st.job.phase === 'running') { n.stuckAlerted = true; ev.push(`JOB ${st.job.identifier} di tahap ${st.job.stageIndex} >40 mnt tanpa perubahan`); }
  }

  // POST: entri ledger baru
  const led = snap.ledger ?? [];
  if (n.ledgerN === undefined) n.ledgerN = led.length;
  else if (led.length > n.ledgerN) { for (const e of led.slice(n.ledgerN)) if (e.mode === 'live') ev.push(`POST ${e.content} → ${e.platform}: ${e.status}${e.error ? ` (${String(e.error).slice(0, 80)})` : ''}`); n.ledgerN = led.length; }

  // OTONOM
  const blog = snap.autoLog ?? [];
  if (n.autoN === undefined) n.autoN = blog.length; else if (blog.length > n.autoN) { ev.push(`OTONOM brief otomatis baru dibuat (${blog[blog.length - 1].file})`); n.autoN = blog.length; }
  const br = snap.breaker?.untilMs;
  if (br && br > nowMs && !n.breakerAlerted) { n.breakerAlerted = true; ev.push(`OTONOM pemutus aktif: ${String(snap.breaker.reason ?? '').slice(0, 100)}`); }
  if (!(br && br > nowMs)) n.breakerAlerted = false;

  // GALAT: baris log orkestrator baru yang perlu perhatian
  const lines = snap.logLines ?? [];
  if (n.logN === undefined) n.logN = lines.length;
  else { for (const l of lines.slice(n.logN)) if (ATTENTION_RE.test(l) && !/TERPOSTING|TIDAK PASTI/.test(l)) emit(`log:${l.slice(0, 60)}`, `GALAT ${l.slice(0, 190)}`); n.logN = lines.length; }
  return { events: ev, next: n };
}

function snapshot() {
  const logFile = f('reports', 'orchestrator.log');
  let logLines = [];
  try { const t = readFileSync(logFile, 'utf8').split(/\r?\n/).filter(Boolean); logLines = t; } catch { /* belum ada */ }
  return {
    launcher: readJson(f('workspace', 'launcher-status.json')), orch: readJson(f('workspace', 'orchestrator-state.json')),
    ledger: readJson(f('workspace', 'agent', 'autopost', 'ledger.json'), []), autoLog: readJson(f('workspace', 'agent', 'autonomy', 'log.json'), []),
    breaker: readJson(f('workspace', 'agent', 'autonomy', 'breaker.json')), logLines,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const every = Number(process.argv.includes('--every') ? process.argv[process.argv.indexOf('--every') + 1] : 30) * 1000;
  let state = {};
  // cuplikan pertama hanya menetapkan garis dasar (tidak ada notifikasi untuk keadaan yang sudah ada)
  state = evaluate(state, snapshot(), Date.now()).next; state.stackAlerted = false;
  console.log('PEMANTAU aktif (picu tepi; diam bila tidak ada perubahan)');
  setInterval(() => {
    try { const r = evaluate(state, snapshot(), Date.now()); state = r.next; for (const e of r.events) console.log(e); } catch (e) { console.log(`PEMANTAU galat: ${String(e.message).slice(0, 100)}`); }
  }, every);
}
void existsSync; void statSync;
