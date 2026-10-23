#!/usr/bin/env node
// away-mode.mjs — "Mode pergi": owner menutup/mematikan perangkat sementara TANPA memakai token model.
//   node scripts/away-mode.mjs on [--hours 8] [--note "teks"] [--power shutdown|sleep]   jeda semua pekerjaan baru, tunggu agen yang sedang bekerja selesai (maks 20 menit), lalu hentikan seluruh stack
//   node scripts/away-mode.mjs off                                lanjutkan (hapus jeda); bila pengawas tidak berjalan, nyalakan
//   node scripts/away-mode.mjs status
// Aman terhadap mati listrik/boot ulang: jeda tersimpan di workspace/orchestrator-settings.json, jadi sesudah perangkat menyala lagi agen TIDAK bekerja dan
// kantor otonom TIDAK membuat brief, sampai batas --hours lewat (dilanjutkan otomatis oleh orkestrator) atau owner menjalankan "off".
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeAway } from './away-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const W = (...p) => path.join(ROOT, 'workspace', ...p);
const AWAY = W('away.json'); const SETTINGS = W('orchestrator-settings.json'); const CMD = W('launcher.command'); const LAUNCHER_STATUS = W('launcher-status.json');
const a = process.argv.slice(2); const mode = a[0];
const arg = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const readJson = (f, d = null) => { try { return JSON.parse(readFileSync(f, 'utf8').replace(/^﻿/, '')); } catch { return d; } };
const setPaused = (v) => { mkdirSync(W(), { recursive: true }); const s = readJson(SETTINGS, {}); s.paused = v; writeFileSync(SETTINGS, JSON.stringify(s, null, 2) + '\n'); };
const launcherAlive = () => { const s = readJson(LAUNCHER_STATUS); if (!s?.pid || s.overall === 'mati') return false; try { process.kill(s.pid, 0); return Date.now() - (s.at ?? 0) < 120_000; } catch { return false; } };

if (mode === 'on') {
  const rec = makeAway({ nowMs: Date.now(), hours: arg('--hours', 0), note: arg('--note', ''), power: arg('--power', null) });
  mkdirSync(W(), { recursive: true }); writeFileSync(AWAY, JSON.stringify(rec, null, 2) + '\n');
  setPaused(true); // tidak ada pekerjaan/brief baru mulai sekarang; jam tahap dibekukan
  if (launcherAlive()) {
    appendFileSync(CMD, JSON.stringify({ cmd: 'shutdown', key: null, at: Date.now() }) + '\n'); // pengawas: tunggu agen selesai (maks 20 mnt) lalu hentikan semuanya termasuk Paperclip
    console.log('Mode pergi AKTIF. Pengawas menunggu agen yang sedang bekerja selesai (maks 20 menit), lalu mematikan semuanya.');
    console.log('Aman menutup perangkat setelah status "Dimatikan" (node scripts/office-launcher.mjs --status) atau setelah ±20 menit.');
  } else console.log('Mode pergi AKTIF (pengawas tidak sedang berjalan; tidak ada yang perlu dimatikan). Aman menutup perangkat.');
  console.log(rec.until ? `Lanjut otomatis setelah ${new Date(rec.until).toLocaleString('id-ID')}.` : 'Tanpa batas waktu: lanjutkan dengan "node scripts/away-mode.mjs off" (atau LANJUT-KERJA.cmd).');
} else if (mode === 'off') {
  try { unlinkSync(AWAY); } catch { /* sudah tidak ada */ }
  try { unlinkSync(W('auto-pause.json')); } catch { /* tidak ada jeda otomatis */ }
  setPaused(false);
  if (launcherAlive()) console.log('Jeda dicabut. Pekerjaan dilanjutkan.');
  else {
    const p = spawn(process.execPath, [path.join(ROOT, 'scripts', 'office-launcher.mjs'), '--no-open'], { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true }); p.unref();
    console.log('Jeda dicabut. Pengawas dinyalakan; Paperclip butuh beberapa menit untuk siap.');
  }
} else if (mode === 'status') {
  const away = readJson(AWAY); const s = readJson(SETTINGS, {});
  console.log(JSON.stringify({ modePergi: !!away, sejak: away ? new Date(away.since).toISOString() : null, lanjutOtomatis: away?.until ? new Date(away.until).toISOString() : null, dijeda: s.paused === true, pengawasHidup: launcherAlive() }, null, 2));
} else { console.log('Pakai: away-mode.mjs on [--hours N] [--note teks] | off | status'); process.exit(64); }
void existsSync;
