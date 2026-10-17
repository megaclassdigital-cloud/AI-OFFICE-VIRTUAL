#!/usr/bin/env node
// worker.mjs — ADMIN PUBLIKASI (ADR-0005): komponen KODE tanpa LLM yang mengurus siklus hidup paket sampai terposting.
//  1. memposting konten yang SUDAH di-approve owner (kapan pun, dengan jeda dari posting terakhir) lewat runner yang berpagar;
//  2. merapikan yang sudah terposting: catatan ledger, posted.json di folder konten, RIWAYAT.md/INDEX.md, bukti;
//  3. menjaga papan status (hitung mundur jeda, kandidat, konten lama yang diabaikan) dan memulihkan status macet.
// TIDAK PERNAH meng-approve apa pun. Hanya konten approved setelah autopostSince, dengan hash isi yang cocok, sekali per platform.
// Pemakaian: node scripts/autopost/worker.mjs --watch [--interval 60]   |   --once   |   --plan (hanya menampilkan keputusan, tanpa browser)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { readJsonSafe, writeJsonAtomic } from '../safe-json.mjs';
import { writeHeartbeat, acquireLock, releaseLock } from '../heartbeat.mjs';
import { writeContentHistory } from '../run-index.mjs';
import { mergeAutopostSettings } from './guards.mjs';
import { buildPackage } from './package.mjs';
import { approvedCandidates, nextToPost, buildStatus, currentContentHash } from './queue.mjs';
import { openSocialChrome, sessionState } from './social-login.mjs';
import { postInstagram, StepError } from './instagram.mjs';
import { postTikTok } from './tiktok.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'workspace', 'agent');
const DIR = path.join(OUT, 'autopost');
const APPROVALS = path.join(ROOT, 'output', 'approvals');
const LOG = path.join(ROOT, 'reports', 'autopost.log');
const SETTINGS_FILE = path.join(DIR, 'settings.json');
const LEDGER_FILE = path.join(DIR, 'ledger.json');
const STATUS_FILE = path.join(DIR, 'status.json');
const STALE_POSTING_MS = 10 * 60_000;

const log = (m) => { const l = `${new Date().toISOString()} ${m}`; console.log(l); try { mkdirSync(path.dirname(LOG), { recursive: true }); appendFileSync(LOG, l + '\n'); } catch { /* kosmetik */ } };

/** Platform yang punya alur LIVE (TikTok menyusul setelah alurnya dibangun dan diuji). */
export const LIVE_FLOWS = { instagram: postInstagram, tiktok: postTikTok };

const loadLedger = () => readJsonSafe(LEDGER_FILE, []) ?? [];
const saveLedger = (l) => { mkdirSync(DIR, { recursive: true }); writeJsonAtomic(LEDGER_FILE, l.slice(-500)); };

/**
 * Pemulihan: entri `sedang_diposting` yang menggantung (proses mati di tengah) menjadi `tidak_pasti`: TIDAK PERNAH diulang otomatis, owner memeriksa akun.
 * Murni terhadap daftar; mengembalikan { ledger, recovered }.
 */
export function recoverStale(ledger, nowMs, staleMs = STALE_POSTING_MS) {
  let recovered = 0;
  const out = ledger.map((e) => {
    if (e.mode === 'live' && e.status === 'sedang_diposting' && nowMs - Date.parse(e.at) > staleMs) { recovered++; return { ...e, status: 'tidak_pasti', error: 'proses berhenti saat posting; periksa akun secara manual' }; }
    return e;
  });
  return { ledger: out, recovered };
}

/** Rapikan konten yang sudah terposting: posted.json di folder versi dan RIWAYAT.md (folder konten TIDAK dipindah). */
export function fileAsPosted({ outputs, runKey, platform, entry }) {
  const dir = path.join(outputs, 'runs', ...runKey.split('/'));
  const f = path.join(dir, 'posted.json');
  const cur = readJsonSafe(f, {}) ?? {};
  cur[platform] = { at: entry.at, status: entry.status, evidenceDir: entry.evidenceDir ?? null };
  writeJsonAtomic(f, cur);
  try { writeContentHistory(outputs, runKey.split('/')[0]); } catch { /* riwayat hanya kosmetik */ }
}

/** Satu posting LIVE: tulis-dulu ke ledger, jalankan alur, perbarui ledger, rapikan. Mengembalikan entri akhir. */
async function postOne({ platform, candidate }) {
  const pkg = buildPackage(OUT, candidate.content);
  if (pkg.runKey !== candidate.runKey) throw new Error(`versi terbaru (${pkg.runKey}) berbeda dari yang di-approve (${candidate.runKey}); tidak diposting`);
  if (pkg.errors.length) throw new Error(`paket tidak valid: ${pkg.errors.join('; ')}`);
  if (currentContentHash(OUT, candidate.runKey) !== candidate.approvedHash) throw new Error('hash isi berubah sejak approval; tidak diposting');

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const evidenceDir = path.join(DIR, 'evidence', candidate.content, platform, ts);
  const entry = { content: candidate.content, platform, mode: 'live', runKey: candidate.runKey, status: 'gagal', at: new Date().toISOString(), evidenceDir: path.relative(ROOT, evidenceDir) };
  writeHeartbeat(ROOT, 'autopost', { ok: true, busy: 'posting', busyUntil: Date.now() + 8 * 60_000 }); // pengawas tidak boleh menganggap macet/mematikan di tengah posting
  const s = await openSocialChrome(platform, { headless: false, offscreen: true });
  try {
    const st = sessionState(platform, await s.ctx.cookies());
    if (!st.loggedIn) throw new StepError('sesi', `sesi ${platform} tidak masuk (${st.reason}); owner perlu login ulang lewat social-login.mjs`);
    log(`POSTING ${candidate.content} -> ${platform} (${pkg.slides.length} slide, approved ${new Date(candidate.approvedAt).toISOString()})`);
    const result = await LIVE_FLOWS[platform]({
      page: s.page, pkg, evidenceDir, log,
      onBeforeShare: async () => { const l = loadLedger(); l.push({ ...entry, status: 'sedang_diposting', at: new Date().toISOString() }); saveLedger(l); }, // tulis-dulu SEBELUM klik Share
    });
    entry.status = result.status; entry.at = new Date().toISOString(); if (result.reason) entry.error = result.reason; if (result.sound) entry.sound = result.sound;
    return entry;
  } catch (e) {
    entry.status = 'gagal'; entry.error = String(e.message).slice(0, 240); entry.at = new Date().toISOString();
    return entry; // gagal SEBELUM klik Share: tidak ada yang terkirim
  } finally { await s.close(); }
}

