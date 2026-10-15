// safe-json.mjs — penulisan/pembacaan JSON tahan mati listrik dan penuh-disk.
// Tulis ke berkas sementara lalu rename (atomik di NTFS); cadangan terakhir yang baik disimpan di <berkas>.bak.
// Baca: bila berkas utama rusak/terpotong, jatuh ke cadangan, bukan crash atau kehilangan seluruh state.
import { existsSync, mkdirSync, readFileSync, renameSync, copyFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';

const strip = (t) => String(t).replace(/^﻿/, '');

export function writeJsonAtomic(file, data) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  // Simpan versi utama yang masih terbaca sebagai cadangan sebelum diganti.
  try { if (existsSync(file)) { JSON.parse(strip(readFileSync(file, 'utf8'))); copyFileSync(file, `${file}.bak`); } } catch { /* utama sudah rusak: pertahankan cadangan lama */ }
  // Windows: rename ke berkas yang sedang dibuka proses lain (pemindai antivirus, pembaca TV) bisa gagal EPERM/EBUSY sesaat -> coba ulang.
  let lastErr = null;
  for (let i = 0; i < 8; i++) {
    try { renameSync(tmp, file); return; } catch (e) {
      lastErr = e;
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(e?.code)) break;
      const until = Date.now() + 40 * (i + 1); while (Date.now() < until) { /* jeda singkat sinkron */ }
    }
  }
  // Tetap gagal: tulis langsung (kehilangan atomisitas, tetapi cadangan .bak sudah ada) daripada menjatuhkan orkestrator.
  try { writeFileSync(file, JSON.stringify(data, null, 2)); } catch { throw lastErr; }
  try { unlinkSync(tmp); } catch { /* sudah hilang */ }
}

/** Baca JSON; bila rusak pakai .bak; bila keduanya tidak ada/rusak kembalikan fallback. */
export function readJsonSafe(file, fallback) {
  for (const f of [file, `${file}.bak`]) {
    try { if (existsSync(f)) return JSON.parse(strip(readFileSync(f, 'utf8'))); } catch { /* coba berikutnya */ }
  }
  return fallback;
}
