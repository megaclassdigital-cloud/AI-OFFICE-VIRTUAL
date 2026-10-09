#!/usr/bin/env node
// pause.mjs — jeda/lanjut seluruh pekerjaan EdukasiAI dengan aman.
//   node scripts/pause.mjs on      jeda: tidak ada pekerjaan baru, jam tahap dibekukan; agent yang sedang bekerja menyelesaikan run-nya
//   node scripts/pause.mjs off     lanjut dari tempat terakhir
//   node scripts/pause.mjs status  tampilkan jeda dan agent yang masih bekerja (aman menutup aplikasi bila kosong)
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'workspace', 'orchestrator-settings.json');
const cmd = process.argv[2];
if (!['on', 'off', 'status'].includes(cmd)) { console.error('Pemakaian: node scripts/pause.mjs on|off|status'); process.exit(64); }
const read = () => { try { return JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return {}; } };
const settings = read();
if (cmd !== 'status') {
  settings.paused = cmd === 'on';
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(settings, null, 2) + '\n', 'utf8');
}
let running = null;
try {
  const api = 'http://127.0.0.1:3177/api';
  const company = (await (await fetch(`${api}/companies`)).json()).find((c) => /edukasi/i.test(c.name));
  const agents = await (await fetch(`${api}/companies/${company.id}/agents`)).json();
  running = agents.filter((a) => a.status === 'running').map((a) => a.name);
} catch { /* Paperclip tidak terjangkau: tidak ada agent yang bisa bekerja */ }
console.log(settings.paused ? 'DIJEDA: tidak ada pekerjaan baru, jam tahap dibekukan.' : 'Berjalan normal (tidak dijeda).');
if (settings.paused) console.log(running === null ? 'Paperclip tidak terjangkau: tidak ada agent yang bekerja.' : running.length ? `Agent yang masih menyelesaikan run: ${running.join(', ')}. Tunggu kosong, lalu aman menutup aplikasi.` : 'Tidak ada agent yang bekerja: AMAN menutup aplikasi sekarang.');
