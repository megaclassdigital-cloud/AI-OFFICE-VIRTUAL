#!/usr/bin/env node
// owner-pin.mjs — PIN owner untuk tombol approve/reject di Office View (ADR-0004).
// Yang tersimpan di .env hanya HASH (scrypt + salt); PIN diketik owner sendiri dan tidak pernah dicatat/ditampilkan.
// Catatan jujur: PIN melindungi JALUR TOMBOL. Token owner di .env tetap dapat dibaca proses di mesin ini (FIX-G3-02, terpisah).
//
// Pemakaian (owner, di terminalnya sendiri):  node scripts/owner-pin.mjs set
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MIN_PIN = 6;
const KEY = 'AAO_OWNER_PIN_HASH';

export function hashPin(pin, salt = randomBytes(16)) {
  if (typeof pin !== 'string' || pin.length < MIN_PIN || pin.length > 64) throw new Error(`PIN harus ${MIN_PIN}-64 karakter`);
  return `scrypt$${salt.toString('hex')}$${scryptSync(pin, salt, 32).toString('hex')}`;
}

export function verifyPin(pin, stored) {
  const m = /^scrypt\$([0-9a-f]{32})\$([0-9a-f]{64})$/.exec(String(stored ?? ''));
  if (!m || typeof pin !== 'string' || pin.length === 0 || pin.length > 64) return false;
  const got = scryptSync(pin, Buffer.from(m[1], 'hex'), 32);
  return timingSafeEqual(got, Buffer.from(m[2], 'hex'));
}

export function readPinHash(envFile = path.join(repoRoot, '.env')) {
  if (!existsSync(envFile)) return null;
  const m = new RegExp(`^${KEY}=(.+)$`, 'm').exec(readFileSync(envFile, 'utf8').replace(/\r/g, ''));
  return m ? m[1].trim() : null;
}

export function writePinHash(hash, envFile = path.join(repoRoot, '.env')) {
  const text = existsSync(envFile) ? readFileSync(envFile, 'utf8') : '';
  const line = `${KEY}=${hash}`;
  const re = new RegExp(`^${KEY}=.*$`, 'm');
  writeFileSync(envFile, re.test(text) ? text.replace(re, line) : `${text}${text && !text.endsWith('\n') ? '\n' : ''}${line}\n`, 'utf8');
}

/** Pembatas percobaan salah: max gagal dalam windowMs => terkunci sampai jendela berlalu. */
export function createLimiter({ max = 5, windowMs = 10 * 60_000, now = Date.now } = {}) {
  let fails = [];
  const prune = () => { const t = now(); fails = fails.filter((x) => t - x < windowMs); };
  return {
    check() { prune(); return fails.length >= max ? { locked: true, retryAfterMs: windowMs - (now() - fails[0]) } : { locked: false, retryAfterMs: 0 }; },
    fail() { prune(); fails.push(now()); },
    ok() { fails = []; },
  };
}

async function promptHidden(question) {
  process.stdout.write(question);
  return new Promise((resolve) => {
    let buf = '';
    process.stdin.setRawMode?.(true); process.stdin.resume(); process.stdin.setEncoding('utf8');
    const on = (chunk) => {
      for (const c of chunk) {
        if (c === '\r' || c === '\n') { process.stdin.setRawMode?.(false); process.stdin.pause(); process.stdin.off('data', on); process.stdout.write('\n'); return resolve(buf); }
        if (c === '\u0003') process.exit(130);
        if (c === '\u007f' || c === '\b') buf = buf.slice(0, -1); else buf += c;
      }
    };
    process.stdin.on('data', on);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== 'set') { console.error('Pemakaian: node scripts/owner-pin.mjs set'); process.exit(64); }
  if (!process.stdin.isTTY) { console.error('Jalankan di terminal interaktif milik owner (PIN diketik langsung, tidak lewat argumen).'); process.exit(2); }
  const a = await promptHidden(`PIN baru (${MIN_PIN}+ karakter, tidak ditampilkan): `);
  const b = await promptHidden('Ulangi PIN: ');
  if (a !== b) { console.error('PIN tidak sama; dibatalkan.'); process.exit(2); }
  try { writePinHash(hashPin(a)); console.log('PIN tersimpan (hash di .env). Mulai ulang Office View agar tombol aktif.'); } catch (e) { console.error(e.message); process.exit(2); }
}
