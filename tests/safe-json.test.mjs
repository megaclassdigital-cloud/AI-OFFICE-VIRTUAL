import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, utimesSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeJsonAtomic, readJsonSafe } from '../scripts/safe-json.mjs';
import { acquireLock } from '../scripts/heartbeat.mjs';

describe('safe-json (tahan mati listrik)', () => {
  it('menulis atomik dan menyimpan cadangan yang baik', () => {
    const d = mkdtempSync(path.join(os.tmpdir(), 'sj-')); const f = path.join(d, 's.json');
    writeJsonAtomic(f, { a: 1 }); writeJsonAtomic(f, { a: 2 });
    expect(JSON.parse(readFileSync(f, 'utf8'))).toEqual({ a: 2 });
    expect(JSON.parse(readFileSync(f + '.bak', 'utf8'))).toEqual({ a: 1 });
  });
  it('berkas utama terpotong -> jatuh ke cadangan; tidak ada apa-apa -> fallback', () => {
    const d = mkdtempSync(path.join(os.tmpdir(), 'sj-')); const f = path.join(d, 's.json');
    writeJsonAtomic(f, { ok: true }); writeJsonAtomic(f, { ok: true, n: 2 });
    writeFileSync(f, '{"ok":tr'); // terpotong saat listrik mati
    expect(readJsonSafe(f, null)).toEqual({ ok: true });
    expect(readJsonSafe(path.join(d, 'tidak-ada.json'), { x: 1 })).toEqual({ x: 1 });
  });
  it('kunci proses dari sebelum boot dianggap basi walau PID-nya "hidup"', () => {
    const d = mkdtempSync(path.join(os.tmpdir(), 'lk-')); const root = d;
    const lock = path.join(root, 'workspace', 'x.lock');
    expect(acquireLock(root, 'x', () => true).ok).toBe(true); // tulis kunci milik proses ini
    writeFileSync(lock, '999999');
    expect(acquireLock(root, 'x', () => true).ok).toBe(false); // baru ditulis + PID hidup -> ditolak
    const old = new Date(Date.now() - os.uptime() * 1000 - 3_600_000); utimesSync(lock, old, old);
    expect(acquireLock(root, 'x', () => true).ok).toBe(true); // ditulis sebelum boot -> basi
    expect(existsSync(lock)).toBe(true);
  });
});