/** Ganti entri sedang_diposting terakhir milik konten x platform dengan hasil akhir; bila tidak ada (gagal sebelum klik), tambahkan. */
export function settleLedger(ledger, entry) {
  const idx = [...ledger].map((e, i) => ({ e, i })).reverse().find(({ e }) => e.mode === 'live' && e.content === entry.content && e.platform === entry.platform && e.status === 'sedang_diposting')?.i;
  if (idx == null) return [...ledger, entry];
  const next = ledger.slice(); next[idx] = { ...ledger[idx], ...entry }; return next;
}

/** Satu siklus. plan=true: hanya keputusan, tanpa membuka browser. */
export async function tick({ plan = false, nowMs = Date.now() } = {}) {
  const settings = mergeAutopostSettings(readJsonSafe(SETTINGS_FILE, {}) ?? {});
  let ledger = loadLedger();
  const rec = recoverStale(ledger, nowMs);
  if (rec.recovered) { ledger = rec.ledger; saveLedger(ledger); log(`pemulihan: ${rec.recovered} posting menggantung ditandai tidak_pasti (periksa akun; tidak dicoba ulang)`); }
  const sinceMs = settings.autopostSince ? Date.parse(settings.autopostSince) : null;
  const { candidates, ignored } = approvedCandidates({ outputs: OUT, approvalsDir: APPROVALS, sinceMs });
  const { pick, blocked } = settings.paused ? { pick: null, blocked: [] } : nextToPost({ candidates, ledger, settings, nowMs, platforms: Object.keys(LIVE_FLOWS) });
  let did = null;
  if (pick && !plan) {
    const entry = await postOne(pick);
    ledger = settleLedger(loadLedger(), entry); saveLedger(ledger);
    log(`${entry.status === 'diposting' ? 'TERPOSTING' : entry.status === 'tidak_pasti' ? 'TIDAK PASTI (periksa akun, tidak diulang)' : 'GAGAL sebelum terkirim'}: ${entry.content} -> ${entry.platform}${entry.error ? ` (${entry.error})` : ''}`);
    if (entry.status === 'diposting' || entry.status === 'tidak_pasti') { try { fileAsPosted({ outputs: OUT, runKey: pick.candidate.runKey, platform: pick.platform, entry }); } catch (e) { log(`peringatan: gagal merapikan ${entry.content} (${String(e.message).slice(0, 80)})`); } }
    did = entry;
  }
  const status = buildStatus({ settings, ledger: loadLedger(), candidates, ignored, blocked, nowMs: Date.now() });
  status.next = pick ? { content: pick.candidate.content, platform: pick.platform, willPost: !plan } : null;
  status.lastAction = did ? { content: did.content, platform: did.platform, status: did.status, at: did.at } : (readJsonSafe(STATUS_FILE, null)?.lastAction ?? null);
  mkdirSync(DIR, { recursive: true }); writeJsonAtomic(STATUS_FILE, status);
  return { pick, did, status, ignored, blocked };
}

async function main(argv) {
  const get = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  if (argv.includes('--plan') || argv.includes('--once')) {
    const r = await tick({ plan: argv.includes('--plan') });
    console.log(JSON.stringify({ paused: r.status.paused, since: r.status.since, platforms: r.status.platforms, approvedWaiting: r.status.approvedWaiting, ignoredOld: r.status.ignoredOld, akanDiposting: r.pick ? `${r.pick.candidate.content} -> ${r.pick.platform}` : null, ditahan: r.blocked.slice(0, 4).map((b) => `${b.content}/${b.platform}: ${b.reasons.join('; ')}`) }, null, 2));
    return 0;
  }
  if (!argv.includes('--watch')) { console.error('Pakai: --watch [--interval 60] | --once | --plan'); return 1; }
  const lock = acquireLock(ROOT, 'autopost');
  if (!lock.ok) { console.error(`Admin Publikasi sudah berjalan (pid ${lock.pid})`); return 1; }
  process.on('exit', () => releaseLock(lock.file));
  const ms = Number(get('--interval', 60)) * 1000;
  log(`Admin Publikasi dimulai (interval ${ms / 1000} dtk; mode ${mergeAutopostSettings(readJsonSafe(SETTINGS_FILE, {})).paused ? 'DIJEDA' : 'aktif'})`);
  for (;;) {
    let ok = true; let error = null;
    try { await tick(); } catch (e) { ok = false; error = String(e?.message ?? e); log(`galat: ${error.slice(0, 200)}`); }
    writeHeartbeat(ROOT, 'autopost', { ok, error: error ? error.slice(0, 160) : null, intervalMs: ms });
    await new Promise((r) => setTimeout(r, ms));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((c) => { if (c !== undefined && !process.argv.includes('--watch')) process.exit(c); }, (e) => { console.error(e.message ?? e); process.exit(1); });
}
