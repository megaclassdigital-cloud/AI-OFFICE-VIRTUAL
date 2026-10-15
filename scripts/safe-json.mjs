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
  try { renameSync(tmp, file); } catch (e) { try { unlinkSync(tmp); } catch { /* sudah hilang */ } throw e; }
}

/** Baca JSON; bila rusak pakai .bak; bila keduanya tidak ada/rusak kembalikan fallback. */
export function readJsonSafe(file, fallback) {
  for (const f of [file, `${file}.bak`]) {
    try { if (existsSync(f)) return JSON.parse(strip(readFileSync(f, 'utf8'))); } catch { /* coba berikutnya */ }
  }
  return fallback;
}
